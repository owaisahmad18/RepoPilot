const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichField } = require("../src/core/fieldPresentation");

function field(details) {
  return { id: "value", label: "Value", names: [], option: null, help: "", type: "str", control: "text", ...details };
}

test("creates concrete placeholders from argument meaning", () => {
  assert.equal(enrichField(field({ id: "pr-number", label: "PR Number", type: "int", control: "number" })).placeholder, "123");
  assert.equal(enrichField(field({ id: "model", label: "Model", help: "override the primary STT model" })).placeholder, "gpt-4o-transcribe");
  assert.equal(enrichField(field({ id: "json", label: "JSON", help: "write results here", type: "Path" })).placeholder, "results.json");
  assert.equal(enrichField(field({ id: "base", label: "Base", help: "Base branch" })).placeholder, "main");
});

test("turns directory-shaped path arguments into folder pickers", () => {
  const result = enrichField(field({ id: "dir", label: "Dir", names: ["--dir"], help: "directory of audio + .txt pairs", type: "Path" }));
  assert.equal(result.control, "directory");
  assert.equal(result.placeholder, "");
  assert.equal(result.displayLabel, "Audio and transcript folder");
  assert.equal(result.section, "primary");
});

test("hides auto-detected values and moves optional technical values to advanced settings", () => {
  const base = enrichField(field({ id: "base", label: "Base", help: "Base branch (default: auto-detect from PR)" }));
  const model = enrichField(field({ id: "model", label: "Model", help: "override the primary STT model" }));
  assert.equal(base.section, "hidden");
  assert.equal(base.displayHelp, "Detected automatically when the task runs.");
  assert.equal(model.section, "advanced");
  assert.equal(model.displayLabel, "Speech-to-text model");
});

test("turns dry-run flags into a safe user choice", () => {
  const preview = enrichField(field({ id: "dry-run", label: "Dry Run", help: "Don't post comments, just print", control: "boolean", default: false }));
  assert.equal(preview.displayLabel, "Preview only");
  assert.equal(preview.displayHelp, "Show what would happen without posting or changing anything.");
  assert.equal(preview.default, true);
  assert.equal(preview.section, "primary");
});

test("keeps output format and timing controls human friendly", () => {
  const format = enrichField(field({ id: "format", label: "Format", help: "Output formats", choices: ["png", "json"], control: "select" }));
  const start = enrichField(field({ id: "starttime", label: "Starttime" }));
  const fps = enrichField(field({ id: "fps", label: "Fps", help: "Frames per second", control: "number" }));
  assert.equal(format.displayLabel, "Output format");
  assert.equal(start.control, "datetime-local");
  assert.equal(start.displayLabel, "Start time (UTC)");
  assert.equal(fps.displayHelp, "Frames per second");
});

test("does not mistake image counters or plugin folders for image uploads", () => {
  const index = enrichField(field({ id: "first-image-set", label: "First Image Set", help: "The one-based index of the first image set to process", control: "file" }));
  const batch = enrichField(field({ id: "images-per-batch", label: "Images Per Batch", help: "The number of images in each batch", default: "1", control: "file" }));
  const plugins = enrichField(field({ id: "plugins-directory", label: "Plugins Directory", help: "Look for plugin modules in this directory" }));
  assert.equal(index.control, "number");
  assert.equal(batch.control, "number");
  assert.equal(plugins.control, "directory");
  assert.equal(plugins.section, "advanced");
});
