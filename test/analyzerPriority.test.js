const test = require("node:test");
const assert = require("node:assert/strict");
const { prioritizeTasks } = require("../src/core/analyzer");

test("puts user-facing analysis tasks ahead of setup commands", () => {
  const commands = [
    { name: "setup", description: "Install supporting data", args: [] },
    { name: "detect", description: "Detect objects", args: [{ control: "file", section: "primary", displayLabel: "Image" }] },
    { name: "info", description: "Show image information", args: [{ control: "file", section: "primary", displayLabel: "FITS image" }] },
  ];
  assert.deepEqual(prioritizeTasks(commands).map((command) => command.name), ["detect", "info", "setup"]);
});
