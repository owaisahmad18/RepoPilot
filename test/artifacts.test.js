const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describeArtifact, splitDelimitedLine } = require("../src/core/artifacts");
const { safeChildEnvironment } = require("../src/core/executor");

test("keeps credentials out of repository process environments", () => {
  const result = safeChildEnvironment({ PATH: "tools", USERPROFILE: "profile", OPENAI_API_KEY: "secret", GH_TOKEN: "secret" });
  assert.equal(result.PATH, "tools");
  assert.equal(result.USERPROFILE, "profile");
  assert.equal(result.OPENAI_API_KEY, undefined);
  assert.equal(result.GH_TOKEN, undefined);
  assert.equal(result.REPO_GUI_RESTRICTED, "1");
});

test("previews quoted table output for non-coding users", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "repo-gui-artifact-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "results.csv");
  fs.writeFileSync(file, 'name,value\n"cell, one",42\n', "utf8");
  const artifact = describeArtifact(file);
  assert.equal(artifact.kind, "table");
  assert.deepEqual(artifact.table.rows[0], ["cell, one", "42"]);
  assert.deepEqual(splitDelimitedLine('"a,b",c', ","), ["a,b", "c"]);
});
