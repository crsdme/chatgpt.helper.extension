(() => {
  const CGH = (window.CGH = window.CGH || {});

  const SELECTORS = {
    composer: [
      '#prompt-textarea.ProseMirror[contenteditable="true"]',
      "#prompt-textarea[contenteditable='true']",
      "#prompt-textarea",
      'div[contenteditable="true"]#prompt-textarea',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[name="prompt-textarea"]',
    ],
    send: [
      'button[data-testid="send-button"]',
      "#composer-submit-button",
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
    ],
    stop: [
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop"]',
    ],
    fileInput: ['form input[type="file"]', 'input[type="file"][multiple]', 'input[type="file"]'],
    attach: [
      'button[data-testid="composer-plus-btn"]',
      "#composer-plus-btn",
      'button[aria-label="Attach files"]',
      'button[aria-label="Add photos"]',
      'button[aria-label="Add photos and files"]',
    ],
    form: ['form[data-type="unified-composer"]', "form.stretch", "main form"],
    messages: ['[data-message-author-role]', 'article[data-testid^="conversation-turn"]'],
    main: ["main", '[role="main"]'],
  };

  function first(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isStopControl(el) {
    if (!el) return false;
    const testId = (el.getAttribute("data-testid") || "").toLowerCase();
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    return testId.includes("stop") || /stop/.test(label);
  }

  CGH.dom = {
    selectors: SELECTORS,
    first,
    visible,

    getComposer() {
      for (const sel of SELECTORS.composer) {
        const el = document.querySelector(sel);
        if (el && (el.getAttribute("contenteditable") === "true" || el.tagName === "TEXTAREA")) {
          return el;
        }
      }
      const editables = [...document.querySelectorAll('div[contenteditable="true"]')];
      return (
        editables.find((el) => visible(el) && el.getBoundingClientRect().height >= 20 && el.closest("form")) ||
        null
      );
    },

    getForm() {
      const composer = this.getComposer();
      return composer?.closest("form") || first(SELECTORS.form);
    },

    getSendButton() {
      const btn = first(SELECTORS.send);
      if (btn && !isStopControl(btn)) return btn;
      // Fallback: submit-looking button that is not Stop
      const form = this.getForm();
      if (!form) return null;
      const candidates = [...form.querySelectorAll("button")];
      return (
        candidates.find((b) => {
          if (!visible(b) || b.disabled || isStopControl(b)) return false;
          const label = (b.getAttribute("aria-label") || "").toLowerCase();
          const testId = (b.getAttribute("data-testid") || "").toLowerCase();
          return testId.includes("send") || label.includes("send") || b.getAttribute("type") === "submit";
        }) || null
      );
    },

    getStopButton() {
      const btn = first(SELECTORS.stop);
      if (btn && visible(btn)) return btn;
      const any = document.querySelector('[data-testid="stop-button"]');
      return any && visible(any) ? any : null;
    },

    getFileInputs() {
      const out = [];
      const seen = new Set();
      const add = (input) => {
        if (!input || seen.has(input)) return;
        if (input.closest?.("#cgh-root, #cgh-composer-bar")) return;
        seen.add(input);
        out.push(input);
      };
      for (const input of document.querySelectorAll('input[type="file"]')) add(input);
      const form = this.getForm();
      if (form) {
        for (const el of form.querySelectorAll("*")) {
          if (!el.shadowRoot) continue;
          for (const input of el.shadowRoot.querySelectorAll('input[type="file"]')) add(input);
        }
      }
      return out;
    },

    getFileInput() {
      const form = this.getForm();
      if (form) {
        const input = form.querySelector('input[type="file"]');
        if (input) return input;
      }
      return this.getFileInputs()[0] || first(SELECTORS.fileInput);
    },

    getAttachButton() {
      const form = this.getForm();
      if (form) {
        const local = first(SELECTORS.attach, form);
        if (local) return local;
      }
      return first(SELECTORS.attach);
    },

    getMain() {
      return first(SELECTORS.main) || document.body;
    },

    isGenerating() {
      if (this.getStopButton()) return true;
      // Streaming cursor / result-streaming class used by ChatGPT variants
      if (document.querySelector(".result-streaming, [data-is-streaming='true'], [aria-busy='true'] .markdown")) {
        return true;
      }
      return false;
    },

    hasOpenOverlay() {
      const nodes = document.querySelectorAll(
        '[role="dialog"], [data-state="open"][role="dialog"], [data-radix-portal], .fixed.inset-0'
      );
      for (const n of nodes) {
        if (!visible(n)) continue;
        // Ignore our own UI
        if (n.closest?.("#cgh-root") || n.id === "cgh-root") continue;
        const rect = n.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 80) return true;
      }
      return false;
    },

    getComposerText() {
      const el = this.getComposer();
      if (!el) return "";
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
      const paragraphs = [...el.querySelectorAll(":scope > p")];
      if (paragraphs.length) {
        return paragraphs
          .map((p) => p.textContent || "")
          .join("\n")
          .replace(/\u200b/g, "")
          .trimEnd();
      }
      return (el.innerText || el.textContent || "").replace(/\u200b/g, "").trimEnd();
    },

    async setComposerText(text) {
      const el = this.getComposer();
      if (!el) throw new Error("Поле ввода не найдено");
      el.focus();
      await CGH.sleep(30);

      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        desc?.set?.call(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      const ok = document.execCommand("insertText", false, text || "");
      if (!ok) {
        el.textContent = "";
        const lines = String(text || "").split("\n");
        el.replaceChildren();
        for (const line of lines) {
          const p = document.createElement("p");
          p.setAttribute("dir", "auto");
          p.textContent = line || "";
          if (!line) p.appendChild(document.createElement("br"));
          el.appendChild(p);
        }
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },

    async clearComposer() {
      await this.setComposerText("");
      this.clearAttachmentChips();
      this.resetFileInput();
    },

    resetFileInput() {
      const inputs = [];
      const form = this.getForm();
      if (form) inputs.push(...form.querySelectorAll('input[type="file"]'));
      const fallback = this.getFileInput();
      if (fallback && !inputs.includes(fallback)) inputs.push(fallback);
      for (const input of inputs) {
        try {
          input.value = "";
        } catch {
          /* ignore */
        }
      }
    },

    clearAttachmentChips() {
      const form = this.getForm() || document;
      const buttons = [...form.querySelectorAll("button")];
      for (const btn of buttons) {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (/remove (file|image|photo)|удалить/.test(label)) btn.click();
      }
    },

    async attachFiles(files) {
      if (!files?.length) return;
      let input = this.getFileInput();
      if (!input) {
        this.getAttachButton()?.click();
        await CGH.sleep(200);
        input = this.getFileInput();
      }
      if (!input) throw new Error("Не удалось найти поле для файлов");

      const dt = new DataTransfer();
      for (const file of files) dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },

    async waitForComposerReady({ timeout = 45000 } = {}) {
      // Wait until attachments finished uploading and Send is available (not Stop).
      return this.waitUntil(() => {
        if (this.isGenerating()) return false;
        const send = this.getSendButton();
        if (!send || send.disabled || isStopControl(send) || !visible(send)) return false;
        const form = this.getForm();
        if (form?.querySelector('[class*="spin"], [class*="loading"], [aria-busy="true"]')) return false;
        return true;
      }, { timeout, interval: 200 });
    },

    async clickSend() {
      // Critical: never click Stop — that cancels the active prompt.
      if (this.isGenerating()) return false;
      const send = this.getSendButton();
      if (!send || send.disabled || isStopControl(send)) return false;

      send.click();
      return true;
    },

    getConversationId() {
      const m = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
      return m ? m[1] : null;
    },

    getConversationTitle() {
      const id = this.getConversationId();
      if (id) {
        const link = document.querySelector(`nav a[href="/c/${id}"], nav a[href*="/c/${id}"], a[href="/c/${id}"]`);
        const title = link?.textContent?.trim();
        if (title) return title;
      }
      const raw = document.title.replace(/\s*[|–-]\s*ChatGPT.*$/i, "").trim();
      return raw && raw.toLowerCase() !== "chatgpt" ? raw : CGH.t?.newChat || "New chat";
    },

    getMessages() {
      return [...document.querySelectorAll(SELECTORS.messages.join(","))];
    },

    messageId(el) {
      return (
        el.getAttribute("data-message-id") ||
        el.closest("[data-message-id]")?.getAttribute("data-message-id") ||
        el.getAttribute("data-testid") ||
        CGH.hash((el.getAttribute("data-message-author-role") || "") + "|" + (el.innerText || "").slice(0, 240))
      );
    },

    messageRole(el) {
      return (
        el.getAttribute("data-message-author-role") ||
        el.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role") ||
        "assistant"
      );
    },

    scrapeSidebarConversations() {
      const links = [...document.querySelectorAll('nav a[href*="/c/"], a[href^="/c/"], a[href*="/c/"]')];
      const seen = new Set();
      const out = [];
      for (const a of links) {
        if (a.closest("#cgh-root, #cgh-composer-bar, #cgh-fab")) continue;
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/c\/([a-z0-9-]{8,})/i);
        if (!m || seen.has(m[1])) continue;
        if (/\/(share|g|gp|project)\//i.test(href) && !/\/c\//.test(href)) continue;
        seen.add(m[1]);
        const title = (a.textContent || "").replace(/\s+/g, " ").trim() || CGH.t?.untitledChat || "Untitled";
        out.push({ id: m[1], title, href: `/c/${m[1]}` });
      }
      return out;
    },

    async waitUntil(predicate, { timeout = 60000, interval = 200 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await predicate()) return true;
        await CGH.sleep(interval);
      }
      return false;
    },

    async waitForGenerationStart({ timeout = 20000 } = {}) {
      return this.waitUntil(() => this.isGenerating(), { timeout, interval: 150 });
    },

    async waitForIdle({ timeout = 300000, stableMs = 900 } = {}) {
      const start = Date.now();
      let idleSince = 0;
      while (Date.now() - start < timeout) {
        if (this.isGenerating()) {
          idleSince = 0;
        } else {
          if (!idleSince) idleSince = Date.now();
          if (Date.now() - idleSince >= stableMs) return true;
        }
        await CGH.sleep(200);
      }
      return false;
    },

    async waitForTurnComplete(msgCountBefore, { timeout = 300000 } = {}) {
      // 1) Generation must start OR a new message must appear.
      const started = await this.waitUntil(
        () => this.isGenerating() || this.getMessages().length > msgCountBefore,
        { timeout: 25000, interval: 150 }
      );
      if (!started) return false;

      // 2) Wait until streaming ends and stays idle.
      const idle = await this.waitForIdle({ timeout, stableMs: 1000 });
      if (!idle) return false;

      // 3) Prefer seeing a new turn; if UI virtualizes, idle after start is enough.
      await CGH.sleep(300);
      return true;
    },

    composerAttachRoot() {
      const composer = this.getComposer();
      const form = this.getForm();
      return form || composer?.closest("form") || composer?.parentElement || null;
    },

    attachmentNames() {
      const root = this.composerAttachRoot();
      if (!root) return [];
      const names = [];
      const push = (raw) => {
        const name = String(raw || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!name || name.length > 220) return;
        if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
      };

      const fileRemove = root.querySelectorAll(
        'button[aria-label*="Remove file" i], button[aria-label*="Remove image" i], button[aria-label*="Remove photo" i], button[aria-label*="Remove upload" i], button[aria-label*="Удалить файл" i], button[aria-label*="Удалить изображение" i], button[aria-label*="Удалить фото" i]'
      );
      for (const btn of fileRemove) {
        const label = btn.getAttribute("aria-label") || "";
        const m =
          label.match(/(?:remove|delete)\s+(?:file|image|photo|upload)\s+(.+)/i) ||
          label.match(/удалить\s+(?:файл|изображение|фото)\s+(.+)/i);
        if (m?.[1]) {
          push(m[1]);
          continue;
        }
        const cluster =
          btn.closest('[data-testid*="attachment"], [data-testid*="file-preview"], [data-testid*="file-thumbnail"], [data-testid*="composer-file"]') ||
          btn.parentElement;
        const titled = cluster?.querySelector?.("[title]");
        if (titled?.getAttribute("title")) push(titled.getAttribute("title"));
        else {
          const text = (cluster?.textContent || "").replace(/\s+/g, " ").trim();
          if (text && text.length < 180 && /\.[a-z0-9]{2,5}$/i.test(text)) push(text);
        }
      }

      for (const el of root.querySelectorAll(
        '[data-testid*="attachment"] [title], [data-testid*="file-preview"] [title], [data-testid*="file-thumbnail"] [title], [data-testid*="composer-file"] [title]'
      )) {
        const title = el.getAttribute("title") || "";
        if (/\.[a-z0-9]{2,5}$/i.test(title)) push(title);
      }

      return names.filter((n) => !/^(remove|delete|удалить)\b/i.test(n));
    },

    attachmentCount() {
      const names = this.attachmentNames();
      if (names.length) return names.length;
      const root = this.composerAttachRoot();
      if (!root) return 0;
      const nodes = root.querySelectorAll(
        [
          '[data-testid*="attachment"]',
          '[data-testid*="file-preview"]',
          '[data-testid*="file-thumbnail"]',
          '[data-testid*="composer-file"]',
          'button[aria-label*="Remove file" i]',
          'button[aria-label*="Remove image" i]',
          'button[aria-label*="Remove photo" i]',
          'button[aria-label*="Remove upload" i]',
          'button[aria-label*="Удалить файл" i]',
          'button[aria-label*="Удалить изображение" i]',
          'button[aria-label*="Удалить фото" i]',
        ].join(", ")
      );
      let n = 0;
      const seen = new Set();
      for (const el of nodes) {
        const key = el.closest("[data-testid]") || el;
        if (seen.has(key)) continue;
        seen.add(key);
        n += 1;
      }
      if (n) return n;
      const imgs = [...root.querySelectorAll("img")].filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width >= 28 && r.height >= 28 && r.width <= 280;
      });
      return imgs.length;
    },

    _disclaimerDone: false,

    hideDisclaimer() {
      // Cheap exit — full DOM scan is expensive and caused lag.
      if (this._disclaimerDone && document.querySelector("[data-cgh-disclaimer-hidden='1']")) {
        return true;
      }

      const re = /chatgpt can make mistakes/i;
      const kill = (el) => {
        if (!el || el.dataset?.cghDisclaimerHidden === "1") return;
        el.dataset.cghDisclaimerHidden = "1";
        el.classList.add("cgh-hide-disclaimer");
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("height", "0", "important");
        el.style.setProperty("max-height", "0", "important");
        el.style.setProperty("overflow", "hidden", "important");
        el.style.setProperty("margin", "0", "important");
        el.style.setProperty("padding", "0", "important");
        el.setAttribute("aria-hidden", "true");
      };

      // Scope search near the composer — not the whole document.
      const form = this.getForm();
      const roots = [form?.parentElement, form?.parentElement?.parentElement, document.querySelector("main")].filter(
        Boolean
      );
      const scopes = roots.length ? roots : [document.body];
      let found = false;

      for (const root of scopes) {
        const nodes = root.querySelectorAll("div, span, p");
        for (const el of nodes) {
          if (el.id === "cgh-composer-bar" || el.closest?.("#cgh-composer-bar")) continue;
          // textContent on large trees is costly — skip fat containers early.
          if (el.childElementCount > 6) continue;
          const text = (el.textContent || "").trim();
          if (!re.test(text) || text.length > 160) continue;
          kill(el);
          let parent = el.parentElement;
          for (let i = 0; i < 3 && parent; i++) {
            if (parent.childElementCount > 8) break;
            const pText = (parent.textContent || "").trim();
            if (pText.length <= 180 && re.test(pText)) kill(parent);
            parent = parent.parentElement;
          }
          found = true;
        }
        if (found) break;
      }

      if (found) this._disclaimerDone = true;
      return found;
    },
  };
})();


