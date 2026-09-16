(function initializeFourKPanel() {
  "use strict";

  if (window.top !== window || window.__fourKPanelLoaded) {
    return;
  }
  window.__fourKPanelLoaded = true;

  const { parseTime, formatTime, formatPreciseTime, clamp, secondsFromDigitBuffer } = window.FourKTime;
  const { parseCaptions, parseTranscript, finalizeCues, normalizeText, stripTags, renderCues, formatTimestamp, FORMAT_META, isCaptionUrl, withCaptionFormat } = window.FourKSubtitles;
  const MAX_CLIP_SECONDS = 15 * 60;
  const MAX_TIME_MASK_DIGITS = 6;
  const timeInputBuffers = new WeakMap();
  const CAPTION_FORMATS = ["json3", "srv3", "srv1", "vtt"];
  const AUTO_SUBTITLE_DELAY_MS = 1200;
  const AUTO_SUBTITLE_RETRY_DELAY_MS = 6000;
  const AUTO_SUBTITLE_MAX_TRIES = 2;
  const BRIDGE_REQUEST = "__fourKBridgeRequest";
  const BRIDGE_REPLY = "__fourKBridgeReply";
  const POT_CACHE_AGE_MS = 60 * 1000;
  const capturedCaptionUrls = [];
  const bridgeRequests = new Map();
  let bridgeRequestId = 0;
  let innerTubeSession = null;

  const state = {
    root: null,
    video: null,
    recorder: null,
    captureStream: null,
    clipUrl: null,
    clipBlob: null,
    clipFileName: "",
    clipAudioExtension: "",
    outputKind: null,
    mode: "video",
    recording: false,
    cancelling: false,
    currentUrl: location.href,
    previousPlayback: null,
    stopTimer: null,
    progressInterval: null,
    frameRequest: null,
    playbackGuard: null,
    boundVideos: new WeakSet(),
    subTracks: [],
    subCues: [],
    subVideoId: "",
    subAutoVideoId: "",
    subAutoTries: 0,
    subAutoTimer: null,
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
              <span class="fourk-brand-name">4K</span>
              <span class="fourk-brand-tag">Fast, private video clipping</span>
            </div>
            <button class="fourk-close-btn" data-action="collapse" type="button" aria-label="Close panel">Close</button>
          </header>

          <div class="fourk-video-summary">
            <div class="fourk-video-indicator"><i></i><span>YouTube video detected</span></div>
            <p class="fourk-video-title">Loading video info…</p>
            <div class="fourk-video-meta">
              <span data-role="current-time">0:00</span><span class="fourk-dot">•</span><span data-role="video-duration">--:--</span>
            </div>
            <div class="fourk-thumbnail-actions">
              <button type="button" class="fourk-split-btn" data-action="get-thumbnail">
                <span class="fourk-split-icon" aria-hidden="true">🖼️</span>
                <span>Get Thumbnail</span>
              </button>
              <span class="fourk-split-divider" aria-hidden="true"></span>
              <button type="button" class="fourk-split-btn" data-action="get-title">
                <span class="fourk-split-icon" aria-hidden="true">📋</span>
                <span>Get Title</span>
              </button>
            </div>
          </div>

          <div class="fourk-view-area">
            <div class="fourk-form" data-view="form">
              <nav class="fourk-tabs" role="tablist" aria-label="Choose a tool">
                <button type="button" class="fourk-tab is-active" data-tool="video" role="tab" aria-selected="true">Video</button>
                <button type="button" class="fourk-tab" data-tool="audio" role="tab" aria-selected="false">Audio</button>
                <button type="button" class="fourk-tab" data-tool="frame" role="tab" aria-selected="false">Frame</button>
                <button type="button" class="fourk-tab" data-tool="sub" role="tab" aria-selected="false">Subtitles</button>
              </nav>

              <div class="fourk-panels">
                <div data-mode-panel="range">
                  <div class="fourk-section-label"><span data-role="range-heading">Video range</span><span data-role="selection-duration">30 seconds</span></div>

                  <div class="fourk-time-grid">
                    <label class="fourk-time-field">
                      <span>Start time</span>
                      <div class="fourk-input-wrap">
                        <input data-input="start" value="0:00" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Start time">
                      </div>
                      <button type="button" class="fourk-text-link" data-action="set-start">Use current position</button>
                    </label>
                    <label class="fourk-time-field">
                      <span>End time</span>
                      <div class="fourk-input-wrap">
                        <input data-input="end" value="0:30" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="End time">
                      </div>
                      <button type="button" class="fourk-text-link" data-action="set-end">Use current position</button>
                    </label>
                  </div>

                  <p class="fourk-hint-text">Enter seconds, mm:ss, or hh:mm:ss.</p>

                  <div class="fourk-timeline" aria-hidden="true">
                    <div class="fourk-timeline-track"><div class="fourk-timeline-selection"></div><i class="fourk-handle fourk-handle-start"></i><i class="fourk-handle fourk-handle-end"></i></div>
                    <div class="fourk-timeline-labels"><span>0:00</span><span data-role="timeline-end">--:--</span></div>
                  </div>

                  <div class="fourk-quick-row">
                    <span>Quick clip</span>
                    <div>
                      <button type="button" data-duration="15">15s</button>
                      <button type="button" data-duration="30" class="is-active">30s</button>
                      <button type="button" data-duration="60">60s</button>
                    </div>
                  </div>

                  <button class="fourk-primary" type="button" data-action="create">
                    <span data-role="create-label">Create video clip</span>
                  </button>
                </div>

                <div class="fourk-frame-panel" data-mode-panel="frame" hidden>
                  <div class="fourk-section-label"><span>Capture frame</span><span>PNG</span></div>
                  <label class="fourk-time-field fourk-frame-time">
                    <span>Capture time</span>
                    <div class="fourk-input-wrap">
                      <input data-input="frame" value="0:00" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Frame capture time">
                    </div>
                    <button type="button" class="fourk-text-link" data-action="set-frame">Use current position</button>
                  </label>
                  <p class="fourk-hint-text">Enter seconds, mm:ss, or hh:mm:ss.</p>
                  <button class="fourk-primary" type="button" data-action="capture-frame"><span>Capture frame</span></button>
                </div>

                <div class="fourk-sub-panel" data-mode-panel="sub" hidden>
                  <div class="fourk-section-label"><span>Subtitles</span><span data-role="sub-count">Waiting</span></div>

                  <label class="fourk-time-field fourk-sub-field">
                    <span>Language</span>
                    <div class="fourk-select-wrap"><select data-select="sub-track" aria-label="Choose subtitle language"><option value="">Subtitles load automatically</option></select></div>
                  </label>

                  <div class="fourk-quick-row fourk-sub-formats">
                    <span>Format</span>
                    <div>
                      <button type="button" data-sub-format="txt" class="is-active">TXT</button>
                      <button type="button" data-sub-format="srt">SRT</button>
                      <button type="button" data-sub-format="vtt">VTT</button>
                      <button type="button" data-sub-format="json">JSON</button>
                    </div>
                  </div>

                  <label class="fourk-time-field fourk-sub-field" data-role="sub-time-style-field">
                    <span>TXT timestamp format</span>
                    <div class="fourk-select-wrap"><select data-select="sub-time-style" aria-label="Timestamp style">
                      <option value="clock">00:01:23.450 (hours:minutes:seconds.ms)</option>
                      <option value="short">01:23 (minutes:seconds)</option>
                      <option value="seconds">83.45 (decimal seconds)</option>
                    </select></div>
                  </label>

                  <button class="fourk-primary" type="button" data-action="load-subtitles"><span>Load subtitles</span></button>

                  <div class="fourk-sub-preview" data-role="sub-preview" hidden></div>

                  <div class="fourk-sub-actions" data-role="sub-actions" hidden>
                    <button class="fourk-secondary" type="button" data-action="copy-subtitles"><span data-role="copy-sub-label">Copy</span></button>
                    <button class="fourk-secondary" type="button" data-action="download-subtitles"><span>Download</span></button>
                  </div>
                </div>

                <div class="fourk-message" data-role="message" hidden></div>
                <p class="fourk-privacy">Processed entirely in your browser. Nothing is uploaded.</p>
              </div>
            </div>

            <div class="fourk-recording" data-view="recording" hidden>
              <div class="fourk-recording-visual">
                <div class="fourk-recording-ring"><span data-role="recording-percent">0%</span></div>
                <div><strong data-role="recording-heading">Creating video clip</strong><p>Keep this tab open while processing.</p></div>
              </div>
              <div class="fourk-progress"><i data-role="progress-bar"></i></div>
              <div class="fourk-progress-meta"><span data-role="progress-time">0:00 / 0:30</span><span>Processing</span></div>
              <button class="fourk-secondary fourk-danger" type="button" data-action="cancel">Cancel</button>
            </div>

            <div class="fourk-result" data-view="result" hidden>
              <div class="fourk-success-badge">
                <strong data-role="result-heading">Clip ready</strong>
                <small data-role="result-description">Your file is ready.</small>
              </div>
              <div class="fourk-preview-wrap">
                <video data-role="preview-video" controls playsinline></video>
                <audio data-role="preview-audio" controls></audio>
                <img data-role="preview-image" alt="Captured frame">
                <span class="fourk-preview-label">Preview</span>
              </div>
              <div class="fourk-file-info">
                <strong data-role="file-name">youtube-clip.mp4</strong>
                <small data-role="file-meta">MP4</small>
              </div>
              <button class="fourk-primary" type="button" data-action="download"><span data-role="download-label">Download video</span></button>
              <button class="fourk-secondary" type="button" data-action="copy-image" hidden><span data-role="copy-image-label">Copy image</span></button>
              <button class="fourk-secondary" type="button" data-action="reset"><span data-role="reset-label">Create another clip</span></button>
            </div>
          </div>
        </section>
      </aside>
    `);

    document.documentElement.appendChild(state.root);
    setView("form");
    bindEvents();
    refreshVideoInfo(true);
    scheduleAutoSubtitles();
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
    query('[data-role="timeline-end"]').textContent = duration ? formatTime(duration) : "--:--";

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
    const videoDuration = Number.isFinite(state.video.duration) ? state.video.duration : 0;
    const valid = Number.isFinite(selection.start) && Number.isFinite(selection.end) && selection.end > selection.start;
    query('[data-role="selection-duration"]').textContent = valid ? formatDurationLabel(selection.duration) : "Invalid";

    const startPercent = videoDuration ? clamp((selection.start / videoDuration) * 100, 0, 100) : 0;
    const endPercent = videoDuration ? clamp((selection.end / videoDuration) * 100, 0, 100) : 0;
    const selectionBar = query(".fourk-timeline-selection");
    selectionBar.style.left = `${startPercent}%`;
    selectionBar.style.width = `${Math.max(0, endPercent - startPercent)}%`;
    query(".fourk-handle-start").style.left = `${startPercent}%`;
    query(".fourk-handle-end").style.left = `${endPercent}%`;
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
      button.classList.toggle("is-active", Number(button.dataset.duration) === seconds);
    });
    clearMessage();
    updateSelectionUI();
  }

  function switchTool(mode) {
    if (!['video', 'audio', 'frame', 'sub'].includes(mode) || state.recording) return;
    state.mode = mode;
    state.root.querySelectorAll("[data-tool]").forEach((button) => {
      const active = button.dataset.tool === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    query('[data-mode-panel="range"]').hidden = mode === "frame" || mode === "sub";
    query('[data-mode-panel="frame"]').hidden = mode !== "frame";
    query('[data-mode-panel="sub"]').hidden = mode !== "sub";

    if (mode === "video" || mode === "audio") {
      query('[data-role="range-heading"]').textContent = mode === "audio"
        ? "Audio range"
        : "Video range";
      const createLabel = mode === "audio" ? "Create audio clip" : "Create video clip";
      query('[data-role="create-label"]').textContent = createLabel;
    }
    clearMessage();

    if (mode === "sub" && !state.subCues.length && !state.subLoading && !state.subNoTracks) {
      loadSubtitles();
    }
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

  async function captureFrameBlob(video) {
    const directCanvas = document.createElement("canvas");
    directCanvas.width = video.videoWidth;
    directCanvas.height = video.videoHeight;
    if (directCanvas.width && directCanvas.height) {
      try {
        directCanvas.getContext("2d").drawImage(video, 0, 0, directCanvas.width, directCanvas.height);
        return await canvasToBlob(directCanvas);
      } catch (_) {
      }
    }

    const rect = video.getBoundingClientRect();
    const visibleLeft = clamp(rect.left, 0, window.innerWidth);
    const visibleTop = clamp(rect.top, 0, window.innerHeight);
    const visibleRight = clamp(rect.right, 0, window.innerWidth);
    const visibleBottom = clamp(rect.bottom, 0, window.innerHeight);
    if (visibleRight - visibleLeft < 80 || visibleBottom - visibleTop < 45) {
      throw new Error("The video player is off-screen. Scroll to the video and try again.");
    }

    state.root.style.visibility = "hidden";
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const response = await sendRuntimeMessage({ type: "FOURK_CAPTURE_VISIBLE_TAB" });
      const screenshot = await loadImage(response.dataUrl);
      const scaleX = screenshot.naturalWidth / window.innerWidth;
      const scaleY = screenshot.naturalHeight / window.innerHeight;
      const sx = Math.round(visibleLeft * scaleX);
      const sy = Math.round(visibleTop * scaleY);
      const sw = Math.round((visibleRight - visibleLeft) * scaleX);
      const sh = Math.round((visibleBottom - visibleTop) * scaleY);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d").drawImage(screenshot, sx, sy, sw, sh, 0, 0, sw, sh);
      return await canvasToBlob(canvas);
    } finally {
      state.root.style.visibility = "";
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
    if (!cues.length) {
      count.textContent = "None";
    } else {
      const duration = Number.isFinite(state.video?.duration) ? state.video.duration : 0;
      const last = cues[cues.length - 1];
      const covered = Math.max(last.end || 0, last.start || 0);
      if (!duration) {
        count.textContent = `${cues.length} lines`;
      } else if (covered >= duration * 0.95) {
        count.textContent = `${cues.length} lines · full video ${formatTime(duration)}`;
      } else {
        count.textContent = `${cues.length} lines · up to ${formatTime(covered)} / ${formatTime(duration)}`;
      }
    }
    query('[data-role="sub-actions"]').hidden = cues.length === 0;
  }

  function buildSubtitleOutput() {
    const meta = FORMAT_META[state.subFormat] || FORMAT_META.txt;
    return {
      text: renderCues(state.subCues, state.subFormat, { timeStyle: state.subTimeStyle }),
      extension: meta.extension,
      mime: meta.mime
    };
  }

  function resetSubtitles() {
    window.clearTimeout(state.subAutoTimer);
    state.subAutoTimer = null;
    state.subTracks = [];
    state.subCues = [];
    state.subVideoId = "";
    state.subAutoVideoId = "";
    state.subAutoTries = 0;
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
    if (count) count.textContent = "Waiting";
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
      renderSubtitlePreview(cues);
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

  function scheduleAutoSubtitles(delay = AUTO_SUBTITLE_DELAY_MS) {
    window.clearTimeout(state.subAutoTimer);
    state.subAutoTimer = window.setTimeout(autoLoadSubtitles, delay);
  }

  async function autoLoadSubtitles() {
    state.subAutoTimer = null;
    if (state.recording || state.subLoading) return;
    if (!state.root || state.root.hidden || !isWatchPage()) return;

    const videoId = getVideoId();
    if (!videoId) return;
    if (videoId !== state.subAutoVideoId) {
      state.subAutoVideoId = videoId;
      state.subAutoTries = 0;
    }
    if (videoId === state.subVideoId && state.subCues.length) return;
    if (state.subNoTracks) return;
    if (state.subAutoTries >= AUTO_SUBTITLE_MAX_TRIES) return;
    state.subAutoTries += 1;

    const ok = await loadSubtitles({ silent: true });
    if (!ok && state.subAutoTries < AUTO_SUBTITLE_MAX_TRIES && getVideoId() === videoId) {
      scheduleAutoSubtitles(AUTO_SUBTITLE_RETRY_DELAY_MS);
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
      button.classList.toggle("is-active", button.dataset.subFormat === format);
    });
    query('[data-role="sub-time-style-field"]').hidden = format !== "txt";
    if (state.subCues.length) renderSubtitlePreview(state.subCues);
  }

  function applySubtitleTimeStyle(style) {
    if (!["clock", "short", "seconds"].includes(style)) return;
    state.subTimeStyle = style;
    if (state.subCues.length) renderSubtitlePreview(state.subCues);
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

  function updateRecordingProgress(start, end) {
    if (!state.recording || !state.video) return;
    const elapsed = clamp(state.video.currentTime - start, 0, end - start);
    const percent = clamp((elapsed / (end - start)) * 100, 0, 100);
    query('[data-role="recording-percent"]').textContent = `${Math.round(percent)}%`;
    query('[data-role="progress-bar"]').style.width = `${percent}%`;
    query('[data-role="progress-time"]').textContent = `${formatPreciseTime(elapsed)} / ${formatTime(end - start)}`;

    if (state.video.currentTime >= end - 0.035 || state.video.ended) {
      stopRecording(false);
      return;
    }

    if (typeof state.video.requestVideoFrameCallback === "function") {
      state.frameRequest = state.video.requestVideoFrameCallback(() => updateRecordingProgress(start, end));
    }
  }

  function prepareRecording(kind, selection) {
    state.previousPlayback = {
      time: state.video.currentTime,
      paused: state.video.paused,
      playbackRate: state.video.playbackRate
    };
    state.cancelling = false;
    state.recording = true;
    query('[data-role="recording-heading"]').textContent = kind === "audio" ? "Creating audio clip" : "Creating video clip";
    query('[data-role="recording-percent"]').textContent = "0%";
    query('[data-role="progress-bar"]').style.width = "0%";
    query('[data-role="progress-time"]').textContent = `0:00 / ${formatTime(selection.duration)}`;
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

  async function createAudioClip(selection, capture) {
    const mimeType = getSupportedAudioMimeType();
    if (!mimeType) {
      throw new Error("This Chrome build doesn't support exporting audio directly. Update Chrome to the latest version.");
    }

    state.video.pause();
    state.video.playbackRate = 1;
    await waitForSeek(state.video, selection.start);
    if (state.cancelling) {
      restoreAfterCancel();
      return;
    }

    state.captureStream = capture.call(state.video);
    const audioTracks = state.captureStream?.getAudioTracks();
    if (!audioTracks?.length) {
      throw new Error("YouTube didn't provide an audio stream for this video.");
    }
    const audioOnlyStream = new MediaStream(audioTracks);

    const chunks = [];
    state.recorder = new MediaRecorder(audioOnlyStream, {
      mimeType,
      audioBitsPerSecond: 192_000
    });

    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });

    const finished = new Promise((resolve, reject) => {
      state.recorder.addEventListener("stop", resolve, { once: true });
      state.recorder.addEventListener("error", () => reject(new Error("An error occurred while creating the audio file.")), { once: true });
    });

    state.recorder.start(500);
    await state.video.play();
    if (state.cancelling) {
      restoreAfterCancel();
      return;
    }
    startPlaybackTracking(selection);

    await finished;

    if (state.cancelling) {
      restoreAfterCancel();
      return;
    }

    const meta = audioFileMeta(state.recorder.mimeType || mimeType);
    const blob = new Blob(chunks, { type: meta.mime });
    if (blob.size < 512) {
      throw new Error("The generated audio file has no data.");
    }

    releaseClipUrl();
    state.clipBlob = blob;
    state.clipUrl = URL.createObjectURL(blob);
    state.outputKind = "audio";
    state.clipAudioExtension = meta.extension;
    state.clipFileName = makeFileName(selection.start, selection.end, "audio");
    showResult(selection, "audio");
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

    const kind = state.mode === "audio" ? "audio" : "video";
    if (typeof MediaRecorder === "undefined") {
      showMessage("This browser doesn't support recording. Use a newer version of Chrome.");
      return;
    }
    const mimeType = kind === "video" ? getSupportedMp4MimeType() : "";
    if (kind === "video" && !mimeType) {
      showMessage("This Chrome build doesn't support exporting MP4 directly. Update Chrome to the latest version.");
      return;
    }

    prepareRecording(kind, selection);

    try {
      if (kind === "audio") {
        await createAudioClip(selection, capture);
        return;
      }

      state.video.pause();
      state.video.playbackRate = 1;
      await waitForSeek(state.video, selection.start);
      if (state.cancelling) {
        restoreAfterCancel();
        return;
      }

      state.captureStream = capture.call(state.video);
      const selectedTracks = state.captureStream?.getTracks();
      if (!selectedTracks?.length || state.captureStream.getVideoTracks().length === 0) {
        throw new Error("YouTube didn't provide a video stream to clip.");
      }

      const chunks = [];
      state.recorder = new MediaRecorder(state.captureStream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
        audioBitsPerSecond: 192_000
      });

      state.recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) chunks.push(event.data);
      });

      const finished = new Promise((resolve, reject) => {
        state.recorder.addEventListener("stop", resolve, { once: true });
        state.recorder.addEventListener("error", () => reject(new Error("An error occurred while creating the MP4 file.")), { once: true });
      });

      state.recorder.start(500);
      await state.video.play();
      if (state.cancelling) {
        restoreAfterCancel();
        return;
      }
      startPlaybackTracking(selection);

      await finished;

      if (state.cancelling) {
        restoreAfterCancel();
        return;
      }

      const outputType = state.recorder.mimeType || mimeType;
      if (!outputType.toLowerCase().startsWith("video/mp4")) {
        throw new Error("Chrome couldn't produce a valid MP4 file on this device.");
      }
      const blob = new Blob(chunks, { type: "video/mp4" });
      if (blob.size < 1024) {
        throw new Error("The generated file has no data. YouTube may be restricting recording for this video.");
      }

      releaseClipUrl();
      state.clipBlob = blob;
      state.clipUrl = URL.createObjectURL(blob);
      state.outputKind = kind;
      state.clipFileName = makeFileName(selection.start, selection.end, kind);
      showResult(selection, kind);
    } catch (error) {
      console.error("[4K]", error);
      cleanupRecording();
      setView("form");
      showMessage(error?.message || `Couldn't create the ${kind} clip. Try playing the video and doing it again.`);
      restoreOriginalPlayback();
    }
  }

  function stopRecording(cancelled) {
    if (!state.recording) return;
    state.cancelling = cancelled;
    state.recording = false;
    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.stop();
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
    if (state.recorder && state.recorder.state !== "inactive") {
      try {
        state.recorder.stop();
      } catch (_) {
      }
    }
    if (state.captureStream) {
      state.captureStream.getTracks().forEach((track) => track.stop());
    }
    state.captureStream = null;
    state.recorder = null;
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
    showMessage(`Cancelled the ${state.mode === "audio" ? "audio" : "video"} clip. You can choose a new time range.`, "success");
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
    const audioPreview = query('[data-role="preview-audio"]');
    const imagePreview = query('[data-role="preview-image"]');
    videoPreview.hidden = kind !== "video";
    audioPreview.hidden = kind !== "audio";
    imagePreview.hidden = kind !== "frame";
    if (kind === "video") videoPreview.src = state.clipUrl;
    if (kind === "audio") audioPreview.src = state.clipUrl;
    if (kind === "frame") imagePreview.src = state.clipUrl;

    const audioLabel = (state.clipAudioExtension || "webm").toUpperCase();
    const labels = {
      video: { format: "MP4 VIDEO", heading: "Video ready", description: "Your file is ready.", download: "Download video", reset: "Create another clip" },
      audio: { format: `${audioLabel} AUDIO`, heading: "Audio ready", description: "Your file is ready.", download: "Download audio", reset: "Create another clip" },
      frame: { format: "PNG", heading: "Frame ready", description: "Your image is ready.", download: "Download image", reset: "Capture another frame" }
    }[kind];
    query('[data-role="file-name"]').textContent = state.clipFileName;
    query('[data-role="file-meta"]').textContent = kind === "frame"
      ? `${labels.format} · ${formatBytes(state.clipBlob.size)} · ${formatTime(selection.start)}`
      : `${labels.format} · ${formatBytes(state.clipBlob.size)} · ${formatTime(selection.duration)}`;
    query('[data-role="download-label"]').textContent = labels.download;
    query('[data-action="copy-image"]').hidden = kind !== "frame";
    query('[data-role="reset-label"]').textContent = labels.reset;
    query('[data-role="result-heading"]').textContent = labels.heading;
    query('[data-role="result-description"]').textContent = labels.description;
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
    if (kind === "frame") return `${safeTitle} [frame-${startLabel}].png`;
    const endLabel = formatTime(end, true).replaceAll(":", "-");
    const suffix = kind === "audio" ? "audio" : "video";
    const extension = kind === "audio" ? (state.clipAudioExtension || "webm") : "mp4";
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

  function releaseClipUrl() {
    const videoPreview = query('[data-role="preview-video"]');
    const audioPreview = query('[data-role="preview-audio"]');
    const imagePreview = query('[data-role="preview-image"]');
    [videoPreview, audioPreview].forEach((preview) => {
      if (!preview) return;
      preview.pause();
      preview.removeAttribute("src");
      preview.load();
    });
    if (imagePreview) imagePreview.removeAttribute("src");
    if (state.clipUrl) URL.revokeObjectURL(state.clipUrl);
    state.clipUrl = null;
    state.clipBlob = null;
    state.outputKind = null;
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

      if (button.dataset.seek) {
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
      if (action === "copy-image") copyCapturedImage();
      if (action === "reset") resetResult();
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
        state.root.querySelectorAll("[data-duration]").forEach((button) => button.classList.remove("is-active"));
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
        query('[data-role="current-time"]').textContent = formatTime(video.currentTime);
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
          scheduleAutoSubtitles();
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
  window.setInterval(handleNavigation, 1000);
  mount();
})();
