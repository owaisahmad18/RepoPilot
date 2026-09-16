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

function moduleNameFor(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/").replace(/\.py$/, "").replace(/\/__init__$/, "").replace(/\//g, ".");
}

function quotedValues(source) {
  return [...source.matchAll(/(["'])(.*?)\1/g)].map((match) => match[2]);
}

function keywordString(source, keyword) {
  return source.match(new RegExp(`${keyword}\\s*=\\s*(["'])(.*?)\\1`))?.[2] || "";
}

function keywordValue(source, keyword) {
  return source.match(new RegExp(`${keyword}\\s*=\\s*([^,)]+)`))?.[1]?.trim() || "";
}

function labelFor(name) {
  return name.replace(/^--?/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clickField(body, positional, index) {
  const names = quotedValues(body.split(/\b(?:default|help|required|type|is_flag|multiple|nargs)\s*=/)[0]);
  if (!names.length) return null;
  const option = positional ? null : names.find((name) => name.startsWith("--")) || names.find((name) => name.startsWith("-")) || null;
  const rawName = option || names[0];
  const name = rawName.replace(/^-+/, "").replace(/-/g, "_");
  const help = keywordString(body, "help");
  const defaultRaw = keywordValue(body, "default");
  const isFlag = /\bis_flag\s*=\s*True/.test(body);
  const choicesBody = body.match(/(?:click\.)?Choice\s*\(\s*\[([\s\S]*?)\]/)?.[1] || "";
  const choices = quotedValues(choicesBody);
  const typeText = keywordValue(body, "type");
  const context = `${name} ${help} ${typeText}`.toLowerCase();
  const output = /\b(output|out[-_ ]?dir|destination|save|write|export)\b/.test(context);
  const directory = /\b(dir|directory|folder)\b/.test(context) || /file_okay\s*=\s*False/.test(body);
  const file = !output && (/\b(file|files|filename|image|images|slide|fits|svs|tiff?)\b/.test(context) || /click\.Path/.test(typeText));
  let control = isFlag ? "boolean" : choices.length ? "select" : directory && !output ? "directory" : file ? "file" : "text";
  if (/\b(?:int|float)\b/.test(typeText) || /^-?\d+(?:\.\d+)?$/.test(defaultRaw)) control = "number";
  const defaultValue = isFlag ? false : /^-?\d+(?:\.\d+)?$/.test(defaultRaw) ? Number(defaultRaw)
    : defaultRaw.replace(/^(["'])|(["'])$/g, "").replace(/^(None|null)$/i, "");
  const accepts = [];
  if (/\bfits?\b/.test(context)) accepts.push(".fits", ".fit", ".fts");
  if (/\bsvs\b/.test(context)) accepts.push(".svs");
  if (/\btiff?\b/.test(context)) accepts.push(".tif", ".tiff");
  if (/\bimage|filename\b/.test(context) && !accepts.length) accepts.push("image/*");
  return {
    id: `${name}-${index}`, names, option, positional, label: labelFor(rawName), help,
    required: positional || /\brequired\s*=\s*True/.test(body), action: isFlag ? "store_true" : "",
    type: typeText || "str", control, choices, default: defaultValue,
    multiple: /\bmultiple\s*=\s*True/.test(body) || /\bnargs\s*=\s*-1/.test(body),
    accept: accepts.join(","), formatHint: control === "file" ? "Choose the image or data file to process."
      : control === "directory" ? "Choose the folder to process." : "",
  };
}

function commandBlocks(source) {
  const blocks = [];
  const pattern = /((?:^[ \t]*@[^\n]+\n)+)^[ \t]*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  for (const match of source.matchAll(pattern)) {
    const decorators = match[1];
    const isRootGroup = /@(?:click\.)?group\s*\(/.test(decorators);
    const isCommand = /@(?:click\.)?command\s*\(/.test(decorators) || /@[A-Za-z_][A-Za-z0-9_]*\.command\s*\(/.test(decorators);
    if (!isCommand || isRootGroup) continue;
    const commandCall = extractBalancedCalls(decorators, ".command(")[0] || "";
    const explicitName = quotedValues(commandCall)[0] || "";
    const calls = [
      ...extractBalancedCalls(decorators, "click.argument(").map((body) => ({ body, positional: true })),
      ...extractBalancedCalls(decorators, "click.option(").map((body) => ({ body, positional: false })),
    ];
    blocks.push({
      functionName: match[2], name: explicitName || match[2].replace(/_/g, "-"),
      description: keywordString(commandCall, "help"),
      args: calls.map((call, index) => clickField(call.body, call.positional, index)).filter(Boolean),
      isRootCommand: /@click\.command\s*\(/.test(decorators),
    });
  }
  return blocks;
}

async function analyzePythonClickRepository(repoPath, metadata = {}) {
  const files = await listPythonFiles(repoPath);
  const entrypoints = await discoverPythonEntrypoints(repoPath);
  const entryByModule = new Map(entrypoints.map((entry) => [entry.module, entry]));
  const commands = [];
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    if (!source.includes("click") || (!source.includes("@click.") && !source.includes(".command("))) continue;
    const relative = path.relative(repoPath, filePath).replace(/\\/g, "/");
    const module = moduleNameFor(repoPath, filePath);
    const entrypoint = entrypoints.find((entry) => moduleNameFor(entry.sourceRoot || repoPath, filePath) === entry.module);
    const directlyRunnable = /if\s+__name__\s*==\s*["']__main__["']/.test(source);
    if (entrypoints.length && !entrypoint) continue;
    if (!entrypoint && !directlyRunnable) continue;
    for (const block of commandBlocks(source)) {
      const prefixArgs = block.isRootCommand ? [] : [block.name];
      commands.push({
        id: `click-${relative}-${block.name}`.replace(/[^A-Za-z0-9_-]/g, "-"),
        name: block.isRootCommand && entrypoint ? entrypoint.name : block.name,
        description: block.description || `Run the ${block.name.replace(/-/g, " ")} task.`,
        entry: relative, module: entrypoint?.module || "",
        moduleRoot: entrypoint ? path.relative(repoPath, entrypoint.sourceRoot || repoPath).replace(/\\/g, "/") : "",
        runtime: "python",
        prefixArgs, confidence: "high", args: block.args,
      });
    }
  }
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    repository: { owner: metadata.owner || "", name: metadata.repo || path.basename(repoPath), url: metadata.cloneUrl || "", localPath: repoPath },
    analyzer: "python-click-static-v1", commands,
  };
}

module.exports = { analyzePythonClickRepository, clickField, commandBlocks };
