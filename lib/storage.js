(() => {
  const CGH = (window.CGH = window.CGH || {});
  const DB_NAME = "cgh-db";
  const DB_VERSION = 1;
  const DEFAULTS = {
    favorites: [
      {
        id: "starter-ru",
        title: "Переведи на русский",
        text: "Переведи на русский язык, сохранив смысл, тон и форматирование.",
        createdAt: 0,
      },
      {
        id: "starter-simple",
        title: "Проще",
        text: "Объясни это простыми словами. Коротко, без воды, с примером.",
        createdAt: 0,
      },
      {
        id: "starter-fix",
        title: "Найди ошибки",
        text: "Найди ошибки и слабые места. Затем дай исправленный вариант.",
        createdAt: 0,
      },
    ],
    queue: [],
    pins: [],
    folders: [],
    conversationMeta: {},
    images: [],
    queuePaused: false,
    settings: {
      autoQueueWhenBusy: true,
      autoProcess: true,
      cacheImages: true,
      language: "ru",
      lightTrimEnabled: false,
      lightTrimLimit: 10,
      lightTrimKeepSpecial: true,
    },
  };

  let dbPromise = null;
  let changeHooked = false;
  let extensionDead = false;
  const listeners = new Set();

  function isInvalidatedError(err) {
    const msg = String(err?.message || err || "");
    return /extension context invalidated/i.test(msg);
  }

  function markDead(err) {
    if (!extensionDead && isInvalidatedError(err)) {
      extensionDead = true;
      CGH.extensionAlive = false;
      console.warn("CGH: extension context invalidated — reload the ChatGPT tab");
    }
  }

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {
        /* fall through */
      }
    }
    if (value === null || typeof value !== "object") return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function defaultFor(key) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
    return clone(DEFAULTS[key]);
  }

  function mergeSettings(value) {
    return { ...clone(DEFAULTS.settings), ...(value && typeof value === "object" ? value : {}) };
  }

  function withDefault(key, value) {
    if (key === "settings") return mergeSettings(value);
    if (value !== undefined && value !== null) return value;
    return defaultFor(key);
  }

  function fallbackFor(keys) {
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) out[key] = withDefault(key, undefined);
      return out;
    }
    if (typeof keys === "string") return withDefault(keys, undefined);
    return {};
  }

  /** Never throws — returns false once the extension was reloaded/removed. */
  function storageAlive() {
    if (extensionDead) return false;
    try {
      // Accessing chrome.runtime after reload throws; optional chaining does NOT catch throws.
      if (typeof chrome === "undefined") return false;
      const runtime = chrome.runtime;
      if (!runtime || !runtime.id) {
        extensionDead = true;
        CGH.extensionAlive = false;
        return false;
      }
      return !!(chrome.storage && chrome.storage.local);
    } catch (err) {
      markDead(err);
      return false;
    }
  }

  function wrapChrome(fn, fallback) {
    if (!storageAlive()) return Promise.resolve(fallback);
    try {
      return Promise.resolve(fn())
        .then((value) => value)
        .catch((err) => {
          markDead(err);
          console.warn("CGH chrome API failed", err);
          return fallback;
        });
    } catch (err) {
      markDead(err);
      console.warn("CGH chrome API failed", err);
      return Promise.resolve(fallback);
    }
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
          if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      dbPromise = null;
      console.warn("CGH IndexedDB open failed", err);
      return null;
    });
    return dbPromise;
  }

  function idbOp(storeName, mode, fn) {
    return openDb().then((db) => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fnDone, value) => {
          if (settled) return;
          settled = true;
          fnDone(value);
        };
        try {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          const req = fn(store);
          tx.oncomplete = () => finish(resolve, req ? req.result : undefined);
          tx.onerror = () => finish(reject, tx.error || new Error("IndexedDB tx error"));
          tx.onabort = () => finish(reject, tx.error || new Error("IndexedDB tx aborted"));
          if (req) {
            req.onerror = () => finish(reject, req.error || new Error("IndexedDB request error"));
          }
        } catch (err) {
          finish(reject, err);
        }
      });
    });
  }

  function getLocal(keys) {
    // Guaranteed non-rejecting promise.
    return wrapChrome(() => chrome.storage.local.get(keys), null).then((data) => {
      if (!data) return fallbackFor(keys);
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) out[key] = withDefault(key, data[key]);
        return out;
      }
      if (typeof keys === "string") return withDefault(keys, data[keys]);
      return data;
    });
  }

  CGH.extensionAlive = true;

  CGH.storage = {
    defaults: DEFAULTS,

    isAlive: storageAlive,

    async init() {
      try {
        await openDb();
      } catch (err) {
        console.warn("CGH IndexedDB init failed", err);
      }

      if (!storageAlive()) return;

      const current = await wrapChrome(() => chrome.storage.local.get(null), null);
      if (!current) return;

      try {
        const patch = {};
        for (const [key, value] of Object.entries(DEFAULTS)) {
          if (current[key] === undefined) patch[key] = clone(value);
        }
        if (current.settings && typeof current.settings === "object") {
          const merged = mergeSettings(current.settings);
          if (JSON.stringify(merged) !== JSON.stringify(current.settings)) {
            patch.settings = merged;
          }
        }
        if (Object.keys(patch).length) {
          await wrapChrome(() => chrome.storage.local.set(patch), null);
        }
      } catch (err) {
        markDead(err);
        console.warn("CGH storage.init failed", err);
      }

      if (!changeHooked && storageAlive()) {
        changeHooked = true;
        try {
          chrome.storage.onChanged.addListener((changes, area) => {
            if (extensionDead || area !== "local") return;
            for (const cb of listeners) {
              try {
                cb(changes);
              } catch (err) {
                console.warn("CGH storage listener failed", err);
              }
            }
          });
        } catch (err) {
          markDead(err);
        }
      }
    },

    get: getLocal,

    set(patch) {
      if (!storageAlive() || !patch || typeof patch !== "object") return Promise.resolve();
      const next = { ...patch };
      if (next.settings && typeof next.settings === "object") {
        next.settings = mergeSettings(next.settings);
      }
      return wrapChrome(() => chrome.storage.local.set(next), null).then(() => undefined);
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async saveBlob(store, id, record) {
      try {
        await idbOp(store, "readwrite", (s) => s.put(record, id));
      } catch (err) {
        console.warn("CGH saveBlob failed", err);
      }
      return id;
    },

    async loadBlob(store, id) {
      try {
        return await idbOp(store, "readonly", (s) => s.get(id));
      } catch (err) {
        console.warn("CGH loadBlob failed", err);
        return null;
      }
    },

    async deleteBlob(store, id) {
      try {
        await idbOp(store, "readwrite", (s) => s.delete(id));
      } catch (err) {
        console.warn("CGH deleteBlob failed", err);
      }
    },

    async saveFile(file) {
      const id = CGH.uuid();
      const buffer = await file.arrayBuffer();
      await this.saveBlob("files", id, {
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        buffer,
      });
      return {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      };
    },

    async loadFile(meta) {
      if (!meta?.id) return null;
      const rec = await this.loadBlob("files", meta.id);
      if (!rec) return null;
      return new File([rec.buffer], rec.name || meta.name || "file", {
        type: rec.type || meta.type || "application/octet-stream",
        lastModified: rec.lastModified || meta.lastModified || Date.now(),
      });
    },

    async deleteFile(id) {
      await this.deleteBlob("files", id);
    },

    async saveImageBlob(id, blob, meta) {
      await this.saveBlob("images", id, { blob, ...meta });
    },

    async loadImageBlob(id) {
      return this.loadBlob("images", id);
    },

    async deleteImageBlob(id) {
      await this.deleteBlob("images", id);
    },
  };

  CGH.runtime = {
    alive: storageAlive,
    sendMessage(message) {
      if (!storageAlive()) return;
      try {
        const result = chrome.runtime.sendMessage(message);
        if (result && typeof result.catch === "function") {
          result.catch((err) => markDead(err));
        }
      } catch (err) {
        markDead(err);
      }
    },
    getURL(path) {
      if (!storageAlive()) return "";
      try {
        return chrome.runtime.getURL(path);
      } catch (err) {
        markDead(err);
        return "";
      }
    },
  };
})();
