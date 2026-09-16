const fs = require("node:fs/promises");
const path = require("node:path");
const { discoverPythonEntrypoints, extractBalancedCalls } = require("./pythonAnalyzer");

const SKIP = new Set([".git", ".venv", "venv", "node_modules", "data", "datasets", "docs", "examples", "test", "tests"]);

async function listPythonFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length && files.length < 1000) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".py")) files.push(path.join(current, entry.name));
    for (const entry of entries) if (entry.isDirectory() && !SKIP.has(entry.name)) queue.push(path.join(current, entry.name));
  }
  return files;
}

function splitTopLevel(source) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function literal(value) {
  const string = value.match(/^(["'])([\s\S]*)\1$/);
  if (string) return string[2];
  if (value === "True") return true;
  if (value === "False") return false;
  if (value === "None") return "";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return "";
}

function labelFor(value) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseAbslField(kind, body, index, requiredNames) {
  const parts = splitTopLevel(body);
  const name = literal(parts[0]);
  if (typeof name !== "string" || !name) return null;
  const defaultValue = literal(parts[1] || "");
  const help = literal(parts[2] || "") || "";
  const context = `${name} ${help}`.toLowerCase();
  const isOutput = /\b(output|destination|save|write|export|log)\b/.test(context);
  const isDirectory = /\b(dir|directory|folder)\b/.test(context);
  const isFile = (/\b(file|filename|image|scan|scans)\b/.test(`${name}`.replace(/_/g, " "))
    || /\b(?:input|source)\b[^.]{0,30}\b(?:file|image|scan)\b/.test(help.toLowerCase())) && !isOutput;
  let control = kind === "boolean" ? "boolean" : ["integer", "float"].includes(kind) ? "number"
    : kind === "enum" ? "select" : isDirectory && !isOutput ? "directory" : isFile ? "file" : "text";
  const choices = kind === "enum" ? [...(parts[2] || "").matchAll(/(["'])(.*?)\1/g)].map((match) => match[2]) : [];
  return {
    id: `${name}-${index}`, names: [`--${name}`], option: `--${name.replace(/_/g, "-")}`,
    positional: false, label: labelFor(name), help: kind === "enum" ? literal(parts[3] || "") || "" : help,
    required: requiredNames.has(name), action: kind === "boolean" ? "store_true" : "", type: kind,
    control, choices, default: defaultValue, multiple: kind === "list",
    accept: /\bimage|scan\b/.test(context) ? "image/*,.tif,.tiff,.fits,.fit,.svs" : "",
    formatHint: isFile ? "Choose the image, model, or data file required by this analysis." : "",
  };
}

async function analyzePythonAbslRepository(repoPath, metadata = {}) {
  const files = await listPythonFiles(repoPath);
  const entrypoints = await discoverPythonEntrypoints(repoPath);
  const commands = [];
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    if (!/flags\.DEFINE_(?:string|integer|float|boolean|bool|enum|list)\s*\(/.test(source) || !/app\.run\s*\(/.test(source)) continue;
    const relative = path.relative(repoPath, filePath).replace(/\\/g, "/");
    if (/(?:^|\/)(?:test|tests|bench|benchmark|examples?)(?:\/|_|\.|$)/i.test(relative)) continue;
    const module = relative.replace(/\.py$/, "").replace(/\/__init__$/, "").replace(/\//g, ".");
    const entrypoint = entrypoints.find((entry) => entry.module === module);
    if (entrypoints.length && !entrypoint) continue;
    const requiredNames = new Set([...source.matchAll(/flags\.mark_flag_as_required\s*\(\s*(["'])(.*?)\1/g)].map((match) => match[2]));
    const args = [];
    for (const kind of ["string", "integer", "float", "boolean", "bool", "enum", "list"]) {
      for (const body of extractBalancedCalls(source, `flags.DEFINE_${kind}(`)) {
        const field = parseAbslField(kind === "bool" ? "boolean" : kind, body, args.length, requiredNames);
        if (field) args.push(field);
      }
    }
    if (!args.length) continue;
    commands.push({
      id: `absl-${relative}`.replace(/[^A-Za-z0-9_-]/g, "-"), name: entrypoint?.name || path.basename(relative, ".py"),
      description: source.match(/^\s*["']{3}([\s\S]*?)["']{3}/)?.[1]?.trim().split(/\r?\n/)[0] || "Run the repository's image-analysis workflow.",
      entry: relative, module: entrypoint?.module || "", runtime: "python", confidence: "high", args,
    });
  }
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    repository: { owner: metadata.owner || "", name: metadata.repo || path.basename(repoPath), url: metadata.cloneUrl || "", localPath: repoPath },
    analyzer: "python-absl-static-v1", commands,
  };
}

module.exports = { analyzePythonAbslRepository, parseAbslField, splitTopLevel };
