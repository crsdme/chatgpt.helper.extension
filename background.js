const BADGE_COLOR = "#0d0d0d";

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
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
