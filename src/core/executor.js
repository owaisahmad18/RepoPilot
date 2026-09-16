const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { adaptInputFile } = require("./formatAdapter");
const { collectArtifacts } = require("./artifacts");
const { repositoryDataRoot } = require("./workspacePaths");

const safeEnvironmentNames = new Set([
  "APPDATA", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL", "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "SHELL",
  "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "USER", "USERPROFILE", "WINDIR",
]);

function safeChildEnvironment(environment = process.env) {
  const safe = {};
  for (const [name, value] of Object.entries(environment)) {
    if (safeEnvironmentNames.has(name.toUpperCase()) || name.toUpperCase().startsWith("LC_")) safe[name] = value;
  }
  safe.REPO_GUI_RESTRICTED = "1";
  safe.PYTHONUNBUFFERED = "1";
  safe.MPLBACKEND = "Agg";
  return safe;
}

function detectPython(environmentPath = "") {
  if (environmentPath) {
    const executable = process.platform === "win32"
      ? path.join(environmentPath, "Scripts", "python.exe")
      : path.join(environmentPath, "bin", "python");
    const result = spawnSync(executable, ["--version"], { shell: false, windowsHide: true, encoding: "utf8" });
    if (!result.error && result.status === 0) return { executable, prefix: [] };
  }
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];

  for (const [executable, prefix] of candidates) {
    const result = spawnSync(executable, [...prefix, "--version"], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
    });
    if (!result.error && result.status === 0) return { executable, prefix };
  }
  throw new Error("Python was not found. Install Python to run this repository command.");
}

function buildArguments(command, values) {
  const args = [];
  for (const field of command.args) {
    const value = values[field.id];
    if (field.control === "choice-group") {
      if (!value || typeof value !== "object") continue;
      if (value.option) args.push(value.option);
      const selectedValues = Array.isArray(value.value) ? value.value : [value.value];
      for (const selected of selectedValues) {
        if (selected !== undefined && selected !== null && String(selected).trim() !== "") args.push(String(selected));
      }
      continue;
    }
    if (field.control === "boolean") {
      if (value === true && field.option) args.push(field.option);
      continue;
    }
    if (value === undefined || value === null || String(value).trim() === "") continue;
    if (field.option) args.push(field.option);
    const selectedValues = Array.isArray(value) ? value : [value];
    for (const selected of selectedValues) args.push(String(selected));
  }
  return args;
}

function selectedPath(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return String(value.path || "");
  return String(value || "");
}

function prepareNotebookExecution(spec, command, values) {
  const repoRoot = path.resolve(spec.repository.localPath);
  const entryPath = path.resolve(repoRoot, command.entry);
  if (entryPath !== repoRoot && !entryPath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("The generated notebook points outside the cloned repository.");
  }
  let notebook;
  try {
    notebook = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  } catch (error) {
    throw new Error(`The notebook could not be read: ${error.message}`);
  }
  const outputRoot = path.join(repositoryDataRoot(repoRoot), "outputs");
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const binding of command.inputBindings || []) {
    const selected = selectedPath(values[binding.fieldId]);
    if (!selected || !fs.existsSync(selected)) {
      const field = command.args.find((item) => item.id === binding.fieldId);
      throw new Error(`Choose a valid ${field?.displayLabel || field?.label || "notebook input"}.`);
    }
    const replacement = binding.control === "file"
      ? adaptInputFile(binding, selected, outputRoot, binding.fieldId).path
      : selected;
    const originals = binding.originals?.length ? binding.originals : [binding.original];
    for (const cell of notebook.cells || []) {
      if (!Array.isArray(cell.source)) continue;
      cell.source = cell.source.map((line) => originals.reduce(
        (updated, original) => updated.split(original).join(replacement.replace(/\\/g, "/")),
        line,
      ));
    }
  }
  if (Array.isArray(command.cellIndexes) && command.cellIndexes.length) {
    const selected = new Set(command.cellIndexes);
    notebook.cells = (notebook.cells || []).filter((cell, index) => cell.cell_type !== "code" || selected.has(index));
  }
  const base = path.basename(command.entry, ".ipynb").replace(/[^A-Za-z0-9_.-]/g, "-") || "notebook";
  const stamp = Date.now();
  const preparedPath = path.join(outputRoot, `${base}-${stamp}-prepared.ipynb`);
  const outputName = `${base}-${stamp}-result.ipynb`;
  fs.writeFileSync(preparedPath, JSON.stringify(notebook), "utf8");
  return { entryPath, repoRoot, outputRoot, preparedPath, outputName, outputPath: path.join(outputRoot, outputName) };
}

function detectJupyter(environmentPath = "") {
  const python = detectPython(environmentPath);
  const result = spawnSync(python.executable, [...python.prefix, "-m", "jupyter", "--version"], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error("Jupyter was not found. Install Jupyter in your Python environment, then retry this notebook task.");
  }
  return python;
}

function runCommand(spec, command, values, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    if (!["python", "python-interactive-science", "jupyter-notebook", "rust", "php-composer-image"].includes(command.runtime)) {
      reject(new Error(`Unsupported runtime: ${command.runtime}`));
      return;
    }

    let runtime;
    try {
      runtime = ["python", "python-interactive-science"].includes(command.runtime) ? detectPython(command.environmentPath)
        : command.runtime === "jupyter-notebook" ? detectJupyter(command.environmentPath)
        : command.runtime === "rust" ? detectRust(command.binary)
          : detectPhpImage(spec, values);
    } catch (error) {
      reject(error);
      return;
    }

    const entryPath = path.resolve(spec.repository.localPath, command.entry);
    const repoRoot = path.resolve(spec.repository.localPath);
    if (entryPath !== repoRoot && !entryPath.startsWith(`${repoRoot}${path.sep}`)) {
      reject(new Error("The generated command points outside the cloned repository."));
      return;
    }

    let notebookRun = null;
    if (command.runtime === "jupyter-notebook") {
      try { notebookRun = prepareNotebookExecution(spec, command, values); }
      catch (error) { reject(error); return; }
    }
    const args = command.runtime === "python"
      ? [...runtime.prefix, ...(command.module ? ["-m", command.module] : [entryPath]), ...(command.prefixArgs || []), ...buildArguments(command, values)]
      : command.runtime === "python-interactive-science"
        ? [...runtime.prefix, path.resolve(__dirname, "..", "adapters", "python-climate-csv.py"), entryPath,
          String(values["climate-csv"] || ""), String(values.city || "")]
      : command.runtime === "jupyter-notebook"
        ? [...runtime.prefix, "-m", "jupyter", "nbconvert", "--to", "notebook", "--execute", notebookRun.preparedPath,
          "--output", notebookRun.outputName, "--output-dir", notebookRun.outputRoot, "--ExecutePreprocessor.timeout=600"]
      : command.runtime === "rust" ? [...runtime.prefix, ...buildArguments(command, values)]
        : runtime.args;
    onOutput(`> ${runtime.executable} ${args.map(quoteForDisplay).join(" ")}\n\n`);
    const moduleRoot = command.moduleRoot ? path.resolve(repoRoot, command.moduleRoot) : repoRoot;
    const pythonPath = [moduleRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const child = spawn(runtime.executable, args, {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      env: { ...safeChildEnvironment(), PYTHONPATH: pythonPath },
    });

    child.stdout.on("data", (chunk) => onOutput(chunk.toString()));
    child.stderr.on("data", (chunk) => onOutput(chunk.toString()));
    child.on("error", (error) => reject(new Error(`Unable to start command: ${error.message}`)));
    child.on("close", (code) => {
      if (command.runtime === "jupyter-notebook" && code === 0) onOutput(`\nExecuted notebook saved to ${notebookRun.outputPath}.\n`);
      onOutput(`\nProcess finished with exit code ${code}.\n`);
      const artifacts = code === 0 ? collectArtifacts(repoRoot, startedAt) : [];
      resolve({ exitCode: code, artifacts });
    });
  });
}

function detectPhpImage(spec, values) {
  const php = spawnSync("php", ["--version"], { shell: false, windowsHide: true, encoding: "utf8" });
  if (php.error || php.status !== 0) {
    throw new Error("PHP 8.3+ was not found. Install PHP with the GD extension to run this generated image workflow.");
  }
  const autoload = path.join(spec.repository.localPath, "vendor", "autoload.php");
  if (!fs.existsSync(autoload)) {
    throw new Error(`Composer dependencies are not installed. Run 'composer install' in ${spec.repository.localPath}, then retry.`);
  }
  const input = String(values["input-image"] || "");
  if (!input || !fs.existsSync(input)) throw new Error("Choose a valid input image.");
  const format = ["jpeg", "png", "webp", "gif"].includes(values.format) ? values.format : "jpeg";
  const rawName = String(values["output-name"] || "repopilot-output").replace(/[^A-Za-z0-9_.-]/g, "-");
  const name = rawName.replace(/\.(?:jpe?g|png|webp|gif)$/i, "") || "repopilot-output";
  const outputRoot = path.join(repositoryDataRoot(spec.repository.localPath), "outputs");
  fs.mkdirSync(outputRoot, { recursive: true });
  const extension = format === "jpeg" ? "jpg" : format;
  const output = path.join(outputRoot, `${name}.${extension}`);
  const adapter = path.resolve(__dirname, "..", "adapters", "php-image.php");
  return {
    executable: "php",
    prefix: [],
    args: [adapter, spec.repository.localPath, input, output, JSON.stringify(values)],
  };
}

function detectRust(binary) {
  if (/^[A-Za-z0-9_.-]+$/.test(binary || "")) {
    const installed = spawnSync(binary, ["--version"], { shell: false, windowsHide: true, encoding: "utf8" });
    if (!installed.error && installed.status === 0) return { executable: binary, prefix: [] };
  }

  const cargo = spawnSync("cargo", ["--version"], { shell: false, windowsHide: true, encoding: "utf8" });
  if (!cargo.error && cargo.status === 0) {
    return { executable: "cargo", prefix: ["run", "--quiet", "--bin", binary, "--"] };
  }
  throw new Error(`Neither the '${binary}' executable nor Rust/Cargo was found. Install one to run this command.`);
}

function quoteForDisplay(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

module.exports = { buildArguments, detectPython, detectRust, detectPhpImage, prepareNotebookExecution, runCommand, safeChildEnvironment };
