(() => {
  const CGH = (window.CGH = window.CGH || {});
  const COLORS = ["#60a5fa", "#3b82f6", "#e3a008", "#ef4444", "#a855f7", "#14b8a6"];
  const PAGE = 100;
  const MAX_PAGES = 8;

  const ui = {
    activeFolder: "all",
    query: "",
    showFolderForm: false,
    editingFolderId: null,
    folderColor: COLORS[0],
    folderNameDraft: "",
    expandedId: null,
    pendingDeleteId: null,
    pendingFolderDelete: false,
    busyId: null,
    busyAction: "",
    loading: false,
    error: "",
  };

  let tokenCache = { token: "", at: 0 };
  let fetchGen = 0;
  let paintHook = null;

  function untitled() {
    return CGH.t?.untitledChat || "Untitled";
  }

  function toMs(value) {
    const n = Number(value) || 0;
    if (!n) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }

  async function accessToken() {
    if (tokenCache.token && Date.now() - tokenCache.at < 4 * 60 * 1000) return tokenCache.token;
    const res = await fetch("/api/auth/session", { credentials: "include" });
    if (!res.ok) throw new Error("session");
    const data = await res.json();
    tokenCache = { token: data?.accessToken || "", at: Date.now() };
    return tokenCache.token;
  }

  async function chatgptApi(path, { method = "GET", body } = {}) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    try {
      const token = await accessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* cookie session may still work */
    }
    const did = localStorage.getItem("oai-did") || localStorage.getItem("oai-device-id");
    if (did) headers["oai-device-id"] = did;
    if (navigator.language) headers["oai-language"] = navigator.language;

    const res = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      tokenCache = { token: "", at: 0 };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  function mapItem(it, archived) {
    const id = it?.id;
    if (!id) return null;
    const title = String(it.title || "").trim();
    return {
      id,
      title: title && title.toLowerCase() !== "new chat" ? title : untitled(),
      href: `/c/${id}`,
      updateTime: toMs(it.update_time || it.create_time),
      archived: !!(it.is_archived || archived),
    };
  }

  async function fetchPage(offset, limit, archived) {
    const q = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      order: "updated",
    });
    if (archived) q.set("is_archived", "true");
    return chatgptApi(`/backend-api/conversations?${q}`);
  }

  async function fetchPages(archived) {
    const items = [];
    let offset = 0;
    let limit = PAGE;
    for (let i = 0; i < MAX_PAGES; i++) {
      let data;
      try {
        data = await fetchPage(offset, limit, archived);
      } catch (err) {
        if (limit > 28) {
          limit = 28;
          data = await fetchPage(offset, limit, archived);
        } else {
          throw err;
        }
      }
      const batch = data?.items || data?.conversations || [];
      for (const it of batch) {
        const mapped = mapItem(it, archived);
        if (mapped) items.push(mapped);
      }
      offset += batch.length;
      const total = Number(data?.total);
      if (!batch.length || batch.length < limit || (Number.isFinite(total) && offset >= total)) break;
    }
    return items;
  }

  async function patchConversation(id, body) {
    return chatgptApi(`/backend-api/conversation/${id}`, { method: "PATCH", body });
  }

  async function patchMeta(id, extra) {
    const all = { ...((await CGH.storage.get("conversationMeta")) || {}) };
    all[id] = { ...(all[id] || {}), ...extra };
    await CGH.storage.set({ conversationMeta: all });
    return all;
  }

  function convFieldFocused() {
    const active = CGH.panel?.shadow?.activeElement;
    return !!active?.closest?.(".cgh-conv-card, .cgh-folder-form");
  }

  function rememberCurrent() {
    const id = CGH.dom.getConversationId();
    if (!id) return;
    const title = CGH.dom.getConversationTitle();
    CGH.storage.get("conversationMeta").then((meta) => {
      const next = { ...(meta || {}) };
      next[id] = {
        ...(next[id] || {}),
        title,
        lastVisited: Date.now(),
      };
      CGH.storage.set({ conversationMeta: next });
    });
  }

  function mergeLists(meta) {
    const map = new Map();
    const archivedIds = new Set((CGH.conversations.archivedList || []).map((c) => c.id));
    const add = (chat, archived) => {
      if (!chat?.id) return;
      const prev = map.get(chat.id) || {};
      map.set(chat.id, {
        ...prev,
        ...chat,
        title: chat.title || prev.title || untitled(),
        href: chat.href || prev.href || `/c/${chat.id}`,
        archived: archived ?? chat.archived ?? prev.archived ?? false,
        updateTime: Math.max(chat.updateTime || 0, prev.updateTime || 0),
      });
    };

    for (const c of CGH.conversations.activeList || []) add(c, false);
    for (const c of CGH.conversations.sidebar || []) {
      if (!archivedIds.has(c.id)) add(c, false);
    }
    for (const c of CGH.conversations.archivedList || []) add(c, true);

    const currentId = CGH.dom.getConversationId();
    if (currentId && !map.has(currentId)) {
      add(
        {
          id: currentId,
          title: CGH.dom.getConversationTitle(),
          href: `/c/${currentId}`,
          updateTime: Date.now(),
        },
        false
      );
    }

    for (const [id, m] of Object.entries(meta || {})) {
      if (map.has(id)) {
        const cur = map.get(id);
        if (m.title && (!cur.title || cur.title === untitled())) cur.title = m.title;
        continue;
      }
      const keep = m.starred || m.folderId || (m.tags && m.tags.length) || m.notes;
      if (!keep) continue;
      add(
        {
          id,
          title: m.title || untitled(),
          href: `/c/${id}`,
          updateTime: m.lastVisited || 0,
        },
        false
      );
    }
    return [...map.values()];
  }

  CGH.conversations = {
    sidebar: [],
    activeList: [],
    archivedList: [],
    apiOk: false,

    scrape({ paint = false } = {}) {
      this.sidebar = CGH.dom.scrapeSidebarConversations();
      rememberCurrent();
      if (paint && !convFieldFocused()) paintHook?.();
    },

    async refresh({ silent = false } = {}) {
      this.scrape();
      const gen = ++fetchGen;
      if (!silent) {
        ui.loading = true;
        ui.error = "";
        paintHook?.();
      }
      try {
        const [active, archived] = await Promise.all([fetchPages(false), fetchPages(true)]);
        if (gen !== fetchGen) return;
        this.activeList = active;
        this.archivedList = archived;
        this.apiOk = true;
        ui.error = "";
        const meta = (await CGH.storage.get("conversationMeta")) || {};
        const next = { ...meta };
        let dirty = false;
        for (const chat of [...active, ...archived]) {
          if (!next[chat.id]) continue;
          if (chat.title && next[chat.id].title !== chat.title) {
            next[chat.id] = { ...next[chat.id], title: chat.title };
            dirty = true;
          }
        }
        if (dirty) await CGH.storage.set({ conversationMeta: next });
      } catch (err) {
        if (gen !== fetchGen) return;
        this.apiOk = false;
        this.activeList = this.sidebar.slice();
        ui.error = CGH.t.chatsLoadFailed;
        console.warn("CGH conversations", err);
      } finally {
        if (gen === fetchGen) {
          ui.loading = false;
          if (!silent || !convFieldFocused()) paintHook?.();
        }
      }
    },

    async init() {
      this.scrape();
    },

    async render(root) {
      const stored = await CGH.storage.get(["folders", "conversationMeta"]);
      let folderList = stored.folders || [];
      let meta = stored.conversationMeta || {};
      ui.pendingDeleteId = null;
      ui.pendingFolderDelete = false;

      const toolbar = CGH.el("div", { class: "cgh-toolbar" });
      const search = CGH.el("input", {
        class: "cgh-input",
        placeholder: CGH.t.searchPlaceholder,
        value: ui.query,
      });
      const chipsHost = CGH.el("div", { class: "cgh-chip-row" });
      const folderHost = CGH.el("div");
      const hint = CGH.el("p", { class: "cgh-hint" });
      const list = CGH.el("div", { class: "cgh-list" });

      search.addEventListener("input", () => {
        ui.query = search.value;
        paintList();
      });

      const paintToolbar = () => {
        const count = mergeLists(meta).filter((c) => !c.archived).length;
        toolbar.className = "cgh-toolbar cgh-conv-toolbar";
        toolbar.replaceChildren(
          CGH.el(
            "button",
            {
              class: "cgh-btn cgh-btn-primary",
              type: "button",
              disabled: ui.loading,
              onclick: () => CGH.conversations.refresh(),
            },
            CGH.svg(CGH.icons.refresh, 14),
            ui.loading ? CGH.t.loadingChats : CGH.t.refresh
          ),
          CGH.el(
            "span",
            {
              class: "cgh-count-badge",
              title: `${count} ${CGH.t.chatsCount}`,
            },
            CGH.el("strong", {}, String(count)),
            CGH.el("span", {}, CGH.t.chatsCount)
          )
        );
      };

      const paintHint = () => {
        hint.textContent = ui.error || (CGH.conversations.apiOk ? CGH.t.chatsHint : CGH.t.chatsSidebarHint);
        hint.className = ui.error ? "cgh-error" : "cgh-hint";
      };

      const paintChips = () => {
        const filters = [
          { id: "all", name: CGH.t.allChats },
          { id: "starred", name: "★ " + CGH.t.starred },
          { id: "unfiled", name: CGH.t.unfiled },
          { id: "archived", name: CGH.t.archivedChats },
          ...folderList,
        ];
        chipsHost.replaceChildren(
          ...filters.map((f) =>
            CGH.el(
              "button",
              {
                class: `cgh-chip ${ui.activeFolder === f.id ? "is-active" : ""}`,
                type: "button",
                style: f.color ? { borderColor: f.color } : {},
                onclick: () => {
                  ui.activeFolder = f.id;
                  ui.pendingFolderDelete = false;
                  paintChips();
                  paintFolder();
                  paintList();
                },
              },
              f.name
            )
          ),
          CGH.el(
            "button",
            {
              class: "cgh-chip",
              type: "button",
              onclick: () => {
                ui.editingFolderId = null;
                ui.folderNameDraft = "";
                ui.folderColor = COLORS[folderList.length % COLORS.length];
                ui.showFolderForm = !ui.showFolderForm;
                ui.pendingFolderDelete = false;
                paintFolder();
              },
            },
            CGH.t.addFolder
          )
        );
      };

      const paintFolder = () => {
        folderHost.replaceChildren();
        if (ui.showFolderForm) {
          const editing = folderList.find((f) => f.id === ui.editingFolderId);
          const nameInput = CGH.el("input", {
            class: "cgh-input",
            placeholder: CGH.t.folderNamePlaceholder,
            value: ui.folderNameDraft || editing?.name || "",
          });
          nameInput.addEventListener("input", () => {
            ui.folderNameDraft = nameInput.value;
          });
          const colors = CGH.el("div", { class: "cgh-color-row" });
          const paintColors = () => {
            colors.replaceChildren(
              ...COLORS.map((color) =>
                CGH.el("button", {
                  class: `cgh-color-dot ${ui.folderColor === color ? "is-on" : ""}`,
                  type: "button",
                  style: { background: color },
                  title: color,
                  onclick: () => {
                    ui.folderColor = color;
                    paintColors();
                  },
                })
              )
            );
          };
          paintColors();
          folderHost.append(
            CGH.el(
              "form",
              {
                class: "cgh-form cgh-folder-form",
                onsubmit: async (e) => {
                  e.preventDefault();
                  const name = nameInput.value.trim();
                  if (!name) {
                    nameInput.focus();
                    return;
                  }
                  if (ui.editingFolderId) {
                    folderList = folderList.map((f) =>
                      f.id === ui.editingFolderId
                        ? { ...f, name, color: ui.folderColor || f.color || COLORS[0] }
                        : f
                    );
                    await CGH.storage.set({ folders: folderList });
                    ui.activeFolder = ui.editingFolderId;
                    CGH.panel?.toast(CGH.t.folderUpdated);
                  } else {
                    const created = {
                      id: CGH.uuid(),
                      name,
                      color: ui.folderColor || COLORS[0],
                    };
                    folderList = folderList.concat(created);
                    await CGH.storage.set({ folders: folderList });
                    ui.activeFolder = created.id;
                    CGH.panel?.toast(CGH.t.folderCreated);
                  }
                  ui.showFolderForm = false;
                  ui.editingFolderId = null;
                  ui.folderNameDraft = "";
                  paintChips();
                  paintFolder();
                  paintList();
                },
              },
              CGH.el("div", { class: "cgh-folder-form-title" }, editing ? CGH.t.editFolder : CGH.t.newFolder),
              nameInput,
              colors,
              CGH.el(
                "div",
                { class: "cgh-toolbar" },
                CGH.el("button", { class: "cgh-btn cgh-btn-primary", type: "submit" }, CGH.t.save),
                CGH.el(
                  "button",
                  {
                    class: "cgh-btn",
                    type: "button",
                    onclick: () => {
                      ui.showFolderForm = false;
                      ui.editingFolderId = null;
                      ui.folderNameDraft = "";
                      paintFolder();
                    },
                  },
                  CGH.t.cancel
                )
              )
            )
          );
        }

        const custom = folderList.find((f) => f.id === ui.activeFolder);
        if (custom && !ui.showFolderForm) {
          if (ui.pendingFolderDelete) {
            folderHost.append(
              CGH.el(
                "div",
                { class: "cgh-confirm-row" },
                CGH.el("span", {}, CGH.t.deleteFolderConfirm),
                CGH.el(
                  "button",
                  {
                    class: "cgh-btn cgh-btn-danger",
                    type: "button",
                    onclick: async () => {
                      const id = custom.id;
                      folderList = folderList.filter((f) => f.id !== id);
                      const all = { ...((await CGH.storage.get("conversationMeta")) || {}) };
                      for (const item of Object.values(all)) {
                        if (item.folderId === id) item.folderId = null;
                      }
                      await CGH.storage.set({ folders: folderList, conversationMeta: all });
                      meta = all;
                      ui.activeFolder = "all";
                      ui.pendingFolderDelete = false;
                      CGH.panel?.toast(CGH.t.deleted);
                      paintChips();
                      paintFolder();
                      paintList();
                    },
                  },
                  CGH.t.delete
                ),
                CGH.el(
                  "button",
                  {
                    class: "cgh-btn",
                    type: "button",
                    onclick: () => {
                      ui.pendingFolderDelete = false;
                      paintFolder();
                    },
                  },
                  CGH.t.cancel
                )
              )
            );
          } else {
            folderHost.append(
              CGH.el(
                "div",
                { class: "cgh-toolbar cgh-folder-actions" },
                CGH.el(
                  "button",
                  {
                    class: "cgh-btn",
                    type: "button",
                    onclick: () => {
                      ui.editingFolderId = custom.id;
                      ui.folderNameDraft = custom.name || "";
                      ui.folderColor = custom.color || COLORS[0];
                      ui.showFolderForm = true;
                      ui.pendingFolderDelete = false;
                      paintFolder();
                    },
                  },
                  CGH.svg(CGH.icons.pencil, 14),
                  CGH.t.editFolder
                ),
                CGH.el(
                  "button",
                  {
                    class: "cgh-btn cgh-btn-danger",
                    type: "button",
                    onclick: () => {
                      ui.pendingFolderDelete = true;
                      paintFolder();
                    },
                  },
                  CGH.svg(CGH.icons.trash, 14),
                  CGH.t.deleteFolder
                )
              )
            );
          }
        }
      };

      const paintList = () => {
        const currentId = CGH.dom.getConversationId();
        const chats = mergeLists(meta).filter((c) => {
          const m = meta[c.id] || {};
          if (ui.activeFolder === "archived") return !!c.archived;
          if (c.archived) return false;
          if (ui.activeFolder === "starred" && !m.starred) return false;
          if (ui.activeFolder === "unfiled" && m.folderId) return false;
          if (
            ui.activeFolder !== "all" &&
            ui.activeFolder !== "starred" &&
            ui.activeFolder !== "unfiled" &&
            ui.activeFolder !== "archived" &&
            m.folderId !== ui.activeFolder
          ) {
            return false;
          }
          if (ui.query) {
            const hay = `${c.title} ${m.notes || ""} ${(m.tags || []).join(" ")}`.toLowerCase();
            if (!hay.includes(ui.query.toLowerCase())) return false;
          }
          return true;
        });
        chats.sort(
          (a, b) =>
            (b.updateTime || meta[b.id]?.lastVisited || 0) - (a.updateTime || meta[a.id]?.lastVisited || 0)
        );

        list.replaceChildren();
        if (!chats.length) {
          list.append(CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyConversations));
          paintToolbar();
          return;
        }

        for (const chat of chats) {
          const m = meta[chat.id] || {};
          const expanded = ui.expandedId === chat.id;
          const pendingDel = ui.pendingDeleteId === chat.id;
          const busy = ui.busyId === chat.id;
          const busyDelete = busy && ui.busyAction === "delete";
          const busyArchive = busy && (ui.busyAction === "archive" || ui.busyAction === "unarchive");

          const folderSelect = CGH.el("select", {
            class: "cgh-select cgh-conv-select",
            title: CGH.t.folder,
            disabled: busy,
          });
          folderSelect.append(new Option(CGH.t.folderPlaceholder, ""));
          for (const f of folderList) folderSelect.append(new Option(f.name, f.id));
          folderSelect.value = m.folderId || "";
          folderSelect.addEventListener("change", async () => {
            meta = await patchMeta(chat.id, { folderId: folderSelect.value || null, title: chat.title });
            paintList();
          });

          const tags = CGH.el("input", {
            class: "cgh-input cgh-conv-tags",
            placeholder: CGH.t.tagsPlaceholder,
            value: (m.tags || []).join(", "),
            title: CGH.t.tags,
            disabled: busy,
          });
          tags.addEventListener("change", async () => {
            meta = await patchMeta(chat.id, {
              tags: tags.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              title: chat.title,
            });
          });

          const notes = CGH.el("textarea", {
            class: "cgh-input cgh-textarea cgh-notes",
            placeholder: CGH.t.notes,
            rows: "2",
            disabled: busy,
          });
          notes.value = m.notes || "";
          notes.addEventListener("change", async () => {
            meta = await patchMeta(chat.id, { notes: notes.value, title: chat.title });
          });

          let actions;
          if (busyDelete || busyArchive) {
            actions = CGH.el(
              "div",
              { class: "cgh-confirm-row is-busy" },
              CGH.el("span", { class: "cgh-busy-label" }, busyDelete ? CGH.t.deletingChat : CGH.t.archivingChat)
            );
          } else if (pendingDel) {
            actions = CGH.el(
              "div",
              { class: "cgh-confirm-row" },
              CGH.el("span", {}, CGH.t.confirmDeleteChat),
              CGH.el(
                "button",
                {
                  class: "cgh-btn cgh-btn-danger",
                  type: "button",
                  disabled: !!ui.busyId,
                  onclick: async () => {
                    ui.busyId = chat.id;
                    ui.busyAction = "delete";
                    paintList();
                    try {
                      await patchConversation(chat.id, { is_visible: false });
                      CGH.conversations.activeList = (CGH.conversations.activeList || []).filter((c) => c.id !== chat.id);
                      CGH.conversations.archivedList = (CGH.conversations.archivedList || []).filter((c) => c.id !== chat.id);
                      CGH.conversations.sidebar = (CGH.conversations.sidebar || []).filter((c) => c.id !== chat.id);
                      const all = { ...((await CGH.storage.get("conversationMeta")) || {}) };
                      delete all[chat.id];
                      await CGH.storage.set({ conversationMeta: all });
                      meta = all;
                      ui.pendingDeleteId = null;
                      CGH.panel?.toast(CGH.t.chatDeleted);
                      if (currentId === chat.id) location.href = "/";
                    } catch (err) {
                      CGH.panel?.toast(CGH.t.chatActionFailed, "error");
                      console.warn("CGH delete chat", err);
                    } finally {
                      ui.busyId = null;
                      ui.busyAction = "";
                      paintList();
                      paintToolbar();
                    }
                  },
                },
                CGH.t.delete
              ),
              CGH.el(
                "button",
                {
                  class: "cgh-btn",
                  type: "button",
                  disabled: !!ui.busyId,
                  onclick: () => {
                    ui.pendingDeleteId = null;
                    paintList();
                  },
                },
                CGH.t.cancel
              )
            );
          } else {
            actions = CGH.el(
              "div",
              { class: "cgh-conv-actions" },
              CGH.el(
                "button",
                {
                  class: `cgh-icon-btn ${expanded ? "is-on" : ""}`,
                  type: "button",
                  title: CGH.t.notes,
                  "aria-label": CGH.t.notes,
                  disabled: busy,
                  onclick: () => {
                    ui.expandedId = expanded ? null : chat.id;
                    paintList();
                  },
                },
                CGH.svg(CGH.icons.note, 15)
              ),
              chat.archived
                ? CGH.el(
                    "button",
                    {
                      class: "cgh-icon-btn",
                      type: "button",
                      title: CGH.t.unarchive,
                      "aria-label": CGH.t.unarchive,
                      disabled: busy,
                      onclick: async () => {
                        ui.busyId = chat.id;
                        ui.busyAction = "unarchive";
                        paintList();
                        try {
                          await patchConversation(chat.id, { is_archived: false });
                          const item = { ...chat, archived: false, updateTime: Date.now() };
                          CGH.conversations.archivedList = (CGH.conversations.archivedList || []).filter((c) => c.id !== chat.id);
                          CGH.conversations.activeList = [item, ...(CGH.conversations.activeList || [])];
                          CGH.panel?.toast(CGH.t.chatUnarchived);
                        } catch (err) {
                          CGH.panel?.toast(CGH.t.chatActionFailed, "error");
                          console.warn("CGH unarchive", err);
                        } finally {
                          ui.busyId = null;
                          ui.busyAction = "";
                          paintList();
                          paintToolbar();
                        }
                      },
                    },
                    CGH.svg(CGH.icons.archive, 15)
                  )
                : CGH.el(
                    "button",
                    {
                      class: "cgh-icon-btn",
                      type: "button",
                      title: CGH.t.archive,
                      "aria-label": CGH.t.archive,
                      disabled: busy,
                      onclick: async () => {
                        ui.busyId = chat.id;
                        ui.busyAction = "archive";
                        paintList();
                        try {
                          await patchConversation(chat.id, { is_archived: true });
                          const item = { ...chat, archived: true, updateTime: Date.now() };
                          CGH.conversations.activeList = (CGH.conversations.activeList || []).filter((c) => c.id !== chat.id);
                          CGH.conversations.sidebar = (CGH.conversations.sidebar || []).filter((c) => c.id !== chat.id);
                          CGH.conversations.archivedList = [item, ...(CGH.conversations.archivedList || [])];
                          CGH.panel?.toast(CGH.t.chatArchived);
                          if (currentId === chat.id) location.href = "/";
                        } catch (err) {
                          CGH.panel?.toast(CGH.t.chatActionFailed, "error");
                          console.warn("CGH archive", err);
                        } finally {
                          ui.busyId = null;
                          ui.busyAction = "";
                          paintList();
                          paintToolbar();
                        }
                      },
                    },
                    CGH.svg(CGH.icons.archive, 15)
                  ),
              CGH.el(
                "button",
                {
                  class: "cgh-icon-btn danger",
                  type: "button",
                  title: CGH.t.delete,
                  "aria-label": CGH.t.delete,
                  disabled: busy,
                  onclick: () => {
                    ui.pendingDeleteId = chat.id;
                    paintList();
                  },
                },
                CGH.svg(CGH.icons.trash, 15)
              )
            );
          }

          list.append(
            CGH.el(
              "article",
              {
                class: `cgh-card cgh-conv-card ${currentId === chat.id ? "is-current" : ""} ${chat.archived ? "is-archived" : ""} ${busy ? "is-busy" : ""}`,
              },
              CGH.el(
                "div",
                { class: "cgh-card-top" },
                CGH.el(
                  "button",
                  {
                    class: `cgh-star ${m.starred ? "is-on" : ""}`,
                    type: "button",
                    title: CGH.t.starred,
                    disabled: busy,
                    onclick: async () => {
                      meta = await patchMeta(chat.id, { starred: !m.starred, title: chat.title });
                      paintList();
                    },
                  },
                  m.starred ? "★" : "☆"
                ),
                CGH.el("a", { class: "cgh-card-title-link", href: `/c/${chat.id}` }, chat.title),
                chat.archived ? CGH.el("span", { class: "cgh-bar-pin-tag" }, CGH.t.archived) : null,
                CGH.el("span", { class: "cgh-muted cgh-conv-date" }, CGH.formatDate(chat.updateTime || m.lastVisited))
              ),
              CGH.el("div", { class: "cgh-conv-fields" }, folderSelect, tags),
              expanded ? notes : null,
              actions
            )
          );
        }
        paintToolbar();
      };

      paintHook = () => {
        CGH.storage.get("conversationMeta").then((next) => {
          meta = next || meta;
          paintToolbar();
          paintHint();
          paintList();
        });
      };

      paintToolbar();
      paintChips();
      paintFolder();
      paintHint();
      paintList();
      root.replaceChildren(toolbar, search, chipsHost, folderHost, hint, list);
      CGH.conversations.refresh({ silent: true });
    },
  };
})();
