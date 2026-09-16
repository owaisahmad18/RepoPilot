const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzePythonRepository, extractBalancedCalls } = require("../src/core/pythonAnalyzer");

test("extractBalancedCalls handles nested choices", () => {
  const source = `parser.add_argument("--format", choices=("json", "csv"), help="Output format")`;
  assert.deepEqual(
    extractBalancedCalls(source, ".add_argument("),
    ['"--format", choices=("json", "csv"), help="Output format"'],
  );
});

test("analyzes an argparse entry point into form fields", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "main.py"), `
import argparse

parser = argparse.ArgumentParser(description="Convert a document")
parser.add_argument("source", help="Input file")
parser.add_argument("--format", choices=["json", "csv"], default="json")
parser.add_argument("--verbose", action="store_true", help="Show details")

if __name__ == "__main__":
    print(parser.parse_args())
`, "utf8");

  const spec = await analyzePythonRepository(root, { owner: "demo", repo: "converter" });
  assert.equal(spec.commands.length, 1);
  assert.equal(spec.commands[0].description, "Convert a document");
  assert.equal(spec.commands[0].confidence, "high");
  assert.deepEqual(spec.commands[0].args.map((arg) => arg.control), ["file", "select", "boolean"]);
  assert.equal(spec.commands[0].args[0].required, true);
  assert.equal(spec.commands[0].args[0].formatHint, "Choose the input file required by this command.");
  assert.deepEqual(spec.commands[0].args[1].choices, ["json", "csv"]);
});

test("uses a packaged console entry point and ignores internal scripts", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-entrypoint-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "science"));
  await fs.writeFile(path.join(root, "pyproject.toml"), `[project]\nname = "science"\n[project.scripts]\nscience = "science.cli:main"\nscience-web = "science.web:main"\n`);
  await fs.writeFile(path.join(root, "science", "cli.py"), `from science.options import parser\ndef main(): parser.parse_args()\n`);
  await fs.writeFile(path.join(root, "science", "web.py"), `def main(): pass\n`);
  await fs.writeFile(path.join(root, "science", "options.py"), `import argparse\nparser=argparse.ArgumentParser()\nparser.add_argument("--input", required=True)\nparser.add_argument("--version", action="version", version="1")\n`);
  await fs.writeFile(path.join(root, "internal.py"), `import argparse\np=argparse.ArgumentParser()\np.add_argument("--debug")\n`);

  const spec = await analyzePythonRepository(root);
  assert.equal(spec.commands.length, 1);
  assert.equal(spec.commands[0].name, "science");
  assert.equal(spec.commands[0].entry, "science/cli.py");
  assert.deepEqual(spec.commands[0].args.map((arg) => arg.label), ["Input"]);
});

test("resolves a packaged command from a src directory layout", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-src-layout-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src", "science"), { recursive: true });
  await fs.writeFile(path.join(root, "pyproject.toml"), `[project]\nname = "science"\n[project.scripts]\nscience = "science.cli:main"\n[tool.setuptools.packages.find]\nwhere = ["src"]\n`);
  await fs.writeFile(path.join(root, "src", "science", "cli.py"), `import argparse\ndef main():\n p=argparse.ArgumentParser()\n p.add_argument("image")\n p.parse_args()\n`);

  const spec = await analyzePythonRepository(root);
  assert.equal(spec.commands.length, 1);
  assert.equal(spec.commands[0].entry, "src/science/cli.py");
  assert.equal(spec.commands[0].module, "science.cli");
  assert.equal(spec.commands[0].moduleRoot, "src");
});

test("splits argparse subcommands and required alternative inputs", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-subparser-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "main.py"), `
import argparse
p=argparse.ArgumentParser()
sub=p.add_subparsers()
run=sub.add_parser("run", help="Run an analysis")
inputs=run.add_mutually_exclusive_group(required=True)
inputs.add_argument("--file", help="PDB file")
inputs.add_argument("--input")
check=sub.add_parser("check", help="Check data")
check.add_argument("--fastq", required=True, help="FASTQ file")
if __name__ == "__main__": p.parse_args()
`);

  const spec = await analyzePythonRepository(root);
  assert.deepEqual(spec.commands.map((command) => command.name).sort(), ["check", "run"]);
  const run = spec.commands.find((command) => command.name === "run");
  assert.deepEqual(run.localPrefixArgs, ["run"]);
  assert.equal(run.args.filter((arg) => arg.exclusiveRequired).length, 2);
});

test("ignores benchmark scripts that are not public repository tools", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-bench-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "bench.py"), `import argparse\np=argparse.ArgumentParser()\np.add_argument("--runs")\n`);
  const spec = await analyzePythonRepository(root);
  assert.equal(spec.commands.length, 0);
});
