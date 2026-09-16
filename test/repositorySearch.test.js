const test = require("node:test");
const assert = require("node:assert/strict");
const { rankRepository, searchQuery, searchRepositories } = require("../src/core/repositorySearch");

test("turns a user goal into a focused GitHub repository query", () => {
  assert.equal(searchQuery("I want to segment biological cells in microscope images"), "segmentation cell microscopy in:name,description,topics fork:false archived:false");
});

test("ranking changes with the user's goal", () => {
  const now = new Date("2026-09-15T00:00:00Z");
  const cellRepo = { name: "cell-segmenter", description: "Segment microscopy cells", topics: ["biology"], language: "Python", pushed_at: "2026-08-01", stargazers_count: 200, license: { spdx_id: "MIT" } };
  const starRepo = { ...cellRepo, name: "star-detector", description: "Detect stars in FITS astronomy images", topics: ["astronomy"] };
  assert.ok(rankRepository(cellRepo, "segment cells", 0, now).score > rankRepository(starRepo, "segment cells", 0, now).score);
  assert.ok(rankRepository(starRepo, "detect astronomy stars", 0, now).score > rankRepository(cellRepo, "detect astronomy stars", 0, now).score);
});

test("search returns at most twenty explainably ranked repositories", async () => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    name: `cell-tool-${index}`, full_name: `lab/cell-tool-${index}`, html_url: `https://github.com/lab/cell-tool-${index}`,
    description: "Segment cells in microscopy images", topics: ["cells"], language: index === 6 ? "Unknown" : "Python",
    pushed_at: "2026-08-01T00:00:00Z", stargazers_count: 100 - index, license: { spdx_id: "MIT" },
  }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ items }) });
  const result = await searchRepositories("segment microscopy cells", fetchImpl, new Date("2026-09-15T00:00:00Z"));
  assert.equal(result.results.length, 20);
  assert.equal(result.results[0].rank, 1);
  assert.match(result.results[0].reasons.join(" "), /goal match/);
  assert.equal(result.results.every((item, index) => !index || result.results[index - 1].score >= item.score), true);
});

test("uses a connected GitHub token without exposing it in the URL", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ items: [] }) };
  };
  await searchRepositories("microscopy", fetchImpl, new Date("2026-09-15T00:00:00Z"), "private-token");
  assert.equal(request.options.headers.Authorization, "Bearer private-token");
  assert.doesNotMatch(request.url, /private-token/);
});
