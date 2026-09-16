const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzePythonAbslRepository } = require("../src/core/pythonAbslAnalyzer");

test("creates controls from Abseil flags", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-absl-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "main.py"), `
from absl import app, flags
flags.DEFINE_string("input_image", None, "Input microstructure image")
flags.DEFINE_integer("stride", 16, "Window stride")
flags.DEFINE_boolean("preview", False, "Preview results")
flags.mark_flag_as_required("input_image")
def main(argv): pass
if __name__ == "__main__": app.run(main)
`);
  const result = await analyzePythonAbslRepository(root);
  assert.equal(result.commands.length, 1);
  assert.deepEqual(result.commands[0].args.map((field) => field.control), ["file", "number", "boolean"]);
  assert.equal(result.commands[0].args[0].required, true);
});
