(() => {
  const CGH = (window.CGH = window.CGH || {});
  const BAR_ID = "cgh-composer-bar";
  let lastSig = "";

  function hostRoot() {
    return document.body || document.documentElement;
  }

  function positionBar(bar) {
    const form = CGH.dom.getForm();
    const composer = CGH.dom.getComposer();
    const anchor = form || composer;
    if (!anchor) {
      bar.style.display = "none";
      return false;
    }

    // Stay under ChatGPT dialogs / popovers.
    if (CGH.dom.hasOpenOverlay?.()) {
      bar.style.display = "none";
      return false;
    }

    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const height = bar.offsetHeight || 36;
    bar.style.display = "flex";
    bar.style.position = "fixed";
    bar.style.left = `${Math.max(12, rect.left)}px`;
    bar.style.width = `${Math.max(160, rect.width)}px`;
    bar.style.top = `${Math.max(8, rect.top - height - gap)}px`;
    // Low stacking — below ChatGPT modals/popovers.
    bar.style.zIndex = "2";
    return true;
  }

  async function renderBar(bar) {
    const favorites = (await CGH.storage.get("favorites")) || [];
    const queue = (await CGH.storage.get("queue")) || [];
    const pending = queue.filter((i) => i.status === "pending" || i.status === "sending").length;
    const files = CGH.queue?.getPendingSnapshot?.() || [];
    const t = CGH.t || {};
    const sig = JSON.stringify({
      f: favorites.map((x) => x.id + x.title),
      pending,
      files: files.map((f) => f.name + f.size),
      lang: CGH.i18n?.lang,
    });
    if (sig === lastSig && bar.childElementCount) return;
    lastSig = sig;

    bar.replaceChildren();
    const chips = CGH.el("div", { class: "cgh-bar-chips" });

    chips.append(
      CGH.el(
        "button",
        {
          class: "cgh-bar-chip cgh-bar-save",
          type: "button",
          title: t.savePrompt || "Save prompt",
          onclick: () => CGH.favorites.saveCurrent(),
        },
        t.savePrompt || "★ Save"
      )
    );

    for (const fav of favorites.slice(0, 8)) {
      chips.append(
        CGH.el(
          "button",
          {
            class: "cgh-bar-chip",
            type: "button",
            title: fav.text,
            onclick: (e) => {
              if (e.shiftKey) CGH.favorites.insert(fav, { send: true });
              else CGH.favorites.insert(fav);
            },
          },
          fav.title
        )
      );
    }

    if (favorites.length > 8) {
      chips.append(
        CGH.el(
          "button",
          {
            class: "cgh-bar-chip",
            type: "button",
            onclick: () => CGH.panel.open("favorites"),
          },
          `${t.more || "More"} ${favorites.length - 8}`
        )
      );
    }

    const queueLabel = pending
      ? `${t.queueLabel || "Queue"} · ${pending}`
      : t.queueLabel || "Queue";

    bar.append(
      chips,
      CGH.el(
        "div",
        { class: "cgh-bar-right" },
        files.length
          ? CGH.el("span", { class: "cgh-bar-files", title: files.map((f) => f.name).join(", ") }, `🖼 ${files.length}`)
          : null,
        CGH.el(
          "button",
          {
            class: "cgh-bar-chip cgh-bar-queue",
            type: "button",
            title: `${t.addToQueue || "Queue"} (Alt+Q). ${t.shortcuts || ""}`,
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              // Empty composer + existing queue → open panel; otherwise enqueue.
              const text = CGH.dom.getComposerText().trim();
              const snaps = CGH.queue.getPendingSnapshot();
              if (!text && !snaps.length) {
                CGH.panel.open("queue");
                return;
              }
              CGH.queue.enqueueFromComposer();
            },
          },
          queueLabel
        )
      )
    );

    requestAnimationFrame(() => positionBar(bar));
  }

  function removeLegacyQueueBtn() {
    document.getElementById("cgh-queue-btn")?.remove();
  }

  CGH.composerBar = {
    async ensure() {
      removeLegacyQueueBtn();
      let bar = document.getElementById(BAR_ID);
      if (!bar) {
        bar = CGH.el("div", { id: BAR_ID, class: "cgh-composer-bar" });
        hostRoot().appendChild(bar);
      }
      if (!positionBar(bar)) return;
      await renderBar(bar);
    },

    update() {
      lastSig = "";
      const bar = document.getElementById(BAR_ID);
      if (bar) renderBar(bar);
      this.reposition();
    },

    reposition() {
      removeLegacyQueueBtn();
      const bar = document.getElementById(BAR_ID);
      if (bar) positionBar(bar);
    },
  };
})();
