(() => {
  const CGH = (window.CGH = window.CGH || {});
  const COLORS = ["#60a5fa", "#3b82f6", "#e3a008", "#ef4444", "#a855f7", "#14b8a6"];

  async function state() {
    return CGH.storage.get(["folders", "conversationMeta", "settings"]);
  }

  CGH.conversations = {
    scraped: [],

    scrape() {
      this.scraped = CGH.dom.scrapeSidebarConversations();
      const id = CGH.dom.getConversationId();
      if (!id) return;
      CGH.storage.get("conversationMeta").then((meta) => {
        const next = { ...(meta || {}) };
        next[id] = {
          ...(next[id] || {}),
          title: CGH.dom.getConversationTitle(),
          lastVisited: Date.now(),
        };
        CGH.storage.set({ conversationMeta: next });
      });
    },

    async init() {
      this.scrape();
    },

    async render(root) {
      const { folders, conversationMeta } = await state();
      const folderList = folders || [];
      const meta = conversationMeta || {};
      let activeFolder = "all";
      let query = "";

      const known = new Map();
      for (const c of this.scraped) known.set(c.id, c);
      for (const [id, m] of Object.entries(meta)) {
        if (!known.has(id)) known.set(id, { id, title: m.title || id, href: `/c/${id}` });
      }

      const search = CGH.el("input", {
        class: "cgh-input",
        placeholder: `${CGH.t.search} по названию, тегам, заметкам`,
      });
      const chipsHost = CGH.el("div", { class: "cgh-chip-row" });
      const list = CGH.el("div", { class: "cgh-list" });
      search.addEventListener("input", () => {
        query = search.value;
        paintList();
      });

      const paintChips = () => {
        chipsHost.replaceChildren(
          ...[
            { id: "all", name: CGH.t.allChats },
            { id: "starred", name: "★ " + CGH.t.starred },
            { id: "unfiled", name: CGH.t.unfiled },
            ...folderList,
          ].map((f) =>
            CGH.el(
              "button",
              {
                class: `cgh-chip ${activeFolder === f.id ? "is-active" : ""}`,
                type: "button",
                style: f.color ? { borderColor: f.color } : {},
                onclick: () => {
                  activeFolder = f.id;
                  paintChips();
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
              onclick: async () => {
                const name = prompt("Название папки");
                if (!name?.trim()) return;
                const next = folderList.concat({
                  id: CGH.uuid(),
                  name: name.trim(),
                  color: COLORS[folderList.length % COLORS.length],
                });
                await CGH.storage.set({ folders: next });
                CGH.panel.refresh();
              },
            },
            "+ папка"
          )
        );
      };

      const paintList = () => {
        const chats = [...known.values()].filter((c) => {
          const m = meta[c.id] || {};
          if (activeFolder === "starred" && !m.starred) return false;
          if (activeFolder === "unfiled" && m.folderId) return false;
          if (activeFolder !== "all" && activeFolder !== "starred" && activeFolder !== "unfiled" && m.folderId !== activeFolder) {
            return false;
          }
          if (query) {
            const hay = `${c.title} ${m.notes || ""} ${(m.tags || []).join(" ")}`.toLowerCase();
            if (!hay.includes(query.toLowerCase())) return false;
          }
          return true;
        });
        chats.sort((a, b) => (meta[b.id]?.lastVisited || 0) - (meta[a.id]?.lastVisited || 0));
        list.replaceChildren();
        if (!chats.length) {
          list.append(CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyConversations));
        }
        for (const chat of chats) {
          const m = meta[chat.id] || {};
          const notes = CGH.el("textarea", {
            class: "cgh-input cgh-textarea cgh-notes",
            placeholder: CGH.t.notes,
            rows: "2",
          });
          notes.value = m.notes || "";
          notes.addEventListener(
            "change",
            async () => {
              const allMeta = (await CGH.storage.get("conversationMeta")) || {};
              allMeta[chat.id] = { ...allMeta[chat.id], notes: notes.value, title: chat.title };
              await CGH.storage.set({ conversationMeta: allMeta });
            }
          );

          const folderSelect = CGH.el("select", { class: "cgh-input cgh-select" });
          folderSelect.append(new Option("— папка —", ""));
          for (const f of folderList) folderSelect.append(new Option(f.name, f.id));
          folderSelect.value = m.folderId || "";
          folderSelect.addEventListener("change", async () => {
            const allMeta = (await CGH.storage.get("conversationMeta")) || {};
            allMeta[chat.id] = { ...allMeta[chat.id], folderId: folderSelect.value || null, title: chat.title };
            await CGH.storage.set({ conversationMeta: allMeta });
          });

          const tags = CGH.el("input", {
            class: "cgh-input",
            placeholder: "теги через запятую",
            value: (m.tags || []).join(", "),
          });
          tags.addEventListener("change", async () => {
            const allMeta = (await CGH.storage.get("conversationMeta")) || {};
            allMeta[chat.id] = {
              ...allMeta[chat.id],
              tags: tags.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              title: chat.title,
            };
            await CGH.storage.set({ conversationMeta: allMeta });
          });

          list.append(
            CGH.el(
              "article",
              { class: "cgh-card" },
              CGH.el(
                "div",
                { class: "cgh-card-top" },
                CGH.el(
                  "button",
                  {
                    class: `cgh-star ${m.starred ? "is-on" : ""}`,
                    type: "button",
                    title: CGH.t.starred,
                    onclick: async () => {
                      const allMeta = (await CGH.storage.get("conversationMeta")) || {};
                      allMeta[chat.id] = { ...allMeta[chat.id], starred: !m.starred, title: chat.title };
                      await CGH.storage.set({ conversationMeta: allMeta });
                      CGH.panel.refresh();
                    },
                  },
                  m.starred ? "★" : "☆"
                ),
                CGH.el("a", { class: "cgh-card-title-link", href: `/c/${chat.id}` }, chat.title),
                CGH.el("span", { class: "cgh-muted" }, m.lastVisited ? CGH.formatDate(m.lastVisited) : "")
              ),
              folderSelect,
              tags,
              notes
            )
          );
        }
      };

      paintChips();
      paintList();
      root.replaceChildren(search, chipsHost, list);
    },
  };
})();
