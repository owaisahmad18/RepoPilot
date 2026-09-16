const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzeInteractiveScienceRepository } = require("../src/core/interactiveScienceAnalyzer");

test("turns a single-file interactive climate CSV tool into a guided workflow", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-climate-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "README.md"), "Climate and precipitation analysis for CSV weather records.");
  await fs.writeFile(path.join(root, "climate.py"), `def clmtmenu():\n    input("Choose .csv: ")\nclmtmenu()\n`);
  const result = await analyzeInteractiveScienceRepository(root);
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].runtime, "python-interactive-science");
  assert.equal(result.commands[0].args[0].accept, ".csv");
});
