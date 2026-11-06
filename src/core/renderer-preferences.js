import {
  CHORD_RENDER_MODES,
  DEFAULT_CHORD_RENDER_MODE,
  DEFAULT_NOTE_NAME_SPECIALS,
} from "./chord-symbol.js";
import { normalizeChordQualityPreferences } from "./chord-quality-display.js";

export const DEFAULT_GLOBAL_PLAYBACK_OFFSET = -30;
export const RENDERER_PREFERENCES_STORAGE_KEY = "mstruct-chord-preferences";

export function normalizeRendererPreferences(value) {
  return {
    ...normalizeChordQualityPreferences(value),
    accidentalBeforeNote: value?.accidentalBeforeNote === true,
    chordDegrees: value?.chordDegrees === true,
    minorTonicSix: value?.minorTonicSix === true,
    renderMode: CHORD_RENDER_MODES.includes(value?.renderMode) ? value.renderMode : DEFAULT_CHORD_RENDER_MODE,
    sharp9AsFlat10: typeof value?.sharp9AsFlat10 === "boolean"
      ? value.sharp9AsFlat10
      : DEFAULT_NOTE_NAME_SPECIALS.includes("sharp9_as_flat10"),
    durationDisplayMode: value?.durationDisplayMode === "fraction" ? "fraction" : "note",
    durationStemDown: value?.durationStemDown === true,
    globalPlaybackOffset: Number.isSafeInteger(value?.globalPlaybackOffset)
      ? value.globalPlaybackOffset
      : DEFAULT_GLOBAL_PLAYBACK_OFFSET,
  };
}
