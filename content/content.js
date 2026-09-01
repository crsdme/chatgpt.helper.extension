(() => {
  const CGH = window.CGH;
  let settingsCache = {
    autoQueueWhenBusy: true,
    autoProcess: true,
    cacheImages: true,
  };

  function bindComposerKeys() {
    document.addEventListener(
      "keydown",
      (e) => {
        const composer = CGH.dom.getComposer();
        if (!composer) return;
        const inComposer = composer === e.target || composer.contains(e.target);
        if (!inComposer) return;

        if ((e.altKey && e.code === "KeyQ") || (e.ctrlKey && e.shiftKey && e.key === "Enter")) {
          e.preventDefault();
          e.stopPropagation();
          CGH.queue.enqueueFromComposer();
          return;
        }

        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          if (settingsCache.autoQueueWhenBusy && CGH.dom.isGenerating()) {
            e.preventDefault();
            e.stopPropagation();
            CGH.queue.enqueueFromComposer();
          }
        }
      },
      true
    );
  }

  function bindMessages() {
    try {
      if (!CGH.storage?.isAlive?.()) return;
      chrome.runtime.onMessage.addListener((msg) => {
        if (!CGH.extensionAlive) return;
        if (msg?.type === "TOGGLE_PANEL") CGH.panel.toggle();
        if (msg?.type === "QUEUE_PROMPT") CGH.queue.enqueueFromComposer();
        if (msg?.type === "QUEUE_TICK") CGH.queue?.tick?.();
        if (msg?.type === "INSERT_FAVORITE") {
          CGH.storage.get("favorites").then((list) => {
            const fav = (list || []).find((f) => f.id === msg.id);
            if (fav) CGH.favorites.insert(fav, { replace: !!msg.replace });
          });
        }
        if (msg?.type === "OPEN_TAB") CGH.panel.open(msg.tab);
      });
    } catch (err) {
      console.warn("CGH messaging unavailable", err);
    }
  }

  function stillAlive() {
    return CGH.extensionAlive !== false && CGH.storage?.isAlive?.() !== false;
  }

  async function init() {
    try {
      await CGH.storage.init();
      if (!stillAlive()) return;
      await CGH.i18n.load();
      settingsCache = (await CGH.storage.get("settings")) || settingsCache;
      CGH.storage.onChange((changes) => {
        if (!stillAlive()) return;
        if (changes.settings?.newValue) {
          settingsCache = changes.settings.newValue;
          CGH.lightTrim?.sync?.();
          if (changes.settings.newValue.language) {
            CGH.i18n.apply(changes.settings.newValue.language);
            CGH.panel?.refresh();
            CGH.composerBar?.update();
          }
        }
        // Rebuild chips only when favorites/queue actually change.
        if (changes.favorites || changes.queue) CGH.composerBar?.update();
      });
      CGH.lightTrim?.sync?.();
      await CGH.panel.mount();
      await CGH.queue.init();
      await CGH.favorites.init();
      await CGH.gallery.init();
      await CGH.pins.init();
      await CGH.conversations.init();
      await CGH.composerBar.ensure({ render: true });
      await CGH.caveman?.init?.();
      bindComposerKeys();
      bindMessages();

      const hookHistory = (key) => {
        const orig = history[key];
        if (typeof orig !== "function" || orig.__cghHooked) return;
        const wrapped = function (...args) {
          const ret = orig.apply(this, args);
          CGH.conversations?.scrape?.({ paint: true });
          CGH.pins?.consumePendingJump?.();
          return ret;
        };
        wrapped.__cghHooked = true;
        history[key] = wrapped;
      };
      hookHistory("pushState");
      hookHistory("replaceState");

      let rafPending = false;
      const repositionRaf = () => {
        if (rafPending || !stillAlive()) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          CGH.composerBar.reposition();
        });
      };

      // Rare: disclaimer + new pin buttons. Avoid whole-document scans on every mutation.
      const softRefresh = CGH.debounce(() => {
        if (!stillAlive()) return;
        CGH.dom.hideDisclaimer?.();
        CGH.pins.decorate();
        repositionRaf();
      }, 400);

      // Very rare: gallery index + conversation scrape (not on every DOM tweak).
      const heavyRefresh = CGH.debounce(() => {
        if (!stillAlive()) return;
        CGH.dom.hideDisclaimer?.();
        if (CGH.panel?.isOpen?.() && CGH.panel.currentTab === "gallery") {
          CGH.gallery.scan();
        }
        if (CGH.panel?.isOpen?.() && CGH.panel.currentTab === "conversations") {
          CGH.conversations.scrape({ paint: true });
        }
      }, 4000);

      const observeRoot = document.querySelector("main") || document.body;
      const obs = new MutationObserver((mutations) => {
        if (!stillAlive()) return;
        let relevant = false;
        let pinRemoved = false;
        let barMissing = !document.getElementById("cgh-composer-bar");
        for (const m of mutations) {
          if (m.type !== "childList") continue;
          for (const n of m.removedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.id === "cgh-composer-bar" || n.querySelector?.("#cgh-composer-bar")) {
              barMissing = true;
            }
            if (
              n.hasAttribute?.("data-cgh-pin") ||
              n.hasAttribute?.("data-cgh-pin-wrap") ||
              n.querySelector?.("[data-cgh-pin], [data-cgh-pin-wrap]")
            ) {
              pinRemoved = true;
            }
          }
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.id === "cgh-composer-bar" || n.closest?.("#cgh-composer-bar, #cgh-root")) continue;
            // Ignore our own pin re-inserts to avoid decorate loops.
            if (n.hasAttribute?.("data-cgh-pin") || n.hasAttribute?.("data-cgh-pin-wrap")) continue;
            relevant = true;
            break;
          }
          if (relevant || pinRemoved) break;
        }
        if (barMissing) {
          CGH.composerBar.ensure({ render: true });
        }
        if (!document.getElementById("cgh-fab") || !document.getElementById("cgh-root")) {
          CGH.panel?.ensureMounted?.();
        }
        if (pinRemoved) CGH.pins?.decorate?.();
        if (barMissing) return;
        if (!relevant) return;
        softRefresh();
        heavyRefresh();
      });
      obs.observe(observeRoot, { childList: true, subtree: true });

      const tickId = setInterval(() => {
        if (!stillAlive()) {
          clearInterval(tickId);
          obs.disconnect();
          return;
        }
        CGH.panel?.ensureMounted?.();
        CGH.queue.tick();
        // Occasional disclaimer pass if ChatGPT re-inserted the footer.
        if (!CGH.dom._disclaimerDone) CGH.dom.hideDisclaimer?.();
        repositionRaf();
      }, 2500);

      window.addEventListener("popstate", () => {
        CGH.dom._disclaimerDone = false;
        softRefresh();
        CGH.composerBar.ensure({ render: true });
        CGH.conversations.scrape({ paint: true });
        CGH.pins?.consumePendingJump?.();
        setTimeout(() => CGH.queue?.tick?.(), 600);
      });
      window.addEventListener("resize", repositionRaf);
      window.addEventListener("scroll", repositionRaf, { capture: true, passive: true });

      CGH.dom.hideDisclaimer?.();
      softRefresh();
    } catch (err) {
      console.error("CGH init failed", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
