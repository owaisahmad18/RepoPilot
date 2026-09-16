const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzeRepository } = require("../src/core/analyzer");

test("profiles a PHP image library and generates an image workflow", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-php-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "composer.json"), JSON.stringify({
    name: "demo/image", description: "PHP Image Processing", keywords: ["image", "resize"],
  }));
  await fs.writeFile(path.join(root, "src", "Image.php"), `<?php
class Image {
  public function resize(?int $width, ?int $height) {}
  public function crop(int $width, int $height) {}
  public function rotate(float $angle) {}
  public function encodeUsingFormat(string $format) {}
  public function grayscale() {}
}`);
  await fs.writeFile(path.join(root, "src", "ImageManager.php"), `<?php
class ImageManager { public function decodePath(string $path) {} }`);

  const spec = await analyzeRepository(root, { owner: "demo", repo: "image" });
  assert.equal(spec.schemaVersion, 3);
  assert.equal(spec.profile.primaryLanguage, "PHP");
  assert.equal(spec.profile.kind, "library");
  assert.equal(spec.commands.length, 1);
  assert.equal(spec.commands[0].runtime, "php-composer-image");
  assert.equal(spec.commands[0].kind, "workflow");
  assert.equal(spec.commands[0].args[0].control, "file");
  assert.ok(spec.commands[0].args.find((field) => field.id === "operation").choices.includes("crop"));
});
