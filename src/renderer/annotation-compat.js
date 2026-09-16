// Work around an inactive stylesheet in the desktop browser's annotation shadow
// root. Without it, the native popover becomes a small centered square and its
// invisible overlay intercepts the mouse. Keep this repair local to this preview.
(() => {
  const hostId = "codex-browser-sidebar-comments-root";
  let watchedRoot = null;
  let observer = null;
  let repairSheet = null;
  let appliedText = "";

  function repair() {
    if (!watchedRoot) return;
    const source = [...watchedRoot.querySelectorAll("style")].find(
      (style) => style.textContent.includes(".interaction-layer") &&
        style.textContent.includes(".annotation-selection-cursor"),
    );
    if (!source) return;
    const layer = watchedRoot.querySelector(".interaction-layer");
    if (!layer) return;
    // Healthy browser versions need no compatibility stylesheet.
    if (!repairSheet && getComputedStyle(layer).borderTopWidth === "0px") return;
    if (!repairSheet) {
      repairSheet = new CSSStyleSheet();
      watchedRoot.adoptedStyleSheets = [...watchedRoot.adoptedStyleSheets, repairSheet];
    }
    if (source.textContent !== appliedText) {
      repairSheet.replaceSync(source.textContent);
      appliedText = source.textContent;
    }
  }

  function discover() {
    const root = document.getElementById(hostId)?.shadowRoot;
    if (root === watchedRoot) return;
    observer?.disconnect();
    watchedRoot = root || null;
    repairSheet = null;
    appliedText = "";
    if (!watchedRoot) return;
    observer = new MutationObserver(repair);
    observer.observe(watchedRoot, { childList: true, subtree: true, characterData: true });
    repair();
  }

  // A shadow root can be attached after its host, without a light-DOM mutation.
  const timer = setInterval(discover, 500);
  discover();
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    observer?.disconnect();
  }, { once: true });
})();
