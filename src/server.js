const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { cloneRepository } = require("./core/repository");
const { analyzeRepository } = require("./core/analyzer");
const { runCommand } = require("./core/executor");
const { planUserRequest } = require("./core/agentPlanner");
const { searchRepositories } = require("./core/repositorySearch");
const { prepareEnvironment } = require("./core/environmentManager");
const { compatibilityFor } = require("./core/compatibility");
const { connectProvider, connectionSummary, disconnectProvider, testProviderConnection } = require("./core/connections");
const { deleteApplet, listApplets, loadApplet, saveApplet } = require("./core/applets");
const { repositoryDataRoot } = require("./core/workspacePaths");

const HOST = "127.0.0.1";
const PORT = Number(process.env.REPO_GUI_PORT || 3211);
const projectRoot = path.resolve(__dirname, "..");
const defaultStorageRoot = path.join(projectRoot, ".repopilot");
let storageRoot = path.resolve(process.env.REPO_GUI_WORKSPACE || defaultStorageRoot);
const rendererRoot = path.join(__dirname, "renderer");
let activeSpec = null;
const artifactFiles = new Map();

function electronExecutable() {
  try {
    const executable = require("electron");
    return typeof executable === "string" ? executable : "";
  } catch { return ""; }
}

function chooseWorkspaceFolder() {
  const executable = electronExecutable();
  if (!executable) throw new Error("The folder chooser is available in the desktop app.");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const child = spawn(executable, [path.join(__dirname, "workspacePicker.js")], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("The folder chooser took too long. Try again.")));
    }, 120_000);
    child.stdout.on("data", (chunk) => { if (output.length < 32_000) output += chunk.toString(); });
    child.on("error", (error) => finish(() => reject(new Error(`The folder chooser could not open: ${error.message}`))));
    child.on("close", () => {
      finish(() => {
        try {
          const line = output.split(/\r?\n/).find((item) => item.startsWith("REPO_GUI_WORKSPACE:"));
          if (!line) throw new Error("The folder chooser did not return a folder.");
          const result = JSON.parse(line.slice("REPO_GUI_WORKSPACE:".length));
          if (result.error) throw new Error(result.error);
          resolve(result.selected || "");
        } catch (error) { reject(error); }
      });
    });
  });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 28_000_000) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function upload(body) {
  const safeName = path.basename(String(body.name || "attachment"))
    .replace(/[^A-Za-z0-9_.-]/g, "-");
  const match = String(body.data || "").match(/^data:[^;]*;base64,(.+)$/s);
  if (!match) throw new Error("The attachment data is invalid.");
  const contents = Buffer.from(match[1], "base64");
  if (contents.length > 20 * 1024 * 1024) throw new Error("Attachments must be 20 MB or smaller.");
  if (!activeSpec) throw new Error("Open an applet before attaching a file.");
  const uploadRoot = path.join(repositoryDataRoot(activeSpec.repository.localPath), "uploads");
  await fs.mkdir(uploadRoot, { recursive: true });
  const destination = path.join(uploadRoot, `${crypto.randomUUID()}-${safeName}`);
  await fs.writeFile(destination, contents);
  return { path: destination, name: safeName, size: contents.length };
}

function safeUploadPath(value) {
  const parts = String(value || "").split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("The selected folder contains an invalid path.");
  }
  return parts.map((part) => part.replace(/[^A-Za-z0-9_.-]/g, "-")).filter(Boolean);
}

async function uploadDirectory(body) {
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) throw new Error("Choose a folder containing at least one file.");
  if (files.length > 1000) throw new Error("Folders may contain at most 1,000 files.");
  if (!activeSpec) throw new Error("Open an applet before attaching a folder.");
  const directoryRoot = path.join(repositoryDataRoot(activeSpec.repository.localPath), "uploads", crypto.randomUUID());
  let total = 0;
  for (const file of files) {
    const relative = safeUploadPath(file.path);
    const match = String(file.data || "").match(/^data:[^;]*;base64,(.+)$/s);
    if (!match) throw new Error("One of the selected files is invalid.");
    const contents = Buffer.from(match[1], "base64");
    total += contents.length;
    if (total > 20 * 1024 * 1024) throw new Error("Folder attachments must be 20 MB or smaller in total.");
    const destination = path.join(directoryRoot, ...relative.slice(1));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  return { path: directoryRoot, files: files.length, size: total };
}

async function analyze(body) {
  const repository = await cloneRepository(body.url, storageRoot);
  const spec = await analyzeRepository(repository.path, repository);
  const saved = await saveApplet(storageRoot, spec);
  activeSpec = saved.spec;
  return activeSpec;
}

async function run(body) {
  if (!activeSpec) throw new Error("Analyze a repository before running a command.");
  const command = activeSpec.commands.find((item) => item.id === body.commandId);
  if (!command) throw new Error("The selected command is no longer available.");
  let output = "";
  const result = await runCommand(activeSpec, command, body.values || {}, (text) => { output += text; });
  const artifacts = (result.artifacts || []).map((artifact) => {
    const id = crypto.randomUUID();
    artifactFiles.set(id, artifact.path);
    const { path: _privatePath, ...safeArtifact } = artifact;
    return { ...safeArtifact, url: `/api/artifacts/${id}` };
  });
  return { ...result, artifacts, output };
}

async function serveArtifact(id, response) {
  const filePath = artifactFiles.get(id);
  if (!filePath || !fsSync.existsSync(filePath) || !fsSync.statSync(filePath).isFile()) {
    json(response, 404, { error: "Result file not found." });
    return;
  }
  const name = path.basename(filePath).replace(/["\r\n]/g, "-");
  const extension = path.extname(name).toLowerCase();
  const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".csv": "text/csv; charset=utf-8", ".tsv": "text/tab-separated-values; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8" };
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Content-Disposition": `${mimeTypes[extension]?.startsWith("image/") ? "inline" : "attachment"}; filename="${name}"`,
    "X-Content-Type-Options": "nosniff",
  });
  fsSync.createReadStream(filePath).pipe(response);
}

async function setup(body) {
  if (!activeSpec) throw new Error("Analyze a repository before creating its environment.");
  const command = activeSpec.commands.find((item) => item.id === body.commandId);
  if (!command) throw new Error("The selected task is no longer available.");
  let output = "";
  const result = await prepareEnvironment(activeSpec, command, (text) => { output += text; });
  command.compatibility = compatibilityFor(activeSpec.repository.localPath, command);
  return { ...result, output, compatibility: command.compatibility };
}

function plan(body) {
  if (!activeSpec) throw new Error("Analyze a repository before asking its assistant.");
  return planUserRequest(activeSpec, body.message, Array.isArray(body.attachments) ? body.attachments : []);
}

async function serveStatic(requestPath, response) {
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "");
  const filePath = path.resolve(rendererRoot, relative);
  if (filePath !== rendererRoot && !filePath.startsWith(`${rendererRoot}${path.sep}`)) {
    json(response, 404, { error: "Not found." });
    return;
  }
  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(contents);
  } catch {
    json(response, 404, { error: "Not found." });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    if (request.method === "POST" && requestUrl.pathname === "/api/analyze") {
      json(response, 200, await analyze(await readJson(request)));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/search") {
      json(response, 200, await searchRepositories((await readJson(request)).goal));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/run") {
      json(response, 200, await run(await readJson(request)));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/setup") {
      json(response, 200, await setup(await readJson(request)));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/plan") {
      json(response, 200, plan(await readJson(request)));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/applets") {
      json(response, 200, { applets: await listApplets(storageRoot) });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/workspace") {
      json(response, 200, {
        label: path.basename(storageRoot),
        custom: storageRoot !== path.resolve(defaultStorageRoot),
        canChoose: Boolean(electronExecutable()),
        message: "Every repository gets its own folder for the applet, setup, inputs, and results.",
      });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/workspace/choose") {
      const selected = await chooseWorkspaceFolder();
      if (!selected) {
        json(response, 200, { label: path.basename(storageRoot), canceled: true, canChoose: true });
        return;
      }
      storageRoot = path.resolve(selected);
      await fs.mkdir(storageRoot, { recursive: true });
      activeSpec = null;
      artifactFiles.clear();
      json(response, 200, { label: path.basename(storageRoot), selected: true, canChoose: true });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/applets/load") {
      activeSpec = await loadApplet(storageRoot, (await readJson(request)).id);
      json(response, 200, { spec: activeSpec });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/applets/save") {
      if (!activeSpec) throw new Error("Analyze a repository before saving an applet.");
      const saved = await saveApplet(storageRoot, activeSpec, (await readJson(request)).name);
      activeSpec = saved.spec;
      json(response, 200, saved);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/applets/delete") {
      const result = await deleteApplet(storageRoot, (await readJson(request)).id);
      if (activeSpec?.applet?.id === result.id) activeSpec = null;
      json(response, 200, result);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/upload") {
      json(response, 200, await upload(await readJson(request)));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/upload-directory") {
      json(response, 200, await uploadDirectory(await readJson(request)));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/connections/connect") {
      const body = await readJson(request);
      json(response, 200, { providers: await connectProvider(body.provider, body.key) });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/connections/disconnect") {
      json(response, 200, { providers: disconnectProvider((await readJson(request)).provider) });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/connections/test") {
      json(response, 200, await testProviderConnection((await readJson(request)).provider));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/connections") {
      json(response, 200, { providers: connectionSummary() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname.startsWith("/api/artifacts/")) {
      await serveArtifact(requestUrl.pathname.slice("/api/artifacts/".length), response);
      return;
    }
    if (request.method === "GET") {
      await serveStatic(requestUrl.pathname, response);
      return;
    }
    json(response, 405, { error: "Method not allowed." });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RepoPilot browser preview: http://${HOST}:${PORT}`);
});
