const I18N = {
  ru: {
    sub: "Очередь, промпты, галерея, пины, диалоги",
    inQueue: "в очереди",
    promptsCount: "промптов",
    pinsCount: "пинов",
    favTitle: "Избранные промпты",
    setTitle: "Настройки",
    langLabel: "Язык интерфейса",
    autoQueue: "Если ChatGPT занят, Enter добавляет запрос в очередь",
    autoProcess: "Автоматически отправлять очередь",
    cacheImages: "Кэшировать изображения галереи",
    lightTrim: "Облегчение длинных чатов (LightSession)",
    lightTrimLimit: "Сколько сообщений оставлять",
    open: "Открыть ChatGPT",
    hint: "На странице чата: Alt+H — панель, Alt+Q — в очередь.",
    emptyFavs: "Пока пусто — сохраните промпт на странице ChatGPT.",
    copied: "Скопировано",
  },
  en: {
    sub: "Queue, prompts, gallery, pins, chats",
    inQueue: "in queue",
    promptsCount: "prompts",
    pinsCount: "pins",
    favTitle: "Favorite prompts",
    setTitle: "Settings",
    langLabel: "Interface language",
    autoQueue: "When ChatGPT is busy, Enter adds the prompt to the queue",
    autoProcess: "Automatically send the queue",
    cacheImages: "Cache gallery images",
    lightTrim: "Light long chats (LightSession)",
    lightTrimLimit: "Messages to keep",
    open: "Open ChatGPT",
    hint: "On the chat page: Alt+H — panel, Alt+Q — queue.",
    emptyFavs: "Empty for now — save a prompt on the ChatGPT page.",
    copied: "Copied",
  },
};

function applyUi(lang) {
  const t = I18N[lang] || I18N.ru;
  document.documentElement.lang = lang;
  document.getElementById("sub").textContent = t.sub;
  document.getElementById("qLabel").textContent = t.inQueue;
  document.getElementById("fLabel").textContent = t.promptsCount;
  document.getElementById("pLabel").textContent = t.pinsCount;
  document.getElementById("favTitle").textContent = t.favTitle;
  document.getElementById("setTitle").textContent = t.setTitle;
  document.getElementById("langLabel").textContent = t.langLabel;
  document.getElementById("autoQueueLabel").textContent = t.autoQueue;
  document.getElementById("autoProcessLabel").textContent = t.autoProcess;
  document.getElementById("cacheImagesLabel").textContent = t.cacheImages;
  document.getElementById("lightTrimLabel").textContent = t.lightTrim;
  document.getElementById("lightTrimLimitLabel").textContent = t.lightTrimLimit;
  document.getElementById("open").textContent = t.open;
  document.getElementById("hint").textContent = t.hint;
  return t;
}

async function load() {
  const data = await chrome.storage.local.get(["queue", "favorites", "pins", "settings"]);
  const settings = data.settings || {
    autoQueueWhenBusy: true,
    autoProcess: true,
    cacheImages: true,
    language: "ru",
    lightTrimEnabled: false,
    lightTrimLimit: 10,
  };
  const lang = settings.language === "en" ? "en" : "ru";
  const t = applyUi(lang);

  const queue = data.queue || [];
  const pending = queue.filter((i) => i.status === "pending" || i.status === "sending").length;
  document.getElementById("q").textContent = String(pending);
  document.getElementById("f").textContent = String((data.favorites || []).length);
  document.getElementById("p").textContent = String((data.pins || []).length);

  document.getElementById("language").value = lang;
  document.getElementById("autoQueue").checked = settings.autoQueueWhenBusy !== false;
  document.getElementById("autoProcess").checked = settings.autoProcess !== false;
  document.getElementById("cacheImages").checked = settings.cacheImages !== false;
  document.getElementById("lightTrim").checked = !!settings.lightTrimEnabled;
  document.getElementById("lightTrimLimit").value = String(Math.max(2, Number(settings.lightTrimLimit) || 10));

  const favs = document.getElementById("favs");
  favs.replaceChildren();
  const list = data.favorites || [];
  if (!list.length) {
    favs.append(Object.assign(document.createElement("div"), { className: "empty", textContent: t.emptyFavs }));
  } else {
    for (const fav of list.slice(0, 8)) {
      const btn = document.createElement("button");
      btn.className = "item";
      btn.type = "button";
      btn.textContent = fav.title;
      btn.title = fav.text;
      btn.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && /chatgpt\.com|chat\.openai\.com/.test(tab.url || "")) {
          chrome.tabs.sendMessage(tab.id, { type: "INSERT_FAVORITE", id: fav.id });
          window.close();
        } else {
          await navigator.clipboard.writeText(fav.text);
          btn.textContent = t.copied;
        }
      });
      favs.append(btn);
    }
  }
}

async function saveSettings() {
  const prev = (await chrome.storage.local.get("settings")).settings || {};
  const settings = {
    ...prev,
    autoQueueWhenBusy: document.getElementById("autoQueue").checked,
    autoProcess: document.getElementById("autoProcess").checked,
    cacheImages: document.getElementById("cacheImages").checked,
    language: document.getElementById("language").value === "en" ? "en" : "ru",
    lightTrimEnabled: document.getElementById("lightTrim").checked,
    lightTrimLimit: Math.max(2, Math.min(200, Number(document.getElementById("lightTrimLimit").value) || 10)),
  };
  document.getElementById("lightTrimLimit").value = String(settings.lightTrimLimit);
  await chrome.storage.local.set({ settings });
  applyUi(settings.language);
}

for (const id of ["autoQueue", "autoProcess", "cacheImages", "language", "lightTrim", "lightTrimLimit"]) {
  document.getElementById(id).addEventListener("change", async () => {
    await saveSettings();
    if (id === "language") load();
  });
}

document.getElementById("open").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://chatgpt.com/" });
});

load();
