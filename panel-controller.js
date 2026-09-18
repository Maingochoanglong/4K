(function initializeFourKPanel() {
  "use strict";

  if (window.top !== window || window.__fourKPanelLoaded) {
    return;
  }
  window.__fourKPanelLoaded = true;

  const { parseTime, formatTime, formatPreciseTime, clamp, secondsFromDigitBuffer } = window.FourKTime;
  const { parseCaptions, parseTranscript, finalizeCues, normalizeText, stripTags, renderCues, formatTimestamp, FORMAT_META, isCaptionUrl, withCaptionFormat, filterCues } = window.FourKSubtitles;
  const MAX_CLIP_SECONDS = 15 * 60;
  const FRAME_FORMAT_META = {
    png: { mime: "image/png", extension: "png", label: "PNG" },
    jpeg: { mime: "image/jpeg", extension: "jpg", label: "JPG" },
    webp: { mime: "image/webp", extension: "webp", label: "WebP" },
    avif: { mime: "image/avif", extension: "avif", label: "AVIF" }
  };
  const MAX_TIME_MASK_DIGITS = 6;
  const timeInputBuffers = new WeakMap();
  const CAPTION_FORMATS = ["json3", "srv3", "srv1", "vtt"];
  const BRIDGE_REQUEST = "__fourKBridgeRequest";
  const BRIDGE_REPLY = "__fourKBridgeReply";
  const POT_CACHE_AGE_MS = 60 * 1000;
  const RECORDING_RING_RADIUS = 46;
  const RECORDING_RING_CIRCUMFERENCE = 2 * Math.PI * RECORDING_RING_RADIUS;

  // Inline icon set (20x20 viewBox, stroke = currentColor) — no external icon font or
  // network fetch, kept as small reusable strings so multi-use icons aren't duplicated.
  const ICON_CLOSE = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const ICON_THUMBNAIL = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_COPY = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-7A1.5 1.5 0 0 0 3 5.5v7A1.5 1.5 0 0 0 4.5 14H6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const ICON_CLOCK = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.4V10l2.6 1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_MOVIE = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8.3 8.1v3.8l3.3-1.9-3.3-1.9Z" fill="currentColor"/></svg>`;
  const ICON_CAMERA = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 7.6A1.5 1.5 0 0 1 5.5 6.1h1.3l.8-1.3a1 1 0 0 1 .9-.5h3a1 1 0 0 1 .9.5l.8 1.3h1.3A1.5 1.5 0 0 1 16 7.6v6.8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.4V7.6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="10.8" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const ICON_INFO = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.5"/><path d="M10 9.3v4.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="6.7" r="0.9" fill="currentColor"/></svg>`;
  const ICON_SHIELD = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3.2 15.6 5.3v4.2c0 3.7-2.4 6.4-5.6 7.3-3.2-.9-5.6-3.6-5.6-7.3V5.3L10 3.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.5 10.1 9.2 11.8l3.3-3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_DOWNLOAD = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v8.6M6.6 9.8 10 13.2l3.4-3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 14.6v1.2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const ICON_HEADPHONES = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.2 11.7v-1.2a5.8 5.8 0 0 1 11.6 0v1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="3.1" y="11.2" width="3.1" height="4.8" rx="1.3" stroke="currentColor" stroke-width="1.5"/><rect x="13.8" y="11.2" width="3.1" height="4.8" rx="1.3" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const ICON_SUBTITLES = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6.1 11.8c-1 0-1.7-.7-1.7-2s.7-2 1.7-2c.5 0 .9.2 1.2.5M11.7 11.8c-1 0-1.7-.7-1.7-2s.7-2 1.7-2c.5 0 .9.2 1.2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  const ICON_CHEVRON = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.5 8 10 12.3 14.5 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_ARROW_BACK = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.3 5.2 7 10.4l5.3 5.2M7.5 10.4H16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_FILE = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 3.5h5.4l3.1 3.1V16a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.3 3.6v3.1h3.1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const capturedCaptionUrls = [];
  const bridgeRequests = new Map();
  let bridgeRequestId = 0;
  let innerTubeSession = null;

  const state = {
    root: null,
    video: null,
    videoRecorder: null,
    audioRecorder: null,
    captureStream: null,
    clipUrl: null,
    clipBlob: null,
    clipFileName: "",
    clipFrameFormat: "png",
    audioUrl: null,
    audioBlob: null,
    audioFileName: "",
    audioExtension: "",
    lastClipSelection: null,
    outputKind: null,
    mode: "video",
    frameFormat: "png",
    recording: false,
    cancelling: false,
    currentUrl: location.href,
    previousPlayback: null,
    stopTimer: null,
    progressInterval: null,
    frameRequest: null,
    playbackGuard: null,
    timeUpdateHandler: null,
    activeSelection: null,
    boundVideos: new WeakSet(),
    subTracks: [],
    subCues: [],
    subVideoId: "",
    subNoTracks: false,
    subLoading: false,
    subFormat: "txt",
    subTimeStyle: "clock"
  };

  function isWatchPage() {
    return location.hostname.endsWith("youtube.com") && location.pathname === "/watch";
  }

  function findVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function createElementFromHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  function mount() {
    if (!isWatchPage()) {
      if (state.root) state.root.hidden = true;
      return;
    }

    state.video = findVideo();
    if (!state.video) {
      window.setTimeout(mount, 800);
      return;
    }

    if (state.root?.isConnected) {
      state.root.hidden = false;
      refreshVideoInfo();
      return;
    }

    state.root = createElementFromHTML(`
      <aside id="fourk-root" aria-label="4K">
        <section class="fourk-card">
          <header class="fourk-header">
            <div class="fourk-brand">
              <span class="fourk-logo" aria-hidden="true">4K</span>
              <div class="fourk-brand-copy">
                <span class="fourk-brand-name">Video Clipper</span>
                <span class="fourk-version-badge" data-role="version-badge"></span>
              </div>
            </div>
            <button class="fourk-icon-btn" data-action="collapse" type="button" aria-label="Close panel">
              ${ICON_CLOSE}
            </button>
          </header>

          <div class="fourk-scroll-area">
            <div class="fourk-video-summary">
              <div class="fourk-live-row">
                <div class="fourk-live-left"><span class="fourk-live-dot" aria-hidden="true"></span><span>YouTube Watch</span></div>
                <div class="fourk-live-time"><span data-role="current-time">0:00</span> / <span data-role="video-duration">--:--</span></div>
              </div>
              <p class="fourk-video-title">Loading video info…</p>
              <div class="fourk-thumbnail-actions">
                <button type="button" class="fourk-chip-btn" data-action="get-thumbnail">
                  ${ICON_THUMBNAIL}
                  <span>Download Thumbnail</span>
                </button>
                <button type="button" class="fourk-chip-btn" data-action="get-title">
                  ${ICON_COPY}
                  <span>Copy Title</span>
                </button>
              </div>
            </div>

            <div class="fourk-form" data-view="form">
              <nav class="fourk-tabs" role="tablist" aria-label="Choose a tool">
                <button type="button" class="fourk-tab is-active" data-tool="video" role="tab" aria-selected="true">
                  ${ICON_MOVIE}
                  <span>Video Clip</span>
                </button>
                <button type="button" class="fourk-tab" data-tool="frame" role="tab" aria-selected="false">
                  ${ICON_CAMERA}
                  <span>Frame</span>
                </button>
              </nav>

              <div class="fourk-panels">
                <div data-mode-panel="video">
                  <div class="fourk-range-section">
                    <div class="fourk-section-label">
                      <span class="fourk-section-label-left"><span>Time range</span><span title="Accurate to the hundredth of a second">${ICON_INFO}</span></span>
                      <span class="fourk-duration-badge" data-role="selection-duration">30 seconds</span>
                    </div>

                    <div class="fourk-time-grid">
                      <div class="fourk-time-card">
                        <div class="fourk-time-card-head"><span>Start time</span><span class="fourk-time-tag">IN</span></div>
                        <div class="fourk-input-wrap">
                          <input data-input="start" value="0:00" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Start time">
                        </div>
                        <button type="button" class="fourk-text-link" data-action="set-start">${ICON_CLOCK}<span>Use current (<span class="fourk-live-hint">0:00</span>)</span></button>
                      </div>
                      <div class="fourk-time-card">
                        <div class="fourk-time-card-head"><span>End time</span><span class="fourk-time-tag">OUT</span></div>
                        <div class="fourk-input-wrap">
                          <input data-input="end" value="0:30" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="End time">
                        </div>
                        <button type="button" class="fourk-text-link" data-action="set-end">${ICON_CLOCK}<span>Use current (<span class="fourk-live-hint">0:00</span>)</span></button>
                      </div>
                    </div>

                    <div class="fourk-inline-row">
                      <span>Quick clip</span>
                      <div class="fourk-segment">
                        <button type="button" class="fourk-segment-btn" data-duration="15" aria-pressed="false">15s</button>
                        <button type="button" class="fourk-segment-btn is-active" data-duration="30" aria-pressed="true">30s</button>
                        <button type="button" class="fourk-segment-btn" data-duration="60" aria-pressed="false">60s</button>
                      </div>
                    </div>
                  </div>

                  <button class="fourk-primary" type="button" data-action="create">${ICON_MOVIE}<span>Create clip</span></button>

                  <div class="fourk-notice">
                    ${ICON_INFO}
                    <p><strong>Note:</strong> clips can run up to 15 minutes. Creating one plays it back once in this tab, so it takes as long as the clip itself.</p>
                  </div>
                </div>

                <div data-mode-panel="frame" hidden>
                  <span class="fourk-field-label">Capture timecode</span>
                  <div class="fourk-frame-time">
                    <div class="fourk-input-wrap">
                      <input data-input="frame" value="0:00" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Frame capture time">
                    </div>
                    <button type="button" class="fourk-text-link" data-action="set-frame">${ICON_CLOCK}<span>Use current (<span class="fourk-live-hint">0:00</span>)</span></button>
                  </div>

                  <span class="fourk-field-label">Image format</span>
                  <div class="fourk-segment fourk-segment-grid">
                    <button type="button" class="fourk-segment-btn" data-frame-format="png">PNG</button>
                    <button type="button" class="fourk-segment-btn" data-frame-format="jpeg">JPG</button>
                    <button type="button" class="fourk-segment-btn" data-frame-format="webp">WebP</button>
                    <button type="button" class="fourk-segment-btn" data-frame-format="avif">AVIF</button>
                  </div>

                  <button class="fourk-primary" type="button" data-action="capture-frame"><span>Capture frame</span></button>
                </div>
              </div>

              <div class="fourk-message" data-role="message" hidden></div>
              <p class="fourk-privacy">${ICON_SHIELD}<span>Processed entirely in your browser. Nothing is uploaded.</span></p>
            </div>

            <div class="fourk-recording" data-view="recording" hidden>
              <div class="fourk-target-card">
                <span class="fourk-target-icon">${ICON_MOVIE}</span>
                <div class="fourk-target-body">
                  <div class="fourk-target-head"><span>Target selection</span><span data-role="target-duration">30s</span></div>
                  <div class="fourk-target-range" data-role="target-range">0:00 → 0:30</div>
                  <div class="fourk-target-meta" data-role="target-meta"></div>
                </div>
              </div>

              <div class="fourk-process-card">
                <div class="fourk-ring-wrap">
                  <svg class="fourk-ring" viewBox="0 0 108 108" aria-hidden="true">
                    <circle class="fourk-ring-track" cx="54" cy="54" r="46" fill="none" stroke="currentColor" stroke-width="9"></circle>
                    <circle class="fourk-ring-progress" data-role="progress-ring" cx="54" cy="54" r="46" fill="none" stroke="currentColor" stroke-width="9" stroke-dasharray="289.03" stroke-dashoffset="289.03"></circle>
                  </svg>
                  <div class="fourk-ring-label">
                    <span class="fourk-ring-percent" data-role="recording-percent">0</span>
                    <span class="fourk-ring-status"><i></i>Encoding</span>
                  </div>
                </div>
                <strong class="fourk-process-heading" data-role="recording-heading">Creating video clip</strong>
                <p class="fourk-process-desc">Keep this tab visible until it finishes.</p>
                <div class="fourk-progress"><i data-role="progress-bar"></i></div>
                <div class="fourk-progress-meta"><span data-role="progress-time">0:00 / 0:30</span><span>Processing</span></div>
              </div>

              <button class="fourk-secondary fourk-danger" type="button" data-action="cancel">Cancel</button>
            </div>

            <div class="fourk-result" data-view="result" hidden>
              <div class="fourk-success-badge">
                <span class="fourk-badge-icon" aria-hidden="true">✓</span>
                <div class="fourk-success-badge-text">
                  <strong data-role="result-heading">Clip ready</strong>
                  <small data-role="result-description">Your file is ready.</small>
                </div>
              </div>
              <div class="fourk-preview-wrap">
                <video data-role="preview-video" controls playsinline></video>
                <img data-role="preview-image" alt="Captured frame">
              </div>
              <div class="fourk-file-info">
                <span class="fourk-file-icon">${ICON_FILE}</span>
                <div class="fourk-file-text">
                  <strong data-role="file-name">youtube-clip.mp4</strong>
                  <small data-role="file-meta">MP4</small>
                </div>
              </div>
              <button class="fourk-primary" type="button" data-action="download">${ICON_DOWNLOAD}<span data-role="download-label">Download video</span><span class="fourk-button-trailing" data-role="download-size"></span></button>
              <button class="fourk-secondary" type="button" data-action="copy-image" hidden>${ICON_COPY}<span data-role="copy-image-label">Copy image</span></button>

              <div class="fourk-export" data-role="export-section" hidden>
                <button class="fourk-secondary" type="button" data-action="download-audio" data-role="download-audio-btn" hidden>
                  ${ICON_HEADPHONES}<span>Download audio</span><span class="fourk-export-meta" data-role="audio-meta"></span>
                </button>

                <button class="fourk-secondary fourk-accordion-toggle" type="button" data-action="toggle-subtitles" aria-expanded="false">
                  ${ICON_SUBTITLES}<span class="fourk-accordion-label">Subtitles</span><span class="fourk-accordion-chevron">${ICON_CHEVRON}</span>
                </button>

                <div class="fourk-sub-panel" data-role="sub-export-panel" hidden>
                  <div class="fourk-section-label"><span class="fourk-section-label-left"><span>Cue list</span></span><span class="fourk-duration-badge" data-role="sub-count">None</span></div>

                  <label class="fourk-sub-field">
                    <span class="fourk-field-label">Language</span>
                    <div class="fourk-select-wrap">
                      <select data-select="sub-track" aria-label="Choose subtitle language"><option value="">Subtitles load automatically</option></select>
                      <span class="fourk-select-chevron">${ICON_CHEVRON}</span>
                    </div>
                  </label>

                  <span class="fourk-field-label">Format</span>
                  <div class="fourk-segment fourk-segment-grid">
                    <button type="button" data-sub-format="txt" class="fourk-segment-btn is-active" aria-pressed="true">TXT</button>
                    <button type="button" data-sub-format="srt" class="fourk-segment-btn" aria-pressed="false">SRT</button>
                    <button type="button" data-sub-format="vtt" class="fourk-segment-btn" aria-pressed="false">VTT</button>
                    <button type="button" data-sub-format="json" class="fourk-segment-btn" aria-pressed="false">JSON</button>
                  </div>

                  <label class="fourk-sub-field" data-role="sub-time-style-field">
                    <span class="fourk-field-label">TXT timestamp format</span>
                    <div class="fourk-select-wrap">
                      <select data-select="sub-time-style" aria-label="Timestamp style">
                        <option value="clock">00:01:23.450 (hours:minutes:seconds.ms)</option>
                        <option value="short">01:23 (minutes:seconds)</option>
                        <option value="seconds">83.45 (decimal seconds)</option>
                      </select>
                      <span class="fourk-select-chevron">${ICON_CHEVRON}</span>
                    </div>
                  </label>

                  <button class="fourk-secondary" type="button" data-action="load-subtitles"><span>Load subtitles</span></button>

                  <div class="fourk-sub-preview" data-role="sub-preview" hidden></div>

                  <div class="fourk-sub-actions" data-role="sub-actions" hidden>
                    <button class="fourk-secondary" type="button" data-action="copy-subtitles">${ICON_COPY}<span data-role="copy-sub-label">Copy</span></button>
                    <button class="fourk-primary" type="button" data-action="download-subtitles">${ICON_DOWNLOAD}<span>Download</span></button>
                  </div>
                </div>
              </div>

              <button class="fourk-secondary fourk-ghost" type="button" data-action="reset">${ICON_ARROW_BACK}<span data-role="reset-label">Create another clip</span></button>
            </div>
          </div>
        </section>
      </aside>
    `);

    document.documentElement.appendChild(state.root);
    const versionBadge = query('[data-role="version-badge"]');
    if (versionBadge) {
      try {
        versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
      } catch (_) {
        versionBadge.hidden = true;
      }
    }
    setView("form");
    bindEvents();
    setupFrameFormatOptions();
    refreshVideoInfo(true);
  }

  function query(selector) {
    return state.root?.querySelector(selector);
  }

  function setView(name) {
    ["form", "recording", "result"].forEach((view) => {
      query(`[data-view="${view}"]`).hidden = view !== name;
    });
  }

  function showMessage(text, type = "error") {
    const message = query('[data-role="message"]');
    message.textContent = text;
    message.dataset.type = type;
    message.hidden = !text;
  }

  function clearMessage() {
    showMessage("");
  }

  function getRawVideoTitle() {
    return document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim()
      || document.title.replace(/\s*-\s*YouTube\s*$/, "")
      || "";
  }

  function refreshVideoInfo(resetSelection = false) {
    const latestVideo = findVideo();
    if (latestVideo) {
      state.video = latestVideo;
      bindVideoEvents(latestVideo);
    }
    if (!state.video) return;

    const duration = Number.isFinite(state.video.duration) ? state.video.duration : 0;
    const title = getRawVideoTitle() || "Video YouTube";

    query(".fourk-video-title").textContent = title;
    query('[data-role="video-duration"]').textContent = duration ? formatTime(duration) : "--:--";

    if (resetSelection && duration) {
      const start = clamp(Math.floor(state.video.currentTime || 0), 0, Math.max(0, duration - 1));
      const end = Math.min(duration, start + 30);
      query('[data-input="start"]').value = formatTime(start);
      query('[data-input="end"]').value = formatTime(end);
      query('[data-input="frame"]').value = formatTime(start);
      updateSelectionUI();
    }
  }

  function readSelection() {
    const start = parseTime(query('[data-input="start"]').value);
    const end = parseTime(query('[data-input="end"]').value);
    return { start, end, duration: end - start };
  }

  function validateSelection() {
    const selection = readSelection();
    const videoDuration = state.video?.duration;

    if (!Number.isFinite(selection.start) || !Number.isFinite(selection.end)) {
      return { error: "Enter a valid time." };
    }
    if (selection.end <= selection.start) {
      return { error: "End time must be later than start time." };
    }
    if (selection.duration < 1) {
      return { error: "Clip must be at least 1 second long." };
    }
    if (selection.duration > MAX_CLIP_SECONDS) {
      return { error: "Clip length cannot exceed 15 minutes." };
    }
    if (Number.isFinite(videoDuration) && selection.end > videoDuration + 0.25) {
      return { error: "End time exceeds the video length." };
    }
    return selection;
  }

  function updateSelectionUI() {
    if (!state.root || !state.video) return;
    const selection = readSelection();
    const valid = Number.isFinite(selection.start) && Number.isFinite(selection.end) && selection.end > selection.start;
    const durationLabel = query('[data-role="selection-duration"]');
    durationLabel.textContent = valid ? formatDurationLabel(selection.duration) : "Invalid";
    durationLabel.classList.toggle("is-valid", valid);
    durationLabel.classList.toggle("is-invalid", !valid);

    if (valid && state.subCues.length) {
      renderSubtitlePreview(getSelectedSubtitleCues());
    }
  }

  function formatDurationLabel(seconds) {
    if (seconds < 60) {
      const label = formatPreciseTime(seconds).replace(/^0:/, "").replace(/\.0$/, "");
      return `${label} sec`;
    }

    const rounded = Math.floor(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    if (hours) return `${hours} hr ${minutes} min`;
    return remainingSeconds ? `${minutes} min ${remainingSeconds} sec` : `${minutes} min`;
  }

  function setTimeFromCurrent(kind) {
    if (!state.video) return;
    const current = state.video.currentTime || 0;
    const input = query(`[data-input="${kind}"]`);
    input.value = kind === "frame" ? formatPreciseTime(current) : formatTime(current);
    clearMessage();
    updateSelectionUI();
  }

  function applyQuickDuration(seconds) {
    const start = parseTime(query('[data-input="start"]').value);
    const safeStart = Number.isFinite(start) ? start : 0;
    const max = Number.isFinite(state.video?.duration) ? state.video.duration : safeStart + seconds;
    query('[data-input="end"]').value = formatTime(Math.min(safeStart + seconds, max));
    state.root.querySelectorAll("[data-duration]").forEach((button) => {
      const active = Number(button.dataset.duration) === seconds;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    clearMessage();
    updateSelectionUI();
  }

  function switchTool(mode) {
    if (!['video', 'frame'].includes(mode) || state.recording) return;
    state.mode = mode;
    state.root.querySelectorAll("[data-tool]").forEach((button) => {
      const active = button.dataset.tool === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    state.root.querySelectorAll("[data-mode-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.modePanel !== mode;
    });
    clearMessage();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "The extension did not receive a response."));
          return;
        }
        resolve(response);
      });
    });
  }

  function canvasToBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Couldn't create an image file from the frame."));
        }, type, quality);
      } catch (error) {
        reject(error);
      }
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Couldn't read the captured image from the browser."));
      image.src = dataUrl;
    });
  }

  // Shared with create-clip: both capture off the decoded playback stream
  // rather than anything screen/tab-dependent, so neither one cares whether
  // this tab is the visible/focused one.
  function getPlaybackStream(video) {
    const capture = video.captureStream || video.mozCaptureStream;
    if (typeof capture !== "function") {
      throw new Error("Chrome isn't allowing capture of this video stream. Update your browser and try again.");
    }
    const stream = capture.call(video);
    if (!stream?.getVideoTracks().length) {
      throw new Error("YouTube didn't provide a video stream to capture — this video may be copy-protected.");
    }
    return stream;
  }

  // Reads one still frame off a live video track. Prefers ImageCapture
  // (no intermediate <video> element needed); falls back to a hidden,
  // muted proxy <video> for browsers where ImageCapture can't grab from a
  // captureStream()-sourced track.
  async function grabFrameFromStream(stream) {
    const [track] = stream.getVideoTracks();
    if (!track) throw new Error("Couldn't read a video frame from the player.");

    if (typeof ImageCapture === "function") {
      try {
        return await new ImageCapture(track).grabFrame();
      } catch (_) {
        // Fall through to the proxy-video path below.
      }
    }

    const proxyVideo = document.createElement("video");
    proxyVideo.muted = true;
    proxyVideo.playsInline = true;
    proxyVideo.srcObject = stream;
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timed out waiting for a video frame.")), 4000);
      proxyVideo.onloadeddata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      proxyVideo.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Couldn't read a video frame from the player."));
      };
      proxyVideo.play().catch(() => {});
    });
    return proxyVideo;
  }

  async function captureFrameBlob(video) {
    const meta = FRAME_FORMAT_META[state.frameFormat] || FRAME_FORMAT_META.png;
    const quality = meta.mime === "image/png" ? undefined : 0.92;

    const stream = getPlaybackStream(video);
    try {
      const source = await grabFrameFromStream(stream);
      const width = source.videoWidth || source.width;
      const height = source.videoHeight || source.height;
      if (!width || !height) {
        throw new Error("Couldn't read this video's frame — it may be copy-protected.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(source, 0, 0, width, height);
      if (typeof source.close === "function") source.close(); // ImageBitmap cleanup
      return await canvasToBlob(canvas, meta.mime, quality);
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  async function captureFrame() {
    clearMessage();
    state.video = findVideo();
    const frameTime = parseTime(query('[data-input="frame"]').value);
    const duration = state.video?.duration;
    if (!state.video || !Number.isFinite(frameTime)) {
      showMessage("Enter a valid time.");
      return;
    }
    if (frameTime < 0 || (Number.isFinite(duration) && frameTime > duration)) {
      showMessage(`The capture time must be within the video, from 0:00 to ${formatTime(duration || 0)}.`);
      return;
    }

    const button = query('[data-action="capture-frame"]');
    const previousContent = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="fourk-button-spinner"></span><span>Capturing frame…</span>`;
    state.previousPlayback = {
      time: state.video.currentTime,
      paused: state.video.paused,
      playbackRate: state.video.playbackRate
    };

    try {
      state.video.pause();
      await waitForSeek(state.video, frameTime);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await captureFrameBlob(state.video);
      releaseClipUrl();
      state.clipBlob = blob;
      state.clipUrl = URL.createObjectURL(blob);
      state.clipFrameFormat = state.frameFormat;
      state.clipFileName = makeFileName(frameTime, frameTime, "frame");
      state.outputKind = "frame";
      state.previousPlayback = null;
      showResult({ start: frameTime, end: frameTime, duration: 0 }, "frame");
    } catch (error) {
      console.error("[4K]", error);
      restoreOriginalPlayback();
      showMessage(error?.message || "Couldn't capture this frame.");
    } finally {
      button.disabled = false;
      button.innerHTML = previousContent;
    }
  }

  function canvasSupportsMime(mime) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL(mime).indexOf(`data:${mime}`) === 0;
    } catch (_) {
      return false;
    }
  }

  function setupFrameFormatOptions() {
    const buttons = state.root.querySelectorAll("[data-frame-format]");
    let firstSupported = "";
    buttons.forEach((button) => {
      const format = button.dataset.frameFormat;
      const meta = FRAME_FORMAT_META[format];
      const supported = format === "png" || canvasSupportsMime(meta.mime);
      button.hidden = !supported;
      button.disabled = !supported;
      if (supported && !firstSupported) firstSupported = format;
    });
    applyFrameFormat(firstSupported || "png");
  }

  function applyFrameFormat(format) {
    if (!FRAME_FORMAT_META[format]) return;
    const target = state.root.querySelector(`[data-frame-format="${format}"]`);
    if (target?.disabled) return;
    state.frameFormat = format;
    state.root.querySelectorAll("[data-frame-format]").forEach((button) => {
      const active = button.dataset.frameFormat === format;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function testThumbnailUrl(url) {
    return new Promise((resolve) => {
      const image = new Image();
      let timeout;
      const finish = (available) => {
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(available);
      };
      timeout = window.setTimeout(() => finish(false), 5000);
      image.onload = () => finish(image.naturalWidth >= 120 && image.naturalHeight >= 90);
      image.onerror = () => finish(false);
      image.referrerPolicy = "no-referrer";
      image.src = url;
    });
  }

  async function findBestThumbnailUrl(videoId) {
    const safeVideoId = encodeURIComponent(videoId);
    const candidates = [
      `https://i.ytimg.com/vi/${safeVideoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${safeVideoId}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${safeVideoId}/hqdefault.jpg`
    ];
    for (const candidate of candidates) {
      if (await testThumbnailUrl(candidate)) return candidate;
    }
    return "";
  }

  async function getCurrentThumbnailUrl() {
    const videoId = new URL(location.href).searchParams.get("v");
    if (!videoId) throw new Error("Couldn't find the video ID to fetch the thumbnail.");
    const thumbnailUrl = await findBestThumbnailUrl(videoId);
    if (!thumbnailUrl) throw new Error("This video has no available thumbnail.");
    return thumbnailUrl;
  }

  async function convertImageToPng(blob) {
    if (blob.type === "image/png") return blob;
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await loadImage(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return await canvasToBlob(canvas, "image/png");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function copyImageBlob(blob) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("This Chrome build doesn't support copying images. Please update your browser.");
    }
    const pngBlob = await convertImageToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
  }

  async function downloadThumbnail() {
    clearMessage();
    const button = query('[data-action="get-thumbnail"]');
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.textContent = "Finding…";
    try {
      const thumbnailUrl = await getCurrentThumbnailUrl();
      await sendRuntimeMessage({
        type: "FOURK_DOWNLOAD_THUMBNAIL",
        url: thumbnailUrl,
        filename: `${getSafeVideoTitle()} [thumbnail].jpg`
      });
      showMessage("Started downloading the high-quality thumbnail.", "success");
    } catch (error) {
      showMessage(error?.message || "Couldn't download the thumbnail.");
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  }

  async function copyVideoTitle() {
    clearMessage();
    const button = query('[data-action="get-title"]');
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.textContent = "Copying…";
    try {
      const title = getRawVideoTitle();
      if (!title) throw new Error("Couldn't find the video title.");
      await navigator.clipboard.writeText(title);
      showMessage("Video title copied to clipboard.", "success");
    } catch (error) {
      showMessage(error?.message || "Couldn't copy the video title.");
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  }

  async function copyCapturedImage() {
    if (state.outputKind !== "frame" || !state.clipBlob) return;
    const button = query('[data-action="copy-image"]');
    const label = query('[data-role="copy-image-label"]');
    button.disabled = true;
    label.textContent = "Copying…";
    try {
      await copyImageBlob(state.clipBlob);
      label.textContent = "Image copied ✓";
    } catch (error) {
      button.title = error?.message || "Couldn't copy image";
      label.textContent = "Copy failed";
    } finally {
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.title = "Copy image to clipboard";
        label.textContent = "Copy image";
      }, 1800);
    }
  }

  function extractObjectLiteral(html, marker) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) return null;

    const braceStart = html.indexOf("{", markerIndex);
    if (braceStart === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = braceStart; index < html.length; index += 1) {
      const char = html[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return html.slice(braceStart, index + 1);
      }
    }
    return null;
  }

  function parseJsonLiteral(html, marker) {
    const raw = extractObjectLiteral(html, marker);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function readCaptionTracks(playerResponse) {
    const list = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(list)) return [];

    return list
      .filter((track) => isCaptionUrl(track?.baseUrl))
      .map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: String(track.languageCode || ""),
        autoGenerated: track.kind === "asr",
        label: track.name?.simpleText
          || track.name?.runs?.map((run) => run?.text ?? "").join("")
          || track.languageCode
          || "Subtitles"
      }));
  }

  function readInnerTubeAuth(html) {
    let apiKey = /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"|INNERTUBE_API_KEY\s*=\s*"([^"]+)"/.exec(html);
    let context = parseJsonLiteral(html, 'INNERTUBE_CONTEXT":') || parseJsonLiteral(html, "INNERTUBE_CONTEXT =");
    if (!apiKey || !context) {
      try {
        const dom = document.documentElement.innerHTML;
        if (!apiKey) apiKey = /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"|INNERTUBE_API_KEY\s*=\s*"([^"]+)"/.exec(dom);
        if (!context) context = parseJsonLiteral(dom, 'INNERTUBE_CONTEXT":') || parseJsonLiteral(dom, "INNERTUBE_CONTEXT =");
      } catch (_) {}
    }
    const key = apiKey?.[1] || apiKey?.[2];
    return key && context ? { key, context } : null;
  }

  function readTranscriptParams(html) {
    let match = /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/.exec(html);
    if (!match) {
      try {
        match = /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/.exec(document.documentElement.innerHTML);
      } catch (_) {}
    }
    return match?.[1] || "";
  }

  async function requestTranscriptCues(auth, params) {
    if (!auth) return { cues: [], note: "couldn't read INNERTUBE_API_KEY / INNERTUBE_CONTEXT from the page." };
    if (!params) return { cues: [], note: "couldn't find the getTranscriptEndpoint token on the page — this video may not have a Transcript panel." };

    try {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(auth.key)}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Visitor-Id": String(auth.context?.client?.visitorData || "")
        },
        body: JSON.stringify({ context: auth.context, params })
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        return { cues: [], note: `get_transcript returned HTTP ${response.status}${detail ? ` — ${detail}` : ""}.` };
      }

      const cues = parseTranscript(await response.json().catch(() => null));
      return cues.length
        ? { cues, note: "" }
        : { cues: [], note: "get_transcript returned JSON but no lines could be read — the response structure may have changed; parseTranscript() needs updating." };
    } catch (error) {
      return { cues: [], note: `couldn't call get_transcript: ${error?.message || error}` };
    }
  }

  function replaceCapturedEntries(entries) {
    capturedCaptionUrls.length = 0;
    for (const entry of entries) {
      if (entry && isCaptionUrl(entry.url)) capturedCaptionUrls.push(entry);
    }
    capturedCaptionUrls.sort((a, b) => b.at - a.at);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__fourK !== BRIDGE_REPLY) return;

    if (Array.isArray(data.entries)) replaceCapturedEntries(data.entries);

    const pending = data.id === undefined ? null : bridgeRequests.get(data.id);
    if (pending) {
      bridgeRequests.delete(data.id);
      pending(data);
    }
  });

  function askBridge(command, payload = {}, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const id = ++bridgeRequestId;
      const timer = window.setTimeout(() => {
        bridgeRequests.delete(id);
        resolve({ ok: false, log: [], reason: "The player bridge did not respond — try reloading the extension." });
      }, timeoutMs);

      bridgeRequests.set(id, (data) => {
        window.clearTimeout(timer);
        resolve(data);
      });

      window.postMessage(Object.assign({ __fourK: BRIDGE_REQUEST, id, command }, payload), "*");
    });
  }

  async function fetchCuesFromUrl(url) {
    if (!isCaptionUrl(url)) return [];
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return [];
      const body = await response.text();
      return body.trim() ? parseCaptions(body) : [];
    } catch (_) {
      return [];
    }
  }

  async function fetchCuesFromCapturedUrl(url) {
    const direct = await fetchCuesFromUrl(url);
    if (direct.length) return direct;

    const asJson3 = withCaptionFormat(url, "json3");
    return asJson3 && asJson3 !== url ? fetchCuesFromUrl(asJson3) : [];
  }

  function readPlayerTextTrackCues() {
    const list = (state.video || document.querySelector("video"))?.textTracks;
    if (!list || !list.length) return [];

    for (let index = 0; index < list.length; index += 1) {
      const track = list[index];
      const prevMode = track.mode;
      if (track.mode === "disabled") {
        try { track.mode = "hidden"; } catch (_) {}
      }
      const cues = track?.cues;
      if (!cues || !cues.length) {
        if (prevMode === "disabled") {
          try { track.mode = prevMode; } catch (_) {}
        }
        continue;
      }

      const parsed = [];
      for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
        const cue = cues[cueIndex];
        const text = normalizeText(stripTags(String(cue?.text ?? "")));
        if (!text) continue;
        parsed.push({ start: Number(cue.startTime), end: Number(cue.endTime), text });
      }

      if (prevMode === "disabled") {
        try { track.mode = prevMode; } catch (_) {}
      }

      const finalized = finalizeCues(parsed);
      if (finalized.length) return finalized;
    }
    return [];
  }

  async function loadCuesThroughPlayer(track) {
    const videoId = getVideoId();

    const useEntries = async (entries, source) => {
      for (const entry of entries) {
        if (videoId && entry.videoId && entry.videoId !== videoId) continue;
        const cues = await fetchCuesFromCapturedUrl(entry.url);
        if (cues.length) {
          console.info(`[4K] Subtitles fetched via the player's link (${source}, lang=${entry.language || "?"}).`);
          return cues;
        }
      }
      return [];
    };

    const now = Date.now();
    const fresh = capturedCaptionUrls.filter((entry) => now - entry.at <= POT_CACHE_AGE_MS);
    let cues = await useEntries(fresh, "cache");
    if (cues.length) return cues;

    const reply = await askBridge("harvest", {
      languageCode: track.languageCode,
      timeoutMs: 10000
    }, 30000);
    if (reply.ok) {
      cues = await useEntries(capturedCaptionUrls, "harvest");
      if (cues.length) return cues;
    }

    cues = readPlayerTextTrackCues();
    if (cues.length) return cues;

    console.warn(
      "[4K] Player bridge:",
      reply.reason || "captured a link but the download was still empty.",
      Array.isArray(reply.log) && reply.log.length ? `| ${reply.log.join(" ")}` : ""
    );
    return [];
  }

  async function requestInnerTubePlayer(auth, videoId) {
    if (!auth || !videoId) return null;

    const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(auth.key)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: auth.context, videoId, contentCheckOk: true, racyCheckOk: true })
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  function getVideoId() {
    return new URL(location.href).searchParams.get("v") || "";
  }

  async function loadCaptionTracks() {
    const videoId = getVideoId();
    if (!videoId) throw new Error("Couldn't find the video ID to fetch subtitles.");

    const pageResponse = await fetch(location.href, { credentials: "include" });
    if (!pageResponse.ok) {
      throw new Error(`YouTube returned error ${pageResponse.status} while reading the video page.`);
    }
    const html = await pageResponse.text();

    innerTubeSession = {
      auth: readInnerTubeAuth(html),
      transcriptParams: readTranscriptParams(html)
    };

    let tracks = readCaptionTracks(parseJsonLiteral(html, "ytInitialPlayerResponse"));
    if (!tracks.length) {
      tracks = readCaptionTracks(await requestInnerTubePlayer(innerTubeSession.auth, videoId));
    }
    if (!tracks.length) {
      throw new Error("This video has no captions or transcript enabled.");
    }
    return tracks;
  }

  async function fetchCaptionCues(track) {
    // YouTube now gates both /api/timedtext and get_transcript behind a
    // proof-of-origin token ("pot") on most videos. Without it, timedtext
    // quietly returns an empty 200 and get_transcript answers with HTTP 400
    // "Precondition check failed" — every time, not just occasionally.
    // Trying them first wastes two doomed round trips and logs misleading
    // warnings before falling back to the one thing that actually works:
    // turning on captions in the real player (which mints a valid pot) and
    // capturing that authenticated request. So try that first instead.
    const playerCues = await loadCuesThroughPlayer(track);
    if (playerCues.length) return playerCues;

    let lastError = null;

    for (const format of CAPTION_FORMATS) {
      const url = withCaptionFormat(track.baseUrl, format);
      if (!url) throw new Error("The subtitle URL isn't on youtube.com.");

      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          lastError = new Error(`YouTube returned error ${response.status} while loading subtitles.`);
          continue;
        }
        const body = await response.text();
        if (!body.trim()) {
          lastError = new Error("YouTube returned empty subtitles; click Load subtitles to get a fresh link.");
          continue;
        }
        const cues = parseCaptions(body);
        if (cues.length) return cues;
        lastError = new Error(`Subtitle format ${format} produced no readable lines.`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Couldn't load subtitles.");
      }
    }

    const transcript = await requestTranscriptCues(
      innerTubeSession?.auth,
      innerTubeSession?.transcriptParams
    );
    if (transcript.cues.length) return transcript.cues;

    if (transcript.note) console.warn("[4K] Transcript fallback:", transcript.note);
    if (lastError) console.warn("[4K] Timedtext subtitles:", lastError.message);

    throw new Error("Couldn't load subtitles for this video. Turn on captions (CC) in the player yourself, then click Load subtitles.");
  }

  function pickDefaultTrackIndex(tracks) {
    const preferred = (document.documentElement.lang || navigator.language || "").slice(0, 2).toLowerCase();
    const score = (track) => (track.autoGenerated ? 0 : 2)
      + (preferred && track.languageCode.slice(0, 2).toLowerCase() === preferred ? 1 : 0);

    let best = 0;
    tracks.forEach((track, index) => {
      if (score(track) > score(tracks[best])) best = index;
    });
    return best;
  }

  function renderTrackOptions(tracks, selectedIndex) {
    const select = query('[data-select="sub-track"]');
    select.textContent = "";
    tracks.forEach((track, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = track.autoGenerated ? `${track.label} (auto)` : track.label;
      select.appendChild(option);
    });
    select.value = String(selectedIndex);
    select.disabled = tracks.length < 2;
  }

  function renderSubtitlePreview(cues) {
    const list = query('[data-role="sub-preview"]');
    list.textContent = "";
    list.hidden = cues.length === 0;

    const fragment = document.createDocumentFragment();
    cues.forEach((cue) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "fourk-sub-row";
      row.dataset.seek = String(cue.start);
      row.title = `Seek video to ${formatTimestamp(cue.start, "clock")}`;

      const time = document.createElement("span");
      time.className = "fourk-sub-time";
      time.textContent = formatTimestamp(cue.start, state.subTimeStyle);

      const text = document.createElement("span");
      text.className = "fourk-sub-text";
      text.textContent = cue.text;

      row.append(time, text);
      fragment.appendChild(row);
    });
    list.appendChild(fragment);

    const count = query('[data-role="sub-count"]');
    const selection = state.lastClipSelection;
    const hasRange = !!selection && Number.isFinite(selection.start) && Number.isFinite(selection.end) && selection.end > selection.start;
    if (!state.subCues.length) {
      count.textContent = "None";
    } else if (!cues.length) {
      count.textContent = hasRange ? "No lines in this range" : "None";
    } else if (hasRange) {
      count.textContent = `${cues.length} lines · ${formatTime(selection.start)}–${formatTime(selection.end)}`;
    } else {
      count.textContent = `${cues.length} lines`;
    }
    query('[data-role="sub-actions"]').hidden = cues.length === 0;
  }

  function getSelectedSubtitleCues() {
    const selection = state.lastClipSelection;
    if (!selection || !Number.isFinite(selection.start) || !Number.isFinite(selection.end) || selection.end <= selection.start) {
      return state.subCues;
    }
    return filterCues(state.subCues, selection.start, selection.end);
  }

  function buildSubtitleOutput() {
    const meta = FORMAT_META[state.subFormat] || FORMAT_META.txt;
    return {
      text: renderCues(getSelectedSubtitleCues(), state.subFormat, { timeStyle: state.subTimeStyle }),
      extension: meta.extension,
      mime: meta.mime
    };
  }

  function resetSubtitles() {
    state.subTracks = [];
    state.subCues = [];
    state.subVideoId = "";
    state.subNoTracks = false;

    const select = query('[data-select="sub-track"]');
    if (select) {
      select.textContent = "";
      select.disabled = false;
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Subtitles load automatically";
      select.appendChild(option);
    }

    const preview = query('[data-role="sub-preview"]');
    if (preview) {
      preview.textContent = "";
      preview.hidden = true;
    }
    const actions = query('[data-role="sub-actions"]');
    if (actions) actions.hidden = true;
    const count = query('[data-role="sub-count"]');
    if (count) count.textContent = "None";

    const panel = query('[data-role="sub-export-panel"]');
    if (panel) panel.hidden = true;
    const toggle = query('[data-action="toggle-subtitles"]');
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  async function loadSubtitles({ silent = false } = {}) {
    if (state.recording || state.subLoading) return false;
    if (!silent) clearMessage();

    const videoId = getVideoId();
    if (videoId && videoId !== state.subVideoId) {
      state.subTracks = [];
      state.subVideoId = videoId;
      state.subNoTracks = false;
    }

    state.subLoading = true;
    const button = query('[data-action="load-subtitles"]');
    const previousContent = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="fourk-button-spinner"></span><span>Loading subtitles…</span>`;

    try {
      if (!state.subTracks.length) {
        state.subTracks = await loadCaptionTracks();
        renderTrackOptions(state.subTracks, pickDefaultTrackIndex(state.subTracks));
      }
      state.subNoTracks = state.subTracks.length === 0;

      const selected = Number(query('[data-select="sub-track"]').value);
      const track = state.subTracks[Number.isInteger(selected) ? selected : 0];
      if (!track) throw new Error("Couldn't determine which subtitle track to load.");

      const cues = await fetchCaptionCues(track);
      state.subCues = cues;
      renderSubtitlePreview(getSelectedSubtitleCues());
      if (!silent) showMessage(`Loaded ${cues.length} subtitle lines (${track.label}).`, "success");
      return true;
    } catch (error) {
      if (silent) console.warn("[4K] Subtitles:", error?.message || error);
      else console.error("[4K]", error);
      state.subCues = [];
      renderSubtitlePreview([]);
      if (!silent) showMessage(error?.message || "Couldn't fetch subtitles for this video.");
      return false;
    } finally {
      state.subLoading = false;
      button.disabled = false;
      button.innerHTML = previousContent;
    }
  }

  function toggleSubtitlesPanel() {
    const panel = query('[data-role="sub-export-panel"]');
    const toggle = query('[data-action="toggle-subtitles"]');
    if (!panel || !toggle) return;
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
    if (!willOpen) return;

    if (state.subTracks.length) {
      renderSubtitlePreview(getSelectedSubtitleCues());
    } else if (!state.subLoading) {
      loadSubtitles();
    }
  }

  async function copySubtitles() {
    if (!state.subCues.length) return;
    const label = query('[data-role="copy-sub-label"]');
    try {
      await navigator.clipboard.writeText(buildSubtitleOutput().text);
      label.textContent = "Copied ✓";
    } catch (error) {
      label.textContent = "Copy failed";
      showMessage(error?.message || "Couldn't copy subtitles to the clipboard.");
    } finally {
      window.setTimeout(() => {
        const current = query('[data-role="copy-sub-label"]');
        if (current) current.textContent = "Copy";
      }, 1800);
    }
  }

  function downloadSubtitles() {
    if (!state.subCues.length) return;
    const { text, extension } = buildSubtitleOutput();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${getSafeVideoTitle()} [sub].${extension}`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function seekVideoTo(seconds) {
    state.video = findVideo();
    if (!state.video || !Number.isFinite(seconds)) return;
    state.video.currentTime = clamp(seconds, 0, state.video.duration || seconds);
    state.video.play().catch(() => {});
    query('[data-role="current-time"]').textContent = formatTime(state.video.currentTime);
  }

  function applySubtitleFormat(format) {
    if (!FORMAT_META[format]) return;
    state.subFormat = format;
    state.root.querySelectorAll("[data-sub-format]").forEach((button) => {
      const active = button.dataset.subFormat === format;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    query('[data-role="sub-time-style-field"]').hidden = format !== "txt";
    if (state.subCues.length) renderSubtitlePreview(getSelectedSubtitleCues());
  }

  function applySubtitleTimeStyle(style) {
    if (!["clock", "short", "seconds"].includes(style)) return;
    state.subTimeStyle = style;
    if (state.subCues.length) renderSubtitlePreview(getSelectedSubtitleCues());
  }

  function getSupportedMp4MimeType() {
    const types = [
      "video/mp4;codecs=avc3.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.4D401E,mp4a.40.2",
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4"
    ];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function waitForSeek(video, targetTime) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Couldn't seek the video to the start time."));
      }, 8000);

      function cleanup() {
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      }
      function onSeeked() {
        cleanup();
        resolve();
      }
      function onError() {
        cleanup();
        reject(new Error("YouTube couldn't play the selected clip."));
      }

      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = targetTime;

      if (Math.abs(video.currentTime - targetTime) < 0.05 && video.readyState >= 2) {
        cleanup();
        resolve();
      }
    });
  }

  // Purely cosmetic: keeps the ring/progress bar smooth while the tab is
  // visible. Driven by rVFC (or the setInterval fallback below), both of
  // which can lag or pause while the tab is hidden — harmless here, since
  // nobody's watching the ring then. `checkRecordingEnd` (below), driven by
  // `timeupdate`, is what actually stops the recording on time.
  function updateRecordingProgress(start, end) {
    if (!state.recording || !state.video) return;
    const elapsed = clamp(state.video.currentTime - start, 0, end - start);
    const percent = clamp((elapsed / (end - start)) * 100, 0, 100);
    query('[data-role="recording-percent"]').textContent = String(Math.round(percent));
    query('[data-role="progress-bar"]').style.width = `${percent}%`;
    query('[data-role="progress-time"]').textContent = `${formatPreciseTime(elapsed)} / ${formatTime(end - start)}`;
    const ring = query('[data-role="progress-ring"]');
    if (ring) ring.style.strokeDashoffset = String(RECORDING_RING_CIRCUMFERENCE * (1 - percent / 100));

    if (typeof state.video.requestVideoFrameCallback === "function") {
      state.frameRequest = state.video.requestVideoFrameCallback(() => updateRecordingProgress(start, end));
    }
  }

  // Authoritative stop check, tied to the media clock via `timeupdate` —
  // this event keeps firing on the playing <video> even when the tab is
  // hidden and rendering-driven signals like rVFC/rAF are throttled, so the
  // clip still stops on time whether or not the tab is in front.
  function checkRecordingEnd(start, end) {
    if (!state.recording || !state.video) return;
    if (state.video.currentTime >= end - 0.035 || state.video.ended) {
      stopRecording(false);
    }
  }

  function prepareRecording(selection) {
    state.previousPlayback = {
      time: state.video.currentTime,
      paused: state.video.paused,
      playbackRate: state.video.playbackRate
    };
    state.cancelling = false;
    state.recording = true;
    query('[data-role="recording-heading"]').textContent = "Creating video clip";
    query('[data-role="recording-percent"]').textContent = "0";
    query('[data-role="progress-bar"]').style.width = "0%";
    query('[data-role="progress-time"]').textContent = `0:00 / ${formatTime(selection.duration)}`;
    const ring = query('[data-role="progress-ring"]');
    if (ring) ring.style.strokeDashoffset = String(RECORDING_RING_CIRCUMFERENCE);

    query('[data-role="target-range"]').textContent = `${formatTime(selection.start)} → ${formatTime(selection.end)}`;
    query('[data-role="target-duration"]').textContent = formatDurationLabel(selection.duration);
    const width = state.video?.videoWidth;
    const height = state.video?.videoHeight;
    query('[data-role="target-meta"]').textContent = width && height ? `MP4 · ${width}×${height}` : "MP4";

    state.activeSelection = selection;
    setView("recording");
  }

  function startPlaybackTracking(selection) {
    state.playbackGuard = () => {
      if (state.recording && !state.cancelling) {
        state.video.playbackRate = 1;
        if (state.video.paused) state.video.play().catch(() => {});
      }
    };
    state.video.addEventListener("pause", state.playbackGuard);
    state.video.addEventListener("ratechange", state.playbackGuard);

    state.timeUpdateHandler = () => checkRecordingEnd(selection.start, selection.end);
    state.video.addEventListener("timeupdate", state.timeUpdateHandler);

    // Backstop only: catches the rare case where `timeupdate` itself stalls
    // (e.g. the video buffering). A late fire here just means a slightly
    // overlong clip, never a clip that fails to stop.
    state.stopTimer = window.setTimeout(() => stopRecording(false), (selection.duration + 10) * 1000);
    updateRecordingProgress(selection.start, selection.end);

    if (typeof state.video.requestVideoFrameCallback !== "function") {
      state.progressInterval = window.setInterval(() => updateRecordingProgress(selection.start, selection.end), 80);
    }
  }

  function getSupportedAudioMimeType() {
    const types = [
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm"
    ];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function audioFileMeta(mimeType) {
    return /mp4/i.test(mimeType)
      ? { extension: "m4a", mime: "audio/mp4", label: "M4A" }
      : { extension: "webm", mime: "audio/webm", label: "WEBM" };
  }

  async function startMediaRecording(selection) {
    const mimeType = getSupportedMp4MimeType();
    if (!mimeType) {
      throw new Error("This Chrome build doesn't support exporting MP4 directly. Update Chrome to the latest version.");
    }

    state.video.pause();
    state.video.playbackRate = 1;
    await waitForSeek(state.video, selection.start);
    if (state.cancelling) {
      restoreAfterCancel();
      return;
    }

    const rawStream = getPlaybackStream(state.video);
    state.captureStream = rawStream;

    // Primary output: the full video (with audio) — this is the one thing that must succeed.
    const videoChunks = [];
    state.videoRecorder = new MediaRecorder(rawStream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 192_000
    });
    state.videoRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) videoChunks.push(event.data);
    });
    const videoFinished = new Promise((resolve, reject) => {
      state.videoRecorder.addEventListener("stop", resolve, { once: true });
      state.videoRecorder.addEventListener("error", () => reject(new Error("An error occurred while creating the MP4 file.")), { once: true });
    });

    // Bonus output: audio-only, captured in parallel from the same stream during the
    // same single playback pass. Best-effort — never fails the video clip.
    const audioMimeType = getSupportedAudioMimeType();
    const audioTracks = rawStream.getAudioTracks();
    const audioChunks = [];
    let audioFinished = Promise.resolve();
    state.audioRecorder = null;

    if (audioMimeType && audioTracks.length) {
      try {
        state.audioRecorder = new MediaRecorder(new MediaStream(audioTracks), {
          mimeType: audioMimeType,
          audioBitsPerSecond: 192_000
        });
        state.audioRecorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) audioChunks.push(event.data);
        });
        audioFinished = new Promise((resolve) => {
          state.audioRecorder.addEventListener("stop", resolve, { once: true });
          state.audioRecorder.addEventListener("error", () => resolve(), { once: true });
        });
      } catch (_) {
        state.audioRecorder = null;
      }
    }

    state.videoRecorder.start(500);
    if (state.audioRecorder) state.audioRecorder.start(500);
    await state.video.play();
    if (state.cancelling) {
      restoreAfterCancel();
      return;
    }
    startPlaybackTracking(selection);

    await videoFinished;
    await audioFinished;

    if (state.cancelling) {
      restoreAfterCancel();
      return;
    }

    const outputMime = state.videoRecorder.mimeType || mimeType;
    if (!outputMime.toLowerCase().startsWith("video/mp4")) {
      throw new Error("Chrome couldn't produce a valid MP4 file on this device.");
    }
    const blob = new Blob(videoChunks, { type: "video/mp4" });
    if (blob.size < 1024) {
      throw new Error("The generated file has no data. YouTube may be restricting recording for this video.");
    }

    releaseClipUrl();
    state.clipBlob = blob;
    state.clipUrl = URL.createObjectURL(blob);
    state.outputKind = "video";
    state.clipFileName = makeFileName(selection.start, selection.end, "video");
    state.lastClipSelection = selection;

    if (state.audioRecorder && audioChunks.length) {
      const meta = audioFileMeta(state.audioRecorder.mimeType || audioMimeType);
      const audioBlob = new Blob(audioChunks, { type: meta.mime });
      if (audioBlob.size >= 512) {
        state.audioBlob = audioBlob;
        state.audioUrl = URL.createObjectURL(audioBlob);
        state.audioExtension = meta.extension;
        state.audioFileName = makeFileName(selection.start, selection.end, "audio");
      }
    }

    showResult(selection, "video");
  }

  async function createClip() {
    if (state.recording) return;
    clearMessage();
    state.video = findVideo();

    if (!state.video) {
      showMessage("Couldn't find the YouTube player. Reload the video page.");
      return;
    }

    const selection = validateSelection();
    if (selection.error) {
      showMessage(selection.error);
      return;
    }

    const capture = state.video.captureStream || state.video.mozCaptureStream;
    if (typeof capture !== "function") {
      showMessage("Chrome isn't allowing capture of this video stream. Update your browser and try again.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      showMessage("This browser doesn't support recording. Use a newer version of Chrome.");
      return;
    }

    prepareRecording(selection);

    try {
      await startMediaRecording(selection);
    } catch (error) {
      console.error("[4K]", error);
      cleanupRecording();
      setView("form");
      showMessage(error?.message || "Couldn't create the video clip. Try playing the video and doing it again.");
      restoreOriginalPlayback();
    }
  }

  function stopRecording(cancelled) {
    if (!state.recording) return;
    state.cancelling = cancelled;
    state.recording = false;
    if (state.videoRecorder && state.videoRecorder.state !== "inactive") {
      state.videoRecorder.stop();
    }
    if (state.audioRecorder && state.audioRecorder.state !== "inactive") {
      state.audioRecorder.stop();
    }
    state.video?.pause();
    clearRecordingTimers();
  }

  function clearRecordingTimers() {
    if (state.stopTimer) {
      window.clearTimeout(state.stopTimer);
      state.stopTimer = null;
    }
    if (state.progressInterval) {
      window.clearInterval(state.progressInterval);
      state.progressInterval = null;
    }
    if (state.frameRequest && state.video?.cancelVideoFrameCallback) {
      state.video.cancelVideoFrameCallback(state.frameRequest);
      state.frameRequest = null;
    }
  }

  function cleanupRecording() {
    clearRecordingTimers();
    state.recording = false;
    if (state.playbackGuard && state.video) {
      state.video.removeEventListener("pause", state.playbackGuard);
      state.video.removeEventListener("ratechange", state.playbackGuard);
    }
    state.playbackGuard = null;
    if (state.timeUpdateHandler && state.video) {
      state.video.removeEventListener("timeupdate", state.timeUpdateHandler);
    }
    state.timeUpdateHandler = null;
    state.activeSelection = null;
    [state.videoRecorder, state.audioRecorder].forEach((recorder) => {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch (_) {
        }
      }
    });
    if (state.captureStream) {
      state.captureStream.getTracks().forEach((track) => track.stop());
    }
    state.captureStream = null;
    state.videoRecorder = null;
    state.audioRecorder = null;
  }

  function restoreOriginalPlayback() {
    if (!state.video || !state.previousPlayback) return;
    const previous = state.previousPlayback;
    state.video.playbackRate = previous.playbackRate;
    state.video.currentTime = previous.time;
    if (!previous.paused) state.video.play().catch(() => {});
    state.previousPlayback = null;
  }

  function restoreAfterCancel() {
    cleanupRecording();
    restoreOriginalPlayback();
    setView("form");
    showMessage("Cancelled the video clip. You can choose a new time range.", "success");
  }

  function showResult(selection, kind) {
    cleanupRecording();
    if (state.video) {
      state.video.pause();
      state.video.currentTime = Math.min(selection.end, state.video.duration || selection.end);
      if (state.previousPlayback) state.video.playbackRate = state.previousPlayback.playbackRate;
    }
    state.previousPlayback = null;

    const videoPreview = query('[data-role="preview-video"]');
    const imagePreview = query('[data-role="preview-image"]');
    videoPreview.hidden = kind !== "video";
    imagePreview.hidden = kind !== "frame";
    if (kind === "video") videoPreview.src = state.clipUrl;
    if (kind === "frame") imagePreview.src = state.clipUrl;

    const frameLabel = (FRAME_FORMAT_META[state.clipFrameFormat] || FRAME_FORMAT_META.png).label;
    const labels = {
      video: { format: "MP4 VIDEO", heading: "Clip ready", description: "Your file is ready.", download: "Download video", reset: "Create another clip" },
      frame: { format: frameLabel, heading: "Frame ready", description: "Your image is ready.", download: "Download image", reset: "Capture another frame" }
    }[kind];
    query('[data-role="file-name"]').textContent = state.clipFileName;
    query('[data-role="file-meta"]').textContent = kind === "frame"
      ? `${labels.format} · ${formatBytes(state.clipBlob.size)} · ${formatTime(selection.start)}`
      : `${labels.format} · ${formatBytes(state.clipBlob.size)} · ${formatTime(selection.duration)}`;
    query('[data-role="download-label"]').textContent = labels.download;
    query('[data-role="download-size"]').textContent = formatBytes(state.clipBlob.size);
    query('[data-action="copy-image"]').hidden = kind !== "frame";
    query('[data-role="reset-label"]').textContent = labels.reset;
    query('[data-role="result-heading"]').textContent = labels.heading;
    query('[data-role="result-description"]').textContent = labels.description;

    const exportSection = query('[data-role="export-section"]');
    exportSection.hidden = kind !== "video";
    if (kind === "video") {
      const downloadAudioBtn = query('[data-role="download-audio-btn"]');
      downloadAudioBtn.hidden = !state.audioBlob;
      query('[data-role="audio-meta"]').textContent = (state.audioExtension || "").toUpperCase();

      const subPanel = query('[data-role="sub-export-panel"]');
      const subToggle = query('[data-action="toggle-subtitles"]');
      subPanel.hidden = true;
      subToggle.setAttribute("aria-expanded", "false");
    }

    setView("result");
  }

  function getSafeVideoTitle() {
    const rawTitle = getRawVideoTitle() || "youtube-video";
    return rawTitle
      .normalize("NFKD")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 70) || "youtube-video";
  }

  function makeFileName(start, end, kind) {
    const safeTitle = getSafeVideoTitle();
    const startLabel = formatTime(start, true).replaceAll(":", "-");
    if (kind === "frame") {
      const meta = FRAME_FORMAT_META[state.clipFrameFormat] || FRAME_FORMAT_META.png;
      return `${safeTitle} [frame-${startLabel}].${meta.extension}`;
    }
    const endLabel = formatTime(end, true).replaceAll(":", "-");
    const suffix = kind === "audio" ? "audio" : "video";
    const extension = kind === "audio" ? (state.audioExtension || "webm") : "mp4";
    return `${safeTitle} [${suffix}-${startLabel}-${endLabel}].${extension}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function downloadClip() {
    if (!state.clipUrl || !state.clipBlob) return;
    const anchor = document.createElement("a");
    anchor.href = state.clipUrl;
    anchor.download = state.clipFileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function downloadAudioOutput() {
    if (!state.audioUrl || !state.audioBlob) return;
    const anchor = document.createElement("a");
    anchor.href = state.audioUrl;
    anchor.download = state.audioFileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function releaseAudioUrl() {
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
    state.audioBlob = null;
    state.audioFileName = "";
    state.audioExtension = "";
  }

  function releaseClipUrl() {
    const videoPreview = query('[data-role="preview-video"]');
    const imagePreview = query('[data-role="preview-image"]');
    if (videoPreview) {
      videoPreview.pause();
      videoPreview.removeAttribute("src");
      videoPreview.load();
    }
    if (imagePreview) imagePreview.removeAttribute("src");
    if (state.clipUrl) URL.revokeObjectURL(state.clipUrl);
    state.clipUrl = null;
    state.clipBlob = null;
    state.outputKind = null;
    releaseAudioUrl();
  }

  function resetResult() {
    releaseClipUrl();
    setView("form");
    clearMessage();
    refreshVideoInfo();
  }

  function setPanelOpen(open) {
    if (!state.root) return;
    if (open) {
      state.root.hidden = false;
      state.root.classList.add("is-collapsing");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        state.root.classList.remove("is-collapsing");
      }));
      return;
    }
    state.root.classList.add("is-collapsing");
    window.setTimeout(() => {
      state.root.classList.remove("is-collapsing");
      state.root.hidden = true;
    }, 200);
  }

  function renderMaskedTimeInput(input, buffer) {
    input.value = formatTime(secondsFromDigitBuffer(buffer));
    // Programmatic value changes don't fire "input" on their own, so the
    // existing listener (timeline redraw, clearing messages, etc.) needs a nudge.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bindTimeInputMask(input) {
    input.addEventListener("focus", () => {
      timeInputBuffers.set(input, 0);
      input.select();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });

    input.addEventListener("beforeinput", (event) => {
      const type = event.inputType || "";

      if (type.startsWith("insert")) {
        event.preventDefault();
        const digits = String(event.data || "").replace(/[^0-9]/g, "");
        if (!digits) return;
        let buffer = timeInputBuffers.get(input) || 0;
        for (const digit of digits) {
          buffer = (buffer * 10 + Number(digit)) % 10 ** MAX_TIME_MASK_DIGITS;
        }
        timeInputBuffers.set(input, buffer);
        renderMaskedTimeInput(input, buffer);
        return;
      }

      if (type.startsWith("delete")) {
        event.preventDefault();
        const buffer = Math.floor((timeInputBuffers.get(input) || 0) / 10);
        timeInputBuffers.set(input, buffer);
        renderMaskedTimeInput(input, buffer);
        return;
      }

      // Anything else (formatting commands, dropped text, etc.) is a no-op for a digit-only mask.
      event.preventDefault();
    });
  }

  function bindEvents() {
    state.root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;

      if (button.dataset.tool) {
        switchTool(button.dataset.tool);
        return;
      }

      if (button.dataset.subFormat) {
        applySubtitleFormat(button.dataset.subFormat);
        return;
      }

      if (button.dataset.frameFormat) {
        applyFrameFormat(button.dataset.frameFormat);
        return;
      }

      if (button.dataset.seek) {
        state.root.querySelectorAll(".fourk-sub-row.is-active").forEach((row) => row.classList.remove("is-active"));
        button.classList.add("is-active");
        seekVideoTo(Number(button.dataset.seek));
        return;
      }

      const action = button.dataset.action;
      if (action === "collapse") setPanelOpen(false);
      if (action === "set-start") setTimeFromCurrent("start");
      if (action === "set-end") setTimeFromCurrent("end");
      if (action === "set-frame") setTimeFromCurrent("frame");
      if (action === "create") createClip();
      if (action === "capture-frame") captureFrame();
      if (action === "get-thumbnail") downloadThumbnail();
      if (action === "get-title") copyVideoTitle();
      if (action === "cancel") stopRecording(true);
      if (action === "download") downloadClip();
      if (action === "download-audio") downloadAudioOutput();
      if (action === "copy-image") copyCapturedImage();
      if (action === "reset") resetResult();
      if (action === "toggle-subtitles") toggleSubtitlesPanel();
      if (action === "load-subtitles") loadSubtitles();
      if (action === "copy-subtitles") copySubtitles();
      if (action === "download-subtitles") downloadSubtitles();
      if (button.dataset.duration) applyQuickDuration(Number(button.dataset.duration));
    });

    query('[data-select="sub-track"]').addEventListener("change", () => {
      if (state.subTracks.length) loadSubtitles();
    });

    query('[data-select="sub-time-style"]').addEventListener("change", (event) => {
      applySubtitleTimeStyle(event.target.value);
    });

    state.root.querySelectorAll("[data-input]").forEach((input) => {
      bindTimeInputMask(input);
      input.addEventListener("input", () => {
        clearMessage();
        state.root.querySelectorAll("[data-duration]").forEach((button) => {
          button.classList.remove("is-active");
          button.setAttribute("aria-pressed", "false");
        });
        updateSelectionUI();
      });
      input.addEventListener("blur", () => {
        const value = parseTime(input.value);
        if (Number.isFinite(value)) input.value = Number.isInteger(value) ? formatTime(value) : formatPreciseTime(value);
        updateSelectionUI();
      });
    });

    bindVideoEvents(state.video);
  }

  function bindVideoEvents(video) {
    if (!video || state.boundVideos.has(video)) return;
    state.boundVideos.add(video);
    video.addEventListener("loadedmetadata", () => {
      if (video === state.video) refreshVideoInfo(true);
    });
    video.addEventListener("timeupdate", () => {
      if (!state.recording && video === state.video && state.root?.isConnected) {
        const label = formatTime(video.currentTime);
        query('[data-role="current-time"]').textContent = label;
        state.root.querySelectorAll(".fourk-live-hint").forEach((node) => {
          node.textContent = label;
        });
      }
    });
  }

  function handleNavigation() {
    if (location.href === state.currentUrl) return;
    state.currentUrl = location.href;
    if (state.recording) stopRecording(true);
    releaseClipUrl();
    window.setTimeout(() => {
      if (getVideoId() !== state.subVideoId) resetSubtitles();
      if (isWatchPage()) {
        state.video = findVideo();
        if (state.root) {
          state.root.hidden = false;
          setView("form");
          clearMessage();
          refreshVideoInfo(true);
        } else {
          mount();
        }
      } else if (state.root) {
        state.root.hidden = true;
      }
    }, 500);
  }

  document.addEventListener("yt-navigate-finish", handleNavigation);
  window.addEventListener("popstate", handleNavigation);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "FOURK_TOGGLE_PANEL" || !isWatchPage()) return;
    if (!state.root) {
      mount();
      return;
    }
    setPanelOpen(state.root.hidden);
  });
  window.addEventListener("beforeunload", () => {
    if (state.recording) stopRecording(true);
    releaseClipUrl();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.recording && state.activeSelection) {
      updateRecordingProgress(state.activeSelection.start, state.activeSelection.end);
    }
  });
  window.setInterval(handleNavigation, 1000);
  mount();
})();
