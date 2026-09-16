(function exposeTimeUtils(globalScope) {
  "use strict";

  function parseTime(value) {
    const raw = String(value ?? "").trim().replace(",", ".");

    if (!raw) {
      return Number.NaN;
    }

    const parts = raw.split(":");
    if (parts.length > 3 || parts.some((part) => part.trim() === "")) {
      return Number.NaN;
    }

    const numbers = parts.map(Number);
    if (numbers.some((number) => !Number.isFinite(number) || number < 0)) {
      return Number.NaN;
    }

    if (parts.length > 1 && numbers.slice(1).some((number) => number >= 60)) {
      return Number.NaN;
    }

    return numbers.reduce((total, number) => total * 60 + number, 0);
  }

  function formatTime(value, includeHours = false) {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const rounded = Math.floor(safeValue);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;

    if (includeHours || hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatPreciseTime(value) {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const wholeSeconds = Math.floor(safeValue);
    const tenths = Math.floor((safeValue - wholeSeconds) * 10);
    return `${formatTime(wholeSeconds)}.${tenths}`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function secondsFromDigitBuffer(buffer) {
    const safeBuffer = Math.max(0, Math.floor(Number(buffer) || 0));
    const seconds = safeBuffer % 100;
    const minutes = Math.floor(safeBuffer / 100) % 100;
    const hours = Math.floor(safeBuffer / 10000);
    return hours * 3600 + minutes * 60 + seconds;
  }

  const api = { parseTime, formatTime, formatPreciseTime, clamp, secondsFromDigitBuffer };
  globalScope.FourKTime = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
