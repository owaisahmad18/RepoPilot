const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { appletRepositoryRoot, workspaceId } = require("./workspacePaths");

function parseGitHubUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid GitHub repository URL.");
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("The MVP accepts public HTTPS GitHub URLs only.");
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Use a repository URL such as https://github.com/owner/project.");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("The repository owner or name contains unsupported characters.");
  }

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

function runGit(args, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { shell: false, windowsHide: true });
    let combined = "";

    const collect = (chunk) => {
      const text = chunk.toString();
      combined += text;
      onOutput(text);
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => reject(new Error(`Unable to start Git: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(combined);
      else reject(new Error(combined.trim() || `Git exited with code ${code}.`));
    });
  });
}

function repositoryKey(repo) {
  return crypto.createHash("sha256")
    .update(`${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

function checkoutPath(storageRoot, repo) {
  return appletRepositoryRoot(storageRoot, workspaceId(repo.owner, repo.repo));
}

async function isGitCheckout(destination) {
  try {
    return (await fs.stat(path.join(destination, ".git"))).isDirectory();
  } catch {
    return false;
  }
}

function readableGitError(error) {
  const message = String(error?.message || error || "Git could not clone the repository.");
  if (/filename too long/i.test(message)) {
    return new Error("Git could not check out this repository because Windows rejected a long path, even after RepoPilot enabled Git long-path support.");
  }
  const lines = message.split(/\r?\n/).filter(Boolean);
  return new Error(lines.slice(-12).join("\n") || "Git could not clone the repository.");
}

async function cloneRepository(rawUrl, storageRoot, onOutput = () => {}) {
  const repo = parseGitHubUrl(rawUrl);
  // Keep the checkout prefix short: large repositories can otherwise exceed
  // Windows' legacy path limit before their own directory tree even begins.
  const destination = checkoutPath(storageRoot, repo);
  const reposRoot = path.dirname(destination);
  const partial = `${destination}.partial`;
  await fs.mkdir(reposRoot, { recursive: true });

  if (await isGitCheckout(destination)) {
    onOutput("Repository already cloned; using the local copy.\n");
    return { ...repo, path: destination };
  }

  // A checkout only reaches its final path after Git succeeds. This prevents a
  // failed clone from being mistaken for a reusable repository on the next run.
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rm(partial, { recursive: true, force: true });
  try {
    await runGit([
      "clone",
      "--depth", "1",
      "--config", "core.longpaths=true",
      "--", repo.cloneUrl, partial,
    ], onOutput);
    await fs.rename(partial, destination);
  } catch (error) {
    await fs.rm(partial, { recursive: true, force: true });
    throw readableGitError(error);
  }
  return { ...repo, path: destination };
}

module.exports = { checkoutPath, cloneRepository, parseGitHubUrl, repositoryKey };
