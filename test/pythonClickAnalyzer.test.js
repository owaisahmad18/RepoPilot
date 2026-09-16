const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzePythonClickRepository } = require("../src/core/pythonClickAnalyzer");

test("turns Click subcommands into separate image tasks", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-click-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "images"));
  await fs.writeFile(path.join(root, "pyproject.toml"), `[project.scripts]\nimages = "images.__main__:cli"\n`);
  await fs.writeFile(path.join(root, "images", "__main__.py"), `
import click
@click.group()
def cli(): pass
@cli.command()
@click.argument("filename", type=click.Path(exists=True))
@click.option("--threshold", default=0.5, type=float)
def analyze(filename, threshold): pass
`);
  const result = await analyzePythonClickRepository(root);
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].name, "analyze");
  assert.equal(result.commands[0].module, "images.__main__");
  assert.deepEqual(result.commands[0].prefixArgs, ["analyze"]);
  assert.equal(result.commands[0].args[0].control, "file");
});
