const BADGE_COLOR = "#0d0d0d";
const QUEUE_ALARM = "cgh-queue-tick";
const CHATGPT_URLS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  ensureQueueAlarm();
});

chrome.runtime.onStartup?.addListener?.(ensureQueueAlarm);

function ensureQueueAlarm() {
  // Keep waking ChatGPT tabs so the queue continues while the tab is in the background.
  // Chrome clamps periodic alarms; ~0.5–1 min is enough as a heartbeat.
  chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 0.5 });
}

ensureQueueAlarm();

async function pingChatGptTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: CHATGPT_URLS });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "QUEUE_TICK" });
      } catch {
        /* tab has no content script yet */
      }
    }
  } catch (err) {
    console.warn("CGH queue ping", err);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUEUE_ALARM) pingChatGptTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "QUEUE_COUNT") {
    const text = message.count ? String(message.count) : "";
    const tabId = sender.tab?.id;
    if (tabId != null) {
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
    } else {
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "OPEN_CHATGPT") {
    chrome.tabs.create({ url: "https://chatgpt.com/" });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "QUEUE_WAKE") {
    ensureQueueAlarm();
    pingChatGptTabs();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const url = tab.url || "";
  if (!/https:\/\/(chatgpt\.com|chat\.openai\.com)/.test(url)) return;

  chrome.tabs.sendMessage(tab.id, {
    type: command === "queue-prompt" ? "QUEUE_PROMPT" : "TOGGLE_PANEL",
  });
});
