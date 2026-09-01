(() => {
  const CGH = (window.CGH = window.CGH || {});

  // Strings live in lib/i18n.js — keep a safe fallback until i18n loads.
  CGH.t = CGH.t || {};

  CGH.uuid = () => {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  CGH.hash = (str) => {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  };

  CGH.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  CGH.debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  CGH.escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  CGH.formatDate = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString(CGH.i18n?.localeTag || "ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  CGH.formatSize = (bytes) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  };

  CGH.downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  CGH.el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
      else if (key === "html") node.innerHTML = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  CGH.svg = (path, size = 16) => {
    const wrap = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wrap.setAttribute("width", String(size));
    wrap.setAttribute("height", String(size));
    wrap.setAttribute("viewBox", "0 0 24 24");
    wrap.setAttribute("fill", "none");
    wrap.setAttribute("stroke", "currentColor");
    wrap.setAttribute("stroke-width", "2");
    wrap.setAttribute("stroke-linecap", "round");
    wrap.setAttribute("stroke-linejoin", "round");
    wrap.innerHTML = path;
    return wrap;
  };

  CGH.icons = {
    sparkles:
      '<path d="M12 3l1.4 4.2L18 8.6l-4.2 1.4L12 14l-1.4-4L6 8.6l4.6-1.4L12 3z"/><path d="M19 14l.7 2.1L22 16.8l-2.3.7L19 20l-.7-2.5L16 16.8l2.3-.7L19 14z"/><path d="M5 15l.6 1.8L7.5 17.4 5.6 18 5 20l-.6-2L2.5 17.4l1.9-.6L5 15z"/>',
    queue: '<path d="M4 6h16M4 12h10M4 18h16"/><circle cx="18" cy="12" r="2"/>',
    star: '<polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
    pin: '<path d="M12 17v5"/><path d="M9 4v6.5a1 1 0 0 1-.4.8l-3.1 2.3A1.5 1.5 0 0 0 6.5 16h11a1.5 1.5 0 0 0 .999-2.4l-3.1-2.3a1 1 0 0 1-.4-.8V4"/><path d="M8 4h8"/>',
    chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/>',
    pause: '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>',
    play: '<polygon points="7 4 20 12 7 20 7 4"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M10 11v6M14 11v6M6 7l1 14h10l1-14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    archive: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.2-5.9"/><path d="M21 3v6h-6"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  };
})();
