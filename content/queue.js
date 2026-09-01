(() => {
  const CGH = (window.CGH = window.CGH || {});
  const pendingFiles = [];
  let processing = false;
  let fileHooksInstalled = false;
  let captureSuspended = 0;
  let lastCaptureAt = 0;
  let lastBatch = [];

  function sameFile(a, b) {
    return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  }

  function nameMatches(fileName, label) {
    const a = String(fileName || "").toLowerCase().trim();
    const b = String(label || "").toLowerCase().trim();
    if (!a || !b) return false;
    if (a === b) return true;
    if (b.includes(a) || a.includes(b)) return true;
    const base = a.replace(/\.[a-z0-9]+$/i, "");
    const labelBase = b.replace(/\.[a-z0-9]+$/i, "");
    return !!base && (b.includes(base) || base.includes(labelBase));
  }

  function isExtensionInput(el) {
    return !!(el?.closest?.("#cgh-root, #cgh-composer-bar"));
  }

  function captureFiles(list, { replace = false } = {}) {
    if (captureSuspended) return;
    if (replace) pendingFiles.length = 0;
    const batch = [];
    for (const file of list || []) {
      if (!file) continue;
      if (!file.size && !file.type?.startsWith("image/")) continue;
      if (!pendingFiles.some((p) => sameFile(p, file))) {
        pendingFiles.push(file);
        batch.push(file);
      } else if (replace) {
        batch.push(file);
      }
    }
    if (batch.length || replace) {
      lastBatch = batch.length ? batch : [...pendingFiles];
      lastCaptureAt = Date.now();
      CGH.composerBar?.update();
    }
  }

  function filesFromClipboard(e) {
    const out = [];
    if (e.clipboardData?.files?.length) out.push(...e.clipboardData.files);
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
    return out;
  }

  function collectInputFiles() {
    const out = [];
    for (const input of CGH.dom.getFileInputs?.() || []) {
      for (const file of input.files || []) {
        if (!file) continue;
        if (!out.some((p) => sameFile(p, file))) out.push(file);
      }
    }
    return out;
  }

  function clearPending() {
    pendingFiles.length = 0;
    lastBatch = [];
    lastCaptureAt = 0;
  }

  /** Only files currently shown in the composer — never the whole stale FileList. */
  function snapshotPendingForEnqueue() {
    const count = CGH.dom.attachmentCount?.() || 0;
    const names = CGH.dom.attachmentNames?.() || [];
    const candidates = [];
    const add = (file) => {
      if (!file) return;
      if (!file.size && !file.type?.startsWith("image/")) return;
      if (!candidates.some((p) => sameFile(p, file))) candidates.push(file);
    };
    for (const f of pendingFiles) add(f);
    if (count > 0 || names.length) {
      for (const f of collectInputFiles()) add(f);
    }

    let chosen = [];
    if (names.length) {
      for (const name of names) {
        const hit = candidates.find((f) => nameMatches(f.name, name));
        if (hit && !chosen.some((c) => sameFile(c, hit))) chosen.push(hit);
      }
    }

    if (!chosen.length && count > 0) {
      chosen = candidates.slice(-count);
    }

    if (!chosen.length && lastBatch.length && Date.now() - lastCaptureAt < 15000) {
      chosen = lastBatch.slice();
    }

    if (!chosen.length) {
      if (!count) clearPending();
      return [];
    }

    const limit = names.length || count || chosen.length;
    if (limit > 0 && chosen.length > limit) chosen = chosen.slice(-limit);

    pendingFiles.length = 0;
    pendingFiles.push(...chosen);
    return chosen.slice();
  }

  function isFileRemoveButton(btn) {
    const label = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""}`.toLowerCase();
    return /remove (file|image|photo|upload)|удалить (файл|изображение|фото)/i.test(label);
  }

  async function withCaptureSuspended(fn) {
    captureSuspended += 1;
    try {
      return await fn();
    } finally {
      captureSuspended = Math.max(0, captureSuspended - 1);
    }
  }

  function installFileHooks() {
    if (fileHooksInstalled) return;
    fileHooksInstalled = true;
    document.addEventListener(
      "change",
      (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || t.type !== "file" || !t.files?.length) return;
        if (isExtensionInput(t) || captureSuspended) return;
        captureFiles(t.files);
      },
      true
    );
    document.addEventListener(
      "drop",
      (e) => {
        if (captureSuspended || !e.dataTransfer?.files?.length) return;
        captureFiles(e.dataTransfer.files);
      },
      true
    );
    document.addEventListener(
      "paste",
      (e) => {
        if (captureSuspended) return;
        const files = filesFromClipboard(e);
        if (files.length) captureFiles(files);
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.("button");
        if (!btn || !isFileRemoveButton(btn)) return;
        const name = `${btn.getAttribute("aria-label") || ""} ${btn.parentElement?.textContent || ""}`;
        const idx = pendingFiles.findIndex((f) => f.name && name.includes(f.name));
        if (idx >= 0) pendingFiles.splice(idx, 1);
        setTimeout(() => {
          if (!CGH.dom.attachmentCount?.()) clearPending();
          CGH.composerBar?.update();
        }, 120);
        CGH.composerBar?.update();
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
    const convId = conversationId || CGH.dom.getConversationId() || null;
    const item = {
      id: CGH.uuid(),
      text: text || "",
      files: metas,
      status: "pending",
      createdAt: Date.now(),
      conversationId: convId,
      conversationTitle: convId ? CGH.dom.getConversationTitle() : "",
      error: "",
    };
    const queue = await getQueue();
    queue.push(item);
    await setQueue(queue);
    return item;
  }

  async function bindNullPendingTo(conversationId) {
    if (!conversationId) return;
    const queue = await getQueue();
    let changed = false;
    const title = CGH.dom.getConversationTitle();
    for (const item of queue) {
      if ((item.status === "pending" || item.status === "sending") && !item.conversationId) {
        item.conversationId = conversationId;
        if (!item.conversationTitle) item.conversationTitle = title;
        changed = true;
      }
    }
    if (changed) await setQueue(queue);
  }

  async function recoverStuckSending() {
    const queue = await getQueue();
    let changed = false;
    for (const item of queue) {
      if (item.status === "sending") {
        item.status = "pending";
        item.error = "";
        changed = true;
      }
    }
    if (changed) await setQueue(queue);
  }

  /** Stay on the chat where the item was queued — never dump prompts into another thread. */
  async function ensureOnConversation(item) {
    const target = item.conversationId || null;
    const current = CGH.dom.getConversationId();

    if (!target) {
      // Queued from a brand-new chat: do not send inside some other existing chat.
      if (current) return false;
      return true;
    }

    if (current === target) return true;

    const link =
      document.querySelector(`a[href="/c/${target}"]`) ||
      document.querySelector(`a[href*="/c/${target}"]`);

    if (link) {
      link.click();
      const ok = await CGH.dom.waitUntil(() => CGH.dom.getConversationId() === target, {
        timeout: 20000,
        interval: 200,
      });
      if (ok) {
        await CGH.sleep(900);
        return CGH.dom.getConversationId() === target;
      }
    }

    try {
      sessionStorage.setItem("cgh-queue-resume", "1");
    } catch {
      /* ignore */
    }
    location.assign(`/c/${target}`);
    return false;
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
    const onChat = await ensureOnConversation(item);
    if (!onChat) {
      const err = new Error("CGH_WRONG_CHAT");
      err.code = "CGH_WRONG_CHAT";
      throw err;
    }

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
      // Programmatic attach fires input.change — must not leak into the next queue item.
      await withCaptureSuspended(() => CGH.dom.attachFiles(files));
      clearPending();
      await CGH.dom.waitUntil(
        () => CGH.dom.attachmentCount() > 0 || CGH.dom.getFileInput()?.files?.length > 0,
        { timeout: 10000, interval: 150 }
      );
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

    const liveId = CGH.dom.getConversationId();
    await updateItem(item.id, {
      status: "done",
      finishedAt: Date.now(),
      conversationId: liveId || item.conversationId || null,
      conversationTitle: liveId ? CGH.dom.getConversationTitle() : item.conversationTitle || "",
    });
    if (liveId && !item.conversationId) await bindNullPendingTo(liveId);

    for (const f of item.files || []) await CGH.storage.deleteFile(f.id);
    clearPending();
    CGH.dom.resetFileInput?.();
  }

  async function tryProcess() {
    // Works on a background ChatGPT tab too — do not bail on document.hidden.
    if (processing) return;
    if (CGH.extensionAlive === false) return;
    const { queuePaused, settings } = await CGH.storage.get(["queuePaused", "settings"]);
    if (queuePaused || settings?.autoProcess === false) return;
    if (CGH.dom.isGenerating()) return;

    const queue = await getQueue();
    const currentId = CGH.dom.getConversationId();
    // Prefer an item that belongs to the current chat; otherwise the next pending (will navigate).
    const next =
      queue.find((i) => i.status === "pending" && i.conversationId && i.conversationId === currentId) ||
      queue.find((i) => i.status === "pending" && !i.conversationId && !currentId) ||
      queue.find((i) => i.status === "pending" && i.conversationId) ||
      queue.find((i) => i.status === "pending");
    if (!next) return;

    processing = true;
    try {
      await sendItem(next);
    } catch (err) {
      if (err?.code === "CGH_WRONG_CHAT" || err?.message === "CGH_WRONG_CHAT") {
        // Navigating back to the original chat (or waiting until we can). Keep pending.
        console.info("CGH queue: switching back to the item's chat");
      } else {
        console.warn("CGH queue", err);
        clearPending();
        CGH.dom.resetFileInput?.();
        await updateItem(next.id, { status: "error", error: err?.message || String(err) });
        CGH.panel?.toast(`${CGH.t.error}: ${err?.message || err}`, "error");
      }
    } finally {
      processing = false;
    }
    // Give the UI a beat before the next prompt — avoids cancel races.
    setTimeout(() => tryProcess(), 1200);
  }

  CGH.queue = {
    pendingFiles,
    captureFiles,
    installFileHooks,
    tryProcess,
    enqueue,
    getPendingSnapshot() {
      return snapshotPendingForEnqueue();
    },
    clearPending,
    pendingCount() {
      return 0;
    },

    async enqueueFromComposer({ keep = false } = {}) {
      const text = CGH.dom.getComposerText().trim();
      const files = snapshotPendingForEnqueue();
      const attached = CGH.dom.attachmentCount?.() > 0;
      if (!text && !files.length) {
        CGH.panel?.toast(CGH.t.emptyPrompt, "error");
        return null;
      }
      if (attached && !files.length) {
        CGH.panel?.toast(CGH.t.filesNotCaptured || "Не удалось перехватить фото", "error");
      }
      const taken = files.slice();
      clearPending();
      const clones = [];
      try {
        for (const f of taken) {
          clones.push(new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified }));
        }
      } catch (err) {
        console.warn("CGH clone files", err);
        CGH.panel?.toast(CGH.t.storageFull || err?.message || String(err), "error");
        return null;
      }
      let item;
      try {
        item = await enqueue({ text, files: clones });
      } catch (err) {
        console.warn("CGH enqueue files", err);
        CGH.panel?.toast(err?.message || CGH.t.storageFull || String(err), "error");
        return null;
      }
      if (!keep) {
        await withCaptureSuspended(async () => {
          await CGH.dom.clearComposer();
          CGH.dom.resetFileInput?.();
        });
        clearPending();
      }
      CGH.panel?.toast(taken.length ? CGH.t.queuedWithFiles || CGH.t.queued : CGH.t.queued, "ok");
      CGH.composerBar?.update();
      CGH.runtime?.sendMessage?.({ type: "QUEUE_WAKE" });
      tryProcess();
      return item;
    },

    async init() {
      installFileHooks();
      await recoverStuckSending();
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
        // Kick again when the tab becomes visible or when returning from sleep/throttle.
        tryProcess();
      });
      try {
        if (sessionStorage.getItem("cgh-queue-resume") === "1") {
          sessionStorage.removeItem("cgh-queue-resume");
          setTimeout(() => tryProcess(), 800);
        }
      } catch {
        /* ignore */
      }
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
            item.conversationId || item.conversationTitle
              ? CGH.el(
                  "p",
                  { class: "cgh-muted" },
                  item.conversationTitle || `Chat ${String(item.conversationId).slice(0, 8)}…`
                )
              : CGH.el("p", { class: "cgh-muted" }, CGH.t.newChat || "New chat"),
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
