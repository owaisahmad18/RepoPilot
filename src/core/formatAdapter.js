const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp"]);
const DELIMITED_EXTENSIONS = new Set([".csv", ".tsv", ".txt"]);

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else value += char;
  }
  row.push(value);
  if (row.some((item) => item !== "")) rows.push(row);
  return rows;
}

function encodeDelimited(rows, delimiter) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /["\r\n,\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(delimiter)).join("\n");
}

function jsonRows(text) {
  const value = JSON.parse(text);
  const items = Array.isArray(value) ? value : [value];
  const keys = [...new Set(items.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item) : []))];
  if (!keys.length) throw new Error("JSON tabular data must contain an object or an array of objects.");
  return [keys, ...items.map((item) => keys.map((key) => item?.[key] ?? ""))];
}

function tabularRows(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, "utf8");
  if (extension === ".json") return jsonRows(text);
  if (extension === ".tsv") return parseDelimited(text, "\t");
  if (extension === ".txt") {
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    return parseDelimited(text, firstLine.includes("\t") ? "\t" : ",");
  }
  return parseDelimited(text, ",");
}

function inputKind(binding) {
  const expected = path.extname(binding.original).toLowerCase();
  if (IMAGE_EXTENSIONS.has(expected) || /imread|Image\.open/i.test(binding.loader || "")) return "image";
  if ([".csv", ".tsv"].includes(expected) || /read_(?:csv|table|json)/i.test(binding.loader || "")) return "tabular";
  if ([".txt", ".md", ".log"].includes(expected) || /^open$/i.test(binding.loader || "")) return "text";
  return "exact";
}

function acceptedFormats(binding) {
  const kind = inputKind(binding);
  if (kind === "image") return "image/*";
  if (kind === "tabular") return ".csv,.tsv,.txt,.json";
  if (kind === "text") return ".txt,.md,.log,.csv,.json";
  return path.extname(binding.original).toLowerCase();
}

function adaptInputFile(binding, selectedPath, outputRoot, fieldId) {
  const kind = inputKind(binding);
  const expected = path.extname(binding.original).toLowerCase();
  const selected = path.extname(selectedPath).toLowerCase();
  if (kind === "image" && IMAGE_EXTENSIONS.has(selected)) return { path: selectedPath, adapted: selected !== expected };
  if (kind === "text") return { path: selectedPath, adapted: selected !== expected };
  if (kind !== "tabular" || expected === selected) return { path: selectedPath, adapted: false };
  if (![...DELIMITED_EXTENSIONS, ".json"].includes(selected)) {
    throw new Error("Choose CSV, TSV, TXT, or JSON tabular data for this input.");
  }
  const rows = tabularRows(selectedPath);
  const safeId = String(fieldId || "table").replace(/[^A-Za-z0-9_.-]/g, "-");
  const targetExtension = expected === ".json" ? ".json" : expected === ".tsv" ? ".tsv" : expected === ".txt" ? ".txt" : ".csv";
  const destination = path.join(outputRoot, `${safeId}-adapted${targetExtension}`);
  if (targetExtension === ".json") {
    const [headers, ...records] = rows;
    fs.writeFileSync(destination, JSON.stringify(records.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))), null, 2));
  } else {
    fs.writeFileSync(destination, encodeDelimited(rows, targetExtension === ".tsv" ? "\t" : ","), "utf8");
  }
  return { path: destination, adapted: true };
}

module.exports = { acceptedFormats, adaptInputFile, inputKind, parseDelimited };
