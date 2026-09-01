(() => {
  const CGH = (window.CGH = window.CGH || {});
  const PENDING_JUMP_KEY = "cgh-pending-jump";

  let tipNode = null;
  let tipTimer = null;

  async function all() {
    return (await CGH.storage.get("pins")) || [];
  }

  function turnRoot(el) {
    if (!(el instanceof HTMLElement)) return null;
    return (
      el.closest('[data-testid^="conversation-turn-"]') ||
      el.closest("article[data-turn], section[data-turn], [data-turn]") ||
      el.closest("article") ||
      el
    );
  }

  function messageEl(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    return (
      turn.querySelector("[data-message-author-role]") ||
      turn.querySelector("[data-message-id]") ||
      turn.closest("[data-message-author-role]") ||
      turn
    );
  }

  function isActionButton(btn) {
    if (!(btn instanceof HTMLElement) || btn.hasAttribute("data-cgh-pin")) return false;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const testId = (btn.getAttribute("data-testid") || "").toLowerCase();
    return (
      testId.includes("copy") ||
      testId.includes("thumb") ||
      testId.includes("share") ||
      testId.includes("regenerate") ||
      testId.includes("good-response") ||
      testId.includes("bad-response") ||
      /copy|share|thumb|good response|bad response|regenerat|копир|подели|хорош|плох|повтор|перегенер/i.test(
        label
      )
    );
  }

  function isMoreButton(btn) {
    if (!(btn instanceof HTMLElement) || btn.hasAttribute("data-cgh-pin")) return false;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const testId = (btn.getAttribute("data-testid") || "").toLowerCase();
    if (
      testId.includes("more") ||
      testId.includes("options") ||
      testId.includes("overflow") ||
      testId.includes("menu")
    ) {
      return true;
    }
    if (/more actions|more options|дополнительн|другие действия|\bmore\b|ещё|еще/i.test(label)) {
      return true;
    }
    const text = (btn.textContent || "").replace(/\s+/g, "");
    if (text === "⋯" || text === "..." || text === "•••" || text === "···") return true;
    if (!isActionButton(btn) && /circle[^>]*>\s*<circle[^>]*>\s*<circle/i.test(btn.innerHTML)) {
      return true;
    }
    return false;
  }

  function findCopyButtons(root = document) {
    const preferred = [
      ...root.querySelectorAll(
        '[data-testid="copy-turn-action-button"], button[data-testid*="copy-turn-action"]'
      ),
    ];
    const list = preferred.length
      ? preferred
      : [
          ...root.querySelectorAll(
            [
              'button[aria-label="Copy response"]',
              'button[aria-label="Copy message"]',
              'button[aria-label="Копировать ответ"]',
              'button[aria-label="Копировать сообщение"]',
            ].join(",")
          ),
        ];
    return list.filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.closest("#cgh-root, #cgh-composer-bar, pre, code")) return false;
      const testId = (el.getAttribute("data-testid") || "").toLowerCase();
      if (testId && !testId.includes("turn") && testId.includes("code")) return false;
      return true;
    });
  }

  function findActionRow(copyBtn) {
    if (!(copyBtn instanceof HTMLElement)) return null;

    let el = copyBtn.parentElement;
    for (let depth = 0; depth < 6 && el; depth++) {
      const directHits = [...el.children].filter((child) => {
        if (child.hasAttribute?.("data-cgh-pin-wrap") || child.hasAttribute?.("data-cgh-pin")) return true;
        if (child.matches?.("button") && (isActionButton(child) || isMoreButton(child))) return true;
        const nested = child.querySelector?.(":scope > button, button");
        return nested && (isActionButton(nested) || isMoreButton(nested));
      });
      if (directHits.length >= 2) return el;
      el = el.parentElement;
    }

    return (
      copyBtn.closest('[role="group"]') ||
      copyBtn.closest("div.flex.items-center") ||
      copyBtn.closest("div.flex") ||
      copyBtn.parentElement
    );
  }

  function childButton(child) {
    if (!(child instanceof HTMLElement)) return null;
    if (child.matches("button")) return child;
    return child.querySelector(":scope > button, button");
  }

  function findMoreSlot(row) {
    for (const child of row.children) {
      const btn = childButton(child);
      if (btn && isMoreButton(btn)) return child;
    }
    const kids = [...row.children].filter(
      (c) =>
        !c.hasAttribute?.("data-cgh-pin-wrap") &&
        !c.hasAttribute?.("data-cgh-pin") &&
        !c.querySelector?.("[data-cgh-pin]")
    );
    for (let i = kids.length - 1; i >= 0; i--) {
      const btn = childButton(kids[i]);
      if (btn && !isActionButton(btn)) return kids[i];
    }
    return null;
  }

  function ensureTip() {
    if (tipNode?.isConnected) return tipNode;
    tipNode = document.createElement("div");
    tipNode.className = "cgh-tip";
    tipNode.setAttribute("role", "tooltip");
    document.documentElement.appendChild(tipNode);
    return tipNode;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipNode?.classList.remove("is-on");
  }

  function showTip(btn) {
    const text = btn.getAttribute("data-cgh-tooltip") || "";
    if (!text) return;
    const tip = ensureTip();
    tip.textContent = text;
    const r = btn.getBoundingClientRect();
    tip.style.left = `${Math.round(r.left + r.width / 2)}px`;
    tip.style.top = `${Math.round(r.top)}px`;
    tip.classList.add("is-on");
  }

  function bindTooltip(btn) {
    if (btn.dataset.cghTipBound === "1") return;
    btn.dataset.cghTipBound = "1";
    btn.addEventListener("pointerenter", () => {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(btn), 350);
    });
    btn.addEventListener("pointerleave", hideTip);
    btn.addEventListener("pointerdown", hideTip);
    btn.addEventListener("blur", hideTip);
  }

  function setTooltip(btn, text) {
    const label = text || CGH.t?.pin || "Pin";
    btn.removeAttribute("title");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("data-cgh-tooltip", label);
    bindTooltip(btn);
  }

  function styleLikeNative(btn, sampleBtn) {
    if (!(sampleBtn instanceof HTMLElement)) return;
    const keep = new Set(["cgh-pin-btn", "is-on"]);
    const native = [...sampleBtn.classList].filter((c) => !c.startsWith("cgh-"));
    btn.className = [...native, ...keep].join(" ");
    for (const attr of ["data-state", "data-size"]) {
      if (sampleBtn.hasAttribute(attr)) btn.setAttribute(attr, sampleBtn.getAttribute(attr));
    }

    const cs = getComputedStyle(sampleBtn);
    btn.style.boxSizing = cs.boxSizing || "border-box";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.padding = cs.padding && cs.padding !== "0px" ? cs.padding : "8px";
    if (cs.width && cs.width !== "auto" && parseFloat(cs.width) >= 28) btn.style.width = cs.width;
    if (cs.height && cs.height !== "auto" && parseFloat(cs.height) >= 28) btn.style.height = cs.height;
    btn.style.minWidth = cs.minWidth && cs.minWidth !== "0px" ? cs.minWidth : "36px";
    btn.style.minHeight = cs.minHeight && cs.minHeight !== "0px" ? cs.minHeight : "36px";
    btn.style.borderRadius = cs.borderRadius || "999px";

    const sampleSvg = sampleBtn.querySelector("svg");
    const ourSvg = btn.querySelector("svg");
    if (sampleSvg && ourSvg) {
      const rect = sampleSvg.getBoundingClientRect();
      const w = sampleSvg.getAttribute("width") || (rect.width ? Math.round(rect.width) : 20);
      const h = sampleSvg.getAttribute("height") || (rect.height ? Math.round(rect.height) : 20);
      ourSvg.setAttribute("width", String(w));
      ourSvg.setAttribute("height", String(h));
      const vb = sampleSvg.getAttribute("viewBox");
      if (vb) ourSvg.setAttribute("viewBox", vb);
      const sw = sampleSvg.getAttribute("stroke-width");
      if (sw) ourSvg.setAttribute("stroke-width", sw);
      ourSvg.style.width = `${w}px`;
      ourSvg.style.height = `${h}px`;
    }
  }

  function pinButton(msg, sampleBtn) {
    const sampleSvg = sampleBtn?.querySelector?.("svg");
    const size =
      Number(sampleSvg?.getAttribute("width")) ||
      Math.round(sampleSvg?.getBoundingClientRect?.().width || 20) ||
      20;
    const icon = CGH.svg(CGH.icons.pin, size);
    const btn = CGH.el(
      "button",
      {
        class: "cgh-pin-btn",
        type: "button",
        "data-cgh-pin": "1",
        onclick: async (e) => {
          e.preventDefault();
          e.stopPropagation();
          hideTip();
          await CGH.pins.toggle(msg);
        },
      },
      icon
    );
    styleLikeNative(btn, sampleBtn);
    btn.setAttribute("data-cgh-pin", "1");
    setTooltip(btn, CGH.t?.pin || "Pin");
    return btn;
  }

  function placeBeforeMore(row, node) {
    if (!(row instanceof HTMLElement) || !(node instanceof HTMLElement)) return;
    const more = findMoreSlot(row);
    if (more && more !== node) {
      if (node.nextSibling !== more) row.insertBefore(node, more);
      return;
    }
    if (node.parentElement !== row) row.appendChild(node);
  }

  function injectIntoRow(row, msg, sampleBtn) {
    let existing = row.querySelector("[data-cgh-pin]");
    if (existing) {
      const wrap = existing.closest("[data-cgh-pin-wrap]") || existing;
      placeBeforeMore(row, wrap);
      styleLikeNative(existing, sampleBtn);
      return existing;
    }

    const btn = pinButton(msg, sampleBtn);
    const sampleChild = [...row.children].find((child) => {
      if (child.hasAttribute?.("data-cgh-pin-wrap") || child.hasAttribute?.("data-cgh-pin")) return false;
      if (child.matches?.("button") && isActionButton(child)) return true;
      const nested = child.querySelector?.("button");
      return nested && isActionButton(nested);
    });

    let node = btn;
    if (sampleChild && sampleChild.tagName !== "BUTTON") {
      const wrap = sampleChild.cloneNode(false);
      wrap.setAttribute("data-cgh-pin-wrap", "1");
      wrap.replaceChildren(btn);
      node = wrap;
    }

    placeBeforeMore(row, node);
    if (node.parentElement !== row) {
      const more = findMoreSlot(row);
      if (more) row.insertBefore(node, more);
      else row.appendChild(node);
    }
    return btn;
  }

  function syncPinState(btn, pins, conv, msg, turn) {
    const id = CGH.dom.messageId(msg);
    const pinned = (pins || []).some((p) => p.messageId === id && p.conversationId === conv);
    btn.classList.toggle("is-on", pinned);
    setTooltip(btn, pinned ? CGH.t.unpin : CGH.t.pin);

    const root = turn || turnRoot(msg) || msg;
    if (root instanceof HTMLElement) {
      root.classList.toggle("cgh-is-pinned", pinned);
      if (pinned) root.setAttribute("data-cgh-pinned", "1");
      else root.removeAttribute("data-cgh-pinned");
    }
  }

  function findMessageTarget(messageId) {
    for (const copy of findCopyButtons()) {
      const turn = turnRoot(copy);
      const msg = messageEl(turn);
      if (msg && CGH.dom.messageId(msg) === messageId) return turn || msg;
    }
    const msg = CGH.dom.getMessages().find((m) => CGH.dom.messageId(m) === messageId);
    return msg ? turnRoot(msg) || msg : null;
  }

  async function scrollToMessage(messageId) {
    let target = findMessageTarget(messageId);
    if (!target) {
      const ready = await CGH.dom.waitUntil(() => !!findMessageTarget(messageId), {
        timeout: 20000,
        interval: 250,
      });
      if (!ready) return false;
      target = findMessageTarget(messageId);
    }
    if (!target) return false;

    for (let i = 0; i < 8; i++) {
      target = findMessageTarget(messageId) || target;
      target.scrollIntoView({ behavior: i === 0 ? "smooth" : "auto", block: "center" });
      await CGH.sleep(300);
      const rect = target.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (mid > 80 && mid < window.innerHeight - 80) break;
    }

    target.classList.add("cgh-flash");
    setTimeout(() => target.classList.remove("cgh-flash"), 1600);
    return true;
  }

  CGH.pins = {
    count() {
      return 0;
    },

    async init() {
      const pins = await all();
      this.count = () => pins.length;
      CGH.storage.onChange((changes) => {
        if (changes.pins) this.count = () => (changes.pins.newValue || []).length;
      });
      this.decorate();
      this.consumePendingJump();
      this._timer = setInterval(() => {
        if (CGH.extensionAlive === false) {
          clearInterval(this._timer);
          return;
        }
        this.decorate();
      }, 1200);
    },

    async isPinned(msg) {
      const id = CGH.dom.messageId(msg);
      const conv = CGH.dom.getConversationId();
      const pins = await all();
      return pins.some((p) => p.messageId === id && p.conversationId === conv);
    },

    async toggle(msg) {
      const messageId = CGH.dom.messageId(msg);
      const conversationId = CGH.dom.getConversationId() || "new";
      const pins = await all();
      const idx = pins.findIndex((p) => p.messageId === messageId && p.conversationId === conversationId);
      if (idx >= 0) {
        pins.splice(idx, 1);
        await CGH.storage.set({ pins });
        CGH.panel?.toast(CGH.t.unpin);
      } else {
        pins.unshift({
          id: CGH.uuid(),
          messageId,
          conversationId,
          conversationTitle: CGH.dom.getConversationTitle(),
          role: CGH.dom.messageRole(msg),
          snippet: (msg.innerText || "").trim().slice(0, 500),
          createdAt: Date.now(),
        });
        await CGH.storage.set({ pins });
        CGH.panel?.toast(CGH.t.pinnedToast);
      }
      this.decorate();
      CGH.panel?.updateFab();
    },

    decorate() {
      CGH.storage.get("pins").then((pins) => {
        document.querySelectorAll("button.cgh-pin-floating[data-cgh-pin]").forEach((el) => {
          (el.closest("[data-cgh-pin-wrap]") || el).remove();
        });

        const conv = CGH.dom.getConversationId();
        const seen = new Set();
        const copies = findCopyButtons();
        const pinnedRoots = new Set();

        for (const copy of copies) {
          const row = findActionRow(copy);
          if (!(row instanceof HTMLElement)) continue;

          const turn = turnRoot(copy) || turnRoot(row) || row;
          const msg = messageEl(turn) || messageEl(copy) || copy;
          const key = CGH.dom.messageId(msg) || copy;
          if (seen.has(key)) continue;
          seen.add(key);

          turn.querySelectorAll("[data-cgh-pin]").forEach((btn) => {
            if (!row.contains(btn)) (btn.closest("[data-cgh-pin-wrap]") || btn).remove();
          });

          const btn = injectIntoRow(row, msg, copy);
          syncPinState(btn, pins, conv, msg, turn);
          if (turn?.classList?.contains("cgh-is-pinned")) pinnedRoots.add(turn);
        }

        document.querySelectorAll(".cgh-is-pinned, [data-cgh-pinned='1']").forEach((el) => {
          if (!pinnedRoots.has(el)) {
            el.classList.remove("cgh-is-pinned");
            el.removeAttribute("data-cgh-pinned");
          }
        });
      });
    },

    async jump(pin) {
      const current = CGH.dom.getConversationId();
      if (pin.conversationId && pin.conversationId !== "new" && pin.conversationId !== current) {
        try {
          sessionStorage.setItem(
            PENDING_JUMP_KEY,
            JSON.stringify({
              messageId: pin.messageId,
              conversationId: pin.conversationId,
              at: Date.now(),
            })
          );
        } catch {
          /* ignore */
        }
        location.href = `/c/${pin.conversationId}`;
        // SPA navigations may not reload the content script — keep trying here too.
        this.consumePendingJump();
        return;
      }
      const ok = await scrollToMessage(pin.messageId);
      if (!ok) CGH.panel?.toast(CGH.t.notFound, "error");
    },

    async consumePendingJump() {
      let raw = null;
      try {
        raw = sessionStorage.getItem(PENDING_JUMP_KEY);
      } catch {
        return;
      }
      if (!raw) return;

      let pending;
      try {
        pending = JSON.parse(raw);
      } catch {
        try {
          sessionStorage.removeItem(PENDING_JUMP_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      if (!pending?.messageId) return;
      if (pending.at && Date.now() - pending.at > 60000) {
        try {
          sessionStorage.removeItem(PENDING_JUMP_KEY);
        } catch {
          /* ignore */
        }
        return;
      }

      if (pending.conversationId) {
        await CGH.dom.waitUntil(() => CGH.dom.getConversationId() === pending.conversationId, {
          timeout: 20000,
          interval: 200,
        });
        if (CGH.dom.getConversationId() !== pending.conversationId) return;
      }

      try {
        sessionStorage.removeItem(PENDING_JUMP_KEY);
      } catch {
        /* ignore */
      }

      await CGH.sleep(500);
      const ok = await scrollToMessage(pending.messageId);
      if (!ok) {
        // Messages may still be virtualized — one more delayed attempt.
        await CGH.sleep(1200);
        const ok2 = await scrollToMessage(pending.messageId);
        if (!ok2) CGH.panel?.toast(CGH.t.notFound, "error");
      }
    },

    async render(root) {
      const pins = await all();
      if (!pins.length) {
        root.append(CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyPins));
        return;
      }
      const list = CGH.el("div", { class: "cgh-list" });
      for (const pin of pins) {
        list.append(
          CGH.el(
            "article",
            { class: "cgh-card" },
            CGH.el(
              "div",
              { class: "cgh-card-top" },
              CGH.el("span", { class: "cgh-role" }, pin.role === "user" ? CGH.t.you : "ChatGPT"),
              CGH.el("span", { class: "cgh-muted" }, pin.conversationTitle || "")
            ),
            CGH.el("p", { class: "cgh-card-text" }, pin.snippet),
            CGH.el(
              "div",
              { class: "cgh-card-actions" },
              CGH.el("button", { class: "cgh-btn cgh-btn-primary", type: "button", onclick: () => this.jump(pin) }, CGH.t.jump),
              CGH.el(
                "button",
                {
                  class: "cgh-icon-btn danger",
                  type: "button",
                  onclick: async () => {
                    await CGH.storage.set({ pins: pins.filter((p) => p.id !== pin.id) });
                    CGH.panel.refresh();
                    this.decorate();
                  },
                },
                CGH.svg(CGH.icons.trash, 14)
              )
            )
          )
        );
      }
      root.append(list);
    },
  };
})();
