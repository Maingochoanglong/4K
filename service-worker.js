"use strict";

function parseYouTubeImageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const allowed = host === "i.ytimg.com"
    || host.endsWith(".ytimg.com")
    || host === "img.youtube.com";
  return url.protocol === "https:" && allowed ? url : null;
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url?.startsWith("https://www.youtube.com/")) return;
  chrome.tabs.sendMessage(tab.id, { type: "FOURK_TOGGLE_PANEL" }, () => {
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FOURK_DOWNLOAD_THUMBNAIL") {
    const url = parseYouTubeImageUrl(message.url);
    if (!url) {
      sendResponse({ ok: false, error: "The thumbnail isn't hosted on a YouTube image server." });
      return false;
    }

    const filename = String(message.filename || "youtube-thumbnail.jpg")
      .replace(/[\\/:*?"<>|]+/g, "")
      .slice(0, 120);
    chrome.downloads.download({ url: url.href, filename, saveAs: false }, (downloadId) => {
      const error = chrome.runtime.lastError;
      sendResponse(error
        ? { ok: false, error: error.message }
        : { ok: true, downloadId });
    });
    return true;
  }

  return false;
});