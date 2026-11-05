import {
  isEditableShortcutTarget,
  matchesRendererShortcut,
  readRendererShortcuts,
  RENDERER_SHORTCUTS_EVENT,
  RENDERER_SHORTCUTS_STORAGE_KEY,
} from "../core/renderer-shortcuts.js";
import { parsePlaybackOffset } from "../core/mstruct-playback.js";
import { createRendererFullscreen } from "./renderer-fullscreen.js";
import { createRendererPlayback } from "./renderer-playback.js";
import { createRendererSearch } from "./renderer-search.js";
import { RENDERER_LAYERS_CHANNEL } from "../core/renderer-layers.js";
import { RENDERER_AUDIO_ICONS } from "./renderer-audio-icons.js";
import { observeRendererNavHeight } from "./renderer-nav-layout.js";
import { createRendererPresentation } from "./renderer-presentation.js";
import { createRendererPianoKeyboard } from "./renderer-piano-keyboard.js";
import "./renderer-piano-keyboard.css";

export function setupRendererNav({ tr, rendererCanvas, isHostedViewer, desktopPreviewMode = false, presentationEnabled = false, videoPresentationEnabled = false, onPresentationModeChange, onChooseVideo, postToHost, closePopovers, pianoPlayer, getLocale, getComments, getChordPreferences, renderCommentText, getSearchOptions, getRendererLayers, onRendererLayersChange, makeTagLabel, makeFormSymbol, makeBpmLabel, appendChordNotation, openChordPopover, setFullscreenPopovers, onFullscreenLayoutChange, onPresentationGeometryChange, onTimelineChange, onTimelineManage, onTimelineDownload, onTimelineHistory, onPlaybackState, onChooseBgm, onTimelineAudioChange }) {
  const nav = document.querySelector(".renderer-nav");
  const stopObservingNavHeight = observeRendererNavHeight(nav);
  const timeline = document.querySelector("#rendererTimeline");
  const timelineManager = document.querySelector("#rendererTimelineManager");
  const timelineDownload = document.querySelector("#rendererTimelineDownload");
  const timelineHistory = document.querySelector("#rendererTimelineHistory");
  const playPause = document.querySelector("#rendererPlayPause");
  const stop = document.querySelector("#rendererStop");
  const goTo = document.querySelector("#rendererGoTo");
  const piano = document.querySelector("#rendererPiano");
  const volume = document.querySelector("#rendererVolume");
  const volumeControl = volume.closest(".renderer-volume-control");
  const volumePanel = document.querySelector("#rendererVolumePanel");
  const volumeSlider = document.querySelector("#rendererVolumeSlider");
  const volumeValue = document.querySelector("#rendererVolumeValue");
  const bgmFile = document.querySelector("#rendererBgmFile");
  piano.querySelector("svg").innerHTML = RENDERER_AUDIO_ICONS.piano;
  bgmFile.querySelector("svg").innerHTML = RENDERER_AUDIO_ICONS.bgmFile;
  const bgmInput = document.querySelector("#rendererBgmInput");
  const audioNotice = document.querySelector("#rendererAudioNotice");
  const autoScroll = document.querySelector("#rendererAutoScroll");
  const playbackTime = document.querySelector("#rendererPlaybackTime");
  const playbackProgress = document.querySelector("#rendererPlaybackProgress");
  const playbackPosition = document.querySelector("#rendererPlaybackPosition");
  const lock = document.querySelector("#rendererLock");
  const offset = document.querySelector("#rendererOffset");
  const fullscreenButton = document.querySelector("#rendererFullscreen");
  const searchButton = document.querySelector("#rendererSearch");
  const searchPanel = document.querySelector("#rendererSearchPanel");
  const searchInput = document.querySelector("#rendererSearchInput");
  const searchPrevious = document.querySelector("#rendererSearchPrevious");
  const searchCount = document.querySelector("#rendererSearchCount");
  const searchNext = document.querySelector("#rendererSearchNext");
  const searchError = document.querySelector("#rendererSearchError");
  const searchClose = document.querySelector("#rendererSearchClose");
  const layersButton = document.querySelector("#rendererLayers");
  const layersPanel = document.querySelector("#rendererLayersPanel");
  const layerInputs = [...layersPanel.querySelectorAll("[data-renderer-layer]")];
  const layersChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(RENDERER_LAYERS_CHANNEL) : null;
  let presentation = null;
  const keyboard = createRendererPianoKeyboard({ panel: document.querySelector("#rendererPanel"), canvas: rendererCanvas, nav,
    player: pianoPlayer, getPreferences: getChordPreferences, getLayers: getRendererLayers, tr, isHostedViewer, requestScroll });
  const fullscreen = createRendererFullscreen({
    rendererPanel: document.querySelector("#rendererPanel"),
    canvas: rendererCanvas,
    button: fullscreenButton,
    infoPanel: document.querySelector("#rendererFullscreenInfo"),
    tr,
    getLocale,
    getComments,
    renderCommentText,
    getChordPreferences,
    makeTagLabel,
    makeFormSymbol,
    makeBpmLabel,
    appendChordNotation,
    openChordPopover,
    setFullscreenPopovers,
    onLayoutChange: onFullscreenLayoutChange,
    onActiveChange: value => presentation?.setActive(value),
    desktopPreviewMode,
    postToHost,
  });
  if (presentationEnabled) presentation = createRendererPresentation({
    panel: document.querySelector("#rendererPanel"), canvas: rendererCanvas, fullscreenButton, fileButton: bgmFile, tr,
    enter: () => fullscreen.enter(), videoEnabled: videoPresentationEnabled, onChooseVideo,
    onGeometryChange: onPresentationGeometryChange,
    onModeChange: (value, mode) => {
      onPresentationModeChange?.(value);
      postToHost("presentation-mode", { mode });
      onFullscreenLayoutChange?.({ force: true });
      keyboard.refresh();
      reflectLayers();
    },
    getPreviousEntry: entry => playback.getPreviousEntry(entry),
    getPlaybackEntries: () => playback.getPlaybackEntries(),
  });
  let committedOffset = 0;
  let timelineEditing = false;
  let stableTempo = false;
  let audioTimeline = "";
  let navLocked = true;
  let navRevealed = true;
  let shortcuts = readRendererShortcuts();
  let latestActiveEntry = null;
  let latestState = {
    enabled: false,
    playing: false,
    selecting: false,
    autoScroll: false,
    pianoEnabled: false,
    bgmVolume: 100,
    notice: null,
    timestamp: "00:00.000",
    position: "—",
  };

  function reflectPlayback(state = latestState, activeEntry = latestActiveEntry) {
    latestState = state;
    latestActiveEntry = activeEntry;
    const playLabel = tr(state.playing ? "rendererPause" : "rendererPlay");
    const unavailable = tr("rendererPlaybackUnavailable");
    playPause.setAttribute("aria-label", state.enabled ? playLabel : unavailable);
    playPause.title = state.enabled ? playLabel : unavailable;
    playPause.setAttribute("aria-pressed", String(state.playing));
    playPause.disabled = !state.enabled;
    goTo.disabled = !state.enabled;
    goTo.title = state.enabled ? tr("rendererGoTo") : unavailable;
    goTo.setAttribute("aria-label", state.enabled ? tr("rendererGoTo") : unavailable);
    goTo.setAttribute("aria-pressed", String(state.selecting));
    piano.setAttribute("aria-pressed", String(state.pianoEnabled));
    autoScroll.setAttribute("aria-pressed", String(state.autoScroll));
    volumeSlider.value = String(state.bgmVolume ?? 100);
    volumeValue.textContent = `${state.bgmVolume ?? 100}%`;
    bgmFile.classList.toggle("has-file", Boolean(state.bgmReady));
    const noticeKey = state.notice ? `rendererAudio_${state.notice.replaceAll("-", "_")}` : null;
    audioNotice.hidden = !noticeKey;
    audioNotice.textContent = noticeKey ? tr(noticeKey) : "";
    playbackTime.textContent = state.timestamp;
    playbackPosition.textContent = state.position;
    playbackProgress.max = String(Math.max(0, Math.round(state.durationMs ?? 0)));
    playbackProgress.value = String(Math.round(state.progressElapsedMs ?? 0));
    const progressRatio = state.durationMs > 0 ? Math.min(1, Math.max(0, (state.progressElapsedMs ?? 0) / state.durationMs)) : 0;
    playbackProgress.style.setProperty("--renderer-progress", `${progressRatio * 100}%`);
    playbackProgress.disabled = !state.enabled || state.mode === "countdown";
    playPause.querySelector("svg").innerHTML = state.playing
      ? '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>'
      : '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>';
    postToHost("playback-state", { playback: state });
    fullscreen.update(state, activeEntry);
    presentation?.update(state, activeEntry);
    keyboard.update(state.mode === "stopped" ? null : activeEntry, state);
    onPlaybackState?.(state, activeEntry);
  }

  function requestScroll(element) {
    if (rendererCanvas.dataset.fixedScale === "true") return;
    const scrollTarget = element.closest(".score-system") ?? element;
    const obstruction = keyboard.scrollObstruction(element);
    const rect = obstruction?.target ?? scrollTarget.getBoundingClientRect();
    if (isHostedViewer && !document.body.classList.contains("renderer-fullscreen-external")) {
      if (obstruction) keyboard.waitForHostScroll(element);
      postToHost("playback-scroll", { top: rect.top, height: rect.height, bottomInset: obstruction?.bottomInset ?? 0, keyboardScroll: Boolean(obstruction) });
      return;
    }
    const canvasRect = rendererCanvas.getBoundingClientRect();
    const navHeight = nav.offsetHeight;
    const visibleTop = canvasRect.top + navHeight;
    if (!obstruction && rect.top >= visibleTop && rect.bottom <= canvasRect.bottom) return;
    const nextTop = rendererCanvas.scrollTop + rect.top - visibleTop;
    rendererCanvas.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
  }

  function reflectNavVisibility() {
    nav.classList.toggle("is-auto-hidden", !navLocked && !navRevealed);
    nav.dataset.locked = String(navLocked);
    lock.setAttribute("aria-pressed", String(navLocked));
  }

  function revealNav() {
    if (navRevealed) return;
    navRevealed = true;
    reflectNavVisibility();
  }

  function hideUnlockedNav() {
    if (navLocked || !navRevealed) return;
    navRevealed = false;
    reflectNavVisibility();
  }

  const playback = createRendererPlayback({
    canvas: rendererCanvas,
    onStateChange: reflectPlayback,
    requestScroll,
    closePopovers,
    pianoPlayer,
    getPreferences: getChordPreferences,
    mediaElement: presentation?.mediaElement,
  });
  const search = createRendererSearch({
    canvas: rendererCanvas,
    button: searchButton,
    panel: searchPanel,
    input: searchInput,
    previousButton: searchPrevious,
    count: searchCount,
    nextButton: searchNext,
    error: searchError,
    closeButton: searchClose,
    tr,
    getQueryOptions: getSearchOptions,
    requestScroll,
    postToHost,
  });

  function changeOffset(step) {
    const next = committedOffset + step;
    if (!Number.isSafeInteger(next)) return;
    committedOffset = next;
    offset.value = String(next);
    playback.setTemporaryOffset(next);
  }

  function commitOffset() {
    const next = parsePlaybackOffset(offset.value);
    if (next === null) {
      offset.value = String(committedOffset);
      return;
    }
    committedOffset = next;
    offset.value = String(next);
    playback.setTemporaryOffset(next);
  }

  function setVolumeOpen(value) {
    const open = Boolean(value);
    volume.setAttribute("aria-expanded", String(open));
    volumePanel.hidden = !open;
  }

  function reflectLayers(value = getRendererLayers()) {
    for (const input of layerInputs) {
      input.checked = value[input.dataset.rendererLayer] === true;
      input.disabled = input.dataset.rendererLayer === "pianoKeyboard" && !keyboard.available();
    }
    postToHost("layer-state", { layers: value });
  }

  function setLayersOpen(value) {
    const open = Boolean(value);
    layersButton.setAttribute("aria-expanded", String(open));
    layersPanel.hidden = !open;
  }

  function updateLayers(value, { broadcast = true } = {}) {
    onRendererLayersChange?.(value);
    reflectLayers(getRendererLayers());
    keyboard.refresh();
    if (broadcast) layersChannel?.postMessage({ type: "state", layers: getRendererLayers() });
  }

  function handleLayersMessage(event) {
    if (event.data?.type === "request") {
      layersChannel?.postMessage({ type: "state", layers: getRendererLayers() });
      return;
    }
    if (event.data?.type === "state" && event.data.layers) updateLayers(event.data.layers, { broadcast: false });
  }

  function handleOutsideVolumePointer(event) {
    if (!volumePanel.hidden && !volumeControl?.contains(event.target)) setVolumeOpen(false);
    if (!layersPanel.hidden && !layersButton.closest(".renderer-layer-control")?.contains(event.target)) setLayersOpen(false);
  }

  function handleShortcutsChanged(event) {
    shortcuts = event.detail;
  }

  function handleShortcutStorage(event) {
    if (event.key === RENDERER_SHORTCUTS_STORAGE_KEY) shortcuts = readRendererShortcuts();
  }

  function handleShortcutKeydown(event) {
    if (isEditableShortcutTarget(event.target)) return;
    if (event.key === "Control") playback.setModifierSelecting(true);
    if (event.repeat) return;
    if (matchesRendererShortcut(event, shortcuts.playPause)) {
      event.preventDefault();
      playback.run(latestState.playing ? "pause" : "play");
      return;
    }
    if (!matchesRendererShortcut(event, shortcuts.stop)) return;
    event.preventDefault();
    playback.run("stop");
  }

  function handleShortcutKeyup(event) {
    if (event.key === "Control") playback.setModifierSelecting(false);
  }

  function clearModifierSelection() {
    playback.setModifierSelecting(false);
  }

  function runPlayPause() {
    playback.run(latestState.playing ? "pause" : "play");
  }

  playPause.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || playPause.disabled) return;
    event.preventDefault();
    runPlayPause();
  });
  playPause.addEventListener("click", (event) => {
    if (event.detail === 0) runPlayPause();
  });
  stop.addEventListener("click", () => playback.run("stop"));
  goTo.addEventListener("click", playback.toggleSelecting);
  piano.addEventListener("click", playback.togglePiano);
  volume.addEventListener("click", () => setVolumeOpen(volume.getAttribute("aria-expanded") !== "true"));
  layersButton.addEventListener("click", () => setLayersOpen(layersButton.getAttribute("aria-expanded") !== "true"));
  layersPanel.addEventListener("change", (event) => {
    const input = event.target.closest("[data-renderer-layer]");
    if (!input) return;
    updateLayers({ ...getRendererLayers(), [input.dataset.rendererLayer]: input.checked });
  });
  document.addEventListener("pointerdown", handleOutsideVolumePointer);
  volumeSlider.addEventListener("input", () => playback.setBgmVolume(Number(volumeSlider.value)));
  bgmFile.addEventListener("click", () => onChooseBgm ? void onChooseBgm() : bgmInput.click());
  bgmInput.addEventListener("change", () => {
    const [file] = bgmInput.files ?? [];
    if (file) void playback.loadBgmFile(file);
    bgmInput.value = "";
  });
  autoScroll.addEventListener("click", playback.toggleAutoScroll);
  playbackProgress.addEventListener("pointerdown", () => playback.beginScrub(Number(playbackProgress.value)));
  playbackProgress.addEventListener("input", () => playback.previewScrub(Number(playbackProgress.value)));
  playbackProgress.addEventListener("change", () => playback.commitScrub(Number(playbackProgress.value)));
  playbackProgress.addEventListener("pointercancel", playback.cancelScrub);
  timeline.addEventListener("change", () => {
    committedOffset = 0;
    offset.value = "0";
    playback.setTemporaryOffset(0);
    reflectTimelineVisibility();
    onTimelineChange?.(timeline.value);
  });
  timelineManager.addEventListener("click", () => onTimelineManage?.());
  timelineDownload.addEventListener("click", () => onTimelineDownload?.(timeline.value));
  timelineHistory.addEventListener("click", () => onTimelineHistory?.(timeline.value));
  lock.addEventListener("click", () => {
    navLocked = !navLocked;
    if (navLocked) navRevealed = true;
    reflectNavVisibility();
  });
  nav.addEventListener("pointerenter", revealNav);
  nav.addEventListener("pointerleave", hideUnlockedNav);
  nav.addEventListener("focusin", revealNav);
  nav.addEventListener("focusout", (event) => {
    if (!nav.contains(event.relatedTarget)) hideUnlockedNav();
  });
  offset.addEventListener("blur", commitOffset);
  offset.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    offset.blur();
  });
  document.querySelector("#rendererOffsetDown").addEventListener("click", () => changeOffset(-10));
  document.querySelector("#rendererOffsetUp").addEventListener("click", () => changeOffset(10));

  window.addEventListener(RENDERER_SHORTCUTS_EVENT, handleShortcutsChanged);
  window.addEventListener("storage", handleShortcutStorage);
  window.addEventListener("keydown", handleShortcutKeydown);
  window.addEventListener("keyup", handleShortcutKeyup);
  window.addEventListener("blur", clearModifierSelection);
  layersChannel?.addEventListener("message", handleLayersMessage);

  reflectNavVisibility();
  reflectPlayback();
  reflectLayers();
  layersChannel?.postMessage({ type: "request" });

  function reflectTimelineVisibility() {
    timeline.parentElement.hidden = stableTempo && !timelineEditing;
    timelineManager.hidden = !timelineEditing;
    const option = timeline.selectedOptions[0];
    const selected = Boolean(timeline.value);
    timelineDownload.hidden = desktopPreviewMode || !selected;
    timelineHistory.hidden = !selected || option?.dataset.history !== "true";
  }

  return {
    refreshLocale: () => {
      reflectPlayback(latestState);
      fullscreen.refresh();
      presentation?.refreshLocale();
      search.refreshLocale();
    },
    updateDocument({ result, isStableTempo, globalOffset, userOffset, timelineDocument }) {
      keyboard.setDocument(result);
      stableTempo = isStableTempo;
      reflectTimelineVisibility();
      playback.setDocument({ result, stableTempo: isStableTempo, globalOffset, userOffset, timelineDocument });
      search.updateDocument(result);
      fullscreen.refresh();
      presentation?.refresh();
    },
    setTimelines(items = [], selectedFileName = "") {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = tr("rendererTimeline");
      const options = items.map((item) => {
        const option = document.createElement("option");
        option.value = item.fileName;
        option.textContent = item.missing ? `${item.label} (${tr("timelineMissing")})` : item.label;
        option.dataset.history = String(item.history === true);
        return option;
      });
      timeline.replaceChildren(placeholder, ...options);
      const fallback = items.length ? items[0].fileName : "";
      timeline.value = items.some((item) => item.fileName === selectedFileName) ? selectedFileName : fallback;
      reflectTimelineVisibility();
      if (audioTimeline !== timeline.value) {
        audioTimeline = timeline.value;
        onTimelineAudioChange?.();
      }
    },
    getSelectedTimeline: () => timeline.value,
    setTimelineDocument(value) {
      committedOffset = 0;
      offset.value = "0";
      playback.setTemporaryOffset(0);
      playback.setTimelineDocument(value);
    },
    refreshTimelineDocument(value) {
      playback.refreshTimelineDocument(value);
    },
    getPlaybackState: playback.getState,
    async getExportSnapshot() { return { ...await playback.getExportSnapshot(), presentationMode: presentation?.getMode() ?? "default" }; },
    async renderPresentationAt(value) {
      playback.renderAt(value);
      await presentation?.seekVideo(value);
      await fullscreen.whenReady();
    },
    seekPlayback: playback.seek,
    selectTimelineRow: playback.selectTimelineRow,
    setCountIn: playback.setCountIn,
    setTimelineEditing(value) {
      timelineEditing = Boolean(value);
      reflectTimelineVisibility();
    },
    refreshRenderedScore() {
      playback.refreshRenderedScore();
      presentation?.refresh();
      search.refreshRenderedScore();
      fullscreen.refresh();
      keyboard.refresh();
    },
    refreshPreferences() { playback.refreshPreferences(); keyboard.refresh(); fullscreen.refresh(); },
    setHostViewport: keyboard.setViewport,
    completeHostScroll: keyboard.completeHostScroll,
    refreshPresentationContent() { presentation?.refreshContent(); },
    handleCommand(command, value) {
      if (["play", "pause", "stop"].includes(command)) playback.run(command);
      if (command === "select") playback.setSelecting(value);
      if (command === "auto-scroll") playback.setAutoScroll(value);
      if (command === "offset") playback.setTemporaryOffset(value);
      if (command === "piano") playback.setPianoEnabled(value);
      if (command === "volume") playback.setBgmVolume(value);
      if (command === "bgm-file") return playback.loadBgmFile(value);
      if (command === "bgm-clear") playback.clearBgmFile();
      if (command === "scrub-start") playback.beginScrub(value);
      if (command === "scrub-preview") playback.previewScrub(value);
      if (command === "scrub-commit") playback.commitScrub(value);
      if (command === "scrub-cancel") playback.cancelScrub();
      if (command === "fullscreen-view") fullscreen.setExternalFullscreen(value);
      if (command === "presentation-mode") presentation?.setMode(value);
      if (command === "layers") updateLayers(value);
      if (command === "search") search.run(value);
      if (command === "search-set") search.run(value, { advance: false });
      if (command === "search-validate") search.validate(value);
      if (command === "search-clear") search.clear();
      if (command === "search-previous") search.navigate(-1);
      if (command === "search-next") search.navigate(1);
    },
    destroy() {
      stopObservingNavHeight();
      document.removeEventListener("pointerdown", handleOutsideVolumePointer);
      window.removeEventListener(RENDERER_SHORTCUTS_EVENT, handleShortcutsChanged);
      window.removeEventListener("storage", handleShortcutStorage);
      window.removeEventListener("keydown", handleShortcutKeydown);
      window.removeEventListener("keyup", handleShortcutKeyup);
      window.removeEventListener("blur", clearModifierSelection);
      layersChannel?.removeEventListener("message", handleLayersMessage);
      layersChannel?.close();
      playback.destroy();
      search.destroy();
      fullscreen.destroy();
      presentation?.destroy();
      keyboard.destroy();
    },
  };
}
