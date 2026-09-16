const fs = require("node:fs/promises");
const path = require("node:path");

function field(id, label, control, details = {}) {
  return { id, label, control, names: [id], option: null, positional: false, required: false,
    action: "", type: control === "number" ? "number" : "string", choices: [], default: "",
    accept: "", formatHint: "", ...details };
}

async function readComposer(repoPath) {
  try { return JSON.parse(await fs.readFile(path.join(repoPath, "composer.json"), "utf8")); }
  catch { return null; }
}

async function imageMethods(repoPath) {
  try {
    const sources = await Promise.all([
      fs.readFile(path.join(repoPath, "src", "Image.php"), "utf8"),
      fs.readFile(path.join(repoPath, "src", "ImageManager.php"), "utf8"),
    ]);
    const source = sources.join("\n");
    return new Set([...source.matchAll(/public\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]));
  } catch { return new Set(); }
}

async function analyzePhpLibrary(repoPath) {
  const composer = await readComposer(repoPath);
  if (!composer) return { analyzer: "php-composer-library-v1", commands: [], detected: false };
  const text = [composer.name, composer.description, ...(composer.keywords || [])].join(" ").toLowerCase();
  const methods = await imageMethods(repoPath);
  const required = ["decodePath", "resize", "crop", "rotate", "encodeUsingFormat"];
  const isImageLibrary = /\bimage\b/.test(text) && required.every((method) => methods.has(method));
  if (!isImageLibrary) return { analyzer: "php-composer-library-v1", commands: [], detected: true };

  const operations = ["resize", "scale", "cover", "crop", "rotate", "blur", "sharpen", "flip", "grayscale"]
    .filter((operation) => methods.has(operation));
  return {
    analyzer: "php-composer-image-workflow-v1",
    detected: true,
    commands: [{
      id: "php-image-transform",
      name: "Image transform",
      description: `Generated from ${composer.name}'s public image API. Choose an operation and export format.`,
      entry: "src/Image.php",
      runtime: "php-composer-image",
      kind: "workflow",
      confidence: "high",
      args: [
        field("input-image", "Input Image", "file", { required: true, accept: "image/*", formatHint: "Choose an image file." }),
        field("operation", "Operation", "select", { required: true, choices: operations, default: operations[0], formatHint: `Choose one value: ${operations.join(", ")}.` }),
        field("width", "Width", "number", { required: true, showWhen: { field: "operation", values: ["resize", "scale", "cover", "crop"] }, min: 1, formatHint: "Enter pixels, for example 800." }),
        field("height", "Height", "number", { required: true, showWhen: { field: "operation", values: ["resize", "scale", "cover", "crop"] }, min: 1, formatHint: "Enter pixels, for example 600." }),
        field("x", "Crop X", "number", { showWhen: { field: "operation", values: ["crop"] }, default: 0, min: 0, formatHint: "Horizontal crop offset in pixels." }),
        field("y", "Crop Y", "number", { showWhen: { field: "operation", values: ["crop"] }, default: 0, min: 0, formatHint: "Vertical crop offset in pixels." }),
        field("angle", "Angle", "number", { showWhen: { field: "operation", values: ["rotate"] }, default: 90, formatHint: "Rotation angle in degrees." }),
        field("level", "Strength", "number", { showWhen: { field: "operation", values: ["blur", "sharpen"] }, default: 5, min: 0, formatHint: "Effect strength, for example 5." }),
        field("direction", "Direction", "select", { showWhen: { field: "operation", values: ["flip"] }, choices: ["horizontal", "vertical"], default: "horizontal", formatHint: "Choose the flip direction." }),
        field("format", "Output Format", "select", { required: true, choices: ["jpeg", "png", "webp", "gif"], default: "jpeg", formatHint: "Choose the exported image format." }),
        field("quality", "Quality", "number", { default: 85, min: 1, max: 100, formatHint: "Enter 1–100." }),
        field("output-name", "Output Name", "text", { default: "repopilot-output", formatHint: "Filename without an extension." }),
      ],
    }],
  };
}

module.exports = { analyzePhpLibrary };
