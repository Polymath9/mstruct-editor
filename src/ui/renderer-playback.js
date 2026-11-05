import {
  buildPlaybackPlan,
  buildMstructtimePlaybackPlan,
  formatPlaybackTimestamp,
  playbackEntryAt,
  playbackEntriesForSlot,
} from "../core/mstruct-playback.js";
import { DEFAULT_GLOBAL_PLAYBACK_OFFSET } from "../core/renderer-preferences.js";
import { transposeMidiNotes } from "../core/transposition.js";

const EMPTY_POSITION = "—";
const SUPPORTED_BGM_EXTENSION = /\.(?:mp3|wav)$/i;
const SUPPORTED_BGM_TYPE = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"]);

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function supportedBgmFile(file) {
  if (!file || typeof file.name !== "string") return false;
  return SUPPORTED_BGM_EXTENSION.test(file.name) || SUPPORTED_BGM_TYPE.has(String(file.type ?? "").toLowerCase());
}

export function createRendererPlayback({ canvas, onStateChange, requestScroll, closePopovers, pianoPlayer, mediaElement, getPreferences = () => ({}) }) {
  let result = null;
  let stableTempo = false;
  let timelineDocument = null;
  let globalOffset = 0;
  let userOffset = DEFAULT_GLOBAL_PLAYBACK_OFFSET;
  let temporaryOffset = 0;
  let plan = buildPlaybackPlan(null);
  let mode = "stopped";
  let elapsedMs = 0;
  let scrubElapsedMs = null;
  let scrubWasPlaying = false;
  let displayedPosition = EMPTY_POSITION;
  let selecting = false;
  let modifierSelecting = false;
  let autoScroll = false;
  let pianoEnabled = false;
  let activeElement = null;
  let activeKey = null;
  let activeEntry = null;
  let animationFrame = null;
  let playbackAnchor = 0;
  let playRequestId = 0;
  let notice = null;
  let noticeTimer = null;
  let bgmVolume = 100;
  let bgmReady = false;
  let bgmFileName = "";
  let bgmUrl = null;
  let bgmSourceFile = null;
  let bgmLoadPromise = null;
  let cancelBgmLoad = null;
  let bgmLoadId = 0;
  let lastSelectedSlotId = null;
  let selectedSlotPassIndex = -1;
  let selectionSerial = 0;
  let countInEnabled = false;
  let countdown = null;
  const bgmAudio = mediaElement ?? new Audio();
  bgmAudio.preload = "auto";
  bgmAudio.volume = 1;

  function isPlaybackRunning() {
    return mode === "playing" || mode === "bgm-tail" || mode === "countdown";
  }

  function enabled() {
    return plan.ready;
  }

  function liveElapsedMs(now = performance.now()) {
    if (mode === "playing") return clamp(now - playbackAnchor, 0, plan.durationMs);
    if (mode === "bgm-tail") return Math.max(plan.durationMs, now - playbackAnchor);
    return elapsedMs;
  }

  function positionAt(value) {
    if (!plan.ready || value < plan.preRollEndMs) return EMPTY_POSITION;
    if (value >= plan.durationMs) return plan.entries.at(-1)?.position ?? EMPTY_POSITION;
    return playbackEntryAt(plan, value)?.position ?? EMPTY_POSITION;
  }

  function clearScrub() {
    scrubElapsedMs = null;
    scrubWasPlaying = false;
  }

  function state() {
    const reportedElapsedMs = liveElapsedMs();
    const previewElapsedMs = scrubElapsedMs ?? reportedElapsedMs;
    return {
      enabled: enabled(),
      mode,
      playing: isPlaybackRunning(),
      selecting: selecting || modifierSelecting,
      autoScroll,
      pianoEnabled,
      pianoReady: Boolean(pianoPlayer?.loaded),
      bgmReady,
      bgmDurationMs: Number.isFinite(bgmAudio.duration) ? bgmAudio.duration * 1000 : null,
      bgmFileName,
      videoReady: Boolean(mediaElement && bgmReady && /\.mp4$/i.test(bgmFileName)),
      bgmVolume,
      notice,
      countdown,
      elapsedMs: reportedElapsedMs,
      progressElapsedMs: clamp(previewElapsedMs, 0, plan.durationMs),
      scrubbing: scrubElapsedMs !== null,
      timestamp: formatPlaybackTimestamp(previewElapsedMs),
      position: scrubElapsedMs === null ? displayedPosition : positionAt(previewElapsedMs),
      durationMs: plan.durationMs,
      atEnd: plan.durationMs > 0 && reportedElapsedMs >= plan.durationMs,
      selectionSerial,
    };
  }

  function emit() {
    onStateChange(state(), activeEntry);
  }

  function setNotice(value, timeout = 0) {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = null;
    notice = value;
    emit();
    if (timeout > 0) {
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        if (notice !== value) return;
        notice = null;
        emit();
      }, timeout);
    }
  }

  function clearHighlight() {
    if (activeElement) {
      activeElement.classList.remove("is-playback-active");
      activeElement.removeAttribute("aria-current");
    }
    activeElement = null;
    activeKey = null;
  }

  function scrollToActive(element) {
    if (autoScroll && element) requestScroll(element);
  }

  function highlight(element, key) {
    if (activeElement === element && activeKey === key) return false;
    clearHighlight();
    if (!element) return true;
    activeElement = element;
    activeKey = key;
    element.classList.add("is-playback-active");
    element.setAttribute("aria-current", "true");
    scrollToActive(element);
    return true;
  }

  function slotHarmony(slotId) {
    return canvas.querySelector(`.measure-slot[data-playback-slot="${CSS.escape(String(slotId))}"] .harmony-stack`);
  }

  function playbackElement(entry) {
    if (entry?.kind === "ellipsis") {
      return canvas.querySelector(`.ellipsis-marker[data-playback-slot="${CSS.escape(String(entry.slotId))}"]`);
    }
    return slotHarmony(entry?.slotId);
  }

  function timeSignatureElement(slotId) {
    if (slotId === null) return null;
    return canvas.querySelector(`.measure-slot[data-playback-slot="${CSS.escape(String(slotId))}"] .time-signature`);
  }

  function activateEntry(entry, { forcePiano = false } = {}) {
    if (!entry) {
      activeEntry = null;
      clearHighlight();
      pianoPlayer?.stop();
      return;
    }
    const key = `event-${entry.routeIndex}`;
    const pianoChanged = activeEntry?.pianoAttackRouteIndex !== entry.pianoAttackRouteIndex;
    activeEntry = entry;
    displayedPosition = entry.position;
    if (pianoEnabled && mode === "playing" && (pianoChanged || forcePiano)) {
      pianoPlayer?.stop();
      const remainingSeconds = (entry.pianoEndMs - elapsedMs) / 1000;
      if (entry.midiNotes?.length && remainingSeconds > 0) {
        void pianoPlayer.play(transposeMidiNotes(entry.midiNotes, getPreferences(), { audio: true }), { durationSeconds: remainingSeconds }).catch(() => {
          pianoPlayer.dispose();
          setNotice("piano-failed", 2500);
        });
      }
    }
    highlight(playbackElement(entry), key);
  }

  function updateActive({ forcePiano = false } = {}) {
    if (mode === "stopped") {
      displayedPosition = EMPTY_POSITION;
      clearHighlight();
      return;
    }
    if (elapsedMs < plan.preRollEndMs) {
      displayedPosition = EMPTY_POSITION;
      activeEntry = null;
      if (activeKey !== "pre-roll") pianoPlayer?.stop();
      highlight(timeSignatureElement(plan.firstTimeSignatureSlotId), "pre-roll");
      return;
    }
    if (elapsedMs >= plan.durationMs) {
      activateEntry(plan.entries.at(-1) ?? null, { forcePiano });
      return;
    }
    activateEntry(playbackEntryAt(plan, elapsedMs), { forcePiano });
  }

  function cancelFrame() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function seekBgm() {
    if (!bgmReady) return;
    const target = elapsedMs / 1000;
    const bounded = Number.isFinite(bgmAudio.duration) ? Math.min(target, bgmAudio.duration) : target;
    try {
      bgmAudio.currentTime = Math.max(0, bounded);
    } catch {
      // A newly selected file can briefly lack seekable metadata.
    }
  }

  function pauseAudio() {
    bgmAudio.pause();
    bgmAudio.muted = false;
    pianoPlayer?.stop();
  }

  function startBgm() {
    if (!bgmReady) return;
    seekBgm();
    if (Number.isFinite(bgmAudio.duration) && bgmAudio.currentTime >= bgmAudio.duration) return;
    bgmAudio.muted = false;
    if (!bgmAudio.paused) return;
    void bgmAudio.play().catch(() => setNotice("bgm-playback-failed", 2500));
  }

  function primeBgmForPianoLoad() {
    if (!bgmReady) return;
    seekBgm();
    bgmAudio.muted = true;
    void bgmAudio.play().catch(() => {
      bgmAudio.muted = false;
      setNotice("bgm-playback-failed", 2500);
    });
  }

  function syncBgmClock() {
    if (!bgmReady || bgmAudio.paused) return;
    if (Math.abs(bgmAudio.currentTime * 1000 - elapsedMs) > 180) seekBgm();
  }

  function bgmHasRemaining() {
    if (!bgmReady || bgmAudio.paused || bgmAudio.ended) return false;
    return !Number.isFinite(bgmAudio.duration) || bgmAudio.currentTime < bgmAudio.duration;
  }

  function finishNaturally() {
    cancelFrame();
    elapsedMs = plan.durationMs;
    pianoPlayer?.stop();
    mode = bgmHasRemaining() ? "bgm-tail" : "paused";
    const last = plan.entries.at(-1) ?? null;
    if (last) activateEntry(last);
    if (mode === "paused") {
      bgmAudio.pause();
      bgmAudio.muted = false;
    }
    emit();
    if (mode === "bgm-tail") animationFrame = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!isPlaybackRunning()) return;
    if (mode === "bgm-tail") {
      elapsedMs = Math.max(plan.durationMs, now - playbackAnchor);
      updateActive();
      syncBgmClock();
      emit();
      animationFrame = requestAnimationFrame(tick);
      return;
    }
    elapsedMs = clamp(now - playbackAnchor, 0, plan.durationMs);
    if (elapsedMs >= plan.durationMs) {
      finishNaturally();
      return;
    }
    updateActive();
    syncBgmClock();
    emit();
    animationFrame = requestAnimationFrame(tick);
  }

  async function play() {
    if (!enabled()) return;
    if (mode === "countdown") return;
    if (mode === "bgm-tail-paused") {
      mode = "bgm-tail";
      playbackAnchor = performance.now() - elapsedMs;
      startBgm();
      emit();
      cancelFrame();
      animationFrame = requestAnimationFrame(tick);
      return;
    }
    const requestId = ++playRequestId;
    if (countInEnabled && mode === "stopped" && elapsedMs === 0) {
      mode = "countdown";
      for (const value of [3, 2, 1]) {
        countdown = value;
        emit();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (requestId !== playRequestId || mode !== "countdown") return;
      }
      countdown = null;
      mode = "paused";
    }
    if (pianoEnabled && pianoPlayer && !pianoPlayer.loaded) {
      primeBgmForPianoLoad();
      setNotice("piano-loading");
      try {
        await pianoPlayer.load();
      } catch {
        if (requestId !== playRequestId) return;
        pauseAudio();
        pianoPlayer.dispose();
        setNotice("piano-failed", 2500);
        return;
      }
      if (requestId !== playRequestId || !pianoEnabled || !enabled()) return;
      setNotice("piano-ready", 1000);
    }
    if (bgmLoadPromise) {
      try {
        await bgmLoadPromise;
      } catch {
        // The loader reports its own error; score preview remains available.
      }
    }
    if (requestId !== playRequestId || !enabled()) return;
    if (elapsedMs >= plan.durationMs) elapsedMs = 0;
    mode = "playing";
    playbackAnchor = performance.now() - elapsedMs;
    updateActive({ forcePiano: true });
    startBgm();
    emit();
    cancelFrame();
    animationFrame = requestAnimationFrame(tick);
  }

  function pause() {
    const wasScrubbing = scrubElapsedMs !== null;
    clearScrub();
    playRequestId += 1;
    if (mode === "countdown") {
      mode = "stopped";
      countdown = null;
      emit();
      return;
    }
    if (!isPlaybackRunning()) {
      if (wasScrubbing) emit();
      return;
    }
    const wasBgmTail = mode === "bgm-tail";
    elapsedMs = wasBgmTail
      ? Math.max(plan.durationMs, performance.now() - playbackAnchor)
      : clamp(performance.now() - playbackAnchor, 0, plan.durationMs);
    mode = wasBgmTail ? "bgm-tail-paused" : "paused";
    cancelFrame();
    pauseAudio();
    updateActive();
    emit();
  }

  function stop() {
    playRequestId += 1;
    cancelFrame();
    mode = "stopped";
    countdown = null;
    elapsedMs = 0;
    clearScrub();
    displayedPosition = EMPTY_POSITION;
    activeEntry = null;
    pauseAudio();
    seekBgm();
    clearHighlight();
    emit();
  }

  function rebuildPlan({ synchronizeAudio = true, preserveClockAnchor = false } = {}) {
    clearScrub();
    const playbackOffset = userOffset + temporaryOffset + (stableTempo ? globalOffset : 0);
    plan = stableTempo
      ? buildPlaybackPlan(result, playbackOffset)
      : buildMstructtimePlaybackPlan(result, timelineDocument, playbackOffset);
    if (!enabled()) {
      mode = "stopped";
      selecting = false;
      modifierSelecting = false;
      canvas.classList.remove("is-playback-selecting");
      elapsedMs = 0;
      displayedPosition = EMPTY_POSITION;
      clearHighlight();
      cancelFrame();
      pauseAudio();
      seekBgm();
      return;
    }
    elapsedMs = clamp(elapsedMs, 0, plan.durationMs);
    if (isPlaybackRunning() && !preserveClockAnchor) playbackAnchor = performance.now() - elapsedMs;
    if (synchronizeAudio) seekBgm();
    updateActive();
  }

  function setDocument(next) {
    playRequestId += 1;
    result = next.result;
    stableTempo = next.stableTempo === true;
    globalOffset = Number.isInteger(next.globalOffset) ? next.globalOffset : 0;
    userOffset = Number.isSafeInteger(next.userOffset) ? next.userOffset : DEFAULT_GLOBAL_PLAYBACK_OFFSET;
    timelineDocument = next.timelineDocument ?? timelineDocument;
    mode = "stopped";
    countdown = null;
    elapsedMs = 0;
    clearScrub();
    displayedPosition = EMPTY_POSITION;
    selecting = false;
    modifierSelecting = false;
    canvas.classList.remove("is-playback-selecting");
    cancelFrame();
    pauseAudio();
    clearHighlight();
    rebuildPlan();
    emit();
  }

  function setTimelineDocument(next) {
    playRequestId += 1;
    timelineDocument = next ?? null;
    lastSelectedSlotId = null;
    selectedSlotPassIndex = -1;
    stop();
    rebuildPlan();
    emit();
  }

  function refreshTimelineDocument(next) {
    const wasRunning = isPlaybackRunning();
    elapsedMs = liveElapsedMs();
    timelineDocument = next ?? null;
    rebuildPlan({ synchronizeAudio: !wasRunning, preserveClockAnchor: wasRunning });
    emit();
  }

  function setTemporaryOffset(value) {
    if (!Number.isInteger(value)) return;
    temporaryOffset = value;
    rebuildPlan();
    emit();
  }

  function setSelecting(value) {
    selecting = enabled() && Boolean(value);
    canvas.classList.toggle("is-playback-selecting", selecting || modifierSelecting);
    if (selecting || modifierSelecting) closePopovers();
    emit();
  }

  function setModifierSelecting(value) {
    modifierSelecting = enabled() && Boolean(value);
    canvas.classList.toggle("is-playback-selecting", selecting || modifierSelecting);
    if (modifierSelecting) closePopovers();
    emit();
  }

  function setAutoScroll(value) {
    autoScroll = Boolean(value);
    if (autoScroll && activeElement) requestScroll(activeElement);
    emit();
  }

  function setPianoEnabled(value) {
    const wasPlaying = mode === "playing";
    if (wasPlaying) pause();
    pianoEnabled = Boolean(value);
    if (!pianoEnabled) {
      playRequestId += 1;
      pianoPlayer?.stop();
    }
    emit();
    if (wasPlaying) void play();
  }

  function setBgmVolume(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    bgmVolume = clamp(next, 0, 100);
    bgmAudio.volume = bgmVolume / 100;
    emit();
  }

  function resetBgmSource() {
    bgmAudio.pause();
    bgmAudio.removeAttribute("src");
    bgmAudio.load();
    if (bgmUrl) URL.revokeObjectURL(bgmUrl);
    bgmUrl = null;
    bgmSourceFile = null;
    bgmReady = false;
    bgmFileName = "";
  }

  async function loadBgmFile(file) {
    if (!supportedBgmFile(file) && !(mediaElement && /\.mp4$/i.test(file?.name ?? ""))) {
      setNotice("bgm-invalid", 2500);
      return;
    }
    const loadId = ++bgmLoadId;
    cancelBgmLoad?.();
    cancelBgmLoad = null;
    resetBgmSource();
    bgmFileName = file.name;
    bgmUrl = URL.createObjectURL(file);
    bgmAudio.src = bgmUrl;
    setNotice("bgm-loading");
    bgmLoadPromise = new Promise((resolve, reject) => {
      const cleanup = () => {
        bgmAudio.removeEventListener("canplay", loaded);
        bgmAudio.removeEventListener("error", failed);
        if (cancelBgmLoad === cancel) cancelBgmLoad = null;
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Unable to load BGM.")); };
      const cancel = () => { cleanup(); reject(new Error("BGM load replaced.")); };
      cancelBgmLoad = cancel;
      bgmAudio.addEventListener("canplay", loaded, { once: true });
      bgmAudio.addEventListener("error", failed, { once: true });
      bgmAudio.load();
    });
    try {
      await bgmLoadPromise;
      if (loadId !== bgmLoadId) return;
      bgmReady = true;
      bgmSourceFile = file;
      seekBgm();
      if (isPlaybackRunning()) startBgm();
      setNotice("bgm-ready", 1000);
    } catch {
      if (loadId !== bgmLoadId) return;
      resetBgmSource();
      setNotice("bgm-failed", 2500);
    } finally {
      if (loadId === bgmLoadId) bgmLoadPromise = null;
      emit();
    }
  }

  function selectSlot(slotId, { playFromSelection = false } = {}) {
    if ((!selecting && !modifierSelecting) || !enabled()) return;
    const matchingEntries = playbackEntriesForSlot(plan, slotId);
    const matchingRows = stableTempo
      ? []
      : (plan.rows ?? []).filter((candidate) => candidate.kind !== "start" && candidate.slotId === String(slotId));
    const choices = matchingRows.length ? matchingRows : matchingEntries;
    if (!choices.length) return;
    if (lastSelectedSlotId === String(slotId)) {
      selectedSlotPassIndex = (selectedSlotPassIndex + 1) % choices.length;
    } else {
      lastSelectedSlotId = String(slotId);
      selectedSlotPassIndex = 0;
    }
    const choice = choices[selectedSlotPassIndex];
    clearScrub();
    const entry = choice?.number === undefined
      ? choice
      : plan.entries.find((candidate) => candidate.rowNumber === choice.number);
    selectionSerial += 1;
    if (!entry) {
      selectTimelineRow(choice.number);
      return;
    }
    elapsedMs = clamp(entry.startMs, 0, plan.durationMs);
    if (playFromSelection) {
      pauseAudio();
      mode = "paused";
      seekBgm();
      activateEntry(entry);
      emit();
      void play();
    } else if (isPlaybackRunning()) {
      mode = "playing";
      playbackAnchor = performance.now() - elapsedMs;
      seekBgm();
      startBgm();
      activateEntry(entry, { forcePiano: true });
    } else {
      mode = "paused";
      seekBgm();
      activateEntry(entry);
    }
    emit();
  }

  function selectTimelineRow(rowNumber) {
    if (!enabled()) return;
    const row = plan.rows?.find((candidate) => candidate.number === rowNumber);
    if (!row) return;
    clearScrub();
    const wasPlaying = mode === "playing" || mode === "bgm-tail";
    if (row.kind === "start") {
      elapsedMs = 0;
      mode = wasPlaying ? "playing" : "paused";
      if (wasPlaying) playbackAnchor = performance.now();
      seekBgm();
      if (wasPlaying) startBgm();
      updateActive();
      emit();
      return;
    }
    const entry = plan.entries.find((candidate) => candidate.rowNumber === rowNumber);
    if (entry) {
      elapsedMs = clamp(entry.startMs, 0, plan.durationMs);
      mode = wasPlaying ? "playing" : "paused";
      if (wasPlaying) playbackAnchor = performance.now() - elapsedMs;
      seekBgm();
      if (wasPlaying) startBgm();
      activateEntry(entry, { forcePiano: wasPlaying });
      emit();
      return;
    }
    if (!wasPlaying) {
      pauseAudio();
      mode = "paused";
    }
    activateEntry({
      kind: row.kind,
      routeIndex: row.routeIndex,
      rowNumber: row.number,
      pass: row.pass,
      slotId: row.slotId,
      startMs: elapsedMs,
      endMs: elapsedMs,
      position: `${row.measure} ${row.beat}`,
      midiNotes: null,
      timeSignatureLabel: row.timeSignatureLabel ?? row.source?.timeSignatureLabel ?? row.source?.timeSignature ?? null,
      formSymbol: row.formSymbol ?? null,
      chordDisplayItems: [],
      romanDisplayItems: [],
      resolvedChordEvent: null,
      source: row.source,
    });
    emit();
  }

  function captureSelection(event) {
    const ctrlSelecting = event.ctrlKey === true;
    if (!selecting && !modifierSelecting && !ctrlSelecting) return;
    const target = event.target.closest?.("[data-playback-selectable=\"true\"]");
    const slot = target?.closest(".measure-slot[data-playback-slot]") ?? target;
    if (!slot?.dataset.playbackSlot) return;
    event.preventDefault();
    event.stopPropagation();
    const temporaryModifier = ctrlSelecting && !modifierSelecting;
    if (temporaryModifier) modifierSelecting = true;
    selectSlot(slot.dataset.playbackSlot, { playFromSelection: ctrlSelecting && event.altKey === true });
    if (temporaryModifier) {
      modifierSelecting = false;
      canvas.classList.toggle("is-playback-selecting", selecting);
      emit();
    }
  }

  canvas.addEventListener("click", captureSelection, true);
  const handleBgmEnded = () => {
    if (mode !== "bgm-tail") return;
    cancelFrame();
    elapsedMs = Math.max(plan.durationMs, bgmAudio.currentTime * 1000);
    mode = "paused";
    bgmAudio.muted = false;
    updateActive();
    emit();
  };
  bgmAudio.addEventListener("ended", handleBgmEnded);

  function beginScrub(value) {
    if (!enabled() || mode === "countdown") return;
    if (scrubElapsedMs === null) scrubWasPlaying = mode === "playing" || mode === "bgm-tail";
    scrubElapsedMs = clamp(Number(value) || 0, 0, plan.durationMs);
    emit();
  }

  function previewScrub(value) {
    beginScrub(value);
  }

  function commitScrub(value) {
    if (!enabled() || mode === "countdown") return;
    if (scrubElapsedMs === null) beginScrub(value);
    const target = clamp(Number(value) || 0, 0, plan.durationMs);
    const resume = scrubWasPlaying;
    clearScrub();
    playRequestId += 1;
    countdown = null;
    cancelFrame();
    pauseAudio();
    elapsedMs = target;
    mode = resume ? "playing" : "paused";
    seekBgm();
    updateActive({ forcePiano: resume });
    if (resume) {
      playbackAnchor = performance.now() - elapsedMs;
      startBgm();
      animationFrame = requestAnimationFrame(tick);
    }
    emit();
  }

  function cancelScrub() {
    if (scrubElapsedMs === null) return;
    clearScrub();
    emit();
  }

  return {
    run(action) {
      if (action === "play") void play();
      if (action === "pause") pause();
      if (action === "stop") stop();
    },
    setDocument,
    refreshPreferences() { updateActive({ forcePiano: true }); emit(); },
    setTimelineDocument,
    refreshTimelineDocument,
    setTemporaryOffset,
    setSelecting,
    setModifierSelecting,
    setAutoScroll,
    setPianoEnabled,
    setBgmVolume,
    setCountIn(value) {
      countInEnabled = Boolean(value);
      if (!countInEnabled && mode === "countdown") stop();
      emit();
    },
    loadBgmFile,
    clearBgmFile() { bgmLoadId += 1; cancelBgmLoad?.(); resetBgmSource(); emit(); },
    getState: state,
    getPreviousEntry(entry) { return plan.entries[plan.entries.indexOf(entry) - 1] ?? null; },
    getPlaybackEntries: () => plan.entries,
    async getExportSnapshot() {
      if (bgmLoadPromise) await bgmLoadPromise.catch(() => {});
      return { timelineDocument, temporaryOffset, userOffset, pianoEnabled, bgmVolume,
        bgmDurationMs: bgmReady && Number.isFinite(bgmAudio.duration) ? bgmAudio.duration * 1000 : 0,
        bgmFile: bgmReady ? bgmSourceFile : null };
    },
    /** External presentation clock; it never starts realtime audio or timers. */
    renderAt(value) {
      cancelFrame();
      mode = "paused";
      elapsedMs = Math.max(0, Number(value) || 0);
      updateActive();
      emit();
    },
    beginScrub,
    previewScrub,
    commitScrub,
    cancelScrub,
    selectTimelineRow,
    seek(value) {
      if (!enabled()) return;
      clearScrub();
      elapsedMs = clamp(Number(value) || 0, 0, plan.durationMs);
      if (isPlaybackRunning()) playbackAnchor = performance.now() - elapsedMs;
      seekBgm();
      updateActive({ forcePiano: true });
      emit();
    },
    toggleSelecting: () => setSelecting(!selecting),
    toggleAutoScroll: () => setAutoScroll(!autoScroll),
    togglePiano: () => setPianoEnabled(!pianoEnabled),
    refresh: emit,
    refreshRenderedScore() {
      updateActive();
      emit();
    },
    destroy() {
      playRequestId += 1;
      bgmLoadId += 1;
      cancelFrame();
      cancelBgmLoad?.();
      if (noticeTimer !== null) clearTimeout(noticeTimer);
      resetBgmSource();
      bgmAudio.removeEventListener("ended", handleBgmEnded);
      canvas.removeEventListener("click", captureSelection, true);
      clearHighlight();
    },
  };
}
