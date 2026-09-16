const fs = require("node:fs/promises");
const path = require("node:path");

const SKIP = new Set([".git", ".repo-gui", "node_modules", "vendor", "target", "dist", "build", ".venv", "venv"]);
const EXTENSIONS = new Map([
  [".py", "Python"], [".js", "JavaScript"], [".mjs", "JavaScript"], [".cjs", "JavaScript"],
  [".ts", "TypeScript"], [".tsx", "TypeScript"], [".rs", "Rust"], [".php", "PHP"],
  [".go", "Go"], [".java", "Java"], [".kt", "Kotlin"], [".rb", "Ruby"],
  [".cs", "C#"], [".swift", "Swift"], [".c", "C"], [".cc", "C++"], [".cpp", "C++"],
  [".ipynb", "Jupyter Notebook"],
]);
const MANIFESTS = {
  "composer.json": { language: "PHP", ecosystem: "Composer" },
  "package.json": { language: "JavaScript", ecosystem: "npm" },
  "pyproject.toml": { language: "Python", ecosystem: "PyPI" },
  "setup.py": { language: "Python", ecosystem: "PyPI" },
  "Cargo.toml": { language: "Rust", ecosystem: "Cargo" },
  "go.mod": { language: "Go", ecosystem: "Go modules" },
  "Gemfile": { language: "Ruby", ecosystem: "Bundler" },
  "pom.xml": { language: "Java", ecosystem: "Maven" },
  "build.gradle": { language: "Java", ecosystem: "Gradle" },
  "build.gradle.kts": { language: "Kotlin", ecosystem: "Gradle" },
};

async function walk(root, current = root, state = { files: [], counts: new Map() }) {
  if (state.files.length >= 5000) return state;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (state.files.length >= 5000) break;
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) await walk(root, path.join(current, entry.name), state);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(root, path.join(current, entry.name)).replace(/\\/g, "/");
    state.files.push(relative);
    const language = EXTENSIONS.get(path.extname(entry.name).toLowerCase());
    if (language) state.counts.set(language, (state.counts.get(language) || 0) + 1);
  }
  return state;
}

async function profileRepository(repoPath) {
  const state = await walk(repoPath);
  const rootFiles = new Set(state.files.filter((file) => !file.includes("/")));
  const manifests = Object.entries(MANIFESTS)
    .filter(([name]) => rootFiles.has(name))
    .map(([name, details]) => ({ name, ...details }));
  for (const manifest of manifests) {
    if (!state.counts.has(manifest.language)) state.counts.set(manifest.language, 1);
  }
  const languages = [...state.counts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((left, right) => right.files - left.files);
  return {
    primaryLanguage: languages[0]?.name || "Unknown",
    languages,
    manifests,
    fileCount: state.files.length,
    kind: "unknown",
  };
}

module.exports = { profileRepository };
