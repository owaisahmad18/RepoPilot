const test = require("node:test");
const assert = require("node:assert/strict");
const { clearSessionCredentials, connectProvider, connectionSummary, disconnectProvider, providerCredential, testProviderConnection } = require("../src/core/connections");

test("reports provider connection state without exposing secret values", () => {
  const providers = connectionSummary({
    OPENAI_API_KEY: "do-not-expose-openai",
    GEMINI_API_KEY: "do-not-expose-gemini",
  }, (command) => command === "claude", new Map(), () => false);

  assert.equal(providers.find((item) => item.id === "codex").status, "Connected");
  assert.equal(providers.find((item) => item.id === "claude").status, "Not connected");
  assert.equal(providers.find((item) => item.id === "gemini").connected, true);
  assert.equal(providers.find((item) => item.id === "github").status, "Optional");
  assert.doesNotMatch(JSON.stringify(providers), /do-not-expose/);
});

test("accepts alternate Gemini and GitHub environment variables", () => {
  const providers = connectionSummary({ GOOGLE_API_KEY: "google", GH_TOKEN: "github" }, () => false, new Map(), () => false);
  assert.equal(providers.find((item) => item.id === "gemini").connected, true);
  assert.equal(providers.find((item) => item.id === "github").connected, true);
});

test("provides separate official login and API-key routes", () => {
  const providers = connectionSummary({}, () => false, new Map(), () => false);
  for (const provider of providers) {
    assert.match(provider.loginUrl, /^https:\/\//);
    assert.match(provider.setupUrl, /^https:\/\//);
    assert.notEqual(provider.loginUrl, provider.setupUrl);
  }
});

test("validates and retains a pasted key only for the running session", async (context) => {
  clearSessionCredentials();
  context.after(clearSessionCredentials);
  const requests = [];
  const result = await connectProvider("codex", "temporary-secret", async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  });
  assert.equal(result.find((item) => item.id === "codex").source, "API key · this session");
  assert.equal(providerCredential("codex"), "temporary-secret");
  assert.equal(requests[0].url, "https://api.openai.com/v1/models");
  assert.equal(requests[0].options.headers.Authorization, "Bearer temporary-secret");
  assert.doesNotMatch(JSON.stringify(result), /temporary-secret/);
  disconnectProvider("codex");
  assert.equal(providerCredential("codex"), "");
});

test("does not retain a rejected key", async (context) => {
  clearSessionCredentials();
  context.after(clearSessionCredentials);
  await assert.rejects(
    connectProvider("gemini", "rejected-key", async () => ({ ok: false })),
    /rejected this key/,
  );
  assert.equal(providerCredential("gemini"), "");
});

test("checks a connected API credential without exposing it", async (context) => {
  clearSessionCredentials();
  context.after(clearSessionCredentials);
  await connectProvider("codex", "temporary-secret", async () => ({ ok: true }));
  const result = await testProviderConnection("codex", async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer temporary-secret");
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true, message: "API connection verified." });
  assert.doesNotMatch(JSON.stringify(result), /temporary-secret/);
});
