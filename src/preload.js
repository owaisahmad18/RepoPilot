const { contextBridge, ipcRenderer, webUtils } = require("electron");
const path = require("node:path");

function directoryPath(files) {
  const first = files?.[0];
  if (!first) return "";
  let result = webUtils.getPathForFile(first);
  const relativeParts = String(first.webkitRelativePath || first.name).split(/[\\/]/).filter(Boolean);
  for (let index = 1; index < relativeParts.length; index += 1) result = path.dirname(result);
  return result;
}

contextBridge.exposeInMainWorld("repoGui", {
  initialInterface: () => ipcRenderer.invoke("interface:initial"),
  workspace: () => ipcRenderer.invoke("workspace:status"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  connections: () => ipcRenderer.invoke("connections:status"),
  connect: (provider, key) => ipcRenderer.invoke("connections:connect", provider, key),
  disconnect: (provider) => ipcRenderer.invoke("connections:disconnect", provider),
  testConnection: (provider) => ipcRenderer.invoke("connections:test", provider),
  listApplets: () => ipcRenderer.invoke("applets:list"),
  loadApplet: (id) => ipcRenderer.invoke("applets:load", id),
  saveApplet: (name) => ipcRenderer.invoke("applets:save", name),
  deleteApplet: (id) => ipcRenderer.invoke("applets:delete", id),
  openArtifact: (artifactPath) => ipcRenderer.invoke("artifact:open", artifactPath),
  search: (goal) => ipcRenderer.invoke("repo:search", goal),
  analyze: (url) => ipcRenderer.invoke("repo:analyze", url),
  run: (commandId, values) => ipcRenderer.invoke("command:run", commandId, values),
  setup: (commandId) => ipcRenderer.invoke("environment:setup", commandId),
  plan: (message, attachments) => ipcRenderer.invoke("agent:plan", message, attachments),
  filePath: (file) => webUtils.getPathForFile(file),
  directoryPath,
  onProgress: (callback) => ipcRenderer.on("repo:progress", (_event, message) => callback(message)),
  onOutput: (callback) => ipcRenderer.on("command:output", (_event, message) => callback(message)),
});
