(() => {
  const CGH = (window.CGH = window.CGH || {});
  const seen = new Set();
  let scanning = false;
  const selected = new Set();

  function isUiImage(img) {
    const src = img.currentSrc || img.src || "";
    const alt = (img.alt || "").toLowerCase();
    const cls = img.className?.toString?.() || "";
    if (!src || src.startsWith("data:image/svg")) return true;
    if (/avatar|profile|icon|logo|emoji|favicon/i.test(src + alt + cls)) return true;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w && h && w < 80 && h < 80) return true;
    if (!img.closest("[data-message-author-role], article, main")) return true;
    return false;
  }

  function fileName(item, index = 0) {
    const base = String(item.conversationTitle || "chatgpt")
      .replace(/[^\w\-а-яё]+/gi, "_")
      .replace(/_+/g, "_")
      .slice(0, 40)
      .replace(/^_|_$/g, "") || "chatgpt";
    const ext = (item.src || "").match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1] || "png";
    return `${base}-${String(index + 1).padStart(2, "0")}-${item.id.slice(0, 6)}.${ext.toLowerCase()}`;
  }

  async function resolveBlob(item, previewSrc) {
    if (item.cached) {
      const rec = await CGH.storage.loadImageBlob(item.id);
      if (rec?.blob) return rec.blob;
    }
    try {
      const res = await fetch(item.src || previewSrc, { credentials: "include" });
      if (res.ok) return await res.blob();
    } catch {
      /* fall through */
    }
    if (previewSrc?.startsWith("blob:") || previewSrc?.startsWith("data:")) {
      const res = await fetch(previewSrc);
      return res.blob();
    }
    throw new Error(CGH.t.downloadFailed);
  }

  async function downloadOne(item, previewSrc, index = 0) {
    const blob = await resolveBlob(item, previewSrc);
    CGH.downloadBlob(blob, fileName(item, index));
  }

  async function downloadMany(items, getPreview) {
    if (!items.length) return;
    CGH.panel?.toast(CGH.t.downloading, "ok");
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      try {
        await downloadOne(items[i], getPreview?.(items[i]), i);
        ok += 1;
        await CGH.sleep(180);
      } catch (err) {
        console.warn("CGH download", err);
      }
    }
    CGH.panel?.toast(ok ? `${CGH.t.downloaded}: ${ok}` : CGH.t.downloadFailed, ok ? "ok" : "error");
  }

  async function indexImage(img) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src)) return;
    seen.add(src);
    const images = (await CGH.storage.get("images")) || [];
    if (images.some((i) => i.src === src)) return;

    const convId = CGH.dom.getConversationId();
    const record = {
      id: CGH.uuid(),
      src,
      conversationId: convId,
      conversationTitle: CGH.dom.getConversationTitle(),
      alt: img.alt || "",
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      capturedAt: Date.now(),
    };

    const settings = await CGH.storage.get("settings");
    if (settings?.cacheImages !== false) {
      try {
        const res = await fetch(src, { credentials: "include" });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size && blob.size < 12 * 1024 * 1024) {
            await CGH.storage.saveImageBlob(record.id, blob, { src, type: blob.type });
            record.cached = true;
          }
        }
      } catch {
        /* keep URL */
      }
    }

    images.unshift(record);
    await CGH.storage.set({ images: images.slice(0, 400) });
  }

  CGH.gallery = {
    async init() {
      const images = (await CGH.storage.get("images")) || [];
      for (const img of images) if (img.src) seen.add(img.src);
    },

    async scan() {
      if (scanning) return;
      scanning = true;
      try {
        const imgs = CGH.dom.getMain().querySelectorAll("img");
        for (const img of imgs) {
          if (isUiImage(img)) continue;
          await indexImage(img);
        }
      } finally {
        scanning = false;
      }
    },

    async render(root) {
      const images = (await CGH.storage.get("images")) || [];
      const convId = CGH.dom.getConversationId();
      const previews = new Map();

      const toolbar = CGH.el(
        "div",
        { class: "cgh-toolbar" },
        CGH.el("button", { class: "cgh-btn", type: "button", onclick: () => this.scan().then(() => CGH.panel.refresh()) }, CGH.t.refresh),
        CGH.el(
          "button",
          {
            class: "cgh-btn cgh-btn-primary",
            type: "button",
            onclick: () => {
              const list = selected.size
                ? images.filter((i) => selected.has(i.id))
                : images;
              downloadMany(list, (item) => previews.get(item.id));
            },
          },
          CGH.svg(CGH.icons.download, 14),
          selected.size ? `${CGH.t.downloadSelected} (${selected.size})` : CGH.t.downloadAll
        ),
        CGH.el(
          "button",
          {
            class: "cgh-btn",
            type: "button",
            onclick: () => {
              if (selected.size === images.length) selected.clear();
              else images.forEach((i) => selected.add(i.id));
              CGH.panel.refresh();
            },
          },
          selected.size === images.length && images.length ? CGH.t.clearSelection : CGH.t.selectAll
        ),
        CGH.el(
          "button",
          {
            class: "cgh-btn",
            type: "button",
            onclick: async () => {
              await CGH.storage.set({ images: images.filter((i) => i.conversationId === convId) });
              selected.clear();
              CGH.panel.refresh();
            },
          },
          CGH.t.thisChat
        ),
        CGH.el(
          "button",
          {
            class: "cgh-btn",
            type: "button",
            onclick: async () => {
              for (const img of images) {
                if (img.cached) await CGH.storage.deleteImageBlob(img.id);
              }
              await CGH.storage.set({ images: [] });
              seen.clear();
              selected.clear();
              CGH.panel.refresh();
            },
          },
          CGH.t.clear
        )
      );
      root.append(toolbar);

      if (!images.length) {
        root.append(CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyGallery));
        return;
      }

      if (selected.size) {
        root.append(CGH.el("p", { class: "cgh-muted" }, `${selected.size} ${CGH.t.selected}`));
      }

      const grid = CGH.el("div", { class: "cgh-grid" });
      for (const item of images) {
        const img = CGH.el("img", { class: "cgh-grid-img", alt: item.alt || "", loading: "lazy" });
        if (item.cached) {
          const rec = await CGH.storage.loadImageBlob(item.id);
          if (rec?.blob) {
            img.src = URL.createObjectURL(rec.blob);
            previews.set(item.id, img.src);
          } else img.src = item.src;
        } else {
          img.src = item.src;
          previews.set(item.id, item.src);
        }

        const check = CGH.el("input", {
          class: "cgh-grid-check",
          type: "checkbox",
          title: CGH.t.selectAll,
        });
        check.checked = selected.has(item.id);
        check.addEventListener("click", (e) => e.stopPropagation());
        check.addEventListener("change", () => {
          if (check.checked) selected.add(item.id);
          else selected.delete(item.id);
          CGH.panel.refresh();
        });

        const downloadBtn = CGH.el(
          "button",
          {
            class: "cgh-mini-btn",
            type: "button",
            title: CGH.t.download,
            onclick: async (e) => {
              e.stopPropagation();
              try {
                await downloadOne(item, img.src);
                CGH.panel?.toast(CGH.t.downloaded, "ok");
              } catch {
                CGH.panel?.toast(CGH.t.downloadFailed, "error");
              }
            },
          },
          CGH.svg(CGH.icons.download, 14)
        );

        const open = () => {
          const overlay = CGH.el(
            "div",
            { class: "cgh-lightbox", onclick: (e) => e.target === overlay && overlay.remove() },
            CGH.el("img", { src: img.src, alt: item.alt || "" }),
            CGH.el(
              "div",
              { class: "cgh-lightbox-bar" },
              CGH.el("span", {}, item.conversationTitle || CGH.t.chat),
              CGH.el(
                "button",
                {
                  class: "cgh-btn cgh-btn-primary",
                  type: "button",
                  onclick: async (e) => {
                    e.stopPropagation();
                    try {
                      await downloadOne(item, img.src);
                      CGH.panel?.toast(CGH.t.downloaded, "ok");
                    } catch {
                      CGH.panel?.toast(CGH.t.downloadFailed, "error");
                    }
                  },
                },
                CGH.svg(CGH.icons.download, 14),
                CGH.t.download
              ),
              CGH.el(
                "button",
                {
                  class: "cgh-btn",
                  type: "button",
                  onclick: async (e) => {
                    e.stopPropagation();
                    try {
                      const blob = await resolveBlob(item, img.src);
                      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
                      CGH.panel?.toast(CGH.t.copied, "ok");
                    } catch {
                      CGH.panel?.toast(CGH.t.downloadFailed, "error");
                    }
                  },
                },
                CGH.t.copyImage
              ),
              item.src
                ? CGH.el("a", { class: "cgh-btn", href: item.src, target: "_blank", rel: "noreferrer", onclick: (e) => e.stopPropagation() }, CGH.t.openOriginal)
                : null,
              item.conversationId
                ? CGH.el("a", { class: "cgh-btn", href: `/c/${item.conversationId}` }, CGH.t.openChat)
                : null
            )
          );
          CGH.panel.shadow.append(overlay);
        };

        grid.append(
          CGH.el(
            "div",
            {
              class: `cgh-grid-item ${selected.has(item.id) ? "is-selected" : ""}`,
              role: "button",
              tabindex: "0",
              title: item.conversationTitle || "",
              onclick: open,
              onkeydown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  open();
                }
              },
            },
            img,
            check,
            CGH.el("div", { class: "cgh-grid-actions" }, downloadBtn),
            CGH.el("span", { class: "cgh-grid-cap" }, item.conversationTitle || CGH.formatDate(item.capturedAt))
          )
        );
      }
      root.append(grid);
    },
  };
})();
