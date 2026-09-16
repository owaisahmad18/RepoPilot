const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { deleteApplet, listApplets, loadApplet, saveApplet } = require("../src/core/applets");
const { workspaceId } = require("../src/core/workspacePaths");

test("saves, lists, renames, and reloads a generated interface", async (context) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-applets-"));
  context.after(() => fs.rm(storage, { recursive: true, force: true }));
  const id = workspaceId("science", "images");
  const repository = path.join(storage, "applets", id, "repository");
  await fs.mkdir(repository, { recursive: true });
  const original = {
    generatedAt: new Date(0).toISOString(),
    repository: { owner: "science", name: "images", url: "https://github.com/science/images.git", localPath: repository },
    commands: [{ id: "analyze" }],
  };

  const first = await saveApplet(storage, original, "Cell analysis");
  assert.equal(first.applet.id, id);
  assert.equal(first.applet.name, "Cell analysis");
  assert.equal((await listApplets(storage))[0].commandCount, 1);
  const stored = JSON.parse(await fs.readFile(path.join(storage, "applets", id, "applet.json"), "utf8"));
  assert.equal(stored.repository.localPath, `applets/${id}/repository`);
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(storage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const renamed = await saveApplet(storage, first.spec, "Microscope helper");
  assert.equal((await loadApplet(storage, renamed.applet.id)).applet.name, "Microscope helper");

  const environment = path.join(storage, "applets", id, "environment");
  await fs.mkdir(environment, { recursive: true });
  await deleteApplet(storage, renamed.applet.id);
  assert.deepEqual(await listApplets(storage), []);
  await assert.rejects(fs.stat(repository));
  await assert.rejects(fs.stat(environment));
});

test("refuses to save applet paths outside managed storage", async (context) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-applets-"));
  context.after(() => fs.rm(storage, { recursive: true, force: true }));
  await assert.rejects(
    saveApplet(storage, { repository: { owner: "demo", name: "unsafe", localPath: os.tmpdir() }, commands: [] }),
    /unsafe local path/,
  );
});

test("refuses to delete paths outside managed repository storage", async (context) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-applets-"));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-external-"));
  context.after(() => Promise.all([
    fs.rm(storage, { recursive: true, force: true }),
    fs.rm(external, { recursive: true, force: true }),
  ]));
  const id = workspaceId("demo", "unsafe");
  await fs.mkdir(path.join(storage, "applets", id), { recursive: true });
  await fs.writeFile(path.join(external, "keep.txt"), "safe", "utf8");
  await fs.writeFile(path.join(storage, "applets", id, "applet.json"), JSON.stringify({
    repository: { owner: "demo", name: "unsafe", localPath: external },
    commands: [],
  }), "utf8");
  await assert.rejects(deleteApplet(storage, id), /safely deleted/);
  assert.equal(await fs.readFile(path.join(external, "keep.txt"), "utf8"), "safe");
});
