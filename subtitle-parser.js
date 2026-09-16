(function exposeSubtitleUtils(globalScope) {
  "use strict";

  const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  const FORMAT_META = {
    txt: { extension: "txt", mime: "text/plain" },
    srt: { extension: "srt", mime: "application/x-subrip" },
    vtt: { extension: "vtt", mime: "text/vtt" },
    json: { extension: "json", mime: "application/json" }
  };

  function isCaptionUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (_) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    const allowed = host === "youtube.com" || host.endsWith(".youtube.com");
    return url.protocol === "https:" && allowed ? url : null;
  }

  function withCaptionFormat(rawUrl, format) {
    const url = isCaptionUrl(rawUrl);
    if (!url) return null;
    const kept = url.search
      ? url.search.slice(1).split("&").filter((pair) => pair && !/^fmt=/i.test(pair))
      : [];
    kept.push(`fmt=${encodeURIComponent(format)}`);
    return `${url.origin}${url.pathname}?${kept.join("&")}`;
  }

  function roundMs(value) {
    return Math.round(value * 1000) / 1000;
  }

  function decodeEntities(value) {
    return String(value ?? "").replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
      if (body[0] === "#") {
        const isHex = body[1] === "x" || body[1] === "X";
        const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
        try {
          return String.fromCodePoint(codePoint);
        } catch (_) {
          return match;
        }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? match : named;
    });
  }

  function normalizeText(value) {
    return decodeEntities(value)
      .replace(/\r/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripTags(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ");
  }

  function parseTimestamp(value) {
    const raw = String(value ?? "").trim().replace(",", ".");
    if (!raw) return Number.NaN;

    const multiplier = /ms$/i.test(raw) ? 0.001 : 1;
    const body = raw.replace(/(?:ms|s)$/i, "");
    const parts = body.split(":");
    if (parts.length > 3 || parts.some((part) => part.trim() === "")) return Number.NaN;

    const numbers = parts.map(Number);
    if (numbers.some((number) => !Number.isFinite(number) || number < 0)) return Number.NaN;

    return numbers.reduce((total, number) => total * 60 + number, 0) * multiplier;
  }

  function readAttribute(attributes, name) {
    const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(attributes);
    return match ? decodeEntities(match[1]) : "";
  }

  function finalizeCues(cues) {
    const usable = cues
      .filter((cue) => cue && Number.isFinite(cue.start) && cue.start >= 0 && cue.text)
      .sort((a, b) => a.start - b.start)
      .map((cue) => ({
        start: cue.start,
        end: Number.isFinite(cue.end) ? cue.end : null,
        text: cue.text
      }));

    return usable.map((cue, index) => {
      let end = cue.end;
      if (end === null) {
        const next = usable[index + 1];
        end = next ? next.start : cue.start + 2;
      }
      if (end <= cue.start) end = cue.start + 0.5;
      return { start: roundMs(cue.start), end: roundMs(end), text: cue.text };
    });
  }

  function parseJson3(payload) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    return finalizeCues(events.map((event) => {
      const start = Number(event?.tStartMs);
      if (!Number.isFinite(start) || start < 0) return null;
      const duration = Number(event.dDurationMs);
      const text = normalizeText((Array.isArray(event.segs) ? event.segs : [])
        .map((segment) => segment?.utf8 ?? "")
        .join(""));
      if (!text) return null;
      return {
        start: start / 1000,
        end: Number.isFinite(duration) && duration > 0 ? (start + duration) / 1000 : null,
        text
      };
    }).filter(Boolean));
  }

  function parseXmlCaptions(source) {
    const text = String(source ?? "");
    const cues = [];

    const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = textPattern.exec(text)) !== null) {
      const start = parseTimestamp(readAttribute(match[1], "start"));
      const duration = parseTimestamp(readAttribute(match[1], "dur"));
      cues.push({
        start,
        end: Number.isFinite(start) && Number.isFinite(duration) ? start + duration : null,
        text: normalizeText(stripTags(match[2]))
      });
    }

    const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    while ((match = paragraphPattern.exec(text)) !== null) {
      const attributes = match[1];
      const start = parseTimestamp(readAttribute(attributes, "begin"));
      const end = parseTimestamp(readAttribute(attributes, "end"));
      const duration = parseTimestamp(readAttribute(attributes, "d"));
      cues.push({
        start,
        end: Number.isFinite(end)
          ? end
          : (Number.isFinite(start) && Number.isFinite(duration) ? start + duration : null),
        text: normalizeText(stripTags(match[2]))
      });
    }

    return finalizeCues(cues);
  }

  function parseVtt(source) {
    const blocks = String(source ?? "")
      .replace(/^\uFEFF/, "")
      .replace(/\r/g, "")
      .split(/\n{2,}/);
    const cues = [];

    blocks.forEach((block) => {
      const lines = block.split("\n").filter((line) => line.trim() !== "");
      const arrowIndex = lines.findIndex((line) => line.includes("-->"));
      if (arrowIndex === -1) return;

      const [rawStart, rawRest] = lines[arrowIndex].split("-->");
      const start = parseTimestamp(rawStart);
      const end = parseTimestamp(String(rawRest ?? "").trim().split(/\s+/)[0]);
      const text = normalizeText(lines.slice(arrowIndex + 1).join(" "));
      if (!text) return;

      const previous = cues[cues.length - 1];
      if (previous && previous.text === text && Math.abs(previous.start - start) < 0.001) return;
      cues.push({ start, end, text });
    });

    return finalizeCues(cues);
  }

  function parseTranscript(payload) {
    const found = [];

    const readSegment = (renderer) => {
      const start = Number(renderer?.startMs);
      if (!Number.isFinite(start) || start < 0) return;
      const runs = renderer.snippet?.runs;
      if (!Array.isArray(runs)) return;
      const text = normalizeText(runs.map((run) => run?.text ?? "").join(""));
      if (!text) return;
      const end = Number(renderer.endMs);
      found.push({
        start: start / 1000,
        end: Number.isFinite(end) && end > start ? end / 1000 : null,
        text
      });
    };

    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 48) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (node.transcriptSegmentRenderer) {
        readSegment(node.transcriptSegmentRenderer);
        return;
      }
      if (Number.isFinite(Number(node.startMs)) && node.snippet) {
        readSegment(node);
        return;
      }
      for (const value of Object.values(node)) walk(value, depth + 1);
    };

    walk(payload, 0);
    return finalizeCues(found);
  }

  function parseCaptions(source) {
    const text = String(source ?? "").replace(/^\uFEFF/, "").trim();
    if (!text) return [];

    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const payload = JSON.parse(text);
        const cues = parseJson3(payload);
        if (cues.length) return cues;
        const transcript = parseTranscript(payload);
        if (transcript.length) return transcript;
      } catch (_) {
      }
    }
    if (/WEBVTT/i.test(text.slice(0, 64))) return parseVtt(text);
    if (text.startsWith("<")) return parseXmlCaptions(text);
    return parseVtt(text);
  }

  function formatTimestamp(seconds, style = "clock") {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    if (style === "seconds") return String(roundMs(safe));

    const totalMs = Math.round(safe * 1000);
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const wholeSeconds = Math.floor((totalMs % 60_000) / 1000);
    const millis = totalMs % 1000;
    const pad = (value, length = 2) => String(value).padStart(length, "0");

    if (style === "short") {
      return hours
        ? `${hours}:${pad(minutes)}:${pad(wholeSeconds)}`
        : `${pad(minutes)}:${pad(wholeSeconds)}`;
    }
    return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)}.${pad(millis, 3)}`;
  }

  function srtClock(seconds) {
    return formatTimestamp(seconds, "clock").replace(".", ",");
  }

  function filterCues(cues, start, end) {
    if (!Array.isArray(cues)) return [];
    const from = Number.isFinite(start) ? Math.max(0, start) : 0;
    const to = Number.isFinite(end) && end > from ? end : Number.POSITIVE_INFINITY;
    return cues.filter((cue) => cue.end > from && cue.start < to);
  }

  function toSrt(cues) {
    return cues
      .map((cue, index) => `${index + 1}\n${srtClock(cue.start)} --> ${srtClock(cue.end)}\n${cue.text}`)
      .join("\n\n");
  }

  function toVtt(cues) {
    const body = cues
      .map((cue) => `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`)
      .join("\n\n");
    return body ? `WEBVTT\n\n${body}` : "WEBVTT";
  }

  function toTxt(cues, timeStyle = "clock") {
    return cues.map((cue) => `[${formatTimestamp(cue.start, timeStyle)}] ${cue.text}`).join("\n");
  }

  function toJson(cues) {
    return JSON.stringify(cues.map((cue) => ({
      start: roundMs(cue.start),
      end: roundMs(cue.end),
      text: cue.text
    })), null, 2);
  }

  function renderCues(cues, format = "txt", options = {}) {
    const list = Array.isArray(cues) ? cues : [];
    if (format === "srt") return toSrt(list);
    if (format === "vtt") return toVtt(list);
    if (format === "json") return toJson(list);
    return toTxt(list, options.timeStyle || "clock");
  }

  const api = {
    FORMAT_META,
    isCaptionUrl,
    withCaptionFormat,
    decodeEntities,
    normalizeText,
    stripTags,
    parseTimestamp,
    finalizeCues,
    parseJson3,
    parseXmlCaptions,
    parseVtt,
    parseTranscript,
    parseCaptions,
    formatTimestamp,
    filterCues,
    toSrt,
    toVtt,
    toTxt,
    toJson,
    renderCues
  };
  globalScope.FourKSubtitles = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
