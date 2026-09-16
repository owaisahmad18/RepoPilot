const fs = require("node:fs");
const path = require("node:path");
const { repositoryDataRoot } = require("./workspacePaths");

const imageTypes = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
]);
const ignoredDirectories = new Set([".git", "node_modules", ".venv", "venv", "environments", "__pycache__"]);

function splitDelimitedLine(line, separator) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === separator && !quoted) { cells.push(value); value = ""; }
    else value += character;
  }
  cells.push(value);
  return cells;
}

function tablePreview(filePath, extension) {
  try {
    if (fs.statSync(filePath).size > 1_000_000) return null;
    if ([".csv", ".tsv"].includes(extension)) {
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).slice(0, 7);
      if (!lines.length) return null;
      const separator = extension === ".tsv" ? "\t" : ",";
      const rows = lines.map((line) => splitDelimitedLine(line, separator).slice(0, 12));
      return { headers: rows[0], rows: rows.slice(1) };
    }
    if (extension === ".json") {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(data) || !data.length || typeof data[0] !== "object") return null;
      const headers = Object.keys(data[0]).slice(0, 12);
      return { headers, rows: data.slice(0, 6).map((row) => headers.map((header) => String(row[header] ?? ""))) };
    }
  } catch {
    return null;
  }
  return null;
}

function describeArtifact(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const mimeType = imageTypes.get(extension) || "application/octet-stream";
  const artifact = { path: filePath, name: path.basename(filePath), size: stat.size, kind: "file", mimeType };
  if (imageTypes.has(extension) && stat.size <= 5_000_000) {
    artifact.kind = "image";
    artifact.dataUrl = `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
  } else {
    const table = tablePreview(filePath, extension);
    if (table) { artifact.kind = "table"; artifact.table = table; }
    else if ([".txt", ".log", ".md"].includes(extension) && stat.size <= 250_000) {
      artifact.kind = "text";
      artifact.preview = fs.readFileSync(filePath, "utf8").slice(0, 4_000);
    }
  }
  return artifact;
}

function recentFiles(root, since, limit = 2_000) {
  const found = [];
  const pending = [root];
  let inspected = 0;
  while (pending.length && inspected < limit) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      inspected += 1;
      if (inspected > limit) break;
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) pending.push(item);
      } else if (entry.isFile()) {
        const stat = fs.statSync(item);
        if (stat.mtimeMs >= since && stat.size <= 50_000_000) found.push({ path: item, modified: stat.mtimeMs });
      }
    }
  }
  return found;
}

function collectArtifacts(repoRoot, since) {
  const outputRoot = path.join(repositoryDataRoot(repoRoot), "outputs");
  const roots = [...new Set([path.resolve(repoRoot), outputRoot])];
  const files = roots.flatMap((root) => recentFiles(root, since - 1_500));
  const unique = new Map(files.map((file) => [path.resolve(file.path), file]));
  return [...unique.values()]
    .sort((left, right) => right.modified - left.modified)
    .slice(0, 20)
    .map((file) => describeArtifact(file.path));
}

module.exports = { collectArtifacts, describeArtifact, splitDelimitedLine, tablePreview };
