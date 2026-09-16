const fs = require("node:fs/promises");
const path = require("node:path");
const { acceptedFormats, inputKind } = require("./formatAdapter");

const SKIP_DIRECTORIES = new Set([".git", ".ipynb_checkpoints", ".repo-gui", "node_modules", "vendor", "dist", "build"]);
const INPUT_CALL = /(?:np|numpy)\.load|(?:pd|pandas)\.read_(?:csv|table|excel|json|parquet)|(?:Image|PIL\.Image)\.open|(?:io|cv2)\.imread|load_model|joblib\.load|pickle\.load|\bopen/g;
const ASSIGNED_PATH = /\b([A-Za-z_][A-Za-z0-9_]*(?:path|file|dir|folder)[A-Za-z0-9_]*)\s*=\s*(["'])([^"'\r\n]+)\2/g;
const CALLED_PATH = new RegExp(`(${INPUT_CALL.source})\\s*\\(\\s*(["'])([^"'\\r\\n]+)\\2`, "g");

async function listNotebooks(root) {
  const results = [];
  const queue = [root];
  while (queue.length && results.length < 50) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".ipynb")) results.push(path.join(current, entry.name));
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
        queue.push(path.join(current, entry.name));
      }
    }
  }
  return results;
}

function cellSource(cell) {
  return Array.isArray(cell?.source) ? cell.source.join("") : String(cell?.source || "");
}

function notebookTitle(notebook, fallback) {
  for (const cell of notebook.cells || []) {
    if (cell.cell_type !== "markdown") continue;
    const heading = cellSource(cell).match(/^\s*#{1,3}\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading.replace(/[*_`]/g, "");
  }
  const readable = fallback.replace(/[-_]+/g, " ").replace(/\bdatat\b/gi, "data").replace(/\bprep\b/gi, "preparation");
  return readable.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function notebookDescription(notebook, title) {
  for (const cell of notebook.cells || []) {
    if (cell.cell_type !== "markdown") continue;
    const prose = cellSource(cell)
      .replace(/^\s*#{1,6}.*$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[[^\]]+\]\([^)]*\)/g, "")
      .replace(/[*_`>#-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (prose.length >= 20) return prose.slice(0, 240);
  }
  return `Run the repository's ${title} notebook as a guided task.`;
}

function looksLikeOutput(name, source, index) {
  if (/\b(output|destination|result|save|export|write)\b/i.test(name)) return true;
  const before = source.slice(Math.max(0, index - 50), index).toLowerCase();
  return /(?:savefig|\.save|to_csv|to_excel|to_json)\s*\([^)]*$/.test(before);
}

function isDirectory(name, value) {
  return /(?:dir|directory|folder)/i.test(name) || /[\\/]$/.test(value) || /[*?]/.test(value);
}

function acceptFor(value) {
  const lower = value.toLowerCase();
  if (/\.nii\.gz$/.test(lower)) return ".nii,.nii.gz";
  const extension = path.extname(lower);
  const known = new Set([".csv", ".tsv", ".json", ".yaml", ".yml", ".npy", ".npz", ".h5", ".hdf5", ".keras", ".pkl", ".pickle", ".joblib", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".dcm", ".fits", ".dat", ".txt"]);
  return known.has(extension) ? extension : "";
}

function friendlyInputName(variable, value, index) {
  const clean = String(variable || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
  if (clean && !/^(Input )?(Path|File|Dir|Directory|Folder)$/i.test(clean)) return clean;
  const base = path.basename(value.replace(/[\\/]+$/, ""));
  return base && base !== "." ? base : `Input ${index + 1}`;
}

function assignmentBefore(source, index) {
  const before = source.slice(Math.max(0, index - 100), index);
  return before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:[A-Za-z_][A-Za-z0-9_.]*\.)?$/)?.[1] || "";
}

function commentAfter(source, index) {
  const restOfLine = source.slice(index, source.indexOf("\n", index) === -1 ? source.length : source.indexOf("\n", index));
  return restOfLine.match(/#\s*([^#]+)/)?.[1]?.trim() || "";
}

function semanticInputName(binding, title, bindings, notebookSource = "") {
  const variable = `${binding.variable || ""} ${binding.assignedVariable || ""}`.toLowerCase();
  const context = `${title} ${binding.comment || ""} ${notebookSource}`.toLowerCase();
  const extension = path.extname(binding.original).toLowerCase();
  const isDenoising = /denois|noise removal/.test(context);
  const modelInputs = bindings.filter((item) => /load_model/.test(item.loader || "") || /\.(?:h5|hdf5|keras|pkl|pickle|joblib|pt|pth|onnx)$/i.test(item.original));

  if (modelInputs.includes(binding)) {
    const purpose = isDenoising ? "denoising model" : "trained model";
    if (modelInputs.length > 1 && /\d+$/.test(binding.assignedVariable || "")) return `Alternative ${purpose}`;
    if (modelInputs.length > 1) return `Primary ${purpose}`;
    return purpose.replace(/^./, (letter) => letter.toUpperCase());
  }
  if (/noise.*microstructure|noisy/.test(binding.comment || "")) return "Noisy training images";
  if (/clean.*microstructure|ground truth|reference/.test(binding.comment || "")) return "Clean reference images";
  if (/^x$/i.test(binding.assignedVariable || "")) {
    if (/train/i.test(title)) return "Training input images";
    if (/test|evaluat/i.test(title)) return "Evaluation image dataset";
    return "Input image dataset";
  }
  if (/^y$/i.test(binding.assignedVariable || "")) return "Expected clean images";
  if (binding.control === "directory") {
    if (/optical/.test(variable)) return "Experimental micrograph folder";
    if (/phase|simulation|\bdat\b/.test(`${variable} ${context}`)) return "Simulation data folder";
    return "Input data folder";
  }
  if (/reference/.test(variable)) return /micrograph|microstruct/.test(context) ? "Reference micrograph" : "Reference image";
  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".dcm", ".fits"].includes(extension)) {
    if (/micrograph|microstruct/.test(context)) return isDenoising ? "Noisy micrograph" : "Micrograph image";
    return "Input image";
  }
  if (extension === ".dat" && /phase|simulation|microstruct|\bdat\b/.test(`${context} ${variable}`)) return "Simulation data file";
  if ([".npy", ".npz"].includes(extension)) return "Scientific data array";
  if ([".csv", ".tsv", ".xls", ".xlsx", ".parquet"].includes(extension)) {
    const subject = friendlyInputName(binding.assignedVariable || binding.variable, binding.original, 0);
    return /^(?:df|data|dataset|table|input file)$/i.test(subject) ? "Data table" : `${subject} table`;
  }
  return friendlyInputName(binding.variable, binding.original, 0);
}

function candidateInputs(source) {
  const found = [];
  const add = (variable, value, index, details = {}) => {
    const normalized = String(value || "").trim();
    if (!normalized || /^https?:\/\//i.test(normalized) || looksLikeOutput(variable, source, index)) return;
    const directory = isDirectory(variable, normalized);
    const pathLike = directory || /[\\/]/.test(normalized) || Boolean(path.extname(normalized));
    if (!pathLike) return;
    if (found.some((item) => item.original === normalized)) return;
    found.push({ variable, original: normalized, control: directory ? "directory" : "file", ...details });
  };

  for (const match of source.matchAll(ASSIGNED_PATH)) {
    add(match[1], match[3], match.index, { assignedVariable: match[1], comment: commentAfter(source, match.index) });
  }
  for (const match of source.matchAll(CALLED_PATH)) {
    const afterCall = source.slice(match.index + match[0].length, match.index + match[0].length + 30);
    if (match[1] === "open" && /^\s*,\s*["'][wax+]/i.test(afterCall)) continue;
    add("Input file", match[3], match.index, {
      loader: match[1],
      assignedVariable: assignmentBefore(source, match.index),
      comment: commentAfter(source, match.index),
    });
  }
  return found.slice(0, 12);
}

function mergeEquivalentInputs(inputs) {
  const merged = [];
  for (const input of inputs) {
    const isModel = /\.(?:h5|hdf5|keras|pkl|pickle|joblib|pt|pth|onnx)$/i.test(input.original)
      || /load_model/.test(input.loader || "");
    const variable = String(input.assignedVariable || "").toLowerCase();
    const existing = merged.find((item) => item.control === input.control && (
      (isModel && path.basename(item.original).toLowerCase() === path.basename(input.original).toLowerCase())
      || (variable && variable === String(item.assignedVariable || "").toLowerCase())
    ));
    if (existing) {
      existing.originals.push(input.original);
      continue;
    }
    merged.push({ ...input, originals: [input.original] });
  }
  return merged;
}

function modelInput(input) {
  return /\.(?:h5|hdf5|keras|pkl|pickle|joblib|pt|pth|onnx)$/i.test(input.original)
    || /load_model/.test(input.loader || "");
}

function inputCategory(input) {
  if (modelInput(input)) return "model";
  if (input.control === "directory") return "folder";
  const extension = path.extname(input.original).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".dcm", ".fits"].includes(extension)) return "image";
  if ([".npy", ".npz"].includes(extension)) return "array";
  if ([".csv", ".tsv", ".xls", ".xlsx", ".parquet"].includes(extension)) return "table";
  return "data";
}

function sectionName(title, bindings) {
  const categories = new Set(bindings.filter((input) => !modelInput(input)).map(inputCategory));
  const lower = title.toLowerCase();
  if (/denois/.test(lower) && categories.has("image")) return "Denoise a micrograph";
  if (/denois/.test(lower) && categories.has("array")) return "Evaluate denoising on a dataset";
  if (/prepar/.test(lower) && categories.size === 1 && categories.has("folder")) return "Prepare micrograph training data";
  if (/prepar/.test(lower) && categories.has("image") && categories.has("data")) return "Compare simulation and reference image";
  if (categories.has("image")) return "Analyze an image";
  if (categories.has("array")) return "Analyze a dataset";
  if (categories.has("table")) return "Analyze a data table";
  if (categories.has("folder")) return "Process a data folder";
  return title;
}

function sectionDescription(name) {
  const descriptions = {
    "Denoise a micrograph": "Remove noise from one micrograph using the repository's trained model.",
    "Evaluate denoising on a dataset": "Evaluate the denoising model using a prepared image dataset.",
    "Prepare micrograph training data": "Build training data from experimental micrographs and simulation results.",
    "Compare simulation and reference image": "Compare simulation data with a reference micrograph.",
    "Analyze an image": "Analyze one image using this notebook workflow.",
    "Analyze a dataset": "Analyze a prepared dataset using this notebook workflow.",
    "Analyze a data table": "Analyze a data table using this notebook workflow.",
    "Process a data folder": "Process the selected data folder using this notebook workflow.",
  };
  return descriptions[name] || `Run ${name} as a guided notebook task.`;
}

function notebookDependencies(source) {
  const standard = new Set(["argparse", "collections", "csv", "datetime", "functools", "glob", "io", "itertools", "json", "math", "os", "pathlib", "pickle", "random", "re", "shutil", "statistics", "sys", "tempfile", "textwrap", "time", "typing"]);
  const names = [];
  for (const match of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    const name = match[1];
    if (!standard.has(name) && !names.includes(name)) names.push(name);
  }
  const display = { cv2: "opencv-python", PIL: "Pillow", skimage: "scikit-image", sklearn: "scikit-learn" };
  const imports = names.slice(0, 12);
  return { imports, packages: imports.map((name) => display[name] || name) };
}

function notebookSections(notebook, title) {
  const codeCells = (notebook.cells || []).map((cell, index) => ({
    index,
    source: cell.cell_type === "code" ? cellSource(cell) : "",
  })).filter((cell) => cell.source);
  const withInputs = codeCells.map((cell) => ({ ...cell, inputs: candidateInputs(cell.source) }));
  const targets = withInputs.filter((cell) => cell.inputs.some((input) => !modelInput(input))
    && /(^|\n)\s*(?:import|from)\s+/m.test(cell.source));
  const groups = new Map();
  for (const target of targets) {
    const signature = [...new Set(target.inputs.filter((input) => !modelInput(input)).map(inputCategory))].sort().join("+");
    if (!groups.has(signature)) groups.set(signature, target);
  }
  if (groups.size < 2) {
    const source = codeCells.map((cell) => cell.source).join("\n");
    return [{ title, description: notebookDescription(notebook, title), source, bindings: mergeEquivalentInputs(candidateInputs(source)), cellIndexes: null }];
  }

  const firstTargetIndex = Math.min(...targets.map((cell) => cell.index));
  const setupCells = withInputs.filter((cell) => cell.index < firstTargetIndex
    && cell.inputs.every(modelInput));
  return [...groups.values()].map((target) => {
    const selected = [...setupCells, target];
    const source = selected.map((cell) => cell.source).join("\n");
    const bindings = mergeEquivalentInputs(selected.flatMap((cell) => cell.inputs));
    const name = sectionName(title, bindings);
    return {
      title: name,
      description: sectionDescription(name),
      source,
      bindings,
      cellIndexes: selected.map((cell) => cell.index),
    };
  });
}

function notebookCommand(relative, section, sectionIndex) {
  const { title, description, source, bindings, cellIndexes } = section;
  const baseLabels = bindings.map((binding) => semanticInputName(binding, title, bindings, source));
  const labelCounts = new Map(baseLabels.map((label) => [label, baseLabels.filter((item) => item === label).length]));
  const seenLabels = new Map();
  const labels = baseLabels.map((label) => {
    if (labelCounts.get(label) === 1) return label;
    const number = (seenLabels.get(label) || 0) + 1;
    seenLabels.set(label, number);
    return `${label} ${number}`;
  });
  const dependencyInfo = notebookDependencies(source);
  const args = bindings.map((binding, index) => ({
    id: `notebook-input-${index + 1}`,
    label: labels[index],
    displayLabel: labels[index],
    help: binding.control === "directory"
      ? `Choose the folder used in place of ${binding.original}.`
      : `Choose the file used in place of ${binding.original}.`,
    displayHelp: binding.control === "directory"
      ? `Choose the folder containing this data. The notebook originally expects “${binding.original}”.`
      : `Choose this ${path.extname(binding.original).replace(".", "").toUpperCase() || "data"} file. The notebook originally expects “${path.basename(binding.original)}”.`,
    control: binding.control,
    required: true,
    default: "",
    accept: binding.control === "file" ? acceptedFormats(binding) : "",
    preview: binding.control === "file" && inputKind(binding) === "image",
    formatHint: binding.control === "directory" ? "Choose a data folder." : "Choose the exact input file requested by the notebook.",
    names: [],
    option: null,
    positional: false,
    section: "primary",
  }));
  return {
    id: `jupyter-${relative}-${sectionIndex + 1}`.replace(/[^A-Za-z0-9_-]/g, "-"),
    name: title,
    displayName: title,
    description,
    entry: relative,
    runtime: "jupyter-notebook",
    kind: "workflow",
    confidence: bindings.length ? "review" : "high",
    userPriority: /^Denoise a micrograph$/i.test(title) ? 80
      : /^Evaluate /i.test(title) ? 60
        : /^Prepare |^Compare /i.test(title) ? 40
          : /training$/i.test(title) ? -30 : 0,
    dependencies: dependencyInfo.packages,
    dependencyImports: dependencyInfo.imports,
    cellIndexes,
    inputBindings: bindings.map((binding, index) => ({ fieldId: `notebook-input-${index + 1}`, ...binding })),
    args,
  };
}

async function analyzeJupyterNotebooks(repoPath, metadata = {}) {
  const files = await listNotebooks(repoPath);
  const commands = [];
  for (const filePath of files) {
    let notebook;
    try {
      notebook = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(notebook.cells)) continue;
    const relative = path.relative(repoPath, filePath).replace(/\\/g, "/");
    const fallback = path.basename(relative, ".ipynb");
    const title = notebookTitle(notebook, fallback);
    commands.push(...notebookSections(notebook, title).map((section, index) => notebookCommand(relative, section, index)));
  }

  return {
    analyzer: "jupyter-notebook-static-v1",
    detected: files.length > 0,
    repository: {
      owner: metadata.owner || "",
      name: metadata.repo || path.basename(repoPath),
      url: metadata.cloneUrl || "",
      localPath: repoPath,
    },
    commands,
  };
}

module.exports = { analyzeJupyterNotebooks, candidateInputs, notebookSections, notebookTitle };
