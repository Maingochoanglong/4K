(function installFourKPlayerBridge() {
  "use strict";

  if (window.__fourKBridgeInstalled) return;
  window.__fourKBridgeInstalled = true;

  const REQUEST_TAG = "__fourKBridgeRequest";
  const REPLY_TAG = "__fourKBridgeReply";
  const MAX_CAPTURED = 40;
  const captured = [];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function snapshot() {
    return captured.map((entry) => ({
      url: entry.url,
      videoId: entry.videoId,
      language: entry.language,
      kind: entry.kind,
      at: entry.at
    }));
  }

  function post(message) {
    try {
      window.postMessage(Object.assign({}, message, { __fourK: REPLY_TAG }), "*");
    } catch (_) {
    }
  }

  function isTimedTextUrl(url) {
    if (url.protocol !== "https:" || url.pathname !== "/api/timedtext") return false;
    if (!url.searchParams.has("pot")) return false;
    const host = url.hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com");
  }

  function remember(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch (_) {
      return;
    }
    if (!isTimedTextUrl(url)) return;

    const entry = {
      key: `${url.searchParams.get("v") || ""}|${url.searchParams.get("lang") || ""}|${url.searchParams.get("kind") || ""}`,
      url: url.href,
      videoId: url.searchParams.get("v") || "",
      language: url.searchParams.get("lang") || "",
      kind: url.searchParams.get("kind") || "",
      at: Date.now()
    };

    const index = captured.findIndex((item) => item.key === entry.key);
    if (index === -1) captured.push(entry);
    else captured[index] = entry;
    if (captured.length > MAX_CAPTURED) captured.splice(0, captured.length - MAX_CAPTURED);

    post({ type: "captured", entries: snapshot() });
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function patchedFetch(input) {
      try {
        const raw = typeof input === "string" ? input : String(input?.url || input?.href || input || "");
        remember(raw);
      } catch (_) {  }
      return nativeFetch.apply(this, arguments);
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  if (typeof nativeOpen === "function") {
    XMLHttpRequest.prototype.open = function patchedOpen(_method, url) {
      try {
        const raw = typeof url === "string" ? url : String(url?.href || url || "");
        remember(raw);
      } catch (_) {  }
      return nativeOpen.apply(this, arguments);
    };
  }

  function getPlayer() {
    const player = document.getElementById("movie_player");
    return player && typeof player.getOption === "function" && typeof player.setOption === "function"
      ? player
      : null;
  }

  function readPlayerOption(player, module, option) {
    try {
      return player.getOption(module, option);
    } catch (_) {
      return null;
    }
  }

  function writePlayerTrack(player, track) {
    try {
      player.setOption("captions", "track", track || {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function pickTrack(list, languageCode) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = String(languageCode || "").slice(0, 2).toLowerCase();
    const sameLanguage = (track) => wanted
      && String(track?.languageCode || "").toLowerCase().startsWith(wanted);
    const isManual = (track) => track?.kind !== "asr";

    return list.find((track) => sameLanguage(track) && isManual(track))
      || list.find(sameLanguage)
      || list.find(isManual)
      || list[0];
  }

  async function waitForCapture(sinceTimestamp, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (captured.some((entry) => entry.at >= sinceTimestamp)) return true;
      if (Date.now() >= deadline) return false;
      await sleep(150);
    }
  }

  async function harvest(request) {
    const log = [];
    const startedAt = Date.now();
    const timeoutMs = Math.min(Math.max(Number(request?.timeoutMs) || 9000, 2000), 20000);
    let restore = null;

    const player = getPlayer();
    if (player) {
      try {
        if (typeof player.loadModule === "function") player.loadModule("captions");
      } catch (_) {  }

      const list = readPlayerOption(player, "captions", "tracklist");
      const previous = readPlayerOption(player, "captions", "track");
      const wanted = pickTrack(list, request?.languageCode);
      log.push(`tracklist=${Array.isArray(list) ? list.length : 0}`);
      log.push(`previous=${previous?.languageCode || "off"}`);

      if (wanted) {
        writePlayerTrack(player, {});
        await sleep(250);
        writePlayerTrack(player, wanted);
        restore = () => writePlayerTrack(player, previous || {});
        log.push(`enabled=${wanted.languageCode || "?"}${wanted.kind === "asr" ? "/asr" : ""}`);
      }
    }

    if (!restore) {
      const button = document.querySelector(".ytp-subtitles-button");
      log.push(`ccButton=${button ? 1 : 0}`);
      if (button) {
        const wasOn = button.getAttribute("aria-pressed") === "true";
        if (wasOn) {
          button.click();
          await sleep(250);
        }
        button.click();
        restore = () => {
          if (!wasOn) button.click();
        };
        log.push("enabled=cc-button");
      }
    }

    if (!restore) {
      return { ok: false, log, entries: snapshot(), reason: "the player has no captions available to turn on." };
    }

    if (!(await waitForCapture(startedAt, timeoutMs))) {
      restore();
      return {
        ok: false,
        log,
        entries: snapshot(),
        reason: "captions were turned on but the player never called /api/timedtext with a pot."
      };
    }

    await sleep(1200);
    restore();
    return { ok: true, log, entries: snapshot(), reason: "" };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__fourK !== REQUEST_TAG) return;

    if (data.command === "ping") {
      post({ type: "pong", id: data.id });
      return;
    }
    if (data.command === "entries") {
      post({ type: "captured", id: data.id, entries: snapshot() });
      return;
    }
    if (data.command === "harvest") {
      harvest(data).then(
        (result) => post(Object.assign({}, result, { type: "harvest", id: data.id })),
        (error) => post({
          type: "harvest",
          id: data.id,
          ok: false,
          log: [],
          entries: snapshot(),
          reason: `bridge error: ${error?.message || error}`
        })
      );
    }
  });
})();
