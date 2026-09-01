(() => {
  const CGH = (window.CGH = window.CGH || {});
  const pendingFiles = [];
  let processing = false;
  let fileHooksInstalled = false;

  function sameFile(a, b) {
    return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  }

  function captureFiles(list) {
    for (const file of list || []) {
      if (!file || !file.size) continue;
      if (!pendingFiles.some((p) => sameFile(p, file))) pendingFiles.push(file);
    }
    CGH.composerBar?.update();
  }

  function syncPendingFromDom() {
    const form = CGH.dom.getForm();
    if (!form) return;
    const names = [...form.querySelectorAll("[title], [aria-label], span, p")]
      .map((n) => (n.getAttribute("title") || n.textContent || "").trim())
      .filter((t) => t && t.length < 180);
    if (!names.length) return;
    for (let i = pendingFiles.length - 1; i >= 0; i--) {
      const f = pendingFiles[i];
      if (!names.some((n) => n.includes(f.name) || f.name.includes(n))) {
        // keep — ChatGPT often doesn't show the raw filename
      }
    }
  }

  function installFileHooks() {
    if (fileHooksInstalled) return;
    fileHooksInstalled = true;
    document.addEventListener(
      "change",
      (e) => {
        const t = e.target;
        if (t instanceof HTMLInputElement && t.type === "file" && t.files?.length) {
          captureFiles(t.files);
        }
      },
      true
    );
    document.addEventListener(
      "drop",
      (e) => {
        if (e.dataTransfer?.files?.length) captureFiles(e.dataTransfer.files);
      },
      true
    );
    document.addEventListener(
      "paste",
      (e) => {
        const files = [...(e.clipboardData?.files || [])];
        if (files.length) captureFiles(files);
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.("button");
        if (!btn) return;
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (/remove (file|image|photo)|удалить/.test(label)) {
          const name = (btn.getAttribute("aria-label") || "") + " " + (btn.parentElement?.textContent || "");
          const idx = pendingFiles.findIndex((f) => name.includes(f.name));
          if (idx >= 0) pendingFiles.splice(idx, 1);
          setTimeout(syncPendingFromDom, 80);
          CGH.composerBar?.update();
        }
      },
      true
    );
  }

  async function getQueue() {
    return (await CGH.storage.get("queue")) || [];
  }

  async function setQueue(queue) {
    await CGH.storage.set({ queue });
    const pending = queue.filter((i) => i.status === "pending" || i.status === "sending").length;
    CGH.runtime?.sendMessage?.({ type: "QUEUE_COUNT", count: pending });
    CGH.composerBar?.update();
    CGH.panel?.updateFab();
    if (CGH.panel?.isOpen?.() && CGH.panel.currentTab === "queue") CGH.panel.refresh();
  }

  async function enqueue({ text, files, conversationId }) {
    const metas = [];
    for (const file of files || []) {
      metas.push(await CGH.storage.saveFile(file));
    }
    const item = {
      id: CGH.uuid(),
      text: text || "",
      files: metas,
      status: "pending",
      createdAt: Date.now(),
      conversationId: conversationId || CGH.dom.getConversationId(),
      error: "",
    };
    const queue = await getQueue();
    queue.push(item);
    await setQueue(queue);
    return item;
  }

  async function updateItem(id, patch) {
    const queue = await getQueue();
    const item = queue.find((i) => i.id === id);
    if (!item) return;
    Object.assign(item, patch);
    await setQueue(queue);
  }

  async function removeItem(id) {
    const queue = await getQueue();
    const item = queue.find((i) => i.id === id);
    if (item) {
      for (const f of item.files || []) await CGH.storage.deleteFile(f.id);
    }
    await setQueue(queue.filter((i) => i.id !== id));
  }

  async function moveItem(id, dir) {
    const queue = await getQueue();
    const i = queue.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= queue.length) return;
    [queue[i], queue[j]] = [queue[j], queue[i]];
    await setQueue(queue);
  }

  async function sendItem(item) {
    await updateItem(item.id, { status: "sending", error: "" });
    const files = [];
    for (const meta of item.files || []) {
      const file = await CGH.storage.loadFile(meta);
      if (file) files.push(file);
    }

    if (!CGH.dom.getComposer()) {
      throw new Error("Поле ввода недоступно");
    }

    // Never interrupt an in-flight answer.
    if (CGH.dom.isGenerating()) {
      const idle = await CGH.dom.waitForIdle({ timeout: 300000, stableMs: 1000 });
      if (!idle || CGH.dom.isGenerating()) throw new Error("ChatGPT ещё отвечает");
    }

    if (files.length) {
      await CGH.dom.attachFiles(files);
      await CGH.dom.waitUntil(
        () => CGH.dom.attachmentCount() > 0 || CGH.dom.getFileInput()?.files?.length > 0,
        { timeout: 10000, interval: 150 }
      );
      // Wait for upload + Send to become available (not Stop).
      const ready = await CGH.dom.waitForComposerReady({ timeout: 60000 });
      if (!ready) throw new Error("Файлы не успели загрузиться");
    }

    await CGH.dom.setComposerText(item.text || (files.length ? " " : ""));
    await CGH.sleep(250);

    const readyToSend = await CGH.dom.waitForComposerReady({ timeout: 20000 });
    if (!readyToSend) throw new Error("Кнопка Send недоступна");

    const msgCountBefore = CGH.dom.getMessages().length;
    const sent = await CGH.dom.clickSend();
    if (!sent) throw new Error("Не удалось нажать Send");

    // Wait for generation to start — do NOT click Send again (that hits Stop).
    const completed = await CGH.dom.waitForTurnComplete(msgCountBefore, { timeout: 300000 });
    if (!completed) throw new Error("Ответ не завершился вовремя");

    await updateItem(item.id, { status: "done", finishedAt: Date.now() });
    for (const f of item.files || []) await CGH.storage.deleteFile(f.id);
  }

  async function tryProcess() {
    if (processing || document.hidden) return;
    if (CGH.extensionAlive === false) return;
    const { queuePaused, settings } = await CGH.storage.get(["queuePaused", "settings"]);
    if (queuePaused || settings?.autoProcess === false) return;
    if (CGH.dom.isGenerating()) return;

    const queue = await getQueue();
    const next = queue.find((i) => i.status === "pending");
    if (!next) return;

    processing = true;
    try {
      await sendItem(next);
    } catch (err) {
      console.warn("CGH queue", err);
      await updateItem(next.id, { status: "error", error: err?.message || String(err) });
      CGH.panel?.toast(`${CGH.t.error}: ${err?.message || err}`, "error");
    } finally {
      processing = false;
    }
    // Give the UI a beat before the next prompt — avoids cancel races.
    if (!document.hidden) setTimeout(() => tryProcess(), 1200);
  }

  CGH.queue = {
    pendingFiles,
    captureFiles,
    installFileHooks,
    tryProcess,
    enqueue,
    getPendingSnapshot() {
      const input = CGH.dom.getFileInput();
      if (input?.files?.length) captureFiles(input.files);
      return pendingFiles.slice();
    },
    clearPending() {
      pendingFiles.length = 0;
    },
    pendingCount() {
      return 0;
    },

    async enqueueFromComposer({ keep = false } = {}) {
      const text = CGH.dom.getComposerText().trim();
      const files = this.getPendingSnapshot();
      if (!text && !files.length) {
        CGH.panel?.toast(CGH.t.emptyPrompt, "error");
        return null;
      }
      const clones = [];
      for (const f of files) clones.push(new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified }));
      const item = await enqueue({ text, files: clones });
      if (!keep) {
        await CGH.dom.clearComposer();
        this.clearPending();
      }
      CGH.panel?.toast(CGH.t.queued, "ok");
      CGH.composerBar?.update();
      tryProcess();
      return item;
    },

    async init() {
      installFileHooks();
      const queue = await getQueue();
      this.pendingCount = () => queue.filter((i) => i.status === "pending" || i.status === "sending").length;
      CGH.storage.onChange((changes) => {
        if (changes.queue) {
          const q = changes.queue.newValue || [];
          this.pendingCount = () => q.filter((i) => i.status === "pending" || i.status === "sending").length;
          CGH.panel?.updateFab();
          CGH.composerBar?.update();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tryProcess();
      });
    },

    tick() {
      tryProcess();
    },

    async render(root) {
      const [{ queue, queuePaused, settings }] = await Promise.all([CGH.storage.get(["queue", "queuePaused", "settings"])]);
      const pending = (queue || []).filter((i) => i.status !== "done");
      const done = (queue || []).filter((i) => i.status === "done");

      const toolbar = CGH.el(
        "div",
        { class: "cgh-toolbar" },
        CGH.el(
          "button",
          {
            class: "cgh-btn cgh-btn-primary",
            type: "button",
            onclick: () => this.enqueueFromComposer(),
          },
          CGH.svg(CGH.icons.plus, 14),
          CGH.t.fromInput
        ),
        CGH.el(
          "button",
          {
            class: "cgh-btn",
            type: "button",
            onclick: async () => {
              await CGH.storage.set({ queuePaused: !queuePaused });
              if (queuePaused) tryProcess();
              CGH.panel.refresh();
            },
          },
          CGH.svg(queuePaused ? CGH.icons.play : CGH.icons.pause, 14),
          queuePaused ? CGH.t.resume : CGH.t.pause
        ),
        CGH.el(
          "button",
          {
            class: "cgh-btn",
            type: "button",
            onclick: async () => {
              const q = await getQueue();
              const keep = q.filter((i) => i.status !== "done");
              await setQueue(keep);
            },
          },
          CGH.t.clearDone
        )
      );

      const hint = CGH.el(
        "p",
        { class: "cgh-hint" },
        queuePaused
          ? CGH.t.paused
          : settings?.autoProcess
            ? CGH.t.queueHintAuto
            : CGH.t.queueHintManual
      );

      if (!pending.length) {
        root.append(toolbar, hint, CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyQueue));
        return;
      }

      const list = CGH.el("div", { class: "cgh-list" });
      for (const item of pending) {
        list.append(
          CGH.el(
            "article",
            { class: `cgh-card is-${item.status}` },
            CGH.el(
              "div",
              { class: "cgh-card-top" },
              CGH.el(
                "span",
                { class: `cgh-status is-${item.status}` },
                item.status === "sending" ? CGH.t.processing : item.status === "error" ? CGH.t.error : CGH.t.waitingStatus
              ),
              CGH.el("span", { class: "cgh-muted" }, CGH.formatDate(item.createdAt))
            ),
            CGH.el("p", { class: "cgh-card-text" }, item.text || CGH.t.onlyAttachments),
            item.files?.length
              ? CGH.el(
                  "div",
                  { class: "cgh-file-row" },
                  ...item.files.map((f) => CGH.el("span", { class: "cgh-file-chip" }, `🖼 ${f.name}`))
                )
              : null,
            item.error ? CGH.el("p", { class: "cgh-error" }, item.error) : null,
            CGH.el(
              "div",
              { class: "cgh-card-actions" },
              CGH.el("button", { class: "cgh-icon-btn", type: "button", title: CGH.t.above, onclick: () => moveItem(item.id, -1) }, CGH.svg(CGH.icons.up, 14)),
              CGH.el("button", { class: "cgh-icon-btn", type: "button", title: CGH.t.below, onclick: () => moveItem(item.id, 1) }, CGH.svg(CGH.icons.down, 14)),
              item.status === "error"
                ? CGH.el(
                    "button",
                    {
                      class: "cgh-btn",
                      type: "button",
                      onclick: () => updateItem(item.id, { status: "pending", error: "" }).then(() => tryProcess()),
                    },
                    CGH.t.retry
                  )
                : null,
              CGH.el("button", { class: "cgh-icon-btn danger", type: "button", title: CGH.t.delete, onclick: () => removeItem(item.id) }, CGH.svg(CGH.icons.trash, 14))
            )
          )
        );
      }

      root.append(toolbar, hint, list);
      if (done.length) {
        root.append(CGH.el("p", { class: "cgh-muted cgh-done-count" }, `${CGH.t.doneCount}: ${done.length}`));
      }
    },
  };
})();
