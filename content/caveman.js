(() => {
  const CGH = (window.CGH = window.CGH || {});
  const D = CGH.cavemanDirective || self.CavemanDirective;
  if (!D) {
    console.warn("CGH caveman: directive missing");
    return;
  }

  let enabled = false;
  let level = "full";
  let bypass = false;
  let indicatorEl = null;
  let indicatorLvl = null;
  let heartbeat = null;

  async function refresh() {
    if (!CGH.storage?.isAlive?.()) return;
    const settings = (await CGH.storage.get("settings")) || {};
    enabled = !!settings.cavemanEnabled;
    level = D.normLevel(settings.cavemanLevel || "full");
    renderIndicator();
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  function looksLikeStop(btn) {
    if (!btn) return true;
    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return true;
    const meta =
      `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("data-testid") || ""} ${btn.title || ""}`.toLowerCase();
    return /\b(stop|abort|cancel)\b/.test(meta);
  }

  function getEditor() {
    return CGH.dom?.getComposer?.() || null;
  }

  function getSend() {
    const btn = CGH.dom?.getSendButton?.();
    if (btn && isVisible(btn) && !looksLikeStop(btn) && !CGH.dom?.isGenerating?.()) return btn;
    return null;
  }

  function getText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    return el.innerText || el.textContent || "";
  }

  function messageCount() {
    try {
      return CGH.dom?.getMessages?.()?.length || 0;
    } catch {
      return 0;
    }
  }

  async function setText(el, text) {
    if (CGH.dom?.setComposerText) {
      await CGH.dom.setComposerText(text);
      return true;
    }
    el.focus();
    if (el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return document.execCommand("insertText", false, text) === true;
    } catch {
      return false;
    }
  }

  function dispatchEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }

  function fireSend(el) {
    bypass = true;
    let tries = 0;
    const release = () => setTimeout(() => (bypass = false), 220);
    const tick = () => {
      const btn = getSend();
      if (btn) {
        btn.click();
        release();
        return;
      }
      if (tries++ < 16) {
        setTimeout(tick, 50);
        return;
      }
      dispatchEnter(el);
      release();
    };
    setTimeout(tick, 20);
  }

  async function injectAndSend(el) {
    const original = getText(el);
    const isFirst = messageCount() === 0;
    const prefix = isFirst ? D.buildPrimer(level) : D.buildReminder(level);
    const ok = await setText(el, `${prefix}\n\n${original}`);
    if (!ok) {
      await setText(el, original);
      if (!getText(el).trim()) return;
    }
    fireSend(el);
  }

  function safeInjectAndSend(el) {
    injectAndSend(el).catch(() => {
      try {
        fireSend(el);
      } catch {
        /* ignore */
      }
    });
  }

  function shouldDeferToQueue() {
    return !!(CGH.dom?.isGenerating?.());
  }

  function onKeydown(e) {
    if (bypass || !enabled) return;
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    // Let Helper queue handle Enter while ChatGPT is generating.
    if (shouldDeferToQueue()) return;
    const el = getEditor();
    if (!el) return;
    if (!(e.target === el || el.contains(e.target))) return;
    const text = getText(el);
    if (!text.trim() || D.isPrefixed(text)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    safeInjectAndSend(el);
  }

  function onClick(e) {
    if (bypass || !enabled) return;
    if (shouldDeferToQueue()) return;
    const btn = getSend();
    if (!btn) return;
    if (!(e.target === btn || btn.contains(e.target))) return;
    // Ignore clicks from our own UI.
    if (e.target.closest?.("#cgh-fab, #cgh-composer-bar, #cgh-root, #cgh-caveman-indicator")) return;
    const el = getEditor();
    if (!el) return;
    const text = getText(el);
    if (!text.trim() || D.isPrefixed(text)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    safeInjectAndSend(el);
  }

  function renderIndicator() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", renderIndicator, { once: true });
      return;
    }
    if (!indicatorEl) {
      indicatorEl = document.createElement("button");
      indicatorEl.id = "cgh-caveman-indicator";
      indicatorEl.type = "button";
      indicatorEl.title = "Caveman mode — open settings";
      indicatorEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        CGH.panel?.open?.("settings");
      });
      const flame = document.createElement("span");
      flame.className = "cgh-cm-dot";
      flame.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "cgh-cm-label";
      label.textContent = "CM";
      indicatorLvl = document.createElement("span");
      indicatorLvl.className = "cgh-cm-lvl";
      indicatorEl.append(flame, label, indicatorLvl);
    }
    if (!document.body.contains(indicatorEl)) document.body.appendChild(indicatorEl);
    indicatorEl.style.display = enabled ? "flex" : "none";
    indicatorEl.classList.toggle("is-on", enabled);
    indicatorEl.title = CGH.t?.cavemanOpenSettings || "Caveman mode — open settings";
    if (indicatorLvl) indicatorLvl.textContent = level;
  }

  CGH.caveman = {
    async init() {
      await refresh();
      CGH.storage.onChange((changes) => {
        if (changes.settings) refresh();
      });
      document.addEventListener("keydown", onKeydown, true);
      document.addEventListener("click", onClick, true);
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (!CGH.storage?.isAlive?.()) {
          clearInterval(heartbeat);
          indicatorEl?.remove();
          return;
        }
        if (enabled) renderIndicator();
      }, 1500);
    },
    refresh,
    isEnabled: () => enabled,
    getLevel: () => level,
  };
})();
