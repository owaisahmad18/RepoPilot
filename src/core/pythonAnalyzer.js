const fs = require("node:fs/promises");
const path = require("node:path");

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "build",
  "site-packages",
  "data",
  "datasets",
  "docs",
  "examples",
  "test",
  "tests",
]);

async function listPythonFiles(root) {
  const results = [];
  const queue = [root];
  while (queue.length && results.length < 1000) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= 1000) break;
      if (entry.isFile() && entry.name.endsWith(".py")) results.push(path.join(current, entry.name));
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) queue.push(path.join(current, entry.name));
    }
  }
  return results;
}

async function readIfPresent(filePath) {
  try { return await fs.readFile(filePath, "utf8"); }
  catch { return ""; }
}

function parseEntrypointLines(source) {
  const entries = [];
  const tomlPattern = /^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([A-Za-z_][A-Za-z0-9_.]*):([A-Za-z_][A-Za-z0-9_]*)["']/gm;
  const setupPattern = /["']([A-Za-z0-9_.-]+)\s*=\s*([A-Za-z_][A-Za-z0-9_.]*):([A-Za-z_][A-Za-z0-9_]*)["']/g;
  const setupBlockPattern = /^\s*([A-Za-z0-9_.-]+)\s*=\s*([A-Za-z_][A-Za-z0-9_.]*):([A-Za-z_][A-Za-z0-9_]*)\s*$/gm;
  for (const pattern of [tomlPattern, setupPattern, setupBlockPattern]) {
    for (const match of source.matchAll(pattern)) entries.push({ name: match[1], module: match[2], callable: match[3] });
  }
  return entries;
}

async function discoverPythonEntrypoints(repoPath) {
  const manifests = [];
  const queue = [{ directory: repoPath, depth: 0 }];
  while (queue.length && manifests.length < 50) {
    const { directory, depth } = queue.shift();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && ["pyproject.toml", "setup.py"].includes(entry.name)) manifests.push(path.join(directory, entry.name));
    }
    if (depth >= 3) continue;
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
        queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
      }
    }
  }

  const discovered = [];
  for (const manifest of manifests) {
    const projectDirectory = path.dirname(manifest);
    const source = await readIfPresent(manifest);
    let scriptsBlock = "";
    if (path.basename(manifest) === "pyproject.toml") {
      const sectionMarker = "[project.scripts]";
      const sectionStart = source.indexOf(sectionMarker);
      if (sectionStart !== -1) {
        const remainder = source.slice(sectionStart + sectionMarker.length);
        const nextSection = remainder.search(/^\s*\[/m);
        scriptsBlock = nextSection === -1 ? remainder : remainder.slice(0, nextSection);
      }
    }
    const sourceDirectory = source.match(/where\s*=\s*\[\s*["']([^"']+)["']/)?.[1]
      || source.match(/package-dir\s*=\s*\{\s*["']["']\s*=\s*["']([^"']+)["']/)?.[1]
      || source.match(/package_dir\s*=\s*\{\s*["']["']\s*:\s*["']([^"']+)["']/)?.[1]
      || "";
    const sourceRoot = sourceDirectory ? path.resolve(projectDirectory, sourceDirectory) : projectDirectory;
    discovered.push(...parseEntrypointLines(scriptsBlock || source).map((entry) => ({ ...entry, sourceRoot })));
  }
  const entries = discovered;
  const unique = entries.filter((entry, index) => entries.findIndex((other) => other.name === entry.name && other.module === entry.module) === index);
  const canonical = unique.find((entry) => entry.name.toLowerCase() === entry.module.split(".")[0].toLowerCase());
  return canonical ? [canonical] : unique;
}

function moduleNameFor(root, filePath) {
  let module = path.relative(root, filePath).replace(/\\/g, "/").replace(/\.py$/, "").replace(/\/__init__$/, "");
  return module.replace(/\//g, ".");
}

function importedModules(source) {
  const modules = [];
  for (const match of source.matchAll(/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/gm)) modules.push({ module: match[1], index: match.index });
  for (const match of source.matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)/gm)) modules.push({ module: match[1], index: match.index });
  return modules;
}

function routeBeforeImport(source, importIndex) {
  const before = source.slice(Math.max(0, importIndex - 500), importIndex);
  const matches = [...before.matchAll(/(?:if|elif)\s+command\s*==\s*["']([^"']+)["']/g)];
  return matches.at(-1)?.[1] || "";
}

async function entrypointReachability(repoPath, files, entrypoints) {
  const fileByModule = new Map();
  const roots = [repoPath, ...new Set(entrypoints.map((entry) => entry.sourceRoot).filter(Boolean))];
  for (const filePath of files) for (const root of roots) {
    const relative = path.relative(root, filePath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) fileByModule.set(moduleNameFor(root, filePath), filePath);
  }
  const reachable = new Map();
  for (const entrypoint of entrypoints) {
    const launcher = fileByModule.get(entrypoint.module);
    if (!launcher) continue;
    const queue = [{ filePath: launcher, prefixArgs: [] }];
    const visited = new Set();
    while (queue.length && visited.size < 300) {
      const current = queue.shift();
      const key = `${current.filePath}\0${current.prefixArgs.join("\0")}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const relative = path.relative(repoPath, current.filePath).replace(/\\/g, "/");
      const mapping = { entrypoint: entrypoint.name, module: entrypoint.module, sourceRoot: entrypoint.sourceRoot, launcher, prefixArgs: current.prefixArgs };
      const existing = reachable.get(relative) || [];
      if (!existing.some((item) => item.launcher === launcher && item.prefixArgs.join("\0") === current.prefixArgs.join("\0"))) {
        existing.push(mapping);
        reachable.set(relative, existing);
      }
      const source = await readIfPresent(current.filePath);
      for (const imported of importedModules(source)) {
        const importedFile = fileByModule.get(imported.module);
        if (!importedFile) continue;
        const route = current.filePath === launcher ? routeBeforeImport(source, imported.index) : "";
        queue.push({ filePath: importedFile, prefixArgs: route ? [route] : current.prefixArgs });
      }
    }
  }
  return reachable;
}

function extractBalancedCalls(source, marker) {
  const calls = [];
  let searchFrom = 0;
  while (true) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;
    const start = markerIndex + marker.length;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let index = start;

    for (; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    if (depth === 0) calls.push(source.slice(start, index));
    searchFrom = Math.max(index + 1, start);
  }
  return calls;
}

function extractArgumentCalls(source) {
  const calls = [];
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\.add_argument\(/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let index = start;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"') quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")" && --depth === 0) break;
    }
    if (depth === 0) calls.push({ body: source.slice(start, index), receiver: match[1] });
  }
  return calls;
}

function requiredExclusiveGroups(source) {
  return new Set([...source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^\n]*\.add_mutually_exclusive_group\s*\(\s*required\s*=\s*True/g)]
    .map((match) => match[1]));
}

function readStringKeyword(call, keyword) {
  const pattern = new RegExp(`${keyword}\\s*=\\s*(["'])([\\s\\S]*?)\\1`);
  const match = call.match(pattern);
  return match ? match[2].replace(/\\n/g, " ") : "";
}

function readSimpleKeyword(call, keyword) {
  const pattern = new RegExp(`${keyword}\\s*=\\s*([A-Za-z_][A-Za-z0-9_.]*|-?\\d+(?:\\.\\d+)?)`);
  return call.match(pattern)?.[1] ?? "";
}

function extractNames(call) {
  const prefix = call.split(/\b(?:action|choices|default|dest|help|nargs|required|type)\s*=/)[0];
  return [...prefix.matchAll(/(["'])(.*?)\1/g)].map((match) => match[2]);
}

function parseChoices(call) {
  const match = call.match(/choices\s*=\s*[\[(]([^\])]+)[\])]/);
  if (!match) return [];
  const quoted = [...match[1].matchAll(/(["'])(.*?)\1/g)].map((item) => item[2]);
  if (quoted.length) return quoted;
  return match[1].split(",").map((item) => item.trim()).filter(Boolean);
}

function parseDefault(call) {
  const stringValue = readStringKeyword(call, "default");
  if (stringValue) return stringValue;
  const raw = readSimpleKeyword(call, "default");
  if (raw === "True") return true;
  if (raw === "False") return false;
  if (raw === "None" || raw === "") return "";
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : "";
}

function toLabel(value) {
  return value.replace(/^--?/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferFileDetails(names, help) {
  const text = `${names.join(" ")} ${help}`.toLowerCase();
  const isFile = /\b(file|files|filename|document|image|images|spreadsheet|archive|csv|tsv|fits?|tiff?|svs|czi|nd2|lif|dicom|nifti|pdb)\b/.test(text)
    && !/\b(output|destination|save|write|create|report)\b/.test(text);
  if (!isFile) return { isFile: false, accept: "", formatHint: "" };

  const formats = [
    ["ome.tiff", ".ome.tif,.ome.tiff"], ["ome.tif", ".ome.tif,.ome.tiff"],
    ["czi", ".czi"], ["nd2", ".nd2"], ["lif", ".lif"], ["svs", ".svs"],
    ["dicom", ".dcm,.dicom"], ["nifti", ".nii,.nii.gz"], ["fits", ".fits,.fit,.fts"],
    ["tiff", ".tif,.tiff"], ["tif", ".tif,.tiff"],
    ["fastq", ".fastq,.fq,.fastq.gz,.fq.gz"], ["fasta", ".fasta,.fa,.fna,.fasta.gz,.fa.gz"],
    ["bam", ".bam"], ["cram", ".cram"], ["pdb", ".pdb"], ["feather", ".feather"],
    ["pickle", ".pickle,.pkl"], ["audio", "audio/*"],
    ["json", ".json"], ["csv", ".csv"], ["tsv", ".tsv"], ["yaml", ".yaml,.yml"],
    ["text", ".txt"], ["markdown", ".md"], ["pdf", ".pdf"], ["image", "image/*"],
    ["zip", ".zip"],
  ];
  const match = formats.find(([word]) => text.includes(word));
  return {
    isFile: true,
    accept: match?.[1] || "",
    formatHint: match ? `Choose a ${match[1].replace(",", " or ")} file.` : "Choose the input file required by this command.",
  };
}

function formatHintFor(control, type, choices) {
  if (control === "number") return type === "float" ? "Enter a number, for example 2.5." : "Enter a whole number, for example 10.";
  if (control === "select") return `Choose one value: ${choices.join(", ")}.`;
  if (control === "boolean") return "Select to include this command flag.";
  return "Enter the value exactly as the command expects it.";
}

function parseArgument(call, index, metadata = {}) {
  const names = extractNames(call);
  if (!names.length || names.some((name) => /[%{}]/.test(name)) || /help\s*=\s*argparse\.SUPPRESS/.test(call)) return null;

  const option = names.find((name) => name.startsWith("--"))
    || names.find((name) => name.startsWith("-"))
    || null;
  const action = readStringKeyword(call, "action");
  if (["help", "version"].includes(action)) return null;
  const choices = parseChoices(call);
  const type = readSimpleKeyword(call, "type").split(".").pop();
  const fallbackName = option || names[0] || `argument-${index + 1}`;
  const help = readStringKeyword(call, "help");
  const fileDetails = inferFileDetails(names, help);
  let control = "text";
  if (["store_true", "store_false"].includes(action)) control = "boolean";
  else if (choices.length) control = "select";
  else if (["int", "float"].includes(type)) control = "number";
  else if (fileDetails.isFile) control = "file";

  return {
    id: `${fallbackName.replace(/^-+/, "").replace(/[^A-Za-z0-9_-]/g, "-")}-${index}`,
    names,
    option,
    positional: option === null,
    label: toLabel(fallbackName),
    help,
    required: readSimpleKeyword(call, "required") === "True" || option === null,
    action,
    type: type || "str",
    control,
    choices,
    default: parseDefault(call),
    accept: fileDetails.accept,
    formatHint: fileDetails.formatHint || formatHintFor(control, type, choices),
    multiple: ["+", "*"].includes(readStringKeyword(call, "nargs")),
    exclusiveGroup: metadata.exclusiveGroup || "",
    exclusiveRequired: Boolean(metadata.exclusiveRequired),
  };
}

function extractDescription(source) {
  const calls = extractBalancedCalls(source, "ArgumentParser(");
  return calls.length ? readStringKeyword(calls[0], "description") : "";
}

function looksRunnable(relativePath, source) {
  const base = path.basename(relativePath).toLowerCase();
  return /if\s+__name__\s*==\s*["']__main__["']/.test(source)
    || ["cli.py", "main.py", "__main__.py"].includes(base);
}

function subparserDefinitions(source) {
  const definitions = new Map();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[A-Za-z_][A-Za-z0-9_]*\.add_parser\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const calls = extractBalancedCalls(source.slice(match.index), ".add_parser(");
    if (!calls.length) continue;
    const names = extractNames(calls[0]);
    if (!names.length) continue;
    definitions.set(match[1], { name: names[0], help: readStringKeyword(calls[0], "help") });
  }
  return definitions;
}

function argumentGroupOwners(source) {
  const owners = new Map();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.(?:add_argument_group|add_mutually_exclusive_group)\s*\(/g;
  for (const match of source.matchAll(pattern)) owners.set(match[1], match[2]);
  return owners;
}

async function analyzePythonRepository(repoPath, metadata = {}) {
  const files = await listPythonFiles(repoPath);
  const entrypoints = await discoverPythonEntrypoints(repoPath);
  const reachable = entrypoints.length ? await entrypointReachability(repoPath, files, entrypoints) : new Map();
  const commands = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    if (!source.includes("argparse") || !source.includes("add_argument")) continue;
    const relativePath = path.relative(repoPath, filePath).replace(/\\/g, "/");
    if (/(?:^|\/)(?:test|tests|bench|benchmark|examples?)(?:\/|_|\.|$)/i.test(relativePath)) continue;
    const exclusiveGroups = requiredExclusiveGroups(source);
    const argumentCalls = extractArgumentCalls(source);
    const parsedArguments = argumentCalls.map((call, index) => ({ receiver: call.receiver, field: parseArgument(call.body, index, {
      exclusiveGroup: exclusiveGroups.has(call.receiver) ? call.receiver : "",
      exclusiveRequired: exclusiveGroups.has(call.receiver),
    }) })).filter((item) => item.field);
    if (!parsedArguments.length) continue;

    const subparsers = subparserDefinitions(source);
    const groupOwners = argumentGroupOwners(source);
    const owningReceiver = (receiver) => groupOwners.get(receiver) || receiver;
    const baseArgs = parsedArguments.filter((item) => !subparsers.has(owningReceiver(item.receiver))).map((item) => item.field);
    const variants = [...subparsers].map(([receiver, definition]) => ({
      definition,
      args: [...baseArgs, ...parsedArguments.filter((item) => owningReceiver(item.receiver) === receiver).map((item) => item.field)],
    })).filter((variant) => variant.args.length > baseArgs.length);
    const commandVariants = variants.length ? variants : [{ definition: null, args: baseArgs }];

    for (const variant of commandVariants) {
      if (!variant.args.length) continue;
      const subcommand = variant.definition?.name || "";
      commands.push({
        id: `${relativePath}-${subcommand}`.replace(/[^A-Za-z0-9_-]/g, "-"),
        name: subcommand || path.basename(relativePath, ".py"),
        description: variant.definition?.help || extractDescription(source),
        entry: relativePath,
        runtime: "python",
        localPrefixArgs: subcommand ? [subcommand] : [],
        confidence: looksRunnable(relativePath, source) ? "high" : "review",
        args: variant.args,
      });
    }
  }

  commands.sort((left, right) => {
    if (left.confidence !== right.confidence) return left.confidence === "high" ? -1 : 1;
    return left.entry.localeCompare(right.entry);
  });

  const publicCommands = entrypoints.length ? commands.flatMap((command) => {
    const mappings = reachable.get(command.entry) || [];
    return mappings.map((mapping) => {
      const prefixArgs = [...mapping.prefixArgs, ...(command.localPrefixArgs || [])];
      return {
        ...command,
        id: `python-${mapping.entrypoint}-${prefixArgs.join("-") || "main"}`.replace(/[^A-Za-z0-9_-]/g, "-"),
        name: prefixArgs.length ? prefixArgs.join(" ") : mapping.entrypoint,
        entry: path.relative(repoPath, mapping.launcher).replace(/\\/g, "/"),
        module: mapping.module,
        moduleRoot: path.relative(repoPath, mapping.sourceRoot || repoPath).replace(/\\/g, "/"),
        prefixArgs,
        confidence: "high",
      };
    });
  }).filter((command, index, all) => all.findIndex((item) => item.id === command.id) === index) : commands;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: {
      owner: metadata.owner || "",
      name: metadata.repo || path.basename(repoPath),
      url: metadata.cloneUrl || "",
      localPath: repoPath,
    },
    analyzer: "python-argparse-static-v1",
    commands: publicCommands,
  };
}

module.exports = {
  analyzePythonRepository,
  discoverPythonEntrypoints,
  extractBalancedCalls,
  extractArgumentCalls,
  parseArgument,
};
