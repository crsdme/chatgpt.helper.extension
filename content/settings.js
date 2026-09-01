(() => {
  const CGH = (window.CGH = window.CGH || {});

  async function patchSettings(patch) {
    const cur = (await CGH.storage.get("settings")) || {};
    Object.assign(cur, patch);
    await CGH.storage.set({ settings: cur });
    CGH.lightTrim?.sync?.();
    return cur;
  }

  CGH.settingsUi = {
    async render(root) {
      const settings = (await CGH.storage.get("settings")) || {};
      const lang = settings.language || CGH.i18n?.lang || "ru";

      const langSection = CGH.el(
        "section",
        { class: "cgh-section" },
        CGH.el("h3", { class: "cgh-section-title" }, CGH.t.language),
        CGH.el("p", { class: "cgh-settings-hint" }, CGH.t.languageHint),
        CGH.el(
          "div",
          { class: "cgh-lang-row" },
          CGH.el(
            "button",
            {
              class: `cgh-btn cgh-lang-btn ${lang === "ru" ? "is-active" : ""}`,
              type: "button",
              onclick: async () => {
                await CGH.i18n.setLanguage("ru");
              },
            },
            CGH.t.russian
          ),
          CGH.el(
            "button",
            {
              class: `cgh-btn cgh-lang-btn ${lang === "en" ? "is-active" : ""}`,
              type: "button",
              onclick: async () => {
                await CGH.i18n.setLanguage("en");
              },
            },
            CGH.t.english
          )
        )
      );

      const defaults = {
        autoQueueWhenBusy: true,
        autoProcess: true,
        cacheImages: true,
        lightTrimEnabled: false,
        lightTrimKeepSpecial: true,
        cavemanEnabled: false,
      };
      const row = (key, label) => {
        const input = CGH.el("input", { type: "checkbox" });
        input.checked = settings[key] === undefined ? !!defaults[key] : !!settings[key];
        input.addEventListener("change", async () => {
          await patchSettings({ [key]: input.checked });
          if (key === "autoProcess" && input.checked) CGH.queue?.tryProcess?.();
          if (key === "cavemanEnabled") CGH.caveman?.refresh?.();
        });
        return CGH.el("label", { class: "cgh-check" }, input, label);
      };

      const general = CGH.el(
        "section",
        { class: "cgh-section" },
        CGH.el("h3", { class: "cgh-section-title" }, CGH.t.settingsGeneral),
        row("autoQueueWhenBusy", CGH.t.autoQueue),
        row("autoProcess", CGH.t.autoProcess),
        row("cacheImages", CGH.t.cacheImages)
      );

      const limitInput = CGH.el("input", {
        class: "cgh-input",
        type: "number",
        min: "2",
        max: "200",
        step: "1",
        value: String(Math.max(2, Number(settings.lightTrimLimit) || 10)),
      });
      limitInput.addEventListener("change", async () => {
        const limit = Math.max(2, Math.min(200, Number(limitInput.value) || 10));
        limitInput.value = String(limit);
        await patchSettings({ lightTrimLimit: limit });
      });

      const lightTrim = CGH.el(
        "section",
        { class: "cgh-section" },
        CGH.el("h3", { class: "cgh-section-title" }, CGH.t.lightTrim),
        CGH.el("p", { class: "cgh-settings-hint" }, CGH.t.lightTrimHint),
        row("lightTrimEnabled", CGH.t.lightTrimEnabled),
        CGH.el("label", { class: "cgh-label" }, CGH.t.lightTrimLimit),
        limitInput,
        row("lightTrimKeepSpecial", CGH.t.lightTrimKeepSpecial),
        CGH.el("p", { class: "cgh-muted" }, CGH.t.lightTrimReloadNote)
      );

      const level = CGH.cavemanDirective?.normLevel?.(settings.cavemanLevel) || "full";
      const levelSelect = CGH.el(
        "select",
        { class: "cgh-input" },
        CGH.el("option", { value: "lite" }, CGH.t.cavemanLite),
        CGH.el("option", { value: "full" }, CGH.t.cavemanFull),
        CGH.el("option", { value: "ultra" }, CGH.t.cavemanUltra)
      );
      levelSelect.value = level;
      levelSelect.addEventListener("change", async () => {
        await patchSettings({ cavemanLevel: levelSelect.value });
        CGH.caveman?.refresh?.();
      });

      const caveman = CGH.el(
        "section",
        { class: "cgh-section" },
        CGH.el("h3", { class: "cgh-section-title" }, CGH.t.caveman),
        CGH.el("p", { class: "cgh-settings-hint" }, CGH.t.cavemanHint),
        row("cavemanEnabled", CGH.t.cavemanEnabled),
        CGH.el("label", { class: "cgh-label" }, CGH.t.cavemanLevel),
        levelSelect,
        CGH.el("p", { class: "cgh-muted" }, CGH.t.cavemanIndicatorHint)
      );

      root.append(langSection, general, caveman, lightTrim, CGH.el("p", { class: "cgh-muted" }, CGH.t.shortcuts));
    },
  };
})();
