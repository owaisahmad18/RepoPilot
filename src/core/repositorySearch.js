const { providerCredential } = require("./connections");

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "app", "can", "code", "do", "find", "for", "from", "github", "i", "in", "is", "it",
  "looking", "me", "my", "of", "on", "please", "repository", "repo", "that", "the", "this", "to", "tool", "want", "with",
]);

const RUNNABLE_LANGUAGE_SCORES = new Map([
  ["python", 15], ["rust", 14], ["php", 12],
  ["javascript", 7], ["typescript", 7], ["go", 6], ["ruby", 6], ["java", 5], ["c#", 5], ["c++", 4], ["c", 4],
]);

const CANONICAL_WORDS = new Map([
  ["segment", "segmentation"], ["segmented", "segmentation"], ["segmenting", "segmentation"],
  ["cells", "cell"], ["cellular", "cell"],
  ["microscope", "microscopy"], ["microscopic", "microscopy"],
  ["images", "image"], ["imaging", "image"],
  ["stars", "star"], ["stellar", "star"],
  ["detecting", "detection"], ["detector", "detection"], ["detect", "detection"],
  ["grains", "grain"], ["materials", "material"],
]);

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function words(value) {
  return [...new Set(normalize(value).split(/\s+/).filter((word) => word.length > 1 && !SEARCH_STOP_WORDS.has(word))
    .map((word) => CANONICAL_WORDS.get(word) || word))];
}

function searchQuery(goal) {
  let keywords = words(goal);
  if (keywords.includes("cell")) keywords = keywords.filter((word) => !["biological", "image"].includes(word));
  if (keywords.includes("microscopy")) keywords = keywords.filter((word) => word !== "image");
  keywords = keywords.slice(0, 6);
  if (!keywords.length) throw new Error("Describe what you want the repository to do.");
  return `${keywords.join(" ")} in:name,description,topics fork:false archived:false`;
}

function ageInDays(date, now) {
  const timestamp = Date.parse(date || "");
  return Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / 86_400_000) : Infinity;
}

function maintenanceScore(pushedAt, now) {
  const age = ageInDays(pushedAt, now);
  if (age <= 90) return 15;
  if (age <= 365) return 12;
  if (age <= 730) return 8;
  if (age <= 1095) return 4;
  return 1;
}

function popularityScore(stars) {
  return Math.min(10, Math.round(Math.log10(Math.max(0, Number(stars)) + 1) * 2.5));
}

function rankRepository(item, goal, position, now = new Date()) {
  const goalWords = words(goal);
  const nameWords = new Set(words(item.name));
  const searchable = new Set(words(`${item.name} ${item.description || ""} ${(item.topics || []).join(" ")}`));
  const overlap = goalWords.filter((word) => searchable.has(word)).length;
  const nameOverlap = goalWords.filter((word) => nameWords.has(word)).length;
  const match = Math.min(55, Math.round(Math.max(3, 15 - position) + overlap * 9 + nameOverlap * 3));
  const language = String(item.language || "").toLowerCase();
  const compatibility = RUNNABLE_LANGUAGE_SCORES.get(language) || 2;
  const maintenance = maintenanceScore(item.pushed_at, now);
  const trust = popularityScore(item.stargazers_count);
  const license = item.license ? 5 : 0;
  const looksLikeCollection = /\b(awesome|guide|resources?|tutorial|course|papers?|list)\b/.test(normalize(`${item.name} ${item.description || ""}`));
  const collectionPenalty = looksLikeCollection ? 18 : 0;
  const score = Math.max(0, Math.min(100, match + compatibility + maintenance + trust + license - collectionPenalty));
  const reasons = [
    `${match}/55 goal match`,
    RUNNABLE_LANGUAGE_SCORES.has(language) ? `${compatibility}/15 likely GUI compatibility` : `${compatibility}/15 limited language support`,
    `${maintenance}/15 maintenance`,
  ];
  if (trust >= 7) reasons.push("widely used");
  if (license) reasons.push("license declared");
  if (collectionPenalty) reasons.push("reference collection penalty");
  return { score, reasons };
}

function retryMessage(response) {
  const reset = Number(response.headers?.get?.("x-ratelimit-reset"));
  if (!reset) return "GitHub search is temporarily limited. Wait a moment and try again.";
  const time = new Date(reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `GitHub search limit reached. Try again after ${time}.`;
}

async function searchRepositories(goal, fetchImpl = fetch, now = new Date(), githubToken = providerCredential("github")) {
  const query = searchQuery(goal);
  const params = new URLSearchParams({ q: query, per_page: "20" });
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repopilot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const response = await fetchImpl(`https://api.github.com/search/repositories?${params}`, {
    headers,
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) throw new Error(retryMessage(response));
    let body = {};
    try { body = await response.json(); } catch {}
    throw new Error(body.message || "GitHub search is unavailable right now.");
  }
  const body = await response.json();
  const ranked = (body.items || []).map((item, position) => ({
    name: item.name,
    fullName: item.full_name,
    url: item.html_url,
    description: item.description || "No description provided.",
    language: item.language || "Unknown",
    stars: item.stargazers_count || 0,
    updatedAt: item.pushed_at,
    license: item.license?.spdx_id || "Not declared",
    ...rankRepository(item, goal, position, now),
  })).sort((left, right) => right.score - left.score || right.stars - left.stars).slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return {
    goal: String(goal).trim(),
    rankingExplanation: "Ranked for this request by goal match, likely GUI compatibility, maintenance, adoption, and licensing.",
    results: ranked,
  };
}

module.exports = { rankRepository, searchQuery, searchRepositories };
