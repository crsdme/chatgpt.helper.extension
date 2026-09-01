(() => {
  const CGH = (window.CGH = window.CGH || {});

  async function all() {
    return (await CGH.storage.get("favorites")) || [];
  }

  async function save(list) {
    await CGH.storage.set({ favorites: list });
    CGH.composerBar?.update();
    CGH.panel?.refresh();
  }

  function form(existing, onDone) {
    const title = CGH.el("input", {
      class: "cgh-input",
      placeholder: CGH.t.title,
      value: existing?.title || "",
    });
    const text = CGH.el("textarea", {
      class: "cgh-input cgh-textarea",
      placeholder: CGH.t.text,
      rows: "5",
    });
    text.value = existing?.text || CGH.dom.getComposerText() || "";
    return CGH.el(
      "form",
      {
        class: "cgh-form",
        onsubmit: async (e) => {
          e.preventDefault();
          const nextTitle = title.value.trim();
          const nextText = text.value.trim();
          if (!nextText) return;
          const list = await all();
          if (existing) {
            const item = list.find((x) => x.id === existing.id);
            if (item) {
              item.title = nextTitle || nextText.slice(0, 40);
              item.text = nextText;
            }
          } else {
            list.push({
              id: CGH.uuid(),
              title: nextTitle || nextText.slice(0, 40),
              text: nextText,
              createdAt: Date.now(),
            });
          }
          await save(list);
          CGH.panel?.toast(CGH.t.saved);
          onDone?.();
        },
      },
      title,
      text,
      CGH.el(
        "div",
        { class: "cgh-toolbar" },
        CGH.el("button", { class: "cgh-btn cgh-btn-primary", type: "submit" }, CGH.t.save),
        CGH.el("button", { class: "cgh-btn", type: "button", onclick: () => onDone?.() }, CGH.t.cancel)
      )
    );
  }

  CGH.favorites = {
    all,

    async init() {},

    async insert(fav, { replace = false, send = false } = {}) {
      const current = CGH.dom.getComposerText();
      const next = replace || !current.trim() ? fav.text : `${current.trim()}\n\n${fav.text}`;
      await CGH.dom.setComposerText(next);
      CGH.dom.getComposer()?.focus();
      if (send) {
        await CGH.sleep(120);
        await CGH.dom.clickSend();
      }
    },

    async remove(id) {
      const list = (await all()).filter((x) => x.id !== id);
      await save(list);
    },

    async saveCurrent() {
      const text = CGH.dom.getComposerText().trim();
      if (!text) {
        CGH.panel?.toast(CGH.t.emptyPrompt, "error");
        CGH.panel?.setTab("favorites");
        return;
      }
      const list = await all();
      list.push({
        id: CGH.uuid(),
        title: text.slice(0, 40),
        text,
        createdAt: Date.now(),
      });
      await save(list);
      CGH.panel?.toast(CGH.t.saved);
    },

    async exportAll() {
      const list = await all();
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
      CGH.downloadBlob(blob, "chatgpt-helper-prompts.json");
    },

    async importAll(file) {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Неверный файл");
      const list = await all();
      for (const item of data) {
        if (!item?.text) continue;
        list.push({
          id: CGH.uuid(),
          title: item.title || String(item.text).slice(0, 40),
          text: String(item.text),
          createdAt: Date.now(),
        });
      }
      await save(list);
    },

    async render(root) {
      let editing = null;
      const draw = async () => {
        const list = await all();
        root.replaceChildren();
        const toolbar = CGH.el(
          "div",
          { class: "cgh-toolbar" },
          CGH.el(
            "button",
            {
              class: "cgh-btn cgh-btn-primary",
              type: "button",
              onclick: () => {
                editing = {};
                draw();
              },
            },
            CGH.svg(CGH.icons.plus, 14),
            CGH.t.addPrompt
          ),
          CGH.el("button", { class: "cgh-btn", type: "button", onclick: () => this.exportAll() }, CGH.t.export),
          (() => {
            const input = CGH.el("input", { type: "file", accept: "application/json", hidden: true });
            input.addEventListener("change", async () => {
              if (input.files[0]) {
                try {
                  await this.importAll(input.files[0]);
                  CGH.panel?.toast(CGH.t.saved);
                } catch (err) {
                  CGH.panel?.toast(err.message, "error");
                }
              }
            });
            return CGH.el(
              "button",
              { class: "cgh-btn", type: "button", onclick: () => input.click() },
              CGH.t.import,
              input
            );
          })()
        );
        root.append(toolbar);
        if (editing) {
          root.append(
            form(editing.id ? editing : null, () => {
              editing = null;
              draw();
            })
          );
          return;
        }
        if (!list.length) {
          root.append(CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyFavorites));
          return;
        }
        const box = CGH.el("div", { class: "cgh-list" });
        for (const fav of list) {
          box.append(
            CGH.el(
              "article",
              { class: "cgh-card" },
              CGH.el("h4", { class: "cgh-card-title" }, fav.title),
              CGH.el("p", { class: "cgh-card-text" }, fav.text),
              CGH.el(
                "div",
                { class: "cgh-card-actions" },
                CGH.el("button", { class: "cgh-btn cgh-btn-primary", type: "button", onclick: () => this.insert(fav) }, CGH.t.insert),
                CGH.el("button", { class: "cgh-btn", type: "button", onclick: () => this.insert(fav, { send: true }) }, CGH.t.sendNow),
                CGH.el(
                  "button",
                  {
                    class: "cgh-icon-btn",
                    type: "button",
                    title: "Изменить",
                    onclick: () => {
                      editing = fav;
                      draw();
                    },
                  },
                  CGH.svg(CGH.icons.gear, 14)
                ),
                CGH.el(
                  "button",
                  { class: "cgh-icon-btn danger", type: "button", onclick: () => this.remove(fav.id) },
                  CGH.svg(CGH.icons.trash, 14)
                )
              )
            )
          );
        }
        root.append(box);
      };
      await draw();
    },
  };
})();
