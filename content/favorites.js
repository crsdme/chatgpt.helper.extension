(() => {
  const CGH = (window.CGH = window.CGH || {});
  let pendingCompose = null;

  async function all() {
    return (await CGH.storage.get("favorites")) || [];
  }

  function isOnBar(fav) {
    return fav?.barPinned !== false;
  }

  async function save(list) {
    await CGH.storage.set({ favorites: list });
    CGH.composerBar?.update();
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
    text.value = existing?.text || "";

    const onBar = CGH.el("input", { type: "checkbox" });
    onBar.checked = existing?.id ? isOnBar(existing) : true;

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
          if (existing?.id) {
            const item = list.find((x) => x.id === existing.id);
            if (item) {
              item.title = nextTitle || nextText.slice(0, 40);
              item.text = nextText;
              item.barPinned = !!onBar.checked;
            }
          } else {
            list.push({
              id: CGH.uuid(),
              title: nextTitle || nextText.slice(0, 40),
              text: nextText,
              barPinned: !!onBar.checked,
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
      CGH.el("label", { class: "cgh-check" }, onBar, CGH.t.pinPromptToBar || "Show on bar"),
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
    isOnBar,

    async init() {},

    /** Open prompts list on the right. With compose, prefill a new-prompt form. */
    async openPanel({ compose = false } = {}) {
      pendingCompose = null;
      if (compose) {
        const text = CGH.dom.getComposerText().trim();
        if (text) pendingCompose = { text };
      }
      if (CGH.panel?.ensureMounted) await CGH.panel.ensureMounted();
      CGH.panel?.open?.("favorites");
    },

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

    async toggleBarPin(id) {
      const list = await all();
      const item = list.find((x) => x.id === id);
      if (!item) return;
      item.barPinned = !isOnBar(item);
      await save(list);
      CGH.panel?.toast(item.barPinned ? CGH.t.promptPinnedToBar : CGH.t.promptUnpinnedFromBar);
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
          barPinned: item.barPinned !== false,
          createdAt: Date.now(),
        });
      }
      await save(list);
    },

    async render(root) {
      let editing = null;
      if (pendingCompose) {
        editing = { text: pendingCompose.text || "", title: "" };
        pendingCompose = null;
      }

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
                const draft = CGH.dom.getComposerText().trim();
                editing = draft ? { text: draft, title: "" } : {};
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
                  draw();
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
        root.append(CGH.el("p", { class: "cgh-hint" }, CGH.t.promptsBarHint || ""));

        if (editing) {
          root.append(
            form(editing, () => {
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
          const pinned = isOnBar(fav);
          box.append(
            CGH.el(
              "article",
              { class: `cgh-card ${pinned ? "is-bar-pinned" : ""}` },
              CGH.el(
                "div",
                { class: "cgh-card-top" },
                CGH.el("h4", { class: "cgh-card-title" }, fav.title),
                CGH.el(
                  "span",
                  { class: `cgh-bar-pin-tag ${pinned ? "is-on" : ""}` },
                  pinned ? CGH.t.onBar || "On bar" : CGH.t.offBar || "Hidden"
                )
              ),
              CGH.el("p", { class: "cgh-card-text" }, fav.text),
              CGH.el(
                "div",
                { class: "cgh-card-actions" },
                CGH.el(
                  "button",
                  {
                    class: `cgh-icon-btn ${pinned ? "is-on" : ""}`,
                    type: "button",
                    title: pinned ? CGH.t.unpinPromptFromBar : CGH.t.pinPromptToBar,
                    onclick: () => this.toggleBarPin(fav.id).then(draw),
                  },
                  CGH.svg(CGH.icons.pin, 14)
                ),
                CGH.el("button", { class: "cgh-btn cgh-btn-primary", type: "button", onclick: () => this.insert(fav) }, CGH.t.insert),
                CGH.el("button", { class: "cgh-btn", type: "button", onclick: () => this.insert(fav, { send: true }) }, CGH.t.sendNow),
                CGH.el(
                  "button",
                  {
                    class: "cgh-icon-btn",
                    type: "button",
                    title: CGH.t.edit || "Edit",
                    onclick: () => {
                      editing = fav;
                      draw();
                    },
                  },
                  CGH.svg(CGH.icons.gear, 14)
                ),
                CGH.el(
                  "button",
                  { class: "cgh-icon-btn danger", type: "button", onclick: () => this.remove(fav.id).then(draw) },
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
