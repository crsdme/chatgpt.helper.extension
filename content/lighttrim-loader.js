(() => {
  if (window.__CGH_LIGHTTRIM_LOADER__) return;
  window.__CGH_LIGHTTRIM_LOADER__ = true;

  function injectPageScript() {
    try {
      if (document.documentElement?.dataset?.cghLighttrim === "1") return;
      const url = chrome.runtime.getURL("inject/lighttrim.js");
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.onload = () => script.remove();
      (document.documentElement || document.head || document).appendChild(script);
      if (document.documentElement) document.documentElement.dataset.cghLighttrim = "1";
    } catch (err) {
      console.warn("CGH lighttrim inject failed", err);
    }
  }

  function detailFromSettings(settings) {
    return {
      enabled: !!settings?.lightTrimEnabled,
      limit: Math.max(1, Number(settings?.lightTrimLimit) || 10),
      keepSpecialRoles: settings?.lightTrimKeepSpecial !== false,
    };
  }

  function pushConfig(detail) {
    try {
      document.documentElement?.setAttribute("data-cgh-lighttrim-cfg", JSON.stringify(detail));
    } catch {
      /* ignore */
    }
    // Isolated ↔ page bridge (CustomEvent does not cross worlds).
    try {
      window.postMessage({ source: "cgh-helper", type: "CGH_LIGHTTRIM_CONFIG", detail }, "*");
    } catch {
      /* ignore */
    }
  }

  async function syncFromStorage() {
    try {
      const data = await chrome.storage.local.get("settings");
      pushConfig(detailFromSettings(data.settings || {}));
    } catch (err) {
      console.warn("CGH lighttrim config sync failed", err);
    }
  }

  injectPageScript();
  syncFromStorage();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.settings) return;
      syncFromStorage();
    });
  } catch {
    /* ignore */
  }

  window.CGH = window.CGH || {};
  window.CGH.lightTrim = {
    inject: injectPageScript,
    sync: syncFromStorage,
    pushConfig,
  };
})();
