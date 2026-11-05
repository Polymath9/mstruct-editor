import { makeError } from "./mstruct-diagnostics.js";
import { tonalReferencePitchClass } from "./tonal-reference.js";

const DEGREE_PITCHES = [0, 2, 4, 5, 7, 9, 11];
const ALTERATIONS = { "": 0, b: -1, bb: -2, "#": 1, x: 2 };
const NOTE_NAMES = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];
const pitchClass = value => (value % 12 + 12) % 12;

/** Standard figures and their general-figure equivalents, before any applied suffix. */
export function romanHasSeventhFigure(result) {
  if (result.figure?.addsSeventh) return true;
  const figures = result.generalFigure?.figures.map(item => (item.degree - 1) % 7 + 1)
    ?? [result.figure?.upper, result.figure?.lower].filter(Boolean).map(value => Number(String(value).match(/\d+/)?.[0]));
  const present = new Set(figures);
  return present.has(7) || present.has(6) && present.has(5)
    || present.has(4) && present.has(3) || present.has(4) && present.has(2);
}

export function collectRomanValidationWarnings(measures, source) {
  const warnings = [];
  for (const measure of measures) for (const slot of measure.slots) for (const event of slot.events) {
    const structure = event.chordResult?.structure;
    if (!structure) continue;
    const notes = structure.toMidiNotes();
    if (!notes.length || !notes.every(Number.isFinite)) continue;
    const actual = pitchClass(Math.min(...notes));
    for (const layer of event.romanLayers ?? [event]) {
      const tonic = tonalReferencePitchClass(layer.tonalCenter ?? event.tonalCenter);
      if (tonic === null) continue;
      for (const field of ["roman", "romanAnnotation"]) {
        const result = layer[`${field}Result`];
        if (!result) continue;
        const start = layer[`${field}Start`] ?? layer.start;
        const end = layer[`${field}End`] ?? start + result.source.length;
        if (!structure.isPolychord && structure.hasSeventh !== romanHasSeventhFigure(result)) {
          const romanCode = structure.hasSeventh ? "seventh-figure-missing" : "seventh-figure-unexpected";
          makeError(warnings, source, `roman-${romanCode}`, start, end, {
            severity: "warning", domain: "roman", romanCode, romanValidation: true,
            details: { chord: event.chord, roman: result.source },
          });
        }
        const bass = result?.structure?.items[0];
        if (!bass) continue;
        const expected = pitchClass(tonic + DEGREE_PITCHES[bass.degree - 1] + ALTERATIONS[bass.accidental]);
        if (expected === actual) continue;
        makeError(warnings, source, "roman-bass-mismatch", start, end, {
          severity: "warning", domain: "roman", romanCode: "bass-mismatch", romanValidation: true,
          details: { tonalCenter: layer.tonalCenter ?? event.tonalCenter, roman: result.source,
            expected: NOTE_NAMES[expected], chord: event.chord, actual: NOTE_NAMES[actual] },
        });
      }
    }
  }
  return warnings;
}
