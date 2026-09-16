const { analyzePythonRepository } = require("./pythonAnalyzer");
const { analyzeRustRepository } = require("./rustAnalyzer");
const { analyzePhpLibrary } = require("./phpLibraryAnalyzer");
const { analyzeInteractiveScienceRepository } = require("./interactiveScienceAnalyzer");
const { analyzePythonClickRepository } = require("./pythonClickAnalyzer");
const { analyzePythonAbslRepository } = require("./pythonAbslAnalyzer");
const { analyzeJupyterNotebooks } = require("./jupyterNotebookAnalyzer");
const { profileRepository } = require("./repositoryProfiler");
const { enrichField } = require("./fieldPresentation");
const { compatibilityFor } = require("./compatibility");
const { enhanceInterfaceWithAgent } = require("./agenticInterfaceBuilder");

function displayName(name) {
  const replacements = new Map([
    ["api", "API"], ["ci", "CI"], ["cli", "CLI"], ["eval", "Evaluation"],
    ["ff", "Force Field"], ["json", "JSON"], ["kb", "Knowledge Base"], ["pdb", "PDB"],
    ["pr", "PR"], ["stt", "Speech-to-text"], ["wer", "Accuracy"], ["xrd", "X-ray Diffraction"],
  ]);
  return String(name || "Task").split(/[-_\s]+/).filter(Boolean)
    .map((word) => replacements.get(word.toLowerCase()) || `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function displayDescription(description) {
  return String(description || "")
    .replace(/\bWER\b/g, "transcription accuracy")
    .replace(/\bSTT\b/g, "speech-to-text")
    .replace(/\bPR\b/g, "pull request");
}

function collapseExclusiveGroups(args) {
  const groups = new Map();
  for (const field of args) {
    if (!field.exclusiveGroup || !field.exclusiveRequired) continue;
    const members = groups.get(field.exclusiveGroup) || [];
    members.push(field);
    groups.set(field.exclusiveGroup, members);
  }
  const collapsed = new Set([...groups].filter(([, members]) => members.length > 1).map(([name]) => name));
  const emitted = new Set();
  const result = [];
  for (const field of args) {
    if (!collapsed.has(field.exclusiveGroup)) {
      result.push(field);
      continue;
    }
    if (emitted.has(field.exclusiveGroup)) continue;
    emitted.add(field.exclusiveGroup);
    const variants = groups.get(field.exclusiveGroup);
    result.push({
      id: `input-${field.exclusiveGroup}`,
      label: "Input source",
      displayLabel: "Input data",
      displayHelp: "Choose the kind of scientific data you want to analyze, then select or enter it.",
      control: "choice-group",
      required: true,
      default: variants[0].id,
      variants,
      section: "primary",
      names: [],
      option: null,
      positional: false,
    });
  }
  return result;
}

function taskPriority(command) {
  const text = `${command.name || ""} ${command.displayName || ""} ${command.description || ""}`.toLowerCase();
  const fields = command.args || [];
  let score = Number(command.userPriority || 0);
  if (/\b(analy[sz]e|analysis|detect|denois(?:e|ing)|evaluat(?:e|ion)|segment|process|run|solve|inspect|convert|render|measure|quantif(?:y|ication)|photometry|stack)\b/.test(text)) score += 100;
  if (fields.some((field) => field.section === "primary" && ["file", "directory", "choice-group"].includes(field.control))) score += 30;
  if (fields.some((field) => /\b(image|images|scan|slide|fits|microstructure|data)\b/i.test(`${field.displayLabel || ""} ${field.displayHelp || ""}`))) score += 15;
  if (/\b(setup|install|download|serve|server|worker|list|train|register|promote|delete|rebuild|clean|version)\b/.test(text)) score -= 100;
  if (fields.length && !fields.some((field) => field.section === "primary")) score -= 10;
  return score;
}

function prioritizeTasks(commands) {
  return commands.map((command, index) => ({ command, index, priority: taskPriority(command) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(({ command }) => command);
}

async function analyzeRepository(repoPath, metadata = {}, options = {}) {
  const profile = await profileRepository(repoPath);
  const analyzers = [analyzePythonRepository, analyzePythonClickRepository, analyzePythonAbslRepository, analyzeRustRepository, analyzePhpLibrary, analyzeInteractiveScienceRepository, analyzeJupyterNotebooks];
  const results = await Promise.all(analyzers.map((analyze) => analyze(repoPath, metadata)));
  const hasNativeCommands = results.some((result) => result.analyzer !== "jupyter-notebook-static-v1" && result.commands.length);
  const prioritizedCommands = prioritizeTasks(results.flatMap((result) => (
    hasNativeCommands && result.analyzer === "jupyter-notebook-static-v1" ? [] : result.commands
  ))
    .map((command) => ({
      kind: "command",
      ...command,
      displayName: command.displayName || (String(command.name).toLowerCase() === String(results[0].repository.name).toLowerCase()
        ? results[0].repository.name : displayName(command.name)),
      displayDescription: command.displayDescription || displayDescription(command.description),
      args: collapseExclusiveGroups(command.args.map(enrichField)),
    })));
  const commands = prioritizedCommands.map((command) => ({
    ...command,
    compatibility: compatibilityFor(repoPath, command),
  }));
  const hasWorkflow = commands.some((command) => command.kind === "workflow");
  const isNotebookRepository = commands.length > 0 && commands.every((command) => command.runtime === "jupyter-notebook");
  const detectedLibrary = results.some((result) => result.detected);
  profile.kind = isNotebookRepository ? "notebook" : hasWorkflow ? "library" : commands.length ? "command-line" : detectedLibrary ? "library" : "unknown";

  const baseSpec = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    repository: results[0].repository,
    profile,
    analyzers: results.filter((result) => result.commands.length || result.detected).map((result) => result.analyzer),
    commands,
  };
  const enhanced = await enhanceInterfaceWithAgent(repoPath, baseSpec, options.agent || {});
  enhanced.commands = enhanced.commands.map((command) => ({
    ...command,
    compatibility: compatibilityFor(repoPath, command),
  }));
  return enhanced;
}

module.exports = { analyzeRepository, prioritizeTasks, taskPriority };
