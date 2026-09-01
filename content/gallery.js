(() => {
  const CGH = (window.CGH = window.CGH || {});
  const seen = new Set();
  let scanning = false;
  let cachePumping = false;
  const selected = new Set();
  const cacheQueue = [];

  function srcOf(img) {
    const srcset = (img.srcset || img.getAttribute?.("srcset") || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
    return (
      img.currentSrc ||
      img.src ||
      img.getAttribute?.("src") ||
      img.getAttribute?.("data-src") ||
      srcset ||
      ""
    ).trim();
  }

  function turnOf(img) {
    return img.closest?.(
      'article[data-testid*="conversation-turn"], section[data-testid*="conversation-turn"], [data-testid^="conversation-turn-"], [data-testid="conversation-turn"]'
    );
  }

  function authorRole(img) {
    const el =
      img.closest?.("[data-message-author-role]") ||
      turnOf(img)?.querySelector?.("[data-message-author-role]");
    return (el?.getAttribute("data-message-author-role") || "").toLowerCase();
  }

  function isGeneratedMarker(img) {
    const src = srcOf(img);
    const alt = img.alt || "";
    if (/^generated image/i.test(alt.trim())) return true;
    if (/\/backend-api\/estuary\/content|files\.oaiusercontent\.com|oaidalle|blob\.core\.windows\.net/i.test(src)) {
      return true;
    }
    if (img.closest?.('[id^="image-"], [data-testid*="image-gen"], [data-testid*="imagegen"], [data-testid*="dalle"]')) {
      return true;
    }
    return false;
  }

  function isTinyUi(img) {
    const src = srcOf(img);
    const alt = (img.alt || "").toLowerCase();
    if (!src || src.startsWith("data:image/svg")) return true;
    if (/avatar|profile|favicon|emoji/i.test(src) || /avatar|profile|logo|emoji/i.test(alt)) return true;
    if (img.closest("form, nav, header, #cgh-root, #cgh-composer-bar")) return true;
    if (img.closest('aside nav, [data-testid="sidebar"]')) return true;
    const w = img.naturalWidth || img.width || img.getBoundingClientRect?.().width || 0;
    const h = img.naturalHeight || img.height || img.getBoundingClientRect?.().height || 0;
    if (w && h && w < 80 && h < 80 && !isGeneratedMarker(img)) return true;
    return false;
  }

  function isGptImage(img) {
    if (isTinyUi(img)) return false;
    const role = authorRole(img);
    if (role === "user") return false;
    if (role === "assistant" || role === "tool") return true;
    if (isGeneratedMarker(img)) return true;
    const turn = turnOf(img);
    if (turn && !turn.querySelector('[data-message-author-role="user"]')) {
      const w = Math.max(img.naturalWidth || 0, img.getBoundingClientRect?.().width || 0);
      if (w >= 120) return true;
    }
    return false;
  }

  function isGalleryItem(item) {
    if (!item?.src) return false;
    if (item.authorRole === "user" || item.fromUser) return false;
    return true;
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

  function bindPreview(imgEl, item) {
    imgEl.decoding = "async";
    imgEl.loading = "lazy";
    imgEl.src = item.src || "";
    if (!item.cached) return;
    CGH.storage.loadImageBlob(item.id).then((rec) => {
      if (!rec?.blob || !imgEl.isConnected) return;
      const url = URL.createObjectURL(rec.blob);
      imgEl.src = url;
    });
  }

  function scheduleCache(record) {
    if (!record?.src || record.cached) return;
    if (cacheQueue.some((j) => j.id === record.id)) return;
    cacheQueue.push(record);
    pumpCache();
  }

  async function pumpCache() {
    if (cachePumping) return;
    cachePumping = true;
    const idle = () =>
      new Promise((resolve) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 1200 });
        else setTimeout(resolve, 80);
      });
    try {
      while (cacheQueue.length) {
        const record = cacheQueue.shift();
        await idle();
        if (!CGH.storage?.isAlive?.()) break;
        try {
          const res = await fetch(record.src, { credentials: "include" });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (!blob.size || blob.size >= 12 * 1024 * 1024) continue;
          await CGH.storage.saveImageBlob(record.id, blob, { src: record.src, type: blob.type });
          const images = (await CGH.storage.get("images")) || [];
          const row = images.find((i) => i.id === record.id);
          if (row) {
            row.cached = true;
            await CGH.storage.set({ images });
          }
        } catch {
          /* skip */
        }
      }
    } finally {
      cachePumping = false;
    }
  }

  async function collectPageImages() {
    const roots = [CGH.dom.getMain?.(), document.querySelector("[role='main']"), document.body].filter(Boolean);
    const seenEls = new Set();
    const gpt = [];
    const userSrcs = new Set();

    const imgs = new Set();
    for (const root of roots) {
      for (const img of root.querySelectorAll("img")) imgs.add(img);
    }
    for (const img of document.querySelectorAll(
      'img[alt*="Generated image" i], img[src*="estuary/content"], img[src*="oaiusercontent"], img[src*="oaidalle"]'
    )) {
      imgs.add(img);
    }

    for (const img of imgs) {
      if (seenEls.has(img)) continue;
      seenEls.add(img);
      const src = srcOf(img);
      if (!src) continue;
      if (authorRole(img) === "user") {
        userSrcs.add(src);
        continue;
      }
      if (!isGptImage(img)) continue;
      gpt.push({ img, src, role: authorRole(img) || "assistant" });
    }
    return { gpt, userSrcs };
  }

  CGH.gallery = {
    async init() {
      const images = (await CGH.storage.get("images")) || [];
      for (const img of images) if (img.src) seen.add(img.src);
    },

    async scan() {
      if (scanning || !CGH.storage?.isAlive?.()) return false;
      scanning = true;
      let changed = false;
      try {
        const { gpt, userSrcs } = await collectPageImages();
        let images = (await CGH.storage.get("images")) || [];
        const kept = [];
        for (const item of images) {
          if (userSrcs.has(item.src) || item.authorRole === "user" || item.fromUser) {
            if (item.cached) await CGH.storage.deleteImageBlob(item.id);
            seen.delete(item.src);
            changed = true;
            continue;
          }
          kept.push(item);
        }
        images = kept;

        const settings = await CGH.storage.get("settings");
        const convId = CGH.dom.getConversationId();
        const title = CGH.dom.getConversationTitle();
        let added = 0;
        for (const { img, src, role } of gpt) {
          if (seen.has(src) || images.some((i) => i.src === src)) {
            seen.add(src);
            continue;
          }
          seen.add(src);
          const record = {
            id: CGH.uuid(),
            src,
            authorRole: role,
            conversationId: convId,
            conversationTitle: title,
            alt: img.alt || "",
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            capturedAt: Date.now(),
          };
          images.unshift(record);
          added += 1;
          changed = true;
          if (settings?.cacheImages !== false) scheduleCache(record);
          if (added >= 40) break;
        }

        if (changed) await CGH.storage.set({ images: images.slice(0, 400) });
        return changed;
      } finally {
        scanning = false;
      }
    },

    async render(root) {
      const previews = new Map();
      let images = ((await CGH.storage.get("images")) || []).filter(isGalleryItem);
      const convId = CGH.dom.getConversationId();

      const paint = (list) => {
        root.replaceChildren();
        const downloadLabel = () =>
          selected.size ? `${CGH.t.downloadSelected} (${selected.size})` : CGH.t.downloadAll;
        const selectLabel = () =>
          selected.size === list.length && list.length ? CGH.t.clearSelection : CGH.t.selectAll;

        const downloadText = CGH.el("span", {}, downloadLabel());
        const downloadBtn = CGH.el(
          "button",
          {
            class: "cgh-btn cgh-btn-primary",
            type: "button",
            onclick: () => {
              const pack = selected.size ? list.filter((i) => selected.has(i.id)) : list;
              downloadMany(pack, (item) => previews.get(item.id));
            },
          },
          CGH.svg(CGH.icons.download, 14),
          downloadText
        );
        const selectBtn = CGH.el(
          "button",
          {
            class: "cgh-btn",
            type: "button",
            onclick: () => {
              if (selected.size === list.length) selected.clear();
              else list.forEach((i) => selected.add(i.id));
              paint(list);
            },
          },
          selectLabel()
        );

        const toolbar = CGH.el(
          "div",
          { class: "cgh-toolbar" },
          CGH.el(
            "button",
            {
              class: "cgh-btn",
              type: "button",
              onclick: () =>
                this.scan().then((changed) => {
                  if (changed) CGH.panel.refresh();
                }),
            },
            CGH.t.refresh
          ),
          downloadBtn,
          selectBtn,
          CGH.el(
            "button",
            {
              class: "cgh-btn",
              type: "button",
              onclick: async () => {
                await CGH.storage.set({ images: list.filter((i) => i.conversationId === convId) });
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
                for (const img of list) {
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

        if (!list.length) {
          root.append(CGH.el("div", { class: "cgh-empty" }, CGH.t.emptyGallery));
          return;
        }

        if (selected.size) {
          root.append(CGH.el("p", { class: "cgh-muted cgh-sel-count" }, `${selected.size} ${CGH.t.selected}`));
        }

        const grid = CGH.el("div", { class: "cgh-grid" });
        for (const item of list) {
          const img = CGH.el("img", { class: "cgh-grid-img", alt: item.alt || "" });
          bindPreview(img, item);
          previews.set(item.id, item.src);

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
            itemEl.classList.toggle("is-selected", check.checked);
            downloadText.textContent = downloadLabel();
            selectBtn.textContent = selectLabel();
            let countEl = root.querySelector(".cgh-sel-count");
            if (selected.size) {
              const text = `${selected.size} ${CGH.t.selected}`;
              if (countEl) countEl.textContent = text;
              else toolbar.after(CGH.el("p", { class: "cgh-muted cgh-sel-count" }, text));
            } else {
              countEl?.remove();
            }
          });

          const dl = CGH.el(
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
                  ? CGH.el(
                      "a",
                      {
                        class: "cgh-btn",
                        href: item.src,
                        target: "_blank",
                        rel: "noreferrer",
                        onclick: (e) => e.stopPropagation(),
                      },
                      CGH.t.openOriginal
                    )
                  : null,
                item.conversationId
                  ? CGH.el("a", { class: "cgh-btn", href: `/c/${item.conversationId}` }, CGH.t.openChat)
                  : null
              )
            );
            CGH.panel.shadow.append(overlay);
          };

          const itemEl = CGH.el(
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
            CGH.el("div", { class: "cgh-grid-actions" }, dl),
            CGH.el("span", { class: "cgh-grid-cap" }, item.conversationTitle || CGH.formatDate(item.capturedAt))
          );
          grid.append(itemEl);
        }
        root.append(grid);
      };

      paint(images);

      // Index new GPT images in the background; refresh only if the set actually changed.
      this.scan().then((changed) => {
        if (!changed) return;
        if (CGH.panel?.currentTab !== "gallery") return;
        CGH.panel.refresh();
      });
    },
  };
})();
