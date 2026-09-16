const crypto = require("node:crypto");
const path = require("node:path");

function safePart(value, limit) {
  return String(value || "repository").replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, limit) || "repository";
}

function workspaceId(owner, repository) {
  const identity = `${String(owner || "local").toLowerCase()}/${String(repository || "repository").toLowerCase()}`;
  const hash = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 8);
  return `${safePart(owner || "local", 24)}--${safePart(repository, 40)}-${hash}`;
}

function validateWorkspaceId(id) {
  if (!/^[A-Za-z0-9_.-]+--[A-Za-z0-9_.-]+-[a-f0-9]{8}$/.test(String(id || ""))) {
    throw new Error("Invalid applet identifier.");
  }
  return String(id);
}

function appletsRoot(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), "applets");
}

function appletRoot(workspaceRoot, id) {
  return path.join(appletsRoot(workspaceRoot), validateWorkspaceId(id));
}

function appletRepositoryRoot(workspaceRoot, id) {
  return path.join(appletRoot(workspaceRoot, id), "repository");
}

function repositoryDataRoot(repositoryRoot) {
  return path.dirname(path.resolve(repositoryRoot));
}

module.exports = { appletRepositoryRoot, appletRoot, appletsRoot, repositoryDataRoot, validateWorkspaceId, workspaceId };
