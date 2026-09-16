const test = require("node:test");
const assert = require("node:assert/strict");
const { planUserRequest } = require("../src/core/agentPlanner");

const spec = {
  commands: [
    {
      id: "setup", name: "setup", displayName: "Setup", description: "Install astronomy data", args: [],
    },
    {
      id: "detect", name: "detect", displayName: "Detect Stars", description: "Find stars in a FITS image",
      args: [
        { id: "image", label: "Image", displayLabel: "FITS image", control: "file", required: true, default: "", section: "primary" },
        { id: "threshold", label: "Threshold", control: "number", required: false, default: "5", section: "advanced" },
        { id: "out", label: "Out", help: "Output directory", control: "text", required: true, default: "", section: "primary" },
      ],
    },
    {
      id: "stack", name: "stack", displayName: "Stack Images", description: "Combine multiple exposures",
      args: [{ id: "images", label: "Images", control: "file", required: true, default: "", section: "primary" }],
    },
  ],
};

test("maps natural language to a generated task tool", () => {
  const plan = planUserRequest(spec, "Find stars in my FITS image with threshold 8");
  assert.equal(plan.status, "planned");
  assert.equal(plan.commandId, "detect");
  assert.equal(plan.values.threshold, "8");
  assert.equal(plan.values.out, "repopilot-output");
  assert.deepEqual(plan.missing.map((field) => field.id), ["image"]);
});

test("keeps a required choice-group missing until its nested value is supplied", () => {
  const choiceSpec = { commands: [{
    id: "run", name: "run", args: [{
      id: "input-source", label: "Input source", displayLabel: "Input data", control: "choice-group",
      required: true, default: "image", section: "primary", variants: [{ id: "image", label: "Image", control: "file" }],
    }],
  }] };
  const plan = planUserRequest(choiceSpec, "Run this on an image");
  assert.deepEqual(plan.missing.map((field) => field.id), ["input-source"]);
});

test("assigns assistant attachments to the selected tool's required file input", () => {
  const plan = planUserRequest(spec, "Detect stars", [{ name: "sky.fits", type: "image/fits", size: 42 }]);
  assert.equal(plan.commandId, "detect");
  assert.deepEqual(plan.attachmentAssignments, [{ fieldId: "image", attachmentIndexes: [0], variantId: null }]);
  assert.equal(plan.missing.some((field) => field.id === "image"), false);
});

test("asks for clarification instead of guessing an unrelated task", () => {
  const plan = planUserRequest(spec, "help me do something useful");
  assert.equal(plan.status, "clarify");
  assert.equal(plan.commandId, undefined);
  assert.equal(plan.alternatives.length, 3);
});
