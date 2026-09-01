(() => {
  if (window.__CGH_LIGHTTRIM_PATCHED__) return;
  window.__CGH_LIGHTTRIM_PATCHED__ = true;

  const DEFAULT_CFG = {
    enabled: false,
    limit: 10,
    keepSpecialRoles: true,
  };

  const getCfg = () => ({
    ...DEFAULT_CFG,
    ...(window.__CGH_LIGHTTRIM_CONFIG__ || {}),
  });

  const banner = (msg) => {
    try {
      const id = "cgh-lighttrim-toast";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        Object.assign(el.style, {
          position: "fixed",
          bottom: "16px",
          right: "16px",
          zIndex: "2147483646",
          padding: "8px 12px",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          fontSize: "12px",
          borderRadius: "10px",
          background: "var(--theme-submit-btn-bg, #0d0d0d)",
          color: "var(--theme-submit-btn-text, #fff)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.28)",
          pointerEvents: "none",
        });
        document.documentElement.appendChild(el);
      }
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(el.__h);
      el.__h = setTimeout(() => {
        el.style.display = "none";
      }, 2400);
    } catch {
      /* ignore */
    }
  };

  function trimConversation(data, cfg) {
    const mapping = data?.mapping;
    const current = data?.current_node;
    if (!mapping || !current || !mapping[current]) return null;

    const path = [];
    let cursor = current;
    const guard = new Set();
    while (cursor && mapping[cursor] && !guard.has(cursor)) {
      guard.add(cursor);
      path.push(cursor);
      cursor = mapping[cursor]?.parent ?? null;
    }
    path.reverse();

    const limit = Math.max(1, Number(cfg.limit) || DEFAULT_CFG.limit);
    let effective = path.slice(-limit);

    if (!cfg.keepSpecialRoles) {
      const filtered = [];
      const seen = new Set();
      for (const id of effective) {
        const role = mapping[id]?.message?.author?.role;
        if (role && role !== "user" && role !== "assistant") continue;
        if (seen.has(id)) continue;
        seen.add(id);
        filtered.push(id);
      }
      const ensure = (id) => {
        if (id && mapping[id] && !filtered.includes(id)) filtered.push(id);
      };
      if (effective.length) {
        ensure(effective[0]);
        ensure(effective[effective.length - 1]);
      }
      filtered.sort((a, b) => effective.indexOf(a) - effective.indexOf(b));
      effective = filtered;
    }

    if (!effective.length) return null;

    const newMapping = {};
    for (let i = 0; i < effective.length; i++) {
      const id = effective[i];
      const node = mapping[id];
      if (!node) continue;
      newMapping[id] = {
        ...node,
        parent: effective[i - 1] ?? null,
        children: effective[i + 1] ? [effective[i + 1]] : [],
      };
    }

    return {
      mapping: newMapping,
      current_node: effective[effective.length - 1] ?? current,
      root: effective[0] ?? current,
      keptCount: effective.length,
      totalCount: path.length,
    };
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const rawCfg = getCfg();
    const cfg = {
      ...rawCfg,
      enabled: !!rawCfg.enabled,
      limit: Math.max(1, Number(rawCfg.limit) || DEFAULT_CFG.limit),
      keepSpecialRoles: rawCfg.keepSpecialRoles !== false,
    };

    const res = await nativeFetch(...args);
    try {
      if (!cfg.enabled) return res;

      const req = args[0] instanceof Request ? args[0] : new Request(...args);
      if (req.method !== "GET") return res;

      const url = new URL(req.url, location.href);
      if (!url.pathname.startsWith("/backend-api/")) return res;

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) return res;

      const json = await res.clone().json().catch(() => null);
      if (!json || typeof json !== "object" || !json.mapping || !json.current_node) return res;

      const trimmed = trimConversation(json, cfg);
      if (!trimmed) return res;

      const totalBefore = Object.keys(json.mapping || {}).length;
      const keptAfter = Object.keys(trimmed.mapping || {}).length;
      if (keptAfter >= totalBefore) return res;

      const removed = Math.max(0, totalBefore - keptAfter);
      const percentSaved = totalBefore > 0 ? Math.round((removed / totalBefore) * 100) : 0;

      const out = {
        ...json,
        mapping: trimmed.mapping,
        current_node: trimmed.current_node,
      };
      if ("root" in json) out.root = trimmed.root;

      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.set("content-type", "application/json; charset=utf-8");

      const response = new Response(JSON.stringify(out), {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
      try {
        if (res.url) Object.defineProperty(response, "url", { value: res.url });
        if (res.type) Object.defineProperty(response, "type", { value: res.type });
      } catch {
        /* ignore */
      }

      banner(`Light trim: ${keptAfter}/${totalBefore} (−${removed}, ~${percentSaved}%)`);
      return response;
    } catch {
      return res;
    }
  };

  function applyConfig(incoming, { silent = false } = {}) {
    const next = {
      enabled: !!incoming.enabled,
      limit: Math.max(1, Number(incoming.limit) || DEFAULT_CFG.limit),
      keepSpecialRoles: incoming.keepSpecialRoles !== false,
    };
    const prev = window.__CGH_LIGHTTRIM_CONFIG__;
    window.__CGH_LIGHTTRIM_CONFIG__ = next;
    if (
      !silent &&
      (!prev || prev.enabled !== next.enabled || prev.limit !== next.limit)
    ) {
      banner(`Light trim ${next.enabled ? "ON" : "OFF"} — limit ${next.limit}`);
    }
  }

  // Config bridge from isolated content script (shared DOM attribute + postMessage).
  try {
    const raw = document.documentElement?.getAttribute("data-cgh-lighttrim-cfg");
    if (raw) applyConfig(JSON.parse(raw), { silent: true });
  } catch {
    /* ignore */
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (e.data?.source !== "cgh-helper" || e.data?.type !== "CGH_LIGHTTRIM_CONFIG") return;
    applyConfig({ ...DEFAULT_CFG, ...(e.data.detail || {}) });
  });

  try {
    const obs = new MutationObserver(() => {
      try {
        const raw = document.documentElement?.getAttribute("data-cgh-lighttrim-cfg");
        if (raw) applyConfig(JSON.parse(raw), { silent: true });
      } catch {
        /* ignore */
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-cgh-lighttrim-cfg"] });
  } catch {
    /* ignore */
  }
})();
