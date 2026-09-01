(() => {
  const CGH = (window.CGH = window.CGH || {});
  const BAR_ID = "cgh-composer-bar";
  let lastSig = "";
  let renderBusy = false;
  let resizeObs = null;
  let observedAnchor = null;

  function getAnchor() {
    const form = CGH.dom.getForm();
    if (form) return form;
    const composer = CGH.dom.getComposer();
    return composer?.closest("form") || composer || null;
  }

  function clearFixedStyles(bar) {
    bar.style.position = "";
    bar.style.left = "";
    bar.style.top = "";
    bar.style.width = "";
    bar.style.bottom = "";
    bar.style.right = "";
    bar.style.transform = "";
  }

  function observeAnchor(anchor) {
    if (!anchor || typeof ResizeObserver !== "function") return;
    if (observedAnchor === anchor && resizeObs) return;
    resizeObs?.disconnect();
    observedAnchor = anchor;
    resizeObs = new ResizeObserver(() => {
      // Keep the bar mounted if ChatGPT reshuffles the composer tree.
      CGH.composerBar?.reposition();
    });
    resizeObs.observe(anchor);
    const parent = anchor.parentElement;
    if (parent) resizeObs.observe(parent);
  }

  /**
   * Mount the bar in normal document flow directly above the composer form.
   * It then moves with the input as height changes — no fixed-position jumping.
   */
  function mountInFlow(bar) {
    const anchor = getAnchor();
    if (!anchor) {
      bar.style.display = "none";
      return false;
    }

    if (CGH.dom.hasOpenOverlay?.()) {
      bar.style.display = "none";
      return false;
    }

    const parent = anchor.parentElement;
    if (!parent) {
      bar.style.display = "none";
      return false;
    }

    if (bar.parentElement !== parent || bar.nextElementSibling !== anchor) {
      parent.insertBefore(bar, anchor);
    }

    clearFixedStyles(bar);
    bar.classList.add("is-docked");
    bar.classList.remove("is-floating");
    bar.style.display = "flex";
    bar.style.zIndex = "40";
    observeAnchor(anchor);
    return true;
  }

  /** Fallback if the form parent cannot accept the node. */
  function positionFixed(bar) {
    const anchor = getAnchor();
    if (!anchor) {
      bar.style.display = "none";
      return false;
    }
    if (CGH.dom.hasOpenOverlay?.()) {
      bar.style.display = "none";
      return false;
    }

    if (bar.parentElement !== (document.body || document.documentElement)) {
      (document.body || document.documentElement).appendChild(bar);
    }

    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const height = Math.max(bar.offsetHeight || 36, 36);
    bar.classList.add("is-floating");
    bar.classList.remove("is-docked");
    bar.style.display = "flex";
    bar.style.position = "fixed";
    bar.style.left = `${Math.max(12, Math.round(rect.left))}px`;
    bar.style.width = `${Math.max(160, Math.round(rect.width))}px`;
    bar.style.top = `${Math.max(8, Math.round(rect.top - height - gap))}px`;
    bar.style.zIndex = "40";
    observeAnchor(anchor);
    return true;
  }

  function positionBar(bar) {
    if (mountInFlow(bar)) return true;
    return positionFixed(bar);
  }

  async function renderBar(bar) {
    if (renderBusy) return;
    renderBusy = true;
    try {
      const favorites = (await CGH.storage.get("favorites")) || [];
      const onBar = favorites.filter((f) => f.barPinned !== false);
      const queue = (await CGH.storage.get("queue")) || [];
      const pending = queue.filter((i) => i.status === "pending" || i.status === "sending").length;
      const filesLen = CGH.queue?.pendingFiles?.length || 0;
      const t = CGH.t || {};
      const sig = JSON.stringify({
        f: onBar.map((x) => `${x.id}:${x.title}:${x.barPinned !== false ? 1 : 0}`),
        pending,
        filesLen,
        lang: CGH.i18n?.lang,
      });
      if (sig === lastSig && bar.childElementCount) {
        positionBar(bar);
        return;
      }
      lastSig = sig;

      bar.replaceChildren();
      const chips = CGH.el("div", { class: "cgh-bar-chips" });

      chips.append(
        CGH.el(
          "button",
          {
            class: "cgh-bar-chip cgh-bar-save",
            type: "button",
            title: t.openPrompts || "Prompts",
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              CGH.favorites.openPanel();
            },
          },
          t.openPrompts || "★ Prompts"
        )
      );

      for (const fav of onBar.slice(0, 8)) {
        chips.append(
          CGH.el(
            "button",
            {
              class: "cgh-bar-chip",
              type: "button",
              title: fav.text,
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) CGH.favorites.insert(fav, { send: true });
                else CGH.favorites.insert(fav);
              },
            },
            fav.title
          )
        );
      }

      if (onBar.length > 8) {
        chips.append(
          CGH.el(
            "button",
            {
              class: "cgh-bar-chip",
              type: "button",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                CGH.favorites.openPanel();
              },
            },
            `${t.more || "More"} ${onBar.length - 8}`
          )
        );
      }

      const queueLabel = pending ? `${t.queueLabel || "Queue"} · ${pending}` : t.queueLabel || "Queue";

      bar.append(
        chips,
        CGH.el(
          "div",
          { class: "cgh-bar-right" },
          filesLen ? CGH.el("span", { class: "cgh-bar-files" }, `🖼 ${filesLen}`) : null,
          CGH.el(
            "button",
            {
              class: "cgh-bar-chip cgh-bar-queue",
              type: "button",
              title: `${t.addToQueue || "Queue"} (Alt+Q)`,
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
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

      positionBar(bar);
    } finally {
      renderBusy = false;
    }
  }

  function removeLegacyQueueBtn() {
    document.getElementById("cgh-queue-btn")?.remove();
  }

  CGH.composerBar = {
    async ensure({ render = true } = {}) {
      removeLegacyQueueBtn();
      let bar = document.getElementById(BAR_ID);
      if (!bar) {
        bar = CGH.el("div", { id: BAR_ID, class: "cgh-composer-bar is-docked" });
        lastSig = "";
      }
      if (!positionBar(bar)) return;
      if (render) await renderBar(bar);
    },

    update() {
      lastSig = "";
      const bar = document.getElementById(BAR_ID);
      if (bar) renderBar(bar);
      else this.ensure({ render: true });
    },

    reposition() {
      removeLegacyQueueBtn();
      let bar = document.getElementById(BAR_ID);
      if (!bar) {
        this.ensure({ render: true });
        return;
      }
      positionBar(bar);
    },
  };
})();
