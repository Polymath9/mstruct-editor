import { setupRendererSettings } from "./renderer-settings.js";
import { normalizeRendererPreferences, RENDERER_PREFERENCES_STORAGE_KEY } from "../core/renderer-preferences.js";
import { normalizeTransposition } from "../core/transposition.js";
import { DEFAULT_RENDERER_SCALE, SCORE_BASE_FONT_SIZE, normalizeRendererScale,
  getRendererScaleSnapshot, writeRendererScale, subscribeRendererScale } from "../core/renderer-scale.js";

export function readStandaloneChordPreferences() {
  try { return normalizeRendererPreferences(JSON.parse(window.localStorage.getItem(RENDERER_PREFERENCES_STORAGE_KEY) ?? "null")); }
  catch { return normalizeRendererPreferences(null); }
}

/** Transposition belongs to the open document session, independent of saved preferences. */
export function createRendererTransposition({ getPreferences, postToHost, refresh }) {
  let value = normalizeTransposition();
  return {
    get: () => value,
    getPreferences: () => ({ ...getPreferences(), ...value }),
    set(next, { refresh: shouldRefresh = true } = {}) {
      value = normalizeTransposition(next);
      postToHost("transposition-state", { transposition: value });
      if (shouldRefresh) refresh();
    },
  };
}

/** Display state and settings routing; score/export document state stays outside. */
export function setupRendererDisplay({ canvas, hostedMode, getPreferences, updatePreferences, getTransposition, updateTransposition, refreshLayout, postToHost, tr }) {
  let scale = hostedMode ? DEFAULT_RENDERER_SCALE : getRendererScaleSnapshot();
  let presentation = false;
  const effectiveScale = () => presentation ? 125 : scale;
  const applySize = () => canvas.style.setProperty("--score-font-size", `${SCORE_BASE_FONT_SIZE * effectiveScale() / 100}px`);
  applySize();

  function setScale(value) {
    const next = normalizeRendererScale(value);
    if (next === scale) return;
    scale = next;
    applySize();
    refreshLayout();
  }

  const unsubscribe = hostedMode ? () => {} : subscribeRendererScale(() => setScale(getRendererScaleSnapshot()));
  let canvasWidth = canvas.clientWidth;
  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = canvas.clientWidth;
    if (Math.abs(nextWidth - canvasWidth) < 1) return;
    canvasWidth = nextWidth;
    refreshLayout();
  });
  resizeObserver.observe(canvas);
  setupRendererSettings({
    getTransposition, updateTransposition,
    getScale: effectiveScale,
    canScale: () => !presentation,
    updateScale: (next) => {
      if (!hostedMode) writeRendererScale(next);
      else {
        setScale(next);
        postToHost("renderer-scale", { rendererScale: scale });
      }
    },
    openHostSettings: () => {
      if (!hostedMode || document.fullscreenElement || document.body.classList.contains("renderer-fullscreen-external")) return false;
      postToHost("open-settings");
      return true;
    },
    getPreferences,
    updatePreferences: (next) => {
      updatePreferences(next);
      if (hostedMode) postToHost("chord-preferences-update", { chordPreferences: getPreferences() });
    },
    storageKey: hostedMode ? null : RENDERER_PREFERENCES_STORAGE_KEY,
    tr,
  });
  return { getScale: effectiveScale, setScale,
    setPresentationMode(value) {
      if (presentation === value) return;
      presentation = value;
      applySize();
      refreshLayout();
    },
    destroy: () => { unsubscribe(); resizeObserver.disconnect(); } };
}
