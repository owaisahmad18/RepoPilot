const test = require("node:test");
const assert = require("node:assert/strict");
const { safePackages } = require("../src/core/environmentManager");

test("setup agent accepts package names but rejects commands, paths, and URLs", () => {
  assert.deepEqual(safePackages(["numpy", "scikit-image", "numpy", "https://bad.example/pkg", "-r", "../local", "x;calc"]), ["numpy", "scikit-image"]);
});
