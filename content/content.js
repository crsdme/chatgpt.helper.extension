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
      });
      CGH.lightTrim?.sync?.();
      await CGH.panel.mount();
      await CGH.queue.init();
      await CGH.favorites.init();
      await CGH.gallery.init();
      await CGH.pins.init();
      await CGH.conversations.init();
      await CGH.composerBar.ensure();
      bindComposerKeys();
      bindMessages();

      const refresh = CGH.debounce(() => {
        if (!stillAlive()) return;
        CGH.composerBar.ensure();
        CGH.pins.decorate();
        CGH.gallery.scan();
        CGH.conversations.scrape();
        CGH.dom.hideDisclaimer?.();
      }, 250);

      const obs = new MutationObserver(refresh);
      obs.observe(document.body, { childList: true, subtree: true });
      const tickId = setInterval(() => {
        if (!stillAlive()) {
          clearInterval(tickId);
          obs.disconnect();
          return;
        }
        CGH.composerBar.ensure();
        CGH.queue.tick();
      }, 1200);

      window.addEventListener("popstate", refresh);
      window.addEventListener("resize", () => {
        if (stillAlive()) CGH.composerBar.reposition();
      });
      window.addEventListener(
        "scroll",
        () => {
          if (stillAlive()) CGH.composerBar.reposition();
        },
        true
      );
      refresh();
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

