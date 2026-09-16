const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { detectPython } = require("./executor");
const { repositoryDataRoot } = require("./workspacePaths");

function safePackages(dependencies = []) {
  return [...new Set(dependencies.map(String).filter((name) => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)))];
}

function environmentPython(environmentPath) {
  return process.platform === "win32"
    ? path.join(environmentPath, "Scripts", "python.exe")
    : path.join(environmentPath, "bin", "python");
}

function runProcess(executable, args, cwd, onOutput) {
  return new Promise((resolve, reject) => {
    onOutput(`> ${executable} ${args.join(" ")}\n`);
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    child.stdout.on("data", (chunk) => onOutput(chunk.toString()));
    child.stderr.on("data", (chunk) => onOutput(chunk.toString()));
    child.on("error", (error) => reject(new Error(`Setup could not start: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Setup step failed with exit code ${code}.`)));
  });
}

async function prepareEnvironment(spec, command, onOutput = () => {}) {
  let systemPython;
  try { systemPython = detectPython(); }
  catch {
    throw new Error("Install Python 3 once, then press Create setup again. RepoPilot will create and manage the isolated environment after that.");
  }
  const repoRoot = path.resolve(spec.repository.localPath);
  const environmentPath = path.join(repositoryDataRoot(repoRoot), "environment");
  const python = environmentPython(environmentPath);
  const packages = safePackages([
    ...(command.runtime === "jupyter-notebook" ? ["jupyter"] : []),
    ...(command.dependencies || []),
  ]);

  onOutput("Setup agent: inspecting the task and creating a private environment.\n\n");
  if (!fs.existsSync(python)) {
    fs.mkdirSync(path.dirname(environmentPath), { recursive: true });
    await runProcess(systemPython.executable, [...systemPython.prefix, "-m", "venv", environmentPath], repoRoot, onOutput);
  } else onOutput("Existing private environment found; reusing it.\n");

  if (packages.length) {
    onOutput(`\nSetup agent: installing ${packages.join(", ")}.\n`);
    await runProcess(python, ["-m", "pip", "install", "--disable-pip-version-check", ...packages], repoRoot, onOutput);
  }
  const imports = safePackages(command.dependencyImports || []);
  if (imports.length) {
    onOutput("\nSetup agent: verifying imports.\n");
    await runProcess(python, ["-c", imports.map((name) => `import ${name}`).join("; ")], repoRoot, onOutput);
  }
  command.environmentPath = environmentPath;
  onOutput("\nSetup complete. This repository now has its own reusable environment.\n");
  return { environmentPath, packages };
}

module.exports = { environmentPython, prepareEnvironment, safePackages };
