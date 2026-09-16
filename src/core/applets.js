const fs = require("node:fs/promises");
const path = require("node:path");
const { appletRoot, appletsRoot, repositoryDataRoot, validateWorkspaceId, workspaceId } = require("./workspacePaths");

function appletId(spec) {
  const repository = spec?.repository || {};
  return workspaceId(repository.owner || "local", repository.name || repository.repo);
}

function appletPath(storageRoot, id) {
  return path.join(appletRoot(storageRoot, validateWorkspaceId(id)), "applet.json");
}

function managedPath(storageRoot, value) {
  const storagePath = path.resolve(storageRoot);
  const candidate = path.isAbsolute(String(value || ""))
    ? path.resolve(String(value))
    : path.resolve(storagePath, String(value || ""));
  if (!value || candidate === storagePath || !candidate.startsWith(`${storagePath}${path.sep}`)) {
    throw new Error("The applet contains an unsafe local path.");
  }
  return candidate;
}

function portableSpec(storageRoot, spec) {
  const localPath = managedPath(storageRoot, spec.repository?.localPath);
  return {
    ...spec,
    repository: {
      ...spec.repository,
      localPath: path.relative(path.resolve(storageRoot), localPath).replace(/\\/g, "/"),
    },
  };
}

function hydratedSpec(storageRoot, spec) {
  return {
    ...spec,
    repository: { ...spec.repository, localPath: managedPath(storageRoot, spec.repository?.localPath) },
  };
}

function publicApplet(spec, id, stats = {}) {
  const repository = spec.repository || {};
  return {
    id,
    name: spec.applet?.name || repository.name || repository.repo || "Saved applet",
    repository: [repository.owner, repository.name || repository.repo].filter(Boolean).join("/"),
    repositoryUrl: repository.url || repository.cloneUrl || "",
    commandCount: Array.isArray(spec.commands) ? spec.commands.length : 0,
    updatedAt: spec.applet?.updatedAt || stats.mtime?.toISOString?.() || spec.generatedAt || "",
  };
}

async function saveApplet(storageRoot, spec, rawName) {
  if (!spec?.repository || !Array.isArray(spec.commands)) throw new Error("There is no generated interface to save.");
  const id = appletId(spec);
  const name = String(rawName || spec.applet?.name || spec.repository.name || spec.repository.repo || "Saved applet")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new Error("Enter an applet name.");
  const saved = hydratedSpec(storageRoot, { ...spec, applet: { id, name, updatedAt: new Date().toISOString() } });
  await fs.mkdir(appletRoot(storageRoot, id), { recursive: true });
  await fs.writeFile(appletPath(storageRoot, id), JSON.stringify(portableSpec(storageRoot, saved), null, 2), "utf8");
  return { spec: saved, applet: publicApplet(saved, id) };
}

async function listApplets(storageRoot) {
  let files = [];
  try { files = await fs.readdir(appletsRoot(storageRoot), { withFileTypes: true }); } catch { return []; }
  const applets = await Promise.all(files.map(async (file) => {
    if (!file.isDirectory()) return null;
    const id = file.name;
    try { validateWorkspaceId(id); } catch { return null; }
    try {
      const filePath = appletPath(storageRoot, id);
      const [spec, stats] = await Promise.all([fs.readFile(filePath, "utf8").then(JSON.parse), fs.stat(filePath)]);
      const portable = portableSpec(storageRoot, spec);
      if (spec.repository?.localPath !== portable.repository.localPath) {
        await fs.writeFile(filePath, JSON.stringify(portable, null, 2), "utf8");
      }
      return publicApplet(spec, id, stats);
    } catch { return null; }
  }));
  return applets.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, 50);
}

async function loadApplet(storageRoot, id) {
  let spec;
  try { spec = hydratedSpec(storageRoot, JSON.parse(await fs.readFile(appletPath(storageRoot, id), "utf8"))); }
  catch { throw new Error("This applet's repository is no longer available locally. Analyze it again."); }
  const localPath = spec.repository.localPath;
  try { if (!(await fs.stat(localPath)).isDirectory()) throw new Error(); }
  catch { throw new Error("This applet's repository is no longer available locally. Analyze it again."); }
  return spec;
}

async function deleteApplet(storageRoot, id) {
  const filePath = appletPath(storageRoot, id);
  let spec;
  try { spec = hydratedSpec(storageRoot, JSON.parse(await fs.readFile(filePath, "utf8"))); }
  catch { throw new Error("This applet could not be safely deleted."); }
  const repositoryPath = spec.repository.localPath;
  const dataRoot = path.resolve(appletRoot(storageRoot, id));
  if (repositoryDataRoot(repositoryPath) !== dataRoot || repositoryPath !== path.join(dataRoot, "repository")) {
    throw new Error("This applet could not be safely deleted.");
  }
  await fs.rm(dataRoot, { recursive: true, force: true });
  return { id };
}

module.exports = { appletId, deleteApplet, listApplets, loadApplet, publicApplet, saveApplet };
