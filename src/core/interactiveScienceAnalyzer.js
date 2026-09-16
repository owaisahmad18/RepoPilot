const fs = require("node:fs/promises");
const path = require("node:path");

async function analyzeInteractiveScienceRepository(repoPath, metadata = {}) {
  const entries = await fs.readdir(repoPath, { withFileTypes: true });
  const pythonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".py"));
  if (pythonFiles.length !== 1) return { analyzer: "python-interactive-science-v1", commands: [], detected: false };

  const entry = pythonFiles[0].name;
  const source = await fs.readFile(path.join(repoPath, entry), "utf8");
  const readme = await fs.readFile(path.join(repoPath, "README.md"), "utf8").catch(() => "");
  const evidence = `${source.slice(0, 30000)}\n${readme.slice(0, 10000)}`.toLowerCase();
  const isClimateCsvTool = source.includes("input(") && source.includes("clmtmenu(")
    && /\b(climate|weather|temperature|precipitation)\b/.test(evidence) && /\.csv\b/.test(evidence);
  if (!isClimateCsvTool) return { analyzer: "python-interactive-science-v1", commands: [], detected: false };

  return {
    analyzer: "python-interactive-science-v1",
    detected: true,
    repository: {
      owner: metadata.owner || "",
      name: metadata.repo || path.basename(repoPath),
      url: metadata.cloneUrl || "",
      localPath: repoPath,
    },
    commands: [{
      id: "interactive-climate-csv",
      name: "Analyze climate records",
      description: "Load a climate CSV and prepare the repository's weather statistics tools.",
      entry,
      runtime: "python-interactive-science",
      adapter: "climate-csv",
      kind: "workflow",
      confidence: "high",
      args: [
        {
          id: "climate-csv", label: "Climate data", control: "file", names: ["climate-csv"], option: null,
          positional: false, required: true, action: "", type: "Path", choices: [], default: "",
          accept: ".csv", formatHint: "Choose the climate CSV you want to analyze.",
        },
        {
          id: "city", label: "Location name", control: "text", names: ["city"], option: null,
          positional: false, required: false, action: "", type: "str", choices: [], default: "",
          placeholder: "Reno, Nevada", help: "Optional label when the file contains more than one station.",
          formatHint: "Enter a city or station name.",
        },
      ],
    }],
  };
}

module.exports = { analyzeInteractiveScienceRepository };
