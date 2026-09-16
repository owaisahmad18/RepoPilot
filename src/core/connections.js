const { spawnSync } = require("node:child_process");

const sessionCredentials = new Map();
const verifiedCliSessions = new Set();
const availabilityCache = new Map();

const providers = [
  {
    id: "codex",
    name: "Codex / OpenAI",
    secretNames: ["OPENAI_API_KEY"],
    cli: "codex",
    authStatusArgs: ["login", "status"],
    loginUrl: "https://chatgpt.com/auth/login",
    setupUrl: "https://platform.openai.com/api-keys",
    validationUrl: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    placeholder: "Paste OpenAI API key",
  },
  {
    id: "claude",
    name: "Claude",
    secretNames: ["ANTHROPIC_API_KEY"],
    cli: "claude",
    authStatusArgs: ["auth", "status"],
    loginUrl: "https://claude.ai/login",
    setupUrl: "https://console.anthropic.com/settings/keys",
    validationUrl: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    placeholder: "Paste Anthropic API key",
  },
  {
    id: "gemini",
    name: "Gemini",
    secretNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    cli: "gemini",
    loginUrl: "https://gemini.google.com/",
    setupUrl: "https://aistudio.google.com/app/apikey",
    validationUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }),
    placeholder: "Paste Gemini API key",
  },
  {
    id: "github",
    name: "GitHub",
    secretNames: ["GITHUB_TOKEN", "GH_TOKEN"],
    cli: "gh",
    authStatusArgs: ["auth", "status", "--active", "--hostname", "github.com"],
    loginUrl: "https://github.com/login",
    setupUrl: "https://github.com/settings/tokens?type=beta",
    validationUrl: "https://api.github.com/user",
    headers: (key) => ({ Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json", "User-Agent": "Repo-GUI" }),
    placeholder: "Paste GitHub access token",
    optional: true,
  },
];

function cliEnvironment(environment = process.env) {
  return { ...environment, HOME: environment.HOME || environment.USERPROFILE };
}

function commandAvailable(command, runner = spawnSync, environment = process.env) {
  if (runner === spawnSync && availabilityCache.has(command)) return availabilityCache.get(command);
  const result = runner(command, ["--version"], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 4_000,
    env: cliEnvironment(environment),
  });
  const available = !result.error && result.status === 0;
  if (runner === spawnSync) availabilityCache.set(command, available);
  return available;
}

function detectCliSession(provider, runner = spawnSync, environment = process.env) {
  if (!provider?.authStatusArgs) return false;
  const result = runner(provider.cli, provider.authStatusArgs, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 6_000,
    env: cliEnvironment(environment),
  });
  return !result.error && result.status === 0;
}

function connectionSummary(environment = process.env, available = commandAvailable, credentials = sessionCredentials, sessionDetector = (provider) => verifiedCliSessions.has(provider.id)) {
  return providers.map((provider) => {
    const fromSession = credentials.has(provider.id);
    const fromEnvironment = provider.secretNames.some((name) => Boolean(environment[name]));
    const cliInstalled = available === commandAvailable ? Boolean(availabilityCache.get(provider.cli)) : available(provider.cli);
    const fromCli = !fromSession && !fromEnvironment && cliInstalled && sessionDetector(provider);
    const connected = fromSession || fromEnvironment || fromCli;
    return {
      id: provider.id,
      name: provider.name,
      connected,
      cliInstalled,
      cliCheckSupported: Boolean(provider.authStatusArgs),
      optional: Boolean(provider.optional),
      status: connected ? "Connected" : provider.optional ? "Optional" : "Not connected",
      loginUrl: provider.loginUrl,
      setupUrl: provider.setupUrl,
      placeholder: provider.placeholder,
      source: fromSession ? "API key · this session" : fromEnvironment ? "API key · environment" : fromCli ? "CLI account" : "",
      removable: fromSession,
    };
  });
}

async function connectProvider(id, rawKey, fetcher = fetch) {
  const provider = providers.find((item) => item.id === id);
  if (!provider) throw new Error("Unknown connection provider.");
  const key = String(rawKey || "").trim();
  if (key.length < 8 || key.length > 4096 || /[\r\n]/.test(key)) throw new Error("Paste a valid API key or access token.");
  let response;
  try {
    response = await fetcher(provider.validationUrl, {
      method: "GET",
      headers: provider.headers(key),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${provider.name} could not be reached. Check the internet connection and try again.`);
  }
  if (!response.ok) throw new Error(`${provider.name} rejected this key. Check it and try again.`);
  sessionCredentials.set(provider.id, key);
  return connectionSummary();
}

async function testProviderConnection(id, fetcher = fetch, runner = spawnSync, environment = process.env) {
  const provider = providers.find((item) => item.id === id);
  if (!provider) throw new Error("Unknown connection provider.");
  const key = providerCredential(id, environment);
  if (key) {
    let response;
    try {
      response = await fetcher(provider.validationUrl, {
        method: "GET",
        headers: provider.headers(key),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error(`${provider.name} could not be reached. Check the internet connection and try again.`);
    }
    if (!response.ok) throw new Error(`${provider.name} rejected the saved credential.`);
    return { ok: true, message: "API connection verified." };
  }
  if (!commandAvailable(provider.cli, runner, environment)) {
    throw new Error(`${provider.name} CLI is not installed and no API key is connected.`);
  }
  if (!provider.authStatusArgs) {
    throw new Error(`${provider.name} CLI is installed. Open it once to complete or verify Google sign-in.`);
  }
  if (!detectCliSession(provider, runner, environment)) throw new Error(`${provider.name} CLI is installed but not logged in.`);
  verifiedCliSessions.add(provider.id);
  return { ok: true, message: "CLI account verified." };
}

function disconnectProvider(id) {
  if (!providers.some((item) => item.id === id)) throw new Error("Unknown connection provider.");
  sessionCredentials.delete(id);
  return connectionSummary();
}

function providerCredential(id, environment = process.env) {
  if (sessionCredentials.has(id)) return sessionCredentials.get(id);
  const provider = providers.find((item) => item.id === id);
  return provider?.secretNames.map((name) => environment[name]).find(Boolean) || "";
}

function agentProviderConnections(environment = process.env) {
  return providers
    .filter((provider) => provider.id !== "github")
    .map((provider) => {
      const credential = providerCredential(provider.id, environment);
      const cliVerified = verifiedCliSessions.has(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        mode: credential ? "api" : cliVerified ? "cli" : "",
        credential,
        cli: provider.cli,
      };
    })
    .filter((provider) => provider.mode);
}

function clearSessionCredentials() {
  sessionCredentials.clear();
  verifiedCliSessions.clear();
}

module.exports = {
  clearSessionCredentials,
  commandAvailable,
  connectProvider,
  connectionSummary,
  detectCliSession,
  disconnectProvider,
  agentProviderConnections,
  providerCredential,
  testProviderConnection,
};
