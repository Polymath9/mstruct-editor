import { describeDuration } from "../core/duration-notation.js";
import { slotDurationLabel } from "../core/engraving.js";

const NOTE_GLYPHS = new Map([
  [1, 0xECA2], [2, 0xECA3], [4, 0xECA5], [8, 0xECA7],
  [16, 0xECA9], [32, 0xECAB], [64, 0xECAD],
]);

function tupletGlyphs(value) {
  return [...String(value)].map((digit) => String.fromCodePoint(0xE880 + Number(digit))).join("");
}

export function makeDurationNotes(value, fraction, makeElement, ariaLabel, stemDown = false) {
  const displayed = describeDuration(value, fraction);
  if (displayed.kind === "fraction") return null;

  const label = makeElement("span", "duration-notes");
  label.setAttribute("role", "img");
  label.setAttribute("aria-label", ariaLabel);
  const sequence = makeElement("span", "duration-note-sequence");
  sequence.setAttribute("aria-hidden", "true");
  for (const note of displayed.notes) {
    const symbol = makeElement("span", "duration-note");
    const codePoint = NOTE_GLYPHS.get(note.denominator);
    const glyph = makeElement("span", "duration-note-glyph", String.fromCodePoint(codePoint));
    if (stemDown) {
      symbol.classList.add("has-down-stem");
      glyph.textContent = "";
      // Keep the original advance, including the space occupied by up flags.
      glyph.append(makeElement("span", "duration-note-stem-up", String.fromCodePoint(codePoint)));
      glyph.append(makeElement("span", "duration-note-stem-down", String.fromCodePoint(note.denominator === 1 ? codePoint : codePoint + 1)));
    }
    symbol.append(glyph);
    if (note.dots) {
      const dots = makeElement("span", "duration-note-dots");
      for (let index = 0; index < note.dots; index += 1) {
        dots.append(makeElement("span", "duration-note-dot"));
      }
      symbol.append(dots);
    }
    if (note.tuplet) symbol.append(makeElement("span", "duration-note-tuplet", tupletGlyphs(note.tuplet)));
    sequence.append(symbol);
  }
  if (displayed.multiplier > 1) sequence.append(makeElement("span", "duration-note-multiplier", `×${displayed.multiplier}`));
  label.append(sequence);
  return label;
}

export function makeDurationLabel(slot, mode, makeElement, tr, stemDown = false) {
  const fraction = slotDurationLabel(slot);
  const notes = mode === "note"
    ? makeDurationNotes(slot.duration, fraction, makeElement, tr("durationAria", { duration: fraction }), stemDown)
    : null;
  if (notes) {
    notes.classList.add("duration-label");
    return notes;
  }
  return makeElement("span", "duration-label", fraction);
}
