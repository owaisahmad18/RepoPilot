const fs = require("node:fs/promises");
const path = require("node:path");

async function listRustFiles(root, current = root, results = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= 1000) break;
    if ([".git", "target", "node_modules"].includes(entry.name)) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) await listRustFiles(root, fullPath, results);
    else if (entry.isFile() && entry.name.endsWith(".rs")) results.push(fullPath);
  }
  return results;
}

function readQuoted(source, keyword) {
  const match = source.match(new RegExp(`${keyword}\\s*=\\s*(["'])([\\s\\S]*?)\\1`));
  return match?.[2]?.replace(/\\\s*\r?\n\s*/g, " ") || "";
}

function stripRustLineComments(source) {
  const characters = [...source];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < characters.length; index += 1) {
    const char = characters[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || (char === "'" && characters[index + 2] === "'")) {
      quote = char;
      continue;
    }
    if (char === "/" && characters[index + 1] === "/") {
      while (index < characters.length && characters[index] !== "\n") {
        characters[index] = " ";
        index += 1;
      }
    }
  }
  return characters.join("");
}

function getAttributeCalls(source, marker) {
  const scanSource = stripRustLineComments(source);
  const calls = [];
  let searchFrom = 0;
  while (true) {
    const markerIndex = scanSource.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;
    const start = markerIndex + marker.length;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let index = start;
    for (; index < scanSource.length; index += 1) {
      const char = scanSource[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
      } else if (char === '"' || (char === "'" && scanSource[index + 2] === "'")) {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth === 0) calls.push({ body: source.slice(start, index), markerIndex });
    searchFrom = Math.max(index + 1, start);
  }
  return calls;
}

function fieldAfterAttribute(source, body, markerIndex) {
  const start = markerIndex + "#[arg(".length + body.length;
  const tail = source.slice(start + 2, start + 500);
  const match = tail.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,\n]+)/);
  if (!match) return null;
  return { name: match[1], type: match[2].trim() };
}

function docsBeforeAttribute(source, markerIndex) {
  const prefix = source.slice(0, markerIndex);
  const lines = prefix.split(/\r?\n/);
  const docs = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^\s*\/\/\/\s?(.*)$/);
    if (!match) break;
    docs.unshift(match[1].trim());
  }
  return docs.join(" ").replace(/\s+/g, " ").trim();
}

function rustControl(type, attribute) {
  if (/\bbool\b/.test(type) || /ArgAction::SetTrue|ArgAction::SetFalse/.test(attribute)) return "boolean";
  if (/\b(?:u|i)(?:8|16|32|64|128|size)\b|\bf(?:32|64)\b/.test(type)) return "number";
  return "text";
}

function rustFileDetails(field, help) {
  const text = `${field.name} ${help}`.toLowerCase();
  const isFile = /\b(files?|filenames?|documents?|images?|archives?)\b/.test(text)
    && !/\b(output|destination|save|write|create)\b/.test(text);
  if (!isFile) return { isFile: false, accept: "", formatHint: "" };
  const formats = [["fits", ".fits,.fit,.fts"], ["xisf", ".xisf"], ["tiff", ".tif,.tiff"],
    ["json", ".json"], ["csv", ".csv"], ["yaml", ".yaml,.yml"], ["pdf", ".pdf"], ["image", "image/*"]];
  const match = formats.find(([word]) => text.includes(word));
  return {
    isFile: true,
    accept: match?.[1] || "",
    formatHint: match ? `Choose a ${match[1].replace(",", " or ")} file.` : "Choose the input file required by this command.",
  };
}

function parseRustField(source, call, index) {
  if (/\bhide\s*=\s*true\b/.test(call.body)) return null;
  const field = fieldAfterAttribute(source, call.body, call.markerIndex);
  if (!field) return null;

  const explicitLong = readQuoted(call.body, "long");
  const hasLong = explicitLong || /(?:^|,)\s*long(?:\s|,|$)/m.test(call.body);
  const explicitShort = call.body.match(/\bshort\s*=\s*'([^']+)'/)?.[1];
  const hasShort = explicitShort || /(?:^|,)\s*short(?:\s|,|$)/m.test(call.body);
  const longName = explicitLong || field.name.replace(/_/g, "-");
  const option = hasLong ? `--${longName}` : hasShort ? `-${explicitShort || field.name[0]}` : null;
  const help = readQuoted(call.body, "help") || docsBeforeAttribute(source, call.markerIndex);
  const defaultValue = readQuoted(call.body, "default_value");
  const hasDefault = Boolean(defaultValue) || /\bdefault_value_t\s*=/.test(call.body);
  const fileDetails = rustFileDetails(field, help);
  const control = fileDetails.isFile ? "file" : rustControl(field.type, call.body);
  const optionalType = /\bOption\s*</.test(field.type);
  const valueName = readQuoted(call.body, "value_name");

  return {
    id: `${field.name}-${index}`,
    names: [option || field.name].filter(Boolean),
    option,
    positional: option === null,
    label: field.name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    help,
    required: !optionalType && !hasDefault && control !== "boolean",
    action: control === "boolean" ? "store_true" : "",
    type: field.type,
    control,
    choices: [],
    default: control === "boolean" ? false : defaultValue,
    accept: fileDetails.accept,
    formatHint: fileDetails.formatHint
      || (control === "number" ? "Enter a whole number, for example 10."
        : valueName ? `Enter ${valueName}.` : control === "boolean" ? "Select to include this command flag."
          : "Enter the value exactly as the command expects it."),
  };
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || (char === "'" && source[index + 2] === "'")) quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function namedDefinition(source, kind, name) {
  const match = new RegExp(`\\b${kind}\\s+${name}\\s*\\{`).exec(source);
  if (!match) return null;
  const open = source.indexOf("{", match.index);
  const close = matchingBrace(source, open);
  return close === -1 ? null : source.slice(open + 1, close);
}

function derivedNames(source, deriveName, kind) {
  const names = [];
  const pattern = new RegExp(`#\\s*\\[\\s*derive\\s*\\([^\\)]*\\b${deriveName}\\b[^\\)]*\\)\\s*\\][\\s\\S]{0,500}?\\b${kind}\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\{`, "g");
  for (const match of source.matchAll(pattern)) names.push(match[1]);
  return names;
}

function rustFieldsFromBody(body) {
  const fields = [];
  const pattern = /((?:(?:\s*\/\/\/[^\n]*\n)|(?:\s*#\[[\s\S]*?\]\s*))*)\s*(?:pub(?:\([^)]*\))?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,\n]+)\s*,/g;
  for (const match of body.matchAll(pattern)) {
    const prefix = match[1] || "";
    if (/\#\s*\[\s*command\s*\(\s*(?:subcommand|flatten)/.test(prefix)) continue;
    const pseudo = `${prefix}\n${match[2]}: ${match[3]},`;
    const call = getAttributeCalls(pseudo, "#[arg(")[0];
    if (call) {
      const field = parseRustField(pseudo, call, fields.length);
      if (field) fields.push(field);
      continue;
    }
    const type = match[3].trim();
    const help = [...prefix.matchAll(/^\s*\/\/\/\s?(.*)$/gm)].map((item) => item[1].trim()).join(" ");
    const optional = /\bOption\s*</.test(type);
    const control = rustControl(type, "");
    const details = rustFileDetails({ name: match[2] }, help);
    fields.push({
      id: `${match[2]}-${fields.length}`, names: [match[2]], option: null, positional: true,
      label: match[2].replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      help, required: !optional, action: "", type, control: details.isFile ? "file" : control,
      choices: [], default: "", accept: details.accept, formatHint: details.formatHint || "Enter the value required by this command.",
      multiple: /\bVec\s*</.test(type),
    });
  }
  return fields;
}

function splitEnumVariants(body) {
  const parts = [];
  let start = 0;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"') quote = char;
    else if (char === "/" && body[index + 1] === "/") {
      while (index < body.length && body[index] !== "\n") index += 1;
    }
    else if (char === "{") brace += 1;
    else if (char === "}") brace -= 1;
    else if (char === "(") paren += 1;
    else if (char === ")") paren -= 1;
    else if (char === "[") bracket += 1;
    else if (char === "]") bracket -= 1;
    else if (char === "," && brace === 0 && paren === 0 && bracket === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (body.slice(start).trim()) parts.push(body.slice(start).trim());
  return parts;
}

function kebab(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}

function commandsFromEnum(enumName, definitions, prefix = [], inherited = [], visited = new Set()) {
  if (visited.has(enumName) || prefix.length > 4) return [];
  const definition = definitions.enums.get(enumName);
  if (!definition) return [];
  const nextVisited = new Set(visited).add(enumName);
  const commands = [];
  for (const segment of splitEnumVariants(definition.body)) {
    const variantMatch = segment.match(/(?:^|\n)\s*(?:#\[[\s\S]*?\]\s*)*([A-Z][A-Za-z0-9_]*)/);
    if (!variantMatch) continue;
    const variantName = readQuoted(segment.match(/#\[command\(([\s\S]*?)\)\]/)?.[1] || "", "name") || kebab(variantMatch[1]);
    const route = [...prefix, variantName];
    const docs = [...segment.matchAll(/^\s*\/\/\/\s?(.*)$/gm)].map((item) => item[1].trim()).join(" ");
    const rest = segment.slice((variantMatch.index || 0) + variantMatch[0].length).trim();
    let args = [];
    let nestedType = "";
    if (rest.startsWith("{")) {
      const close = matchingBrace(rest, 0);
      const inline = close === -1 ? "" : rest.slice(1, close);
      args = rustFieldsFromBody(inline);
      nestedType = inline.match(/#\[command\(subcommand\)\]\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_:]*)/)?.[1]?.split("::").pop() || "";
    } else {
      const tupleType = rest.match(/^\(\s*([A-Za-z_][A-Za-z0-9_:]*)\s*\)/)?.[1]?.split("::").pop() || "";
      if (tupleType && definitions.structs.has(tupleType)) args = rustFieldsFromBody(definitions.structs.get(tupleType).body);
      else if (tupleType && definitions.enums.has(tupleType)) nestedType = tupleType;
    }
    if (nestedType) {
      commands.push(...commandsFromEnum(nestedType, definitions, route, inherited, nextVisited));
    } else {
      commands.push({ name: route.join(" "), description: docs, prefixArgs: route, args: [...inherited, ...args] });
    }
  }
  return commands;
}

async function packageMetadata(repoPath) {
  try {
    const cargo = await fs.readFile(path.join(repoPath, "Cargo.toml"), "utf8");
    const packageBlock = cargo.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] || "";
    return {
      name: readQuoted(packageBlock, "name"),
      description: readQuoted(packageBlock, "description"),
    };
  } catch {
    return { name: "", description: "" };
  }
}

async function analyzeRustRepository(repoPath, metadata = {}) {
  const files = await listRustFiles(repoPath);
  const packageInfo = await packageMetadata(repoPath);
  const commands = [];
  const sources = await Promise.all(files.map(async (filePath) => ({ filePath, source: await fs.readFile(filePath, "utf8") })));
  const definitions = { structs: new Map(), enums: new Map() };
  for (const item of sources) {
    for (const derive of ["Args", "Parser"]) for (const name of derivedNames(item.source, derive, "struct")) {
      const body = namedDefinition(item.source, "struct", name);
      if (body) definitions.structs.set(name, { body, source: item.source, filePath: item.filePath });
    }
    for (const name of derivedNames(item.source, "Subcommand", "enum")) {
      const body = namedDefinition(item.source, "enum", name);
      if (body) definitions.enums.set(name, { body, source: item.source, filePath: item.filePath });
    }
  }

  for (const { filePath, source } of sources) {
    if (!/#\s*\[\s*derive\s*\([^\)]*\bParser\b/.test(source) || !source.includes("#[arg(")) continue;
    const relativePath = path.relative(repoPath, filePath).replace(/\\/g, "/");
    const commandCall = getAttributeCalls(source, "#[command(")[0]?.body || "";
    const name = readQuoted(commandCall, "name") || packageInfo.name || path.basename(relativePath, ".rs");
    const parserName = derivedNames(source, "Parser", "struct")[0];
    const parserBody = parserName ? namedDefinition(source, "struct", parserName) : null;
    const subcommandType = parserBody?.match(/#\[command\(subcommand\)\]\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_:]*)/)?.[1]?.split("::").pop() || "";
    if (parserBody && subcommandType && definitions.enums.has(subcommandType)) {
      const globalArgs = rustFieldsFromBody(parserBody);
      for (const variant of commandsFromEnum(subcommandType, definitions, [], globalArgs)) {
        commands.push({
          id: `rust-${relativePath}-${variant.prefixArgs.join("-")}`.replace(/[^A-Za-z0-9_-]/g, "-"),
          name: variant.name, description: variant.description || readQuoted(commandCall, "about") || packageInfo.description || "Detected Rust Clap command.",
          entry: relativePath, runtime: "rust", binary: name, prefixArgs: variant.prefixArgs, confidence: "high", args: variant.args,
        });
      }
    } else {
      const args = parserBody ? rustFieldsFromBody(parserBody)
        : getAttributeCalls(source, "#[arg(").map((call, index) => parseRustField(source, call, index)).filter(Boolean);
      if (!args.length) continue;
      commands.push({
        id: `rust-${relativePath.replace(/[^A-Za-z0-9_-]/g, "-")}`, name,
        description: readQuoted(commandCall, "about") || packageInfo.description || "Detected Rust Clap command.",
        entry: relativePath, runtime: "rust", binary: name, confidence: "high", args,
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: {
      owner: metadata.owner || "",
      name: metadata.repo || path.basename(repoPath),
      url: metadata.cloneUrl || "",
      localPath: repoPath,
    },
    analyzer: "rust-clap-static-v1",
    commands,
  };
}

module.exports = { analyzeRustRepository, commandsFromEnum, parseRustField, rustFieldsFromBody, splitEnumVariants };
