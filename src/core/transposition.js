const LETTERS = "CDEFGAB";
const PITCHES = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTALS = { bb: -2, b: -1, "": 0, "#": 1, x: 2 };
const mod = (value, base) => (value % base + base) % base;

export const TRANSPOSE_INTERVALS = Object.freeze([
  { id: "none", steps: 0, semitones: 0, zh: "不移调", en: "No transposition" },
  { id: "A1", steps: 0, semitones: 1, zh: "增一度", en: "Augmented unison" },
  { id: "d2", steps: 1, semitones: 0, zh: "减二度", en: "Diminished second" },
  { id: "m2", steps: 1, semitones: 1, zh: "小二度", en: "Minor second" },
  { id: "M2", steps: 1, semitones: 2, zh: "大二度", en: "Major second" },
  { id: "A2", steps: 1, semitones: 3, zh: "增二度", en: "Augmented second" },
  { id: "d3", steps: 2, semitones: 2, zh: "减三度", en: "Diminished third" },
  { id: "m3", steps: 2, semitones: 3, zh: "小三度", en: "Minor third" },
  { id: "M3", steps: 2, semitones: 4, zh: "大三度", en: "Major third" },
  { id: "A3", steps: 2, semitones: 5, zh: "增三度", en: "Augmented third" },
  { id: "d4", steps: 3, semitones: 4, zh: "减四度", en: "Diminished fourth" },
  { id: "P4", steps: 3, semitones: 5, zh: "纯四度", en: "Perfect fourth" },
  { id: "A4", steps: 3, semitones: 6, zh: "增四度", en: "Augmented fourth" },
  { id: "d5", steps: 4, semitones: 6, zh: "减五度", en: "Diminished fifth" },
  { id: "P5", steps: 4, semitones: 7, zh: "纯五度", en: "Perfect fifth" },
]);

export function normalizeTransposition(value) {
  return {
    transposeDirection: value?.transposeDirection === "down" ? "down" : "up",
    transposeInterval: TRANSPOSE_INTERVALS.some(interval => interval.id === value?.transposeInterval) ? value.transposeInterval : "none",
    pianoFollowsTranspose: value?.pianoFollowsTranspose === true,
  };
}

export function transpositionOffset(preferences = {}) {
  const interval = TRANSPOSE_INTERVALS.find(item => item.id === preferences.transposeInterval) ?? TRANSPOSE_INTERVALS[0];
  return interval.semitones * (preferences.transposeDirection === "down" ? -1 : 1);
}

/** Accept a single note or quoted tonal reference. Preserve case and its written degree when possible. */
export function transposeNoteName(value, preferences = {}) {
  const interval = TRANSPOSE_INTERVALS.find(item => item.id === preferences.transposeInterval);
  if (!interval || interval.id === "none") return value;
  const match = /^("?)([A-Ga-g])(bb|b|#|x)?\1$/.exec(String(value));
  if (!match) return value;
  const sourceIndex = LETTERS.indexOf(match[2].toUpperCase());
  const direction = preferences.transposeDirection === "down" ? -1 : 1;
  const desired = mod(PITCHES[sourceIndex] + ACCIDENTALS[match[3] ?? ""] + direction * interval.semitones, 12);
  const preferred = sourceIndex + direction * interval.steps;
  const candidates = [];
  for (let shift = -2; shift <= 2; shift += 1) {
    const index = mod(preferred + shift, 7);
    const alteration = mod(desired - PITCHES[index] + 6, 12) - 6;
    if (Math.abs(alteration) > 2) continue;
    candidates.push({ index, alteration, score: Math.abs(shift) * 100 + Math.abs(alteration), shift });
  }
  candidates.sort((a, b) => a.score - b.score || a.shift - b.shift);
  const best = candidates[0];
  const letter = match[2] === match[2].toLowerCase() ? LETTERS[best.index].toLowerCase() : LETTERS[best.index];
  const accidental = Object.keys(ACCIDENTALS).find(key => ACCIDENTALS[key] === best.alteration);
  return `${match[1]}${letter}${accidental}${match[1]}`;
}

export function transposeMidiNotes(notes, preferences = {}, { audio = false } = {}) {
  const offset = audio && !preferences.pianoFollowsTranspose ? 0 : transpositionOffset(preferences);
  return notes.map(note => note + offset);
}

export function pianoKeyMidi(key, preferences = {}) {
  return key - (preferences.pianoFollowsTranspose ? 0 : transpositionOffset(preferences));
}

export function isPlayableMidi(note) {
  return Number.isInteger(note) && note >= 0 && note <= 127;
}

export function pianoKeyboardRange(notes = []) {
  let low = 21, high = 108;
  for (const note of notes) if (isPlayableMidi(note)) { low = Math.min(low, note); high = Math.max(high, note); }
  return { low: low < 21 ? Math.floor(low / 12) * 12 : 21,
    high: high > 108 ? Math.min(127, Math.ceil((high + 1) / 12) * 12 - 1) : 108 };
}
