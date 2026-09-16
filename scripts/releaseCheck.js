const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const skippedDirectories = new Set([".git", ".repo-gui", ".repopilot", "coverage", "dist", "node_modules", "release"]);
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".toml", ".txt", ".yaml", ".yml"]);
const findings = [];

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["OpenAI or Anthropic key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
];
const personalPathPatterns = [
  /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/i,
  /\/(?:Users|home)\/[^/\s"']+/,
];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (/^\.env(?:\.|$)/i.test(entry.name)) findings.push(`${relative}: environment file must not be released`);
    if (!textExtensions.has(path.extname(entry.name).toLowerCase()) || relative === "scripts/releaseCheck.js") continue;
    const contents = fs.readFileSync(absolute, "utf8");
    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(contents)) findings.push(`${relative}: possible ${label}`);
    }
    if (personalPathPatterns.some((pattern) => pattern.test(contents))) findings.push(`${relative}: absolute personal path`);
  }
}

walk(root);
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
for (const required of [".env", ".env.*", ".npmrc", ".repopilot/", "node_modules/", "dist/", "release/"]) {
  if (!gitignore.split(/\r?\n/).includes(required)) findings.push(`.gitignore: missing ${required}`);
}

if (findings.length) {
  console.error("Release safety check failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Release safety check passed: no credentials or personal paths found in releasable files.");
}
