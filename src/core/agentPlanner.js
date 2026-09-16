const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "i", "in", "into",
  "is", "it", "me", "my", "of", "on", "please", "the", "this", "to", "use", "using", "want", "with",
]);

const INTENT_GROUPS = [
  ["analyze", "analysis", "inspect", "measure", "quantify", "statistics", "stats"],
  ["detect", "find", "identify", "locate", "recognize"],
  ["segment", "segmentation", "mask", "outline"],
  ["convert", "export", "transform"],
  ["plot", "chart", "graph", "render", "visualize", "map"],
  ["solve", "astrometry", "plate"],
  ["stack", "combine", "merge"],
  ["batch", "folder", "directory", "many", "multiple"],
  ["cell", "cells", "microscopy", "biological"],
  ["grain", "grains", "microstructure", "material"],
  ["star", "stars", "astronomy", "astronomical", "fits"],
];

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value) {
  return [...new Set(normalize(value).split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
}

function expandedTokens(value) {
  const found = new Set(tokens(value));
  for (const group of INTENT_GROUPS) {
    if (group.some((word) => found.has(word))) group.forEach((word) => found.add(word));
  }
  return found;
}

function commandScore(command, message) {
  const request = expandedTokens(message);
  const name = normalize(command.displayName || command.name);
  const nameTokens = expandedTokens(name);
  const descriptionTokens = expandedTokens(command.displayDescription || command.description);
  const fieldTokens = expandedTokens((command.args || []).map((field) => `${field.displayLabel || field.label} ${field.displayHelp || field.help}`).join(" "));
  let score = name && normalize(message).includes(name) ? 30 : 0;
  for (const word of request) {
    if (nameTokens.has(word)) score += 8;
    else if (descriptionTokens.has(word)) score += 3;
    else if (fieldTokens.has(word)) score += 1;
  }
  return score;
}

function mentionedChoice(field, message) {
  const normalized = normalize(message);
  return (field.choices || []).find((choice) => {
    const candidate = normalize(choice);
    return candidate && new RegExp(`(?:^|\\s)${candidate.replace(/\s+/g, "\\s+")}(?:$|\\s)`).test(normalized);
  });
}

function inferredValues(command, message) {
  const values = {};
  const normalized = normalize(message);
  for (const field of command.args || []) {
    if (field.section === "hidden") continue;
    if (field.control === "select") {
      const choice = mentionedChoice(field, message);
      if (choice !== undefined) values[field.id] = choice;
    } else if (field.control === "boolean") {
      const label = normalize(field.displayLabel || field.label);
      if (label && normalized.includes(label)) {
        values[field.id] = !new RegExp(`\\b(?:no|without|disable)\\s+${label.replace(/\s+/g, "\\s+")}`).test(normalized);
      }
    } else if (field.control === "number") {
      const labelWords = tokens(field.displayLabel || field.label).join("\\s+");
      if (!labelWords) continue;
      const match = normalized.match(new RegExp(`(?:${labelWords})\\s*(?:is|of|=|:)?\\s*(-?\\d+(?:\\.\\d+)?)`));
      if (match) values[field.id] = match[1];
    }
    const identity = normalize(`${field.id} ${field.label} ${field.displayLabel} ${field.help} ${field.displayHelp}`);
    if (values[field.id] === undefined && field.required && !field.default
      && field.control === "text" && /\b(output|out|destination|export|save)\b/.test(identity)) {
      values[field.id] = "repopilot-output";
    }
  }
  return values;
}

function attachmentAssignments(command, attachments) {
  if (!attachments.length) return [];
  const candidates = (command.args || []).filter((field) => field.required && field.section !== "hidden" && (
    field.control === "file" || (field.control === "choice-group" && field.variants?.some((variant) => variant.control === "file"))
  ));
  const assignments = [];
  let nextAttachment = 0;
  for (const field of candidates) {
    if (nextAttachment >= attachments.length) break;
    const variant = field.control === "choice-group" ? field.variants.find((item) => item.control === "file") : null;
    const multiple = field.multiple || variant?.multiple;
    const indexes = multiple ? attachments.map((_item, index) => index).slice(nextAttachment) : [nextAttachment];
    assignments.push({ fieldId: field.id, attachmentIndexes: indexes, variantId: variant?.id || null });
    nextAttachment = multiple ? attachments.length : nextAttachment + 1;
  }
  return assignments;
}

function missingInputs(command, values, assignedFieldIds = new Set()) {
  return (command.args || []).filter((field) => {
    if (field.section === "hidden" || !field.required || values[field.id] !== undefined || assignedFieldIds.has(field.id)) return false;
    if (field.control === "choice-group") return true;
    return field.default === undefined || field.default === null || String(field.default).trim() === "";
  }).map((field) => ({
    id: field.id,
    label: field.displayLabel || field.label,
    control: field.control,
  }));
}

function planUserRequest(spec, message, attachments = []) {
  const request = String(message || "").trim();
  if (!request) throw new Error("Describe what you want the repository to do.");
  const commands = spec?.commands || [];
  if (!commands.length) throw new Error("This repository does not have a ready-to-use task yet.");

  const attachmentContext = attachments.map((attachment) => attachment.name).join(" ");
  const ranked = commands.map((command, index) => ({ command, index, score: commandScore(command, `${request} ${attachmentContext}`) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  const alternatives = ranked.slice(1, 4).filter((item) => item.score > 0)
    .map((item) => ({ commandId: item.command.id, name: item.command.displayName || item.command.name }));

  if (commands.length > 1 && best.score === 0) {
    return {
      status: "clarify",
      message: "I could not confidently match that request to a task. Try naming the result you want, such as detect, segment, analyze, convert, or plot.",
      alternatives: commands.slice(0, 3).map((command) => ({ commandId: command.id, name: command.displayName || command.name })),
    };
  }

  const values = inferredValues(best.command, request);
  const assignments = attachmentAssignments(best.command, attachments);
  const missing = missingInputs(best.command, values, new Set(assignments.map((assignment) => assignment.fieldId)));
  const commandName = best.command.displayName || best.command.name;
  return {
    status: "planned",
    commandId: best.command.id,
    commandName,
    confidence: best.score >= 16 || commands.length === 1 ? "high" : "medium",
    values,
    attachmentAssignments: assignments,
    missing,
    alternatives,
    message: missing.length
      ? `I selected ${commandName}. Add ${missing.map((field) => field.label).join(", ")} in the form, then review and run it.`
      : `I selected ${commandName} and prepared the available settings. Review them before running it.`,
  };
}

module.exports = { commandScore, planUserRequest };
