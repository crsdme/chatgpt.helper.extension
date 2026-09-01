(() => {
  const CGH = (window.CGH = window.CGH || {});
  let host;
  let fab;
  let shadow;
  let currentTab = "queue";
  let cssLoaded = false;
  let toastTimer;

  const TABS = [
    { id: "queue", label: () => CGH.t.queue, icon: "queue" },
    { id: "favorites", label: () => CGH.t.favorites, icon: "star" },
    { id: "gallery", label: () => CGH.t.gallery, icon: "image" },
    { id: "pins", label: () => CGH.t.pins, icon: "pin" },
    { id: "conversations", label: () => CGH.t.conversations, icon: "chat" },
    { id: "settings", label: () => CGH.t.settings, icon: "gear" },
  ];

  function fabBadge() {
    const n = (CGH.queue?.pendingCount?.() || 0) + (CGH.pins?.count?.() || 0);
    return n > 0 ? String(n) : "";
  }

  function syncThemeTokens(el) {
    if (!el) return;
    try {
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue("--theme-submit-btn-bg").trim();
      const fg = cs.getPropertyValue("--theme-submit-btn-text").trim();
      if (bg) el.style.setProperty("--theme-submit-btn-bg", bg);
      if (fg) el.style.setProperty("--theme-submit-btn-text", fg);
    } catch {
      /* ignore */
    }
  }

  async function ensureCss() {
    if (cssLoaded || !shadow) return;
    try {
      const url = CGH.runtime?.getURL?.("content/panel.css");
      if (!url) return;
      const css = await fetch(url).then((r) => r.text());
      const style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
      cssLoaded = true;
    } catch (err) {
      console.warn("CGH: panel.css", err);
    }
  }

  function renderShell() {
    const wrap = shadow?.querySelector(".cgh-panel");
    if (!wrap) return;
    wrap.classList.toggle("is-open", host?.classList.contains("is-open"));
    const tabs = wrap.querySelector(".cgh-tabs");
    tabs.replaceChildren(
      ...TABS.map((tab) =>
        CGH.el(
          "button",
          {
            class: `cgh-tab ${currentTab === tab.id ? "is-active" : ""}`,
            type: "button",
            title: tab.label(),
            onclick: () => CGH.panel.setTab(tab.id),
          },
          CGH.svg(CGH.icons[tab.icon], 16),
          CGH.el("span", {}, tab.label())
        )
      )
    );
    wrap.querySelector(".cgh-title").textContent = TABS.find((t) => t.id === currentTab)?.label() || CGH.t.app;
    const closeBtn = wrap.querySelector(".cgh-close-btn");
    if (closeBtn) closeBtn.title = CGH.t.close || "Close";
    const body = wrap.querySelector(".cgh-body");
    body.replaceChildren();
    if (currentTab === "queue") CGH.queue.render(body);
    if (currentTab === "favorites") CGH.favorites.render(body);
    if (currentTab === "gallery") CGH.gallery.render(body);
    if (currentTab === "pins") CGH.pins.render(body);
    if (currentTab === "conversations") CGH.conversations.render(body);
    if (currentTab === "settings") CGH.settingsUi.render(body);
    updateFab();
  }

  function updateFab() {
    const badge = fab?.querySelector?.(".cgh-fab-badge");
    const text = fabBadge();
    if (badge) {
      badge.textContent = text;
      badge.hidden = !text;
    }
    if (fab) {
      fab.title = CGH.t?.app || "ChatGPT Helper";
      fab.setAttribute("aria-label", CGH.t?.app || "ChatGPT Helper");
      syncThemeTokens(fab);
    }
  }

  function ensureFab() {
    fab = document.getElementById("cgh-fab");
    const icon = CGH.svg(CGH.icons.sparkles || CGH.icons.star, 18);
    if (!fab) {
      fab = CGH.el(
        "button",
        {
          id: "cgh-fab",
          class: "cgh-fab-btn",
          type: "button",
          title: CGH.t?.app || "ChatGPT Helper",
          "aria-label": CGH.t?.app || "ChatGPT Helper",
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            CGH.panel.toggle();
          },
        },
        icon,
        CGH.el("span", { class: "cgh-fab-badge", hidden: true })
      );
    } else {
      const old = fab.querySelector("svg");
      if (old) old.replaceWith(icon);
      else fab.prepend(icon);
    }
    syncThemeTokens(fab);
    if (!fab.isConnected) {
      (document.body || document.documentElement).appendChild(fab);
    }
    updateFab();
    return fab;
  }

  async function createHost() {
    host = CGH.el("div", { id: "cgh-root", class: "cgh-root" });
    syncThemeTokens(host);
    shadow = host.attachShadow({ mode: "open" });
    cssLoaded = false;
    document.documentElement.appendChild(host);
    await ensureCss();

    shadow.append(
      CGH.el(
        "aside",
        { class: "cgh-panel", role: "dialog", "aria-label": CGH.t.app },
        CGH.el(
          "header",
          { class: "cgh-header" },
          CGH.el("span", { class: "cgh-title" }, CGH.t.app),
          CGH.el(
            "button",
            { class: "cgh-icon-btn cgh-close-btn", type: "button", title: CGH.t.close || "Close", onclick: () => CGH.panel.close() },
            CGH.svg(CGH.icons.close, 16)
          )
        ),
        CGH.el("nav", { class: "cgh-tabs" }),
        CGH.el("div", { class: "cgh-body" }),
        CGH.el("div", { class: "cgh-toast", hidden: true })
      )
    );
    renderShell();
  }

  CGH.panel = {
    get shadow() {
      return shadow;
    },

    get currentTab() {
      return currentTab;
    },

    isOpen() {
      return !!host?.classList.contains("is-open");
    },

    async mount() {
      ensureFab();
      if (host?.isConnected && shadow) {
        updateFab();
        return;
      }
      if (host && !host.isConnected) {
        document.documentElement.appendChild(host);
        ensureFab();
        return;
      }
      await createHost();
      ensureFab();
    },

    /** Reattach FAB/panel if ChatGPT or a navigation removed them. */
    async ensureMounted() {
      ensureFab();
      if (!host?.isConnected || !shadow || !document.getElementById("cgh-root")) {
        host = null;
        shadow = null;
        cssLoaded = false;
        await createHost();
        ensureFab();
      }
    },

    refresh() {
      if (!shadow) return;
      renderShell();
    },

    updateFab,

    open(tabId) {
      if (!host) return;
      if (tabId) currentTab = tabId;
      host.classList.add("is-open");
      shadow?.querySelector(".cgh-panel")?.classList.add("is-open");
      fab?.classList.add("is-open");
      renderShell();
    },

    close() {
      host?.classList.remove("is-open");
      shadow?.querySelector(".cgh-panel")?.classList.remove("is-open");
      fab?.classList.remove("is-open");
    },

    toggle() {
      if (!host?.isConnected) {
        this.ensureMounted().then(() => this.open());
        return;
      }
      if (host.classList.contains("is-open")) this.close();
      else this.open();
    },

    setTab(tabId) {
      currentTab = tabId;
      this.open(tabId);
    },

    toast(message, type = "ok") {
      const el = shadow?.querySelector(".cgh-toast");
      if (!el) return;
      el.hidden = false;
      el.className = `cgh-toast is-${type}`;
      el.textContent = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.hidden = true;
      }, 2600);
    },
  };
})();
