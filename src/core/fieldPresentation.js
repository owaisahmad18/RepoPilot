function contextFor(field) {
  return [
    field.id,
    field.label,
    field.option,
    ...(field.names || []),
    field.help,
    field.type,
    field.formatHint,
    field.exclusiveGroup,
  ].filter(Boolean).join(" ").toLowerCase();
}

function identityFor(field) {
  return [field.id, field.label, field.option, ...(field.names || []), field.exclusiveGroup]
    .filter(Boolean).join(" ").toLowerCase();
}

function inferredControl(field, context) {
  const identity = identityFor(field);
  if (/\b(one-based\s+index|numeric|integer|number\s+of|count|per[-_\s]+batch)\b/.test(context)
    || /^-?\d+(?:\.\d+)?$/.test(String(field.default ?? ""))) return "number";
  if (field.control !== "text") return field.control;
  if (/\b(starttime|endtime|start[-_\s]?time|end[-_\s]?time)\b/.test(identity)) return "datetime-local";
  if (/\b(api[-_\s]?key|token|secret|password)\b/.test(identity)) return "password";
  const pathTyped = /\bpath(?:buf)?\b/.test(context);
  const directoryNamed = /(?:^|[-_\s])(dir|directory|folder)(?:$|[-_\s])/.test(context);
  const isOutput = /\b(output|out[-_\s]?dir|destination|save|write|export|create)\b/.test(context);
  if (directoryNamed && !isOutput) return "directory";
  if (pathTyped && /\b(input|source|file|document|image|archive)\b/.test(context) && !isOutput) return "file";
  return field.control;
}

function extensionExample(context) {
  if (/\bjson\b/.test(context)) return "results.json";
  if (/\bcsv\b/.test(context)) return "results.csv";
  if (/\btsv\b/.test(context)) return "results.tsv";
  if (/\byaml\b|\byml\b/.test(context)) return "config.yaml";
  if (/\bmarkdown\b|\.md\b/.test(context)) return "README.md";
  if (/\bpdf\b/.test(context)) return "document.pdf";
  if (/\bimage\b/.test(context)) return "image.png";
  if (/\btext\b|\.txt\b/.test(context)) return "notes.txt";
  return "output.txt";
}

function placeholderFor(field, control, context) {
  if (["file", "directory", "select", "boolean"].includes(control)) return "";

  if (control === "number") {
    if (/\bpr(?:[-_\s]?number)?\b/.test(context)) return "123";
    if (/\bport\b/.test(context)) return "8080";
    if (/\bwidth\b/.test(context)) return "800";
    if (/\bheight\b/.test(context)) return "600";
    if (/\bangle\b/.test(context)) return "90";
    if (/\bquality\b/.test(context)) return "85";
    if (/\bduration|seconds?|secs?\b/.test(context)) return "30";
    return /\bfloat|number|decimal\b/.test(context) ? "2.5" : "10";
  }

  if (/\b(webhook|url|uri|endpoint)\b/.test(context)) return "https://example.com/webhook";
  if (/\bemail\b/.test(context)) return "name@example.com";
  if (/\b(branch|base branch)\b/.test(context)) return "main";
  if (/\bmodel\b/.test(context)) {
    return /\b(stt|speech|transcri)/.test(context) ? "gpt-4o-transcribe" : "model-name";
  }
  if (/\b(output|destination|save|write|export)\b/.test(context)) return extensionExample(context);
  if (/\b(directory|folder|\bdir\b)\b/.test(context)) return "./path/to/folder";
  if (/\b(file|filename|path|document|image|archive)\b/.test(context)) return extensionExample(context);
  if (/\b(pattern|glob)\b/.test(context)) return "*.txt";
  if (/\b(query|search)\b/.test(context)) return "search term";
  if (/\b(name|title)\b/.test(context)) return "example-name";
  return "example-value";
}

function friendlyLabel(field, control, context) {
  const identity = identityFor(field);
  if (/\bdry[-_\s]?run\b/.test(context)) return "Preview only";
  if (/\bstarttime|start[-_\s]?time\b/.test(identity)) return "Start time (UTC)";
  if (/\bendtime|end[-_\s]?time\b/.test(identity)) return "End time (UTC)";
  if (/\bpdbstructure\b/.test(identity) && /\binput\b/.test(identity)) return "PDB identifier(s)";
  if (/\bpdbstructure\b/.test(identity) && control === "file") return "Protein structure file";
  if (/\bsvs\b/.test(identity) && control === "file") return "Whole-slide image";
  if (/\bfits?[-_\s]?file\b/.test(identity) && control === "file") return "FITS image";
  if (/\binput[-_\s]?scans?\b/.test(identity) && control === "file") return "Input images";
  if (/\bformat\b/.test(identity) && /\b(output|plot|report)\b/.test(context)) return "Output format";
  if (control === "directory" && /\baudio\b/.test(context) && /\.txt|transcript/.test(context)) return "Audio and transcript folder";
  if (/\bpr(?:[-_\s]?number)?\b/.test(context)) return "Pull request number";
  if (/\bduration[-_\s]?(secs?|seconds?)\b/.test(context)) return "Fallback duration (seconds)";
  if (/\bstt\b|speech.to.text|transcri/.test(context) && /\bmodel\b/.test(context)) return "Speech-to-text model";
  if (/\bjson\b/.test(identity) && /\b(write|output|save|result)/.test(context)) return "Detailed report file";
  if (/\bdiscord\b/.test(context) && /\bwebhook\b/.test(context)) return "Discord notifications URL";
  if (/\bbase\b/.test(context) && /\bbranch\b/.test(context)) return "Base branch";
  if (control === "directory" && /^(dir|directory|folder)$/i.test(field.label || "")) return "Folder";
  return field.label;
}

function friendlyHelp(field, control, context) {
  const identity = identityFor(field);
  if (/\bdry[-_\s]?run\b/.test(context)) return "Show what would happen without posting or changing anything.";
  if (control === "directory" && /\baudio\b/.test(context) && /\.txt|transcript/.test(context)) {
    return "Choose a folder containing matching audio and transcript files.";
  }
  if (/\bauto[- ]?detect/.test(context)) return "Detected automatically when the task runs.";
  if (/\bstt\b|speech.to.text|transcri/.test(context) && /\bmodel\b/.test(context)) {
    return "The repository's recommended model is used automatically.";
  }
  if (/\bduration|seconds?|secs?\b/.test(identity) && control === "number") {
    return "Only needed when an audio file does not report its duration.";
  }
  if (/\bjson\b/.test(identity) && /\b(write|output|save|result)/.test(context)) {
    return "Optionally save a detailed report using this filename.";
  }
  return field.help;
}

function sectionFor(field, control, context) {
  const identity = identityFor(field);
  if (field.section) return field.section;
  if (!field.required && /\b(auto[- ]?detect|automatically detected|auto[- ]?generated)\b/.test(context)) return "hidden";
  if (field.required || field.showWhen) return "primary";
  if (control === "directory" && /\baudio\b/.test(context) && /\btranscript|\.txt\b/.test(context)) return "primary";
  if (["file", "directory"].includes(control)
    && /\b(input|source|image|images|scan|scans|slide|data|audio|transcript|folder|directory|dir)\b/.test(identity)
    && !/\b(model|plugins?|temporary|cache|test|file list|output|save|export)\b/.test(identity)) return "primary";
  if (/\b(operation|output format|output name|preview|dry run)\b/.test(context)) return "primary";
  return "advanced";
}

function enrichField(field) {
  const context = contextFor(field);
  const control = inferredControl(field, context);
  return {
    ...field,
    control,
    default: control === "boolean" && /\bdry[-_\s]?run\b/.test(context) ? true : field.default,
    displayLabel: field.displayLabel || friendlyLabel(field, control, context),
    displayHelp: field.displayHelp || friendlyHelp(field, control, context),
    placeholder: field.placeholder || (/\bpdbstructure\b/.test(identityFor(field)) && /\binput\b/.test(identityFor(field))
      ? "1vsn"
      : placeholderFor(field, control, context)),
    section: sectionFor(field, control, context),
  };
}

module.exports = { enrichField, placeholderFor };
