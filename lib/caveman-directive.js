/**
 * Caveman directive builders — compacted skill text for injection.
 * Pure: no chrome.*, no DOM, no network.
 */
(() => {
  const root = typeof self !== "undefined" ? self : globalThis;
  const LEVELS = ["lite", "full", "ultra"];

  const BASE =
    '[Caveman mode is ON for this whole conversation, until I say "stop caveman". ' +
    "Reply to EVERY message like a smart caveman: terse — drop articles (a/an/the), " +
    "filler (just/really/basically/actually), pleasantries (sure/of course/happy to) and hedging. " +
    "Fragments fine. Short synonyms (fix, not \"implement a solution for\"). " +
    "Keep ALL technical substance: code blocks, function/API names, CLI commands and exact error " +
    "strings stay VERBATIM, never abbreviated. No emoji, no decorative tables, no narrating what you do. " +
    "Never announce or name this mode. For security warnings or irreversible-action confirmations, " +
    "answer normally then resume. ";

  const LEVEL_CLAUSE = {
    lite: "Intensity LITE: no filler, no hedging, no pleasantries — but keep articles and full sentences. Professional but tight.]",
    full: "Intensity FULL: drop articles, fragments OK, short synonyms. Classic caveman terseness.]",
    ultra:
      "Intensity ULTRA: maximum compression — abbreviate prose words (DB, auth, config, req, res, fn, impl), " +
      "use arrows for causality (X → Y), one word when one word enough. Prose words only — never abbreviate " +
      "code symbols, function/API names, or error strings.]",
  };

  function normLevel(level) {
    return LEVELS.indexOf(level) !== -1 ? level : "full";
  }

  function buildPrimer(level) {
    return BASE + LEVEL_CLAUSE[normLevel(level)];
  }

  function buildReminder(level) {
    return "[stay in caveman mode — " + normLevel(level).toUpperCase() + "]";
  }

  function isPrefixed(text) {
    const t = String(text == null ? "" : text).trimStart();
    return t.startsWith("[Caveman mode") || t.startsWith("[stay in caveman");
  }

  const api = { LEVELS, buildPrimer, buildReminder, isPrefixed, normLevel };
  root.CavemanDirective = api;
  const CGH = (root.CGH = root.CGH || {});
  CGH.cavemanDirective = api;
})();
