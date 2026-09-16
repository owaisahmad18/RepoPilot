const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzeRustRepository } = require("../src/core/rustAnalyzer");

test("analyzes a Rust clap derive command", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-rust-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "Cargo.toml"), `[package]\nname = "finder"\ndescription = "Find things"\n`, "utf8");
  await fs.writeFile(path.join(root, "src", "cli.rs"), `
use clap::Parser;
#[derive(Parser)]
#[command(name = "finder", about = "Find files")]
pub struct Opts {
    /// Include hidden files.
    #[arg(long, short = 'H')]
    pub hidden: bool,

    #[arg(long = "max-depth", help = "Maximum depth")]
    pub depth: Option<usize>,

    #[arg(help = "Search pattern")]
    pub pattern: Option<String>,
}
`, "utf8");

  const spec = await analyzeRustRepository(root, { owner: "demo", repo: "finder" });
  assert.equal(spec.commands.length, 1);
  assert.equal(spec.commands[0].name, "finder");
  assert.equal(spec.commands[0].description, "Find files");
  assert.equal(spec.commands[0].args[0].option, "--hidden");
  assert.equal(spec.commands[0].args[0].control, "boolean");
  assert.equal(spec.commands[0].args[1].option, "--max-depth");
  assert.equal(spec.commands[0].args[2].positional, true);
});

test("splits nested Rust clap subcommands into focused tasks", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-rust-subcommands-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "Cargo.toml"), `[package]\nname = "astro"\ndescription = "Astronomy tools"\n`, "utf8");
  await fs.writeFile(path.join(root, "src", "main.rs"), `
use clap::{Args, Parser, Subcommand};
#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Detect sources in an image.
    Detect { image: std::path::PathBuf, #[arg(long)] sigma: Option<f32> },
    /// Combine several exposures.
    Stack(StackArgs),
}
#[derive(Args)]
struct StackArgs {
    images: Vec<std::path::PathBuf>,
    #[arg(long)] output: Option<std::path::PathBuf>,
}
`, "utf8");

  const spec = await analyzeRustRepository(root, { owner: "demo", repo: "astro" });
  assert.deepEqual(spec.commands.map((command) => command.name), ["detect", "stack"]);
  assert.deepEqual(spec.commands.map((command) => command.prefixArgs), [["detect"], ["stack"]]);
  assert.equal(spec.commands[0].args[0].control, "file");
  assert.equal(spec.commands[1].args[0].control, "file");
});
