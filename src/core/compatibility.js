const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const runtimeCache = new Map();

function available(executable, args = ["--version"]) {
  const key = `${executable}\0${args.join("\0")}`;
  if (!runtimeCache.has(key)) {
    const result = spawnSync(executable, args, { shell: false, windowsHide: true, encoding: "utf8" });
    runtimeCache.set(key, !result.error && result.status === 0);
  }
  return runtimeCache.get(key);
}

function pythonRuntime() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];
  return candidates.find(([executable, prefix]) => available(executable, [...prefix, "--version"])) || null;
}

function dependencyFiles(repoPath) {
  return ["requirements.txt", "pyproject.toml", "environment.yml", "environment.yaml", "Pipfile", "poetry.lock"]
    .filter((name) => fs.existsSync(path.join(repoPath, name)));
}

function compatibilityFor(repoPath, command) {
  const checks = [];
  let blocked = false;
  if (["python", "python-interactive-science", "jupyter-notebook"].includes(command.runtime)) {
    const managedPython = command.environmentPath && (process.platform === "win32"
      ? path.join(command.environmentPath, "Scripts", "python.exe")
      : path.join(command.environmentPath, "bin", "python"));
    const python = managedPython && fs.existsSync(managedPython) && available(managedPython) ? [managedPython, []] : pythonRuntime();
    const jupyterReady = python && command.runtime === "jupyter-notebook"
      ? available(python[0], [...python[1], "-m", "jupyter", "--version"])
      : true;
    if (!python) {
      blocked = true;
      checks.push({ state: "blocked", label: "Python runtime", detail: "Python 3 must be installed before this task can run." });
    } else if (!jupyterReady) {
      blocked = true;
      checks.push({ state: "blocked", label: "Notebook runtime", detail: "Jupyter must be installed in the selected Python environment." });
    } else {
      checks.push({ state: "ready", label: command.runtime === "jupyter-notebook" ? "Python and Jupyter" : "Python runtime", detail: "Available on this computer." });
    }
    const manifests = dependencyFiles(repoPath);
    if (manifests.length) {
      checks.push({ state: "info", label: "Dependencies", detail: `Repository instructions found in ${manifests.join(", ")}.` });
    } else if (command.dependencies?.length) {
      checks.push({ state: "warning", label: "Dependencies", detail: `No setup file was provided. Detected: ${command.dependencies.join(", ")}.` });
    }
  } else if (command.runtime === "rust") {
    const ready = available("cargo");
    blocked = !ready;
    checks.push({ state: ready ? "ready" : "blocked", label: "Rust runtime", detail: ready ? "Cargo is available." : "Rust and Cargo must be installed." });
  } else if (command.runtime === "php-composer-image") {
    const ready = available("php");
    blocked = !ready;
    checks.push({ state: ready ? "ready" : "blocked", label: "PHP runtime", detail: ready ? "PHP is available." : "PHP 8.3 or newer must be installed." });
  }

  const requiredInputs = (command.args || []).filter((field) => field.required && field.section !== "hidden");
  if (requiredInputs.length) checks.push({
    state: "info",
    label: "Your inputs",
    detail: `Choose ${requiredInputs.length} item${requiredInputs.length === 1 ? "" : "s"} before running.`,
  });
  if ((command.args || []).some((field) => field.accept === "image/*")) checks.push({
    state: "ready",
    label: "Image formats",
    detail: "PNG, JPG, JPEG, TIFF, BMP, GIF and other standard images are accepted.",
  });
  if (/train/i.test(command.name || "") && (command.dependencies || []).some((name) => /tensorflow|torch/i.test(name))) checks.push({
    state: "warning",
    label: "Processing hardware",
    detail: "A compatible GPU is recommended for training, but is not required to generate the interface.",
  });
  return {
    status: blocked ? "blocked" : "review",
    summary: blocked ? "Setup is needed before this task can run." : "Basic runtime checks passed; review inputs before running.",
    checks,
    canCreateEnvironment: ["python", "python-interactive-science", "jupyter-notebook"].includes(command.runtime),
  };
}

module.exports = { compatibilityFor, dependencyFiles };
