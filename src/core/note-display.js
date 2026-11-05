import { renderChordParts, toMusicGlyphs } from "./chord-symbol.js";
import { parseTonalReference, tonalReferencePitchClass } from "./tonal-reference.js";
import { transposeNoteName } from "./transposition.js";

const LETTERS = "CDEFGAB";
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const mod = (value, base) => (value % base + base) % base;

/** Display-only ordering; interval and quality text must never pass through here. */
export function displayNoteName(value, preferences = {}) {
  const glyphs = toMusicGlyphs(transposeNoteName(value, preferences), { noteName: true });
  return preferences.accidentalBeforeNote
    ? glyphs.replace(/([A-Ga-g])([♭♯𝄫𝄪])/gu, "$2$1")
    : glyphs;
}

export function noteDegree(note, center, minorTonicSix = false) {
  const reference = parseTonalReference(center, { extendedAccidentals: true });
  const pitch = tonalReferencePitchClass(note);
  if (!reference || pitch === null) return null;
  let tonicLetter = LETTERS.indexOf(reference.note[0].toUpperCase());
  let tonicPitch = tonalReferencePitchClass(center);
  if (minorTonicSix && reference.mode === "m") {
    tonicLetter = mod(tonicLetter + 2, 7);
    tonicPitch = mod(tonicPitch + 3, 12);
  }
  const degree = mod(LETTERS.indexOf(note[0].toUpperCase()) - tonicLetter, 7);
  const alteration = mod(pitch - tonicPitch - MAJOR_STEPS[degree] + 6, 12) - 6;
  const accidental = alteration === -2 ? "bb" : alteration === 2 ? "x"
    : alteration < 0 ? "♭".repeat(-alteration) : "♯".repeat(alteration);
  return { number: String(degree + 1), accidental };
}

export function displayChordParts(result, mode, preferences = {}, center = null) {
  const parts = renderChordParts(result, mode, preferences);
  return parts.flatMap((part, index) => {
    if (["root-accidental", "bass-accidental"].includes(part.role)) return [];
    if (!["root", "bass"].includes(part.role)) return [part];
    const next = parts[index + 1];
    const originalAccidental = next?.role === `${part.role}-accidental` ? next : null;
    const transposed = transposeNoteName(part.text + (originalAccidental?.text ?? ""), preferences);
    const accidental = transposed.slice(1) ? { ...part, role: `${part.role}-accidental`, text: transposed.slice(1), notation: true } : null;
    const degree = preferences.chordDegrees ? noteDegree(transposed, transposeNoteName(center, preferences), preferences.minorTonicSix) : null;
    const name = { ...part, text: degree?.number ?? transposed[0] };
    const mark = degree
      ? degree.accidental && { ...part, role: `${part.role}-accidental`, text: degree.accidental, notation: true }
      : accidental;
    if (!mark) return [name];
    const before = Boolean(degree || preferences.accidentalBeforeNote);
    const displayMark = { ...mark, accidentalPlacement: before ? "before" : "after" };
    return before ? [displayMark, name] : [name, displayMark];
  });
}

export function chordEventTonalCenter(event) {
  return event.romanLayers?.[1]?.tonalCenter ?? event.hardModulationPrefix?.targetTonalCenter ?? event.tonalCenter;
}

/** Copy only display containers, leaving source AST and music structures intact. */
export function projectChordDisplayFlow(flow, preferences = {}) {
  if (!preferences.chordDegrees) return flow;
  let lastCenter;
  let pendingPrefix = false;
  const modulationCenters = new Map();
  return flow.map((item) => {
    if (item.kind !== "measure") return item;
    const slots = item.measure.slots.map((slot) => {
      if (slot.settings.some((setting) => setting.type === "TC")
        || slot.tags.some((tag) => tag.semanticKind === "centricity" && ["start", "oneshot"].includes(tag.kind))) pendingPrefix = true;
      const events = slot.events.map((event) => {
        if (event.modulationStart) modulationCenters.set(event.modulationId, event.modulationStart.targetTonalCenter);
        const center = modulationCenters.get(event.modulationId) ?? chordEventTonalCenter(event);
        if (center !== lastCenter) pendingPrefix = true;
        lastCenter = center;
        const numeric = Boolean(event.chordResult && parseTonalReference(center));
        const chordDegreePrefix = numeric && pendingPrefix ? center : null;
        if (numeric) pendingPrefix = false;
        return { ...event, chordDisplayTonalCenter: center, chordDegreePrefix };
      });
      return { ...slot, events };
    });
    return { ...item, measure: { ...item.measure, slots } };
  });
}
