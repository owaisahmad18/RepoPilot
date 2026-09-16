const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { cloneRepository } = require("./core/repository");
const { analyzeRepository } = require("./core/analyzer");
const { runCommand } = require("./core/executor");
const { planUserRequest } = require("./core/agentPlanner");
const { searchRepositories } = require("./core/repositorySearch");
const { prepareEnvironment } = require("./core/environmentManager");
const { compatibilityFor } = require("./core/compatibility");
const { connectProvider, connectionSummary, disconnectProvider, testProviderConnection } = require("./core/connections");
const { deleteApplet, listApplets, loadApplet, saveApplet } = require("./core/applets");

let activeSpec = null;
let workspaceRoot = null;
const allowedArtifacts = new Set();

function loadBundledInterface() {
  const specPath = path.join(process.resourcesPath, "generated-interface", "spec.json");
  if (!app.isPackaged || !require("node:fs").existsSync(specPath)) return null;
  const bundled = JSON.parse(require("node:fs").readFileSync(specPath, "utf8"));
  bundled.repository.localPath = path.join(process.resourcesPath, "generated-interface", "repository");
  for (const command of bundled.commands || []) command.compatibility = compatibilityFor(bundled.repository.localPath, command);
  return bundled;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  workspaceRoot = app.getPath("userData");
  activeSpec = loadBundledInterface();
  ipcMain.handle("interface:initial", async () => ({ spec: activeSpec }));
  ipcMain.handle("connections:status", async () => ({ providers: connectionSummary() }));
  ipcMain.handle("connections:connect", async (_event, provider, key) => ({ providers: await connectProvider(provider, key) }));
  ipcMain.handle("connections:disconnect", async (_event, provider) => ({ providers: disconnectProvider(provider) }));
  ipcMain.handle("connections:test", async (_event, provider) => testProviderConnection(provider));
  ipcMain.handle("workspace:status", async () => ({
    label: path.basename(workspaceRoot),
    custom: workspaceRoot !== path.resolve(app.getPath("userData")),
    canChoose: true,
  }));
  ipcMain.handle("workspace:choose", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, {
      title: "Choose a RepoPilot working folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { label: path.basename(workspaceRoot), canceled: true, canChoose: true };
    workspaceRoot = path.resolve(result.filePaths[0]);
    await fs.mkdir(workspaceRoot, { recursive: true });
    activeSpec = null;
    allowedArtifacts.clear();
    return { label: path.basename(workspaceRoot), selected: true, canChoose: true };
  });
  ipcMain.handle("applets:list", async () => ({ applets: await listApplets(workspaceRoot) }));
  ipcMain.handle("applets:load", async (_event, id) => {
    activeSpec = await loadApplet(workspaceRoot, id);
    return { spec: activeSpec };
  });
  ipcMain.handle("applets:save", async (_event, name) => {
    if (!activeSpec) throw new Error("Analyze a repository before saving an applet.");
    const saved = await saveApplet(workspaceRoot, activeSpec, name);
    activeSpec = saved.spec;
    return saved;
  });
  ipcMain.handle("applets:delete", async (_event, id) => {
    const result = await deleteApplet(workspaceRoot, id);
    if (activeSpec?.applet?.id === result.id) activeSpec = null;
    return result;
  });
  ipcMain.handle("artifact:open", async (_event, artifactPath) => {
    const resolved = path.resolve(String(artifactPath || ""));
    if (!allowedArtifacts.has(resolved)) throw new Error("This result file is not available.");
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle("repo:search", async (_event, goal) => searchRepositories(goal));
  ipcMain.handle("repo:analyze", async (event, rawUrl) => {
    const send = (message) => event.sender.send("repo:progress", message);
    send("Cloning repository…\n");
    const repository = await cloneRepository(rawUrl, workspaceRoot, send);
    send("Profiling languages, package manifests, commands, and library capabilities…\n");
    const spec = await analyzeRepository(repository.path, repository);
    activeSpec = (await saveApplet(workspaceRoot, spec)).spec;
    send(`${spec.generation?.mode === "agent" ? `Agent planned and validated the interface with ${spec.generation.provider}.` : "Static analyzers generated the interface."}\n`);
    send(`Generated ${spec.commands.length} usable interface${spec.commands.length === 1 ? "" : "s"}.\n`);
    return activeSpec;
  });

  ipcMain.handle("command:run", async (event, commandId, values) => {
    if (!activeSpec) throw new Error("Analyze a repository before running a command.");
    const command = activeSpec.commands.find((item) => item.id === commandId);
    if (!command) throw new Error("The selected command is no longer available.");
    const send = (message) => event.sender.send("command:output", message);
    const result = await runCommand(activeSpec, command, values, send);
    for (const artifact of result.artifacts || []) allowedArtifacts.add(path.resolve(artifact.path));
    return result;
  });

  ipcMain.handle("environment:setup", async (_event, commandId) => {
    if (!activeSpec) throw new Error("Analyze a repository before creating its environment.");
    const command = activeSpec.commands.find((item) => item.id === commandId);
    if (!command) throw new Error("The selected task is no longer available.");
    let output = "";
    const result = await prepareEnvironment(activeSpec, command, (text) => { output += text; });
    command.compatibility = compatibilityFor(activeSpec.repository.localPath, command);
    return { ...result, output, compatibility: command.compatibility };
  });

  ipcMain.handle("agent:plan", async (_event, message, attachments) => {
    if (!activeSpec) throw new Error("Analyze a repository before asking its assistant.");
    return planUserRequest(activeSpec, message, Array.isArray(attachments) ? attachments : []);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
