const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { enhanceInterfaceWithAgent, validatePlan } = require("../src/core/agenticInterfaceBuilder");

function baseSpec(root, commands = []) {
  return {
    schemaVersion: 3,
    repository: { owner: "demo", repo: "tool", localPath: root },
    profile: { primaryLanguage: "Python", kind: commands.length ? "command-line" : "unknown" },
    commands,
  };
}

function emptyPlan(overrides = {}) {
  return { summary: "A simple interface.", commandOrder: [], refinements: [], newCommands: [], ...overrides };
}

test("repairs an invalid agent plan and applies only presentation changes", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-agent-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "cli.py"), "print('hello')\n", "utf8");
  const spec = baseSpec(root, [{
    id: "run", name: "run", displayName: "Run", description: "Run it", runtime: "python", entry: "cli.py", args: [{ id: "input", label: "Input", control: "file" }],
  }]);
  const plans = [
    emptyPlan({ refinements: [{ commandId: "invented", displayName: "Bad", displayDescription: "Bad", fields: [] }] }),
    emptyPlan({ commandOrder: ["run"], refinements: [{ commandId: "run", displayName: "Analyze a sample", displayDescription: "Choose a sample and analyze it.", fields: [{ fieldId: "input", displayLabel: "Sample file", displayHelp: "Choose the sample you want to analyze.", placeholder: "" }] }] }),
  ];
  const prompts = [];
  const result = await enhanceInterfaceWithAgent(root, spec, {
    providers: [{ id: "claude", name: "Claude", mode: "cli" }],
    generate: async (_provider, prompt) => { prompts.push(prompt); return plans.shift(); },
  });
  assert.equal(result.generation.mode, "agent");
  assert.equal(result.generation.attempts, 2);
  assert.equal(result.commands[0].entry, "cli.py");
  assert.equal(result.commands[0].displayName, "Analyze a sample");
  assert.equal(result.commands[0].args[0].displayLabel, "Sample file");
  assert.match(prompts[1], /Unknown command id/);
});

test("rejects generated commands with traversal and shell syntax", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-agent-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const plan = emptyPlan({ newCommands: [{
    id: "run", name: "run", displayName: "Run", description: "Run", runtime: "python", entry: "../outside.py",
    module: "", moduleRoot: "", binary: "", prefixArgs: [], args: [{ id: "value", label: "Value", help: "Value", control: "text", required: true, default: null, choices: [], option: "--value;whoami", positional: false, multiple: false, accept: "" }],
  }] });
  const result = await validatePlan(root, baseSpec(root), plan);
  assert.ok(result.errors.some((error) => /Unsafe entry path/.test(error)));
  assert.ok(result.errors.some((error) => /Unsafe option/.test(error)));
});

test("creates a validated Python GUI only from an existing entry file", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-agent-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "main.py"), "import argparse\n", "utf8");
  const plan = emptyPlan({ commandOrder: ["analyze"], newCommands: [{
    id: "analyze", name: "analyze", displayName: "Analyze data", description: "Analyze a data file.", runtime: "python", entry: "main.py",
    module: "", moduleRoot: "", binary: "", prefixArgs: [], args: [{ id: "input", label: "Data file", help: "Choose the data file to analyze.", control: "file", required: true, default: null, choices: [], option: "--input", positional: false, multiple: false, accept: ".csv,.txt" }],
  }] });
  const result = await enhanceInterfaceWithAgent(root, baseSpec(root), {
    providers: [{ id: "codex", name: "Codex / OpenAI", mode: "api", credential: "hidden" }],
    generate: async () => plan,
  });
  assert.equal(result.generation.mode, "agent");
  assert.equal(result.commands[0].runtime, "python");
  assert.equal(result.commands[0].entry, "main.py");
  assert.equal(result.commands[0].args[0].control, "file");
});

test("uses the deterministic analyzer when no AI provider is connected", async () => {
  const spec = baseSpec("C:/unused", [{ id: "safe", args: [] }]);
  const result = await enhanceInterfaceWithAgent("C:/unused", spec, { providers: [] });
  assert.equal(result.generation.mode, "deterministic");
  assert.equal(result.commands[0].id, "safe");
});
