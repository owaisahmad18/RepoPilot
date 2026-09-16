const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { checkoutPath, cloneRepository, parseGitHubUrl, repositoryKey } = require("../src/core/repository");

test("validates a public GitHub repository URL", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/sharkdp/fd"), {
    owner: "sharkdp",
    repo: "fd",
    cloneUrl: "https://github.com/sharkdp/fd.git",
  });
  assert.throws(() => parseGitHubUrl("https://example.com/tool"), /GitHub/);
});

test("reuses an existing checkout without requiring a progress callback", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-clone-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = parseGitHubUrl("https://github.com/demo/tool");
  const checkout = checkoutPath(root, repository);
  await fs.mkdir(path.join(checkout, ".git"), { recursive: true });
  await fs.writeFile(path.join(checkout, "README.md"), "existing checkout", "utf8");

  const result = await cloneRepository("https://github.com/demo/tool", root);
  assert.equal(result.path, checkout);
});

test("uses a short stable checkout key for repositories", () => {
  const repository = parseGitHubUrl("https://github.com/significant-gravitas/autogpt");
  assert.match(repositoryKey(repository), /^[a-f0-9]{16}$/);
  const storageRoot = path.join(os.tmpdir(), "very-long-project-name", ".repo-gui");
  const relativeCheckout = path.relative(storageRoot, checkoutPath(storageRoot, repository));
  assert.equal(relativeCheckout.length < 100, true);
});
