const path = require("node:path");
const { cloneRepository } = require("../src/core/repository");
const { analyzeRepository } = require("../src/core/analyzer");

const domains = {
  "Biological cell and tissue imaging": [
    "https://github.com/CellProfiler/CellProfiler",
    "https://github.com/MouseLand/cellpose",
    "https://github.com/AllenCell/aics-segmentation",
    "https://github.com/manuel-munoz-aguirre/PyHIST",
    "https://github.com/ITMO-MMRM-lab/cellpose_plus",
  ],
  "Materials and microstructure imaging": [
    "https://github.com/pranavkokati/grainstat",
    "https://github.com/seatonullberg/grains",
    "https://github.com/NEFM-TUDresden/MCRpy",
    "https://github.com/tldr-group/microstructure-inpainter",
    "https://github.com/Scientific-Computing-Lab/MLography",
  ],
  "Astronomical imaging": [
    "https://github.com/taco-ops/nebulift",
    "https://github.com/theatrus/seiza",
    "https://github.com/Jbsco/plate-solve-annotate",
    "https://github.com/ryanhausen/fitsmap",
    "https://github.com/SHayashida/Amanogawa",
  ],
};

function qualityIssues(spec) {
  const issues = [];
  if (!spec.commands.length) issues.push("no usable task generated");
  if (spec.commands.some((command) => /(?:^|\s)(test|demo|example)(?:$|\s)/i.test(command.displayName))) {
    issues.push("test/demo command leaked into the task list");
  }
  if (new Set(spec.commands.map((command) => command.id)).size !== spec.commands.length) issues.push("duplicate task identifiers");
  for (const command of spec.commands) {
    if (command.args.some((field) => !field.displayLabel || !field.control)) issues.push(`incomplete field in ${command.displayName}`);
    if (command.args.filter((field) => field.section === "primary").length > 8) issues.push(`too many primary inputs in ${command.displayName}`);
  }
  return [...new Set(issues)];
}

async function main() {
  const storageRoot = path.resolve(__dirname, "..", ".repo-gui");
  const results = [];
  for (const [domain, urls] of Object.entries(domains)) {
    for (const url of urls) {
      process.stdout.write(`\nChecking ${domain}: ${url}\n`);
      try {
        const repository = await cloneRepository(url, storageRoot);
        const spec = await analyzeRepository(repository.path, repository);
        const issues = qualityIssues(spec);
        const result = {
          domain, url, status: issues.length ? "needs-work" : "ok", issues,
          primaryLanguage: spec.profile.primaryLanguage,
          filesInspected: spec.profile.fileCount,
          analyzers: spec.analyzers,
          tasks: spec.commands.map((command) => ({
            name: command.displayName,
            primaryInputs: command.args.filter((field) => field.section === "primary").map((field) => field.displayLabel),
            advancedInputs: command.args.filter((field) => field.section === "advanced").length,
          })),
        };
        results.push(result);
        process.stdout.write(`${result.primaryLanguage}; ${result.tasks.length} task(s); ${issues.length ? issues.join("; ") : "ready"}.\n`);
      } catch (error) {
        results.push({ domain, url, status: "error", error: error.message });
        process.stdout.write(`FAILED: ${error.message}\n`);
      }
    }
  }
  process.stdout.write(`\nIMAGE_DOMAIN_RESULTS=${JSON.stringify(results)}\n`);
  if (results.some((result) => result.status === "error")) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { domains, qualityIssues };
