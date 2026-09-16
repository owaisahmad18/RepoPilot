const path = require("node:path");
const { cloneRepository } = require("../src/core/repository");
const { analyzeRepository } = require("../src/core/analyzer");

const repositories = [
  { domain: "Climate data", url: "https://github.com/ksgwxfan/climate-parser" },
  { domain: "Seismic signals", url: "https://github.com/liamtoney/sonify" },
  { domain: "Molecular interactions", url: "https://github.com/pharmai/plip" },
  { domain: "Genome sequencing QC", url: "https://github.com/wdecoster/NanoPlot" },
  { domain: "Microscopy and spectroscopy", url: "https://github.com/ziatdinovmax/SciLink" },
];

async function main() {
  const storageRoot = path.resolve(__dirname, "..", ".repo-gui");
  const results = [];
  for (const target of repositories) {
    process.stdout.write(`\nChecking ${target.domain}: ${target.url}\n`);
    try {
      const repository = await cloneRepository(target.url, storageRoot);
      const spec = await analyzeRepository(repository.path, repository);
      const result = {
        ...target,
        status: spec.commands.length ? "ok" : "error",
        primaryLanguage: spec.profile.primaryLanguage,
        filesInspected: spec.profile.fileCount,
        tasks: spec.commands.map((command) => ({
          name: command.displayName,
          primaryInputs: command.args.filter((field) => field.section === "primary").map((field) => field.displayLabel),
          advancedInputs: command.args.filter((field) => field.section === "advanced").length,
        })),
      };
      results.push(result);
      if (!spec.commands.length) result.error = "No usable task was generated.";
      process.stdout.write(`${result.primaryLanguage}; ${result.tasks.length} task(s) found.${result.error ? ` ${result.error}` : ""}\n`);
    } catch (error) {
      results.push({ ...target, status: "error", error: error.message });
      process.stdout.write(`FAILED: ${error.message}\n`);
    }
  }

  process.stdout.write(`\nSCIENCE_SMOKE_RESULTS=${JSON.stringify(results)}\n`);
  if (results.some((result) => result.status === "error")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
