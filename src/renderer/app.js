const repoUrl = document.querySelector("#repo-url");
const analyzeButton = document.querySelector("#analyze-button");
const status = document.querySelector("#status");
const repoProfile = document.querySelector("#repo-profile");
const workspace = document.querySelector("#workspace");
const commandList = document.querySelector("#command-list");
const emptyCommand = document.querySelector("#empty-command");
const emptyExplanation = document.querySelector("#empty-explanation");
const commandForm = document.querySelector("#command-form");
const commandTitle = document.querySelector("#command-title");
const commandEntry = document.querySelector("#command-entry");
const commandDescription = document.querySelector("#command-description");
const confidence = document.querySelector("#confidence");
const compatibility = document.querySelector("#compatibility");
const fields = document.querySelector("#fields");
const output = document.querySelector("#output");
const outputArtifacts = document.querySelector("#output-artifacts");
const runButton = document.querySelector("#run-button");
const executionConsent = document.querySelector("#execution-consent");
const clearOutput = document.querySelector("#clear-output");
const searchForm = document.querySelector("#search-form");
const searchGoal = document.querySelector("#search-goal");
const searchButton = document.querySelector("#search-button");
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const agentPanel = document.querySelector("#agent-panel");
const agentConversation = document.querySelector("#agent-conversation");
const agentForm = document.querySelector("#agent-form");
const agentInput = document.querySelector("#agent-input");
const agentSend = document.querySelector("#agent-send");
const agentFiles = document.querySelector("#agent-files");
const agentAttachmentStatus = document.querySelector("#agent-attachment-status");
const viewSwitch = document.querySelector("#view-switch");
const assistantViewButton = document.querySelector("#assistant-view-button");
const manualViewButton = document.querySelector("#manual-view-button");
const connectionsList = document.querySelector("#connections-list");
const repoPage = document.querySelector("#repo-page");
const interfacePage = document.querySelector("#interface-page");
const navBack = document.querySelector("#nav-back");
const navForward = document.querySelector("#nav-forward");
const stepIndicator = document.querySelector("#step-indicator");
const activeRepoName = document.querySelector("#active-repo-name");
const workspaceSidebar = document.querySelector("#workspace-sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarClose = document.querySelector("#sidebar-close");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const appletList = document.querySelector("#applet-list");
const appletSaveForm = document.querySelector("#applet-save-form");
const appletName = document.querySelector("#applet-name");
const sidebarTabApplets = document.querySelector("#sidebar-tab-applets");
const sidebarTabAccounts = document.querySelector("#sidebar-tab-accounts");
const sidebarPanelApplets = document.querySelector("#sidebar-panel-applets");
const sidebarPanelAccounts = document.querySelector("#sidebar-panel-accounts");
const appletContextMenu = document.querySelector("#applet-context-menu");
const deleteAppletMenu = document.querySelector("#delete-applet-menu");
const deleteAppletDialog = document.querySelector("#delete-applet-dialog");
const deleteAppletName = document.querySelector("#delete-applet-name");
const deleteAppletNo = document.querySelector("#delete-applet-no");
const deleteAppletYes = document.querySelector("#delete-applet-yes");
const workspaceName = document.querySelector("#workspace-name");
const workspaceStatus = document.querySelector("#workspace-status");
const chooseWorkspace = document.querySelector("#choose-workspace");
const sidebarMedia = window.matchMedia("(max-width: 960px)");

let spec = null;
let selectedCommand = null;
let progressText = "";
let viewMode = "assistant";
let preparedCommandId = null;
let preparedValues = {};
let searchResultSet = null;
let searchPage = 0;
let currentPage = 1;
let appletPendingDeletion = null;
const searchPageSize = 5;
const browserOutputListeners = [];

const desktopBridgeMissing = window.location.protocol === "file:" && !window.repoGui;
const desktopBridgeError = () => Promise.reject(new Error(
  "RepoPilot desktop services did not start. Restart the app or install the latest release.",
));
const unavailableDesktopBridge = new Proxy({
  onProgress: () => {},
  onOutput: () => {},
}, {
  get(target, property) {
    return target[property] || desktopBridgeError;
  },
});

const bridge = window.repoGui ? {
  initialInterface: window.repoGui.initialInterface,
  workspace: window.repoGui.workspace,
  chooseWorkspace: window.repoGui.chooseWorkspace,
  connections: window.repoGui.connections,
  connect: window.repoGui.connect,
  disconnect: window.repoGui.disconnect,
  testConnection: window.repoGui.testConnection,
  listApplets: window.repoGui.listApplets,
  loadApplet: window.repoGui.loadApplet,
  saveApplet: window.repoGui.saveApplet,
  deleteApplet: window.repoGui.deleteApplet,
  openArtifact: window.repoGui.openArtifact,
  search: window.repoGui.search,
  analyze: window.repoGui.analyze,
  run: window.repoGui.run,
  setup: window.repoGui.setup,
  plan: window.repoGui.plan,
  onProgress: window.repoGui.onProgress,
  onOutput: window.repoGui.onOutput,
  upload: async (file) => window.repoGui.filePath(file),
  uploadDirectory: async (files) => window.repoGui.directoryPath(files),
} : desktopBridgeMissing ? unavailableDesktopBridge : {
  initialInterface: async () => ({ spec: null }),
  workspace: async () => getJson("/api/workspace"),
  chooseWorkspace: async () => postJson("/api/workspace/choose", {}),
  connections: async () => getJson("/api/connections"),
  connect: async (provider, key) => postJson("/api/connections/connect", { provider, key }),
  disconnect: async (provider) => postJson("/api/connections/disconnect", { provider }),
  testConnection: async (provider) => postJson("/api/connections/test", { provider }),
  listApplets: async () => getJson("/api/applets"),
  loadApplet: async (id) => postJson("/api/applets/load", { id }),
  saveApplet: async (name) => postJson("/api/applets/save", { name }),
  deleteApplet: async (id) => postJson("/api/applets/delete", { id }),
  openArtifact: async () => {},
  search: async (goal) => postJson("/api/search", { goal }),
  analyze: async (url) => postJson("/api/analyze", { url }),
  plan: async (message, attachments) => postJson("/api/plan", { message, attachments }),
  run: async (commandId, values) => {
    const result = await postJson("/api/run", { commandId, values });
    browserOutputListeners.forEach((callback) => callback(result.output));
    return result;
  },
  setup: async (commandId) => postJson("/api/setup", { commandId }),
  upload: async (file) => {
    const data = await fileAsDataUrl(file);
    const result = await postJson("/api/upload", { name: file.name, type: file.type, data });
    return result.path;
  },
  uploadDirectory: async (files) => {
    const payload = await Promise.all(files.map(async (file) => ({
      name: file.name,
      path: file.webkitRelativePath || file.name,
      type: file.type,
      data: await fileAsDataUrl(file),
    })));
    const result = await postJson("/api/upload-directory", { files: payload });
    return result.path;
  },
  onProgress: () => {},
  onOutput: (callback) => browserOutputListeners.push(callback),
};

async function getJson(url) {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

function renderConnections(providers) {
  connectionsList.replaceChildren();
  for (const provider of providers) {
    const card = document.createElement("article");
    card.className = "connection-card";
    card.dataset.providerId = provider.id;
    const heading = document.createElement("div");
    heading.className = "connection-card-heading";
    const name = document.createElement("strong");
    name.textContent = provider.name;
    const state = document.createElement("span");
    state.className = `connection-state ${provider.connected ? "connected" : provider.optional ? "optional" : ""}`;
    state.textContent = provider.status;
    heading.append(name, state);
    card.append(heading);
    const feedback = document.createElement("p");
    feedback.className = "connection-feedback";
    const check = document.createElement("button");
    check.type = "button";
    check.className = "connection-secondary";
    check.textContent = "Check";
    check.addEventListener("click", async () => {
      check.disabled = true;
      check.textContent = "Checking…";
      feedback.textContent = "";
      feedback.classList.remove("error");
      try {
        const result = await bridge.testConnection(provider.id);
        const refreshed = await bridge.connections();
        renderConnections(refreshed.providers || []);
        const refreshedFeedback = connectionsList.querySelector(`[data-provider-id="${CSS.escape(provider.id)}"] .connection-feedback`);
        if (refreshedFeedback) refreshedFeedback.textContent = result.message;
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add("error");
      } finally {
        check.disabled = false;
        check.textContent = "Check";
      }
    });
    if (provider.connected) {
      const connectedRow = document.createElement("div");
      connectedRow.className = "connection-connected-row";
      const source = document.createElement("span");
      source.textContent = `${provider.source} credential ready`;
      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.className = "connection-secondary";
      disconnect.textContent = "Disconnect";
      disconnect.addEventListener("click", async () => {
        disconnect.disabled = true;
        try { renderConnections((await bridge.disconnect(provider.id)).providers || []); }
        catch (error) { source.textContent = error.message; disconnect.disabled = false; }
      });
      const actions = document.createElement("div");
      actions.className = "connection-row-actions";
      actions.append(check);
      connectedRow.append(source, actions);
      if (provider.removable) actions.append(disconnect);
      card.append(connectedRow, feedback);
    } else {
      const form = document.createElement("form");
      form.className = "connection-form";
      const input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "new-password";
      input.spellcheck = false;
      input.placeholder = provider.placeholder;
      input.setAttribute("aria-label", provider.placeholder);
      const save = document.createElement("button");
      save.type = "submit";
      save.textContent = "Save key";
      const error = document.createElement("p");
      error.className = "connection-error";
      const login = document.createElement("a");
      login.className = "connection-login";
      login.href = provider.loginUrl;
      login.target = "_blank";
      login.rel = "noopener noreferrer";
      login.textContent = "Login";
      login.title = `Open ${provider.name} account login`;
      const options = document.createElement("div");
      options.className = "connection-options";
      options.append(login, check);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        save.disabled = true;
        save.textContent = "Checking…";
        try { renderConnections((await bridge.connect(provider.id, input.value)).providers || []); }
        catch (failure) { error.textContent = failure.message; save.disabled = false; save.textContent = "Save key"; }
      });
      form.append(input, save, options, error);
      card.append(form, feedback);
    }
    connectionsList.append(card);
  }
}

function setSidebarOpen(open) {
  workspaceSidebar.classList.toggle("open", open);
  sidebarBackdrop.classList.toggle("open", open);
  sidebarToggle.setAttribute("aria-expanded", String(open));
  const hidden = sidebarMedia.matches && !open;
  workspaceSidebar.inert = hidden;
  workspaceSidebar.setAttribute("aria-hidden", String(hidden));
}

function setSidebarSection(section) {
  const accounts = section === "accounts";
  sidebarPanelApplets.classList.toggle("hidden", accounts);
  sidebarPanelAccounts.classList.toggle("hidden", !accounts);
  sidebarTabApplets.classList.toggle("active", !accounts);
  sidebarTabAccounts.classList.toggle("active", accounts);
  sidebarTabApplets.setAttribute("aria-pressed", String(!accounts));
  sidebarTabAccounts.setAttribute("aria-pressed", String(accounts));
}

async function refreshConnections() {
  try {
    const result = await bridge.connections();
    renderConnections(result.providers || []);
  } catch (error) {
    connectionsList.textContent = `Connections could not be checked: ${error.message}`;
  }
}

function renderApplets(applets) {
  appletList.replaceChildren();
  if (!applets.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "No saved applets yet.";
    appletList.append(empty);
    return;
  }
  for (const applet of applets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "applet-card";
    button.classList.toggle("active", applet.id === spec?.applet?.id);
    const name = document.createElement("strong");
    name.textContent = applet.name;
    const detail = document.createElement("span");
    detail.textContent = `${applet.repository || "Repository"} · ${applet.commandCount} task${applet.commandCount === 1 ? "" : "s"}`;
    button.append(name, detail);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await bridge.loadApplet(applet.id);
        repoUrl.value = result.spec.repository?.url || applet.repositoryUrl || "";
        showInterface(result.spec, true);
        setSidebarOpen(false);
      } catch (error) {
        detail.textContent = error.message;
        button.disabled = false;
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showAppletContextMenu(applet, event.clientX, event.clientY);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      showAppletContextMenu(applet, bounds.left + 18, bounds.top + 18);
    });
    appletList.append(button);
  }
}

function hideAppletContextMenu() {
  appletContextMenu.classList.add("hidden");
}

function clearActiveInterface() {
  spec = null;
  selectedCommand = null;
  appletSaveForm.classList.add("hidden");
  viewSwitch.classList.add("hidden");
  agentPanel.classList.add("hidden");
  workspace.classList.add("hidden");
  setPage(1);
}

function showAppletContextMenu(applet, x, y) {
  appletPendingDeletion = applet;
  appletContextMenu.classList.remove("hidden");
  appletContextMenu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - 150))}px`;
  appletContextMenu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - 48))}px`;
  deleteAppletMenu.focus();
}

deleteAppletMenu.addEventListener("click", () => {
  hideAppletContextMenu();
  if (!appletPendingDeletion) return;
  deleteAppletName.textContent = appletPendingDeletion.name;
  deleteAppletDialog.showModal();
  deleteAppletNo.focus();
});

deleteAppletNo.addEventListener("click", () => {
  deleteAppletDialog.close();
  appletPendingDeletion = null;
});

deleteAppletYes.addEventListener("click", async () => {
  if (!appletPendingDeletion) return;
  const applet = appletPendingDeletion;
  deleteAppletYes.disabled = true;
  deleteAppletYes.textContent = "Deleting…";
  try {
    await bridge.deleteApplet(applet.id);
    if (spec?.applet?.id === applet.id) clearActiveInterface();
    deleteAppletDialog.close();
    appletPendingDeletion = null;
    await refreshApplets();
  } catch (error) {
    deleteAppletName.textContent = error.message;
  } finally {
    deleteAppletYes.disabled = false;
    deleteAppletYes.textContent = "Yes, delete";
  }
});

deleteAppletDialog.addEventListener("cancel", () => { appletPendingDeletion = null; });
document.addEventListener("pointerdown", (event) => {
  if (!appletContextMenu.classList.contains("hidden") && !appletContextMenu.contains(event.target)) hideAppletContextMenu();
});
window.addEventListener("blur", hideAppletContextMenu);

async function refreshWorkspace() {
  try {
    const result = await bridge.workspace();
    workspaceName.textContent = result.label || "RepoPilot workspace";
    if (result.message) workspaceStatus.textContent = result.message;
  } catch (error) {
    workspaceName.textContent = "Workspace unavailable";
    workspaceStatus.textContent = error.message;
  }
}

chooseWorkspace.addEventListener("click", async () => {
  chooseWorkspace.disabled = true;
  chooseWorkspace.textContent = "Choosing…";
  try {
    const result = await bridge.chooseWorkspace();
    workspaceName.textContent = result.label || workspaceName.textContent;
    if (result.selected) {
      clearActiveInterface();
      workspaceStatus.textContent = "Ready. Each new repository will be stored in its own applet folder here.";
      await refreshApplets();
    } else if (result.message) workspaceStatus.textContent = result.message;
  } catch (error) {
    workspaceStatus.textContent = error.message;
  } finally {
    chooseWorkspace.disabled = false;
    chooseWorkspace.textContent = "Choose folder";
  }
});

async function refreshApplets() {
  try { renderApplets((await bridge.listApplets()).applets || []); }
  catch (error) { appletList.textContent = `Applets could not be loaded: ${error.message}`; }
}

async function refreshSidebar() {
  await Promise.all([refreshApplets(), refreshConnections()]);
}

sidebarToggle.addEventListener("click", () => {
  const open = !workspaceSidebar.classList.contains("open");
  setSidebarOpen(open);
  if (open) refreshSidebar();
});
sidebarClose.addEventListener("click", () => setSidebarOpen(false));
sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
sidebarTabApplets.addEventListener("click", () => setSidebarSection("applets"));
sidebarTabAccounts.addEventListener("click", () => setSidebarSection("accounts"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && workspaceSidebar.classList.contains("open")) setSidebarOpen(false);
});
sidebarMedia.addEventListener("change", () => setSidebarOpen(false));
setSidebarOpen(false);

function setPage(page) {
  currentPage = page === 2 && spec ? 2 : 1;
  repoPage.classList.toggle("hidden", currentPage !== 1);
  interfacePage.classList.toggle("hidden", currentPage !== 2);
  navBack.disabled = currentPage === 1;
  navForward.disabled = currentPage === 2 || !spec;
  stepIndicator.textContent = currentPage === 1 ? "1 / 2 · Repository" : "2 / 2 · Interface";
  window.scrollTo({ top: 0, behavior: "auto" });
}

navBack.addEventListener("click", () => setPage(1));
navForward.addEventListener("click", () => setPage(2));

appletSaveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!spec) return;
  const button = appletSaveForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const result = await bridge.saveApplet(appletName.value);
    spec = result.spec;
    appletName.value = result.applet.name;
    await refreshApplets();
  } catch (error) {
    appletName.setCustomValidity(error.message);
    appletName.reportValidity();
  } finally {
    appletName.setCustomValidity("");
    button.disabled = false;
    button.textContent = "Save";
  }
});

function compactNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function renderSearchResults(result, page = 0) {
  searchResultSet = result;
  const pageCount = Math.max(1, Math.ceil(result.results.length / searchPageSize));
  searchPage = Math.max(0, Math.min(page, pageCount - 1));
  const start = searchPage * searchPageSize;
  const visibleResults = result.results.slice(start, start + searchPageSize);
  searchResults.replaceChildren();
  const note = document.createElement("p");
  note.className = "search-ranking-note";
  note.textContent = result.rankingExplanation;
  searchResults.append(note);
  for (const repository of visibleResults) {
    const card = document.createElement("article");
    card.className = "search-result";
    const rank = document.createElement("span");
    rank.className = "search-rank";
    rank.textContent = repository.rank;
    const copy = document.createElement("div");
    copy.className = "search-result-copy";
    const title = document.createElement("div");
    title.className = "search-result-title";
    const name = document.createElement("strong");
    name.textContent = repository.fullName;
    const score = document.createElement("span");
    score.className = "search-score";
    score.textContent = `${repository.score}/100 fit`;
    const description = document.createElement("p");
    description.className = "search-result-description";
    description.textContent = repository.description;
    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    meta.textContent = `${repository.language} · ${compactNumber(repository.stars)} stars · ${repository.reasons.join(" · ")}`;
    const use = document.createElement("button");
    use.type = "button";
    use.className = "search-use";
    use.textContent = "Use repository";
    use.addEventListener("click", () => {
      repoUrl.value = repository.url;
      searchResults.classList.add("hidden");
      searchStatus.textContent = `Selected ${repository.fullName}. Preparing its interface…`;
      analyze();
    });
    title.append(name, score);
    copy.append(title, description, meta);
    card.append(rank, copy, use);
    searchResults.append(card);
  }
  if (result.results.length > searchPageSize) {
    const pagination = document.createElement("div");
    pagination.className = "search-pagination";
    const pageStatus = document.createElement("span");
    pageStatus.className = "search-page-status";
    pageStatus.textContent = `Showing ${start + 1}–${Math.min(start + searchPageSize, result.results.length)} of ${result.results.length} ranked results`;
    const actions = document.createElement("div");
    actions.className = "search-page-actions";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "search-page-button";
    previous.textContent = "Previous 5";
    previous.disabled = searchPage === 0;
    previous.addEventListener("click", () => renderSearchResults(searchResultSet, searchPage - 1));
    const next = document.createElement("button");
    next.type = "button";
    next.className = "search-page-button";
    next.textContent = "Next 5";
    next.disabled = start + searchPageSize >= result.results.length;
    next.addEventListener("click", () => renderSearchResults(searchResultSet, searchPage + 1));
    actions.append(previous, next);
    pagination.append(pageStatus, actions);
    searchResults.append(pagination);
  }
  searchResults.classList.remove("hidden");
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = searchGoal.value.trim();
  if (!goal) return;
  searchButton.disabled = true;
  searchButton.textContent = "Searching…";
  searchStatus.classList.remove("error");
  searchStatus.textContent = "Searching public GitHub repositories…";
  searchResults.classList.add("hidden");
  try {
    const result = await bridge.search(goal);
    searchStatus.textContent = result.results.length
      ? `Found ${result.results.length} ranked repositories for your request.`
      : "No suitable repositories found. Try describing the result with different words.";
    renderSearchResults(result, 0);
  } catch (error) {
    searchStatus.textContent = error.message;
    searchStatus.classList.add("error");
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = "Search GitHub";
  }
});

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected attachment."));
    reader.readAsDataURL(file);
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

bridge.onProgress((message) => {
  progressText += message;
  status.textContent = progressText.trim();
});

bridge.onOutput((message) => {
  if (output.textContent === "Results will appear here.") output.textContent = "";
  output.textContent += message;
  output.scrollTop = output.scrollHeight;
});

function renderArtifacts(artifacts = []) {
  outputArtifacts.replaceChildren();
  for (const artifact of artifacts) {
    const card = document.createElement("article");
    card.className = "artifact-card";
    const heading = document.createElement("div");
    heading.className = "artifact-heading";
    const name = document.createElement("strong");
    name.textContent = artifact.name;
    const size = document.createElement("span");
    size.textContent = artifact.size < 1_000_000 ? `${Math.max(1, Math.round(artifact.size / 1_000))} KB` : `${(artifact.size / 1_000_000).toFixed(1)} MB`;
    heading.append(name, size);
    card.append(heading);
    if (artifact.kind === "image") {
      const image = document.createElement("img");
      image.className = "artifact-image";
      image.src = artifact.dataUrl || artifact.url;
      image.alt = `Generated result: ${artifact.name}`;
      card.append(image);
    } else if (artifact.kind === "table" && artifact.table) {
      const frame = document.createElement("div");
      frame.className = "artifact-table-frame";
      const table = document.createElement("table");
      const header = document.createElement("tr");
      for (const value of artifact.table.headers || []) { const cell = document.createElement("th"); cell.textContent = value; header.append(cell); }
      table.append(header);
      for (const row of artifact.table.rows || []) {
        const line = document.createElement("tr");
        for (const value of row) { const cell = document.createElement("td"); cell.textContent = value; line.append(cell); }
        table.append(line);
      }
      frame.append(table);
      card.append(frame);
    } else if (artifact.kind === "text") {
      const preview = document.createElement("pre");
      preview.className = "artifact-text";
      preview.textContent = artifact.preview;
      card.append(preview);
    }
    if (artifact.url) {
      const download = document.createElement("a");
      download.className = "artifact-action";
      download.href = artifact.url;
      download.download = artifact.name;
      download.textContent = "Download result";
      card.append(download);
    } else if (artifact.path && bridge.openArtifact) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "artifact-action";
      open.textContent = "Open result";
      open.addEventListener("click", () => bridge.openArtifact(artifact.path));
      card.append(open);
    }
    outputArtifacts.append(card);
  }
}

analyzeButton.addEventListener("click", analyze);
repoUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") analyze();
});

async function analyze() {
  progressText = "";
  spec = null;
  navForward.disabled = true;
  selectedCommand = null;
  preparedCommandId = null;
  preparedValues = {};
  status.classList.remove("error");
  repoProfile.textContent = "";
  repoProfile.classList.add("hidden");
  commandList.replaceChildren();
  analyzeButton.disabled = true;
  try {
    status.textContent = "Cloning and inspecting repository…";
    showInterface(await bridge.analyze(repoUrl.value));
    await refreshApplets();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    analyzeButton.disabled = false;
  }
}

function showInterface(nextSpec, bundled = false) {
  spec = nextSpec;
  viewSwitch.classList.add("hidden");
  agentPanel.classList.add("hidden");
  workspace.classList.add("hidden");
  const count = spec.commands.length;
  const agentBuilt = spec.generation?.mode === "agent";
  status.textContent = bundled ? `Installed interface ready. Choose from ${count} task${count === 1 ? "" : "s"}.`
    : count ? `${agentBuilt ? "Agent-built and safety-checked" : "Ready"}. Choose from ${count} task${count === 1 ? "" : "s"} below.` : "Repository understood, but no ready-to-use task was found.";
  renderProfile();
  activeRepoName.textContent = spec.applet?.name || spec.repository?.name || spec.repository?.repo || "Repository interface";
  appletName.value = activeRepoName.textContent;
  appletSaveForm.classList.remove("hidden");
  renderCommandList();
  workspace.classList.remove("hidden");
  if (count) {
    resetAgentConversation();
    viewSwitch.classList.remove("hidden");
    setViewMode("assistant");
    selectCommand(spec.commands[0].id);
  } else {
    setViewMode("manual");
    viewSwitch.classList.add("hidden");
    commandForm.classList.add("hidden");
    emptyCommand.classList.remove("hidden");
    const language = spec.profile?.primaryLanguage || "unknown language";
    const kind = spec.profile?.kind || "unknown type";
    emptyExplanation.textContent = `Detected ${language} · ${kind}. Add an adapter for this capability to make it runnable.`;
  }
  setPage(2);
  refreshApplets();
}

function setViewMode(mode) {
  viewMode = mode === "manual" ? "manual" : "assistant";
  const assistantActive = viewMode === "assistant";
  agentPanel.classList.toggle("hidden", !assistantActive);
  workspace.classList.toggle("hidden", assistantActive);
  assistantViewButton.classList.toggle("active", assistantActive);
  manualViewButton.classList.toggle("active", !assistantActive);
  assistantViewButton.setAttribute("aria-pressed", String(assistantActive));
  manualViewButton.setAttribute("aria-pressed", String(!assistantActive));
}

assistantViewButton.addEventListener("click", () => setViewMode("assistant"));
manualViewButton.addEventListener("click", () => setViewMode("manual"));

function appendAgentMessage(text, role = "assistant") {
  const message = document.createElement("div");
  message.className = `agent-message ${role}`;
  message.textContent = text;
  agentConversation.append(message);
  agentConversation.scrollTop = agentConversation.scrollHeight;
  return message;
}

function resetAgentConversation() {
  agentConversation.replaceChildren();
  const examples = spec.commands.slice(0, 3).map((command) => command.displayName || command.name).join(", ");
  appendAgentMessage(`Tell me the result you want. I can prepare tasks such as ${examples}.`);
  agentPanel.classList.remove("hidden");
  agentFiles.value = "";
  refreshAgentAttachmentStatus();
}

function refreshAgentAttachmentStatus() {
  const selected = [...agentFiles.files];
  agentAttachmentStatus.textContent = selected.length
    ? `${selected.length} attached: ${selected.map((file) => file.name).join(", ")}`
    : "No files attached";
  agentAttachmentStatus.classList.toggle("ready", selected.length > 0);
}

agentFiles.addEventListener("change", refreshAgentAttachmentStatus);

function applyPlanValues(command, values) {
  for (const [fieldId, value] of Object.entries(values || {})) {
    const field = command.args.find((item) => item.id === fieldId);
    const input = document.getElementById(fieldId);
    if (!field || !input || ["file", "directory", "choice-group"].includes(field.control)) continue;
    if (field.control === "boolean") input.checked = Boolean(value);
    else input.value = String(value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function applyPlanAttachments(command, plan, attachments) {
  for (const assignment of plan.attachmentAssignments || []) {
    const field = command.args.find((item) => item.id === assignment.fieldId);
    const selected = assignment.attachmentIndexes.map((index) => attachments[index]).filter(Boolean);
    if (!field || !selected.length) continue;
    const variant = field.control === "choice-group"
      ? field.variants.find((item) => item.id === assignment.variantId) : null;
    const multiple = field.multiple || variant?.multiple;
    const uploaded = multiple ? await Promise.all(selected.map(bridge.upload)) : await bridge.upload(selected[0]);
    preparedValues[field.id] = variant ? { option: variant.option, value: uploaded } : uploaded;
    if (variant) {
      const selector = document.getElementById(field.id);
      selector.value = variant.id;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const wrapper = fields.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
    const selection = wrapper?.querySelector(".attachment-selection");
    if (selection) selection.textContent = `Attached through assistant: ${selected.map((file) => file.name).join(", ")}`;
  }
}

async function appendPlan(plan, attachments) {
  const command = spec.commands.find((item) => item.id === plan.commandId);
  if (!command) return;
  preparedCommandId = command.id;
  preparedValues = {};
  selectCommand(command.id);
  applyPlanValues(command, plan.values);
  Object.assign(preparedValues, plan.values || {});
  await applyPlanAttachments(command, plan, attachments);
  appendAgentMessage(plan.message);

  const card = document.createElement("div");
  card.className = "agent-message assistant agent-plan";
  const copy = document.createElement("div");
  copy.className = "agent-plan-copy";
  const title = document.createElement("strong");
  title.textContent = `Tool: ${plan.commandName}`;
  const detail = document.createElement("span");
  detail.textContent = plan.missing.length
    ? `Still needed: ${plan.missing.map((field) => field.label).join(", ")}`
    : "Required inputs are ready. Final confirmation is still required.";
  const review = document.createElement("button");
  review.type = "button";
  review.className = "agent-review";
  review.textContent = "Review task";
  review.addEventListener("click", () => {
    if (selectedCommand?.id !== command.id) selectCommand(command.id);
    setViewMode("manual");
    commandForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  copy.append(title, detail);
  card.append(copy, review);
  agentConversation.append(card);
  agentConversation.scrollTop = agentConversation.scrollHeight;
}

agentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = agentInput.value.trim();
  if (!message || !spec) return;
  appendAgentMessage(message, "user");
  const attachments = [...agentFiles.files];
  const attachmentMetadata = attachments.map((file) => ({ name: file.name, type: file.type, size: file.size }));
  agentInput.value = "";
  agentSend.disabled = true;
  agentSend.textContent = "Planning…";
  try {
    const plan = await bridge.plan(message, attachmentMetadata);
    if (plan.status === "planned") {
      await appendPlan(plan, attachments);
      agentFiles.value = "";
      refreshAgentAttachmentStatus();
    }
    else appendAgentMessage(`${plan.message} Available tasks: ${plan.alternatives.map((item) => item.name).join(", ")}.`);
  } catch (error) {
    appendAgentMessage(error.message);
  } finally {
    agentSend.disabled = false;
    agentSend.textContent = "Plan task";
  }
});

function renderProfile() {
  const profile = spec.profile;
  if (!profile) {
    repoProfile.classList.add("hidden");
    return;
  }
  const generation = spec.generation;
  repoProfile.textContent = generation?.mode === "agent"
    ? `Agent-built with ${generation.provider} · Validated in ${generation.attempts} pass${generation.attempts === 1 ? "" : "es"} · Safe execution rules applied`
    : "Repository understood · Deterministic safety fallback used";
  repoProfile.classList.remove("hidden");
}

function renderCommandList() {
  commandList.replaceChildren();
  for (const command of spec.commands) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-item";
    button.dataset.commandId = command.id;
    const name = document.createElement("strong");
    name.textContent = command.displayName || command.name;
    const entry = document.createElement("span");
    entry.textContent = command.displayDescription || command.description || "Ready to use";
    button.append(name, entry);
    button.addEventListener("click", () => selectCommand(command.id));
    commandList.append(button);
  }
}

function selectCommand(commandId) {
  const previousCommandId = selectedCommand?.id;
  if (preparedCommandId && preparedCommandId !== commandId) {
    preparedCommandId = null;
    preparedValues = {};
  }
  selectedCommand = spec.commands.find((command) => command.id === commandId);
  if (!selectedCommand) return;
  for (const item of commandList.querySelectorAll(".command-item")) {
    item.classList.toggle("active", item.dataset.commandId === commandId);
  }
  emptyCommand.classList.add("hidden");
  commandForm.classList.remove("hidden");
  commandTitle.textContent = selectedCommand.displayName || selectedCommand.name;
  commandEntry.textContent = "Task";
  commandDescription.textContent = selectedCommand.displayDescription || selectedCommand.description || "Ready to use.";
  confidence.textContent = selectedCommand.confidence === "high" ? "Ready" : "Review";
  confidence.className = `badge ${selectedCommand.confidence}`;
  renderCompatibility();
  executionConsent.checked = false;
  runButton.textContent = "Confirm and run task";
  if (previousCommandId !== commandId || !fields.children.length) renderFields();
}

function renderCompatibility() {
  compatibility.replaceChildren();
  const report = selectedCommand?.compatibility;
  if (!report?.checks?.length) {
    compatibility.classList.add("hidden");
    return;
  }
  compatibility.classList.remove("hidden");
  const heading = document.createElement("div");
  heading.className = "compatibility-heading";
  const title = document.createElement("strong");
  title.textContent = "Run readiness";
  const status = document.createElement("span");
  status.className = `compatibility-status ${report.status}`;
  status.textContent = report.status === "blocked" ? "Setup needed" : "Review";
  const actions = document.createElement("div");
  actions.className = "compatibility-actions";
  actions.append(status);
  heading.append(title, actions);
  const summary = document.createElement("p");
  summary.textContent = report.summary;
  if (report.canCreateEnvironment) {
    const setup = document.createElement("button");
    setup.type = "button";
    setup.className = "setup-button";
    setup.textContent = "Create setup";
    setup.addEventListener("click", async () => {
      setup.disabled = true;
      setup.textContent = "Creating setup…";
      output.textContent = "";
      try {
        const result = await bridge.setup(selectedCommand.id);
        output.textContent = result.output;
        selectedCommand.environmentPath = result.environmentPath;
        selectedCommand.compatibility = result.compatibility;
        renderCompatibility();
      } catch (error) {
        output.textContent = `Setup agent stopped: ${error.message}\n`;
        setup.disabled = false;
        setup.textContent = "Create setup";
      }
    });
    actions.append(setup);
  }
  compatibility.append(heading, summary);
  const list = document.createElement("ul");
  for (const check of report.checks) {
    const item = document.createElement("li");
    item.className = check.state;
    const label = document.createElement("strong");
    label.textContent = check.label;
    const detail = document.createElement("span");
    detail.textContent = check.detail;
    item.append(label, detail);
    list.append(item);
  }
  compatibility.append(list);
}

function renderFields() {
  fields.replaceChildren();
  const primaryFields = document.createElement("div");
  primaryFields.className = "field-group";
  const advancedFields = document.createElement("div");
  advancedFields.className = "field-group advanced-field-group";
  let advancedCount = 0;
  for (const field of selectedCommand.args) {
    if (field.section === "hidden") continue;
    const wrapper = document.createElement("div");
    wrapper.className = field.control === "boolean" ? "field checkbox-field" : "field";
    const input = createInput(field);
    input.id = field.id;
    input.name = field.id;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    wrapper.dataset.fieldId = field.id;

    const label = document.createElement("label");
    label.htmlFor = field.id;
    label.textContent = field.displayLabel || field.label;
    if (field.required && field.control !== "boolean") {
      const required = document.createElement("span");
      required.className = "required";
      required.textContent = "*";
      label.append(required);
    }

    if (field.control === "boolean") wrapper.append(input, label);
    else if (field.control === "choice-group") {
      const choiceValue = document.createElement("div");
      choiceValue.className = "choice-value";
      wrapper.append(label, input, choiceValue);
      renderChoiceValue(input, field, choiceValue);
      input.addEventListener("change", () => renderChoiceValue(input, field, choiceValue));
    }
    else if (["file", "directory"].includes(field.control)) wrapper.append(label, createPicker(input, field));
    else wrapper.append(label, input);

    const helpText = field.displayHelp || field.help;
    if (helpText) {
      const help = document.createElement("p");
      help.className = "field-help";
      help.textContent = helpText;
      wrapper.append(help);
    }
    if (field.section === "advanced") {
      advancedFields.append(wrapper);
      advancedCount += 1;
    } else {
      primaryFields.append(wrapper);
    }
    if (field.showWhen) input.closest(".field").dataset.conditional = "true";
  }
  fields.append(primaryFields);
  if (advancedCount) {
    const details = document.createElement("details");
    details.className = "advanced-settings";
    const summary = document.createElement("summary");
    summary.textContent = `Advanced settings (${advancedCount})`;
    const note = document.createElement("p");
    note.className = "advanced-note";
    note.textContent = "Optional settings. The repository's defaults are used automatically.";
    details.append(summary, note, advancedFields);
    fields.append(details);
  }
  for (const input of fields.querySelectorAll("input, select")) input.addEventListener("change", refreshConditionalFields);
  refreshConditionalFields();
}

function createPicker(input, field) {
  const picker = document.createElement("div");
  picker.className = "attachment-picker";
  const action = document.createElement("span");
  action.className = "attachment-action";
  action.textContent = field.control === "directory" ? "Choose folder" : field.multiple ? "Choose files" : "Choose file";
  const selection = document.createElement("span");
  selection.className = "attachment-selection";
  selection.textContent = field.control === "directory" ? "No folder selected" : "No file selected";
  const preview = document.createElement("img");
  preview.className = "attachment-preview hidden";
  preview.alt = "Selected image preview";
  let previewUrl = "";
  input.addEventListener("change", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    preview.classList.add("hidden");
    if (!input.files.length) {
      selection.textContent = field.control === "directory" ? "No folder selected" : "No file selected";
      return;
    }
    if (field.control === "directory") {
      const root = (input.files[0].webkitRelativePath || "Selected folder").split(/[\\/]/)[0];
      selection.textContent = `${root} · ${input.files.length} file${input.files.length === 1 ? "" : "s"}`;
    } else {
      selection.textContent = input.files[0].name;
      if (field.preview && (input.files[0].type.startsWith("image/") || /\.(?:png|jpe?g|gif|bmp|tiff?|webp)$/i.test(input.files[0].name))) {
        previewUrl = URL.createObjectURL(input.files[0]);
        preview.src = previewUrl;
        preview.classList.remove("hidden");
      }
    }
  });
  picker.append(input, action, selection, preview);
  return picker;
}

function renderChoiceValue(selector, field, host) {
  host.replaceChildren();
  const variant = field.variants.find((item) => item.id === selector.value) || field.variants[0];
  if (!variant) return;
  const input = createInput(variant);
  input.id = `${field.id}--value`;
  input.required = true;
  if (["file", "directory"].includes(variant.control)) host.append(createPicker(input, variant));
  else host.append(input);
  if (variant.displayHelp || variant.help) {
    const help = document.createElement("p");
    help.className = "field-help";
    help.textContent = variant.displayHelp || variant.help;
    host.append(help);
  }
}

function refreshConditionalFields() {
  for (const field of selectedCommand.args) {
    const wrapper = fields.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
    if (!wrapper || !field.showWhen) continue;
    const controller = document.getElementById(field.showWhen.field);
    const visible = field.showWhen.values.includes(controller?.value);
    wrapper.classList.toggle("hidden", !visible);
    const input = document.getElementById(field.id);
    input.disabled = !visible;
  }
}

function createInput(field) {
  if (field.control === "choice-group") {
    const select = document.createElement("select");
    for (const variant of field.variants) select.append(new Option(variant.displayLabel || variant.label, variant.id));
    select.value = field.default || field.variants[0]?.id || "";
    return select;
  }
  if (field.control === "select") {
    const select = document.createElement("select");
    select.multiple = Boolean(field.multiple);
    if (!field.required) select.append(new Option("Select…", ""));
    for (const choice of field.choices) select.append(new Option(choice, choice));
    select.value = field.default === undefined ? "" : String(field.default);
    return select;
  }

  const input = document.createElement("input");
  input.type = field.control === "boolean" ? "checkbox" : ["file", "directory"].includes(field.control) ? "file" : field.control;
  if (field.control === "file" && field.accept) input.accept = field.accept;
  if (field.control === "file" && field.multiple) input.multiple = true;
  if (field.control === "directory") {
    input.setAttribute("webkitdirectory", "");
    input.multiple = true;
    input.setAttribute("aria-label", `${field.label}: choose folder`);
  }
  if (field.control === "boolean") input.checked = Boolean(field.default);
  else if (!["file", "directory"].includes(field.control)) {
    input.value = field.default === undefined ? "" : String(field.default);
    input.placeholder = field.placeholder || "example-value";
  }
  input.required = field.required && field.control !== "boolean";
  return input;
}

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedCommand) return;
  if (!executionConsent.checked) {
    executionConsent.focus();
    return;
  }
  const values = {};
  for (const field of selectedCommand.args) {
    const input = document.getElementById(field.id);
    if (!input) {
      if (field.default !== undefined && field.default !== null && String(field.default).trim() !== "") values[field.id] = field.default;
      continue;
    }
    if (input.disabled) continue;
    if (field.control === "choice-group") {
      const variant = field.variants.find((item) => item.id === input.value) || field.variants[0];
      const valueInput = document.getElementById(`${field.id}--value`);
      if (["file", "directory"].includes(variant.control)) {
        const selectedFiles = [...valueInput.files];
        const selectedValue = variant.control === "directory"
          ? (selectedFiles.length ? await bridge.uploadDirectory(selectedFiles) : "")
          : (variant.multiple ? await Promise.all(selectedFiles.map(bridge.upload)) : (selectedFiles[0] ? await bridge.upload(selectedFiles[0]) : ""));
        values[field.id] = selectedValue ? { option: variant.option, value: selectedValue } : preparedValues[field.id] || { option: variant.option, value: "" };
      } else {
        const selectedValue = variant.control === "boolean" ? valueInput.checked
          : variant.control === "select" && variant.multiple ? [...valueInput.selectedOptions].map((option) => option.value)
            : valueInput.value;
        values[field.id] = { option: variant.option, value: selectedValue };
      }
    } else if (field.control === "directory") {
      values[field.id] = input.files.length ? await bridge.uploadDirectory([...input.files]) : preparedValues[field.id] || "";
    } else if (field.control === "file") {
      const selectedFiles = [...input.files];
      values[field.id] = selectedFiles.length
        ? (field.multiple ? await Promise.all(selectedFiles.map(bridge.upload)) : await bridge.upload(selectedFiles[0]))
        : preparedValues[field.id] || "";
    } else {
      values[field.id] = field.control === "boolean" ? input.checked
        : field.control === "select" && field.multiple ? [...input.selectedOptions].map((option) => option.value)
          : input.value;
    }
  }

  output.textContent = "";
  outputArtifacts.replaceChildren();
  runButton.disabled = true;
  runButton.textContent = "Running…";
  try {
    const result = await bridge.run(selectedCommand.id, values);
    renderArtifacts(result.artifacts || []);
  } catch (error) {
    output.textContent += `Error: ${error.message}\n`;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Confirm and run task";
  }
});

clearOutput.addEventListener("click", () => {
  output.textContent = "Results will appear here.";
  outputArtifacts.replaceChildren();
});

bridge.initialInterface().then((result) => {
  if (result?.spec) {
    repoUrl.value = result.spec.repository?.url || "";
    showInterface(result.spec, true);
  } else setPage(1);
}).catch(() => {});

refreshSidebar();
refreshWorkspace();
