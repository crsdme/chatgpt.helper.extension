(() => {
  const CGH = (window.CGH = window.CGH || {});

  async function all() {
    return (await CGH.storage.get("pins")) || [];
  }

  function pinButton(msg) {
    const icon = CGH.svg(
      '<path d="M12 17v5"/><path d="M9 4v6.5a1 1 0 0 1-.4.8l-3.1 2.3A1.5 1.5 0 0 0 6.5 16h11a1.5 1.5 0 0 0 .999-2.4l-3.1-2.3a1 1 0 0 1-.4-.8V4"/><path d="M8 4h8"/>',
      15
    );
    const btn = CGH.el(
      "button",
      {
        class: "cgh-pin-btn",
        type: "button",
        title: CGH.t.pin,
        onclick: async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await CGH.pins.toggle(msg);
        },
      },
      icon
    );
    return btn;
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
        msg.classList.remove("cgh-is-pinned");
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
        msg.classList.add("cgh-is-pinned");
        CGH.panel?.toast(CGH.t.pinnedToast);
      }
      this.decorate();
      CGH.panel?.updateFab();
    },

    decorate() {
      const messages = CGH.dom.getMessages();
      CGH.storage.get("pins").then((pins) => {
        const conv = CGH.dom.getConversationId();
        for (const msg of messages) {
          if (!(msg instanceof HTMLElement)) continue;
          if (!msg.style.position || msg.style.position === "static") msg.classList.add("cgh-msg");
          if (!msg.querySelector(":scope > .cgh-pin-btn")) msg.appendChild(pinButton(msg));
          const id = CGH.dom.messageId(msg);
          const pinned = (pins || []).some((p) => p.messageId === id && p.conversationId === conv);
          msg.classList.toggle("cgh-is-pinned", pinned);
        }
      });
    },

    async jump(pin) {
      if (pin.conversationId && pin.conversationId !== "new" && pin.conversationId !== CGH.dom.getConversationId()) {
        location.href = `/c/${pin.conversationId}`;
        return;
      }
      const messages = CGH.dom.getMessages();
      const el = messages.find((m) => CGH.dom.messageId(m) === pin.messageId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("cgh-flash");
        setTimeout(() => el.classList.remove("cgh-flash"), 1600);
      } else {
        CGH.panel?.toast(CGH.t.notFound, "error");
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
              CGH.el("span", { class: "cgh-role" }, pin.role === "user" ? "Вы" : "ChatGPT"),
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
