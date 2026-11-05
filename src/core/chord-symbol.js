import { displayChordQuality } from "./chord-quality-display.js";

const NATURAL_INTERVAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTAL_OFFSETS = { "": 0, b: -1, bb: -2, "#": 1, x: 2 };
const INTERVAL_ACCIDENTALS = new Set(["", "b", "bb", "#", "x"]);
const ORIGINS = new Set(["natural", "manual"]);

export const CHORD_RENDER_MODES = ["normal", "camel", "superscript"];
export const DEFAULT_CHORD_RENDER_MODE = "camel";
export const DEFAULT_NOTE_NAME_SPECIALS = ["sharp9_as_flat10"];

export class ChordSyntaxError extends Error {
  constructor(code, start, end, details = {}, message = code) {
    super(message);
    this.name = "ChordSyntaxError";
    this.code = code;
    this.start = Math.max(0, start);
    this.end = Math.max(this.start + 1, end);
    this.details = details;
  }
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function accidentalOffset(accidental) {
  return ACCIDENTAL_OFFSETS[accidental] ?? Number.NaN;
}

function naturalIntervalSemitones(degree) {
  const zeroBased = degree - 1;
  return Math.floor(zeroBased / 7) * 12 + NATURAL_INTERVAL_SEMITONES[modulo(zeroBased, 7)];
}

function intervalSemitones(item) {
  return naturalIntervalSemitones(item.degree) + accidentalOffset(item.accidental);
}

function intervalText(item) {
  return `${item.accidental}${item.degree}`;
}

function parseIntervalToken(token, span = { start: 0, end: Math.max(1, token.length) }) {
  const match = /^(bb|b|#|x)?([1-9]\d*)$/.exec(token);
  if (!match) {
    throw new ChordSyntaxError("invalid-interval", span.start, span.end, { token }, `Invalid interval ${token}.`);
  }
  const accidental = match[1] ?? "";
  const degree = Number(match[2]);
  if (!INTERVAL_ACCIDENTALS.has(accidental)) {
    throw new ChordSyntaxError("invalid-accidental", span.start, span.end, { token }, `Invalid accidental in ${token}.`);
  }
  return { accidental, degree };
}

function parseRoot(root, span = { start: 0, end: Math.max(1, root.length) }) {
  const match = /^([A-G])(bb|b|#|x)?$/.exec(root);
  if (!match) {
    throw new ChordSyntaxError("invalid-root", span.start, span.end, { token: root }, `Invalid root ${root}.`);
  }
  return { name: match[1], accidental: match[2] ?? "" };
}

function rootPitchClass(root) {
  const parsed = parseRoot(root);
  return modulo(NOTE_SEMITONES[parsed.name] + accidentalOffset(parsed.accidental), 12);
}

function intervalFromPosition(preferredDegree, semitones, origin, sourceSpan, sourceItem = {}) {
  const allowedOffsets = new Set([-2, -1, 0, 1, 2]);
  const candidates = [];
  for (let letterShift = -2; letterShift <= 2; letterShift += 1) {
    for (let octaveShift = -3; octaveShift <= 3; octaveShift += 1) {
      const degree = preferredDegree + letterShift + octaveShift * 7;
      if (degree < 1) continue;
      const offset = semitones - naturalIntervalSemitones(degree);
      if (!allowedOffsets.has(offset)) continue;
      candidates.push({
        degree,
        offset,
        letterShift,
        octaveShift,
        score: Math.abs(letterShift) * 100 + Math.abs(offset) * 10 + Math.abs(octaveShift),
      });
    }
  }
  candidates.sort((left, right) => left.score - right.score || left.degree - right.degree);
  const match = candidates[0];
  if (!match) {
    throw new ChordSyntaxError("interval-spelling", sourceSpan?.start ?? 0, sourceSpan?.end ?? 1, {}, "Unable to spell the transformed interval.");
  }
  const accidental = match.offset === -2 ? "bb" : match.offset === -1 ? "b" : match.offset === 1 ? "#" : match.offset === 2 ? "x" : "";
  return { accidental, degree: match.degree, origin, sourceSpan, sharp9AsFlat10: Boolean(sourceItem.sharp9AsFlat10) };
}

function cloneItem(item) {
  return { ...item, sourceSpan: item.sourceSpan ? { ...item.sourceSpan } : undefined };
}

function makeItem(token, origin = "manual", sourceSpan) {
  const parsed = parseIntervalToken(token, sourceSpan);
  if (!ORIGINS.has(origin)) throw new TypeError(`Unknown interval origin: ${origin}`);
  return { ...parsed, origin, sourceSpan, sharp9AsFlat10: parsed.accidental === "#" && parsed.degree === 9 };
}

function itemSort(left, right) {
  return intervalSemitones(left) - intervalSemitones(right) || left.degree - right.degree || accidentalOffset(left.accidental) - accidentalOffset(right.accidental);
}

function shiftedRootDegree(lowerRoot, upperRoot) {
  const lower = parseRoot(lowerRoot);
  const upper = parseRoot(upperRoot);
  return modulo(NOTE_NAMES.indexOf(upper.name) - NOTE_NAMES.indexOf(lower.name), 7) + 1;
}

function ascendingPitchDistance(lowerRoot, upperRoot) {
  return modulo(rootPitchClass(upperRoot) - rootPitchClass(lowerRoot), 12);
}

function transformedSpecialInterval(item, specials) {
  const specialSet = new Set(specials ?? []);
  if (specialSet.has("sharp9_as_flat10") && item.sharp9AsFlat10) {
    return { ...item, accidental: "b", degree: item.degree + 1 };
  }
  if (specialSet.has("aug6") && item.accidental === "b" && item.degree === 7) {
    return { ...item, accidental: "#", degree: 6 };
  }
  if (specialSet.has("aug6dim3")) {
    if (item.accidental === "" && item.degree === 2) return { ...item, accidental: "bb", degree: 3 };
    if (item.accidental === "#" && item.degree === 4) return { ...item, accidental: "b", degree: 5 };
    if (item.accidental === "" && item.degree === 6) return { ...item, accidental: "b", degree: 7 };
  }
  return item;
}

function noteNameForInterval(root, sourceItem, specials) {
  const item = transformedSpecialInterval(sourceItem, specials);
  const parsedRoot = parseRoot(root);
  const rootLetterIndex = NOTE_NAMES.indexOf(parsedRoot.name);
  const desiredPitch = modulo(rootPitchClass(root) + intervalSemitones(item), 12);
  const preferredLetterIndex = rootLetterIndex + item.degree - 1;
  const candidates = [];

  for (let shift = -2; shift <= 2; shift += 1) {
    const letterIndex = preferredLetterIndex + shift;
    const name = NOTE_NAMES[modulo(letterIndex, 7)];
    let offset = modulo(desiredPitch - NOTE_SEMITONES[name], 12);
    if (offset > 6) offset -= 12;
    if (offset < -2 || offset > 2) continue;
    candidates.push({ name, offset, shift, score: Math.abs(shift) * 100 + Math.abs(offset) });
  }
  candidates.sort((left, right) => left.score - right.score || left.shift - right.shift);
  const match = candidates[0];
  if (!match) return parsedRoot.name;
  const accidental = match.offset === -2 ? "bb" : match.offset === -1 ? "b" : match.offset === 1 ? "#" : match.offset === 2 ? "x" : "";
  return `${match.name}${accidental}`;
}

export class IntervalStructure {
  constructor(intervals = ["1"], root = "C", options = {}) {
    parseRoot(root);
    this.root = root;
    this.isSlashChord = Boolean(options.isSlashChord);
    this.isPolychord = Boolean(options.isPolychord);
    this.sourceHasSeventh = options.sourceHasSeventh;
    this.items = intervals.map((item) => typeof item === "string" ? makeItem(item, "manual") : cloneItem(item));
    this.sort();
  }

  get values() {
    return this.items.map(intervalText);
  }

  get hasSeventh() {
    return this.sourceHasSeventh ?? this.items.some(item => (item.degree - 1) % 7 === 6);
  }

  clone() {
    return new IntervalStructure(this.items, this.root, { isSlashChord: this.isSlashChord, isPolychord: this.isPolychord, sourceHasSeventh: this.sourceHasSeventh });
  }

  sort() {
    this.items.sort(itemSort);
  }

  append(token, origin = "manual", sourceSpan) {
    this.items.push(makeItem(token, origin, sourceSpan));
    this.sort();
  }

  replaceNatural(degree, replacement, sourceSpan) {
    const index = this.items.findIndex((item) => item.degree === degree && item.accidental === "");
    if (index !== -1) {
      if (this.items[index].origin !== "natural") {
        throw new ChordSyntaxError("altered-manual", sourceSpan.start, sourceSpan.end, { interval: intervalText(this.items[index]) }, `Interval ${degree} was added explicitly and cannot be altered.`);
      }
      this.items.splice(index, 1);
    }
    this.append(replacement, "manual", sourceSpan);
  }

  removeNatural(degree, sourceSpan) {
    const index = this.items.findIndex((item) => item.degree === degree && item.accidental === "");
    if (index === -1) {
      throw new ChordSyntaxError("removal-missing", sourceSpan.start, sourceSpan.end, { interval: String(degree) }, `Interval ${degree} is not present.`);
    }
    this.items.splice(index, 1);
  }

  removeNaturalInterval(token, sourceSpan) {
    const interval = parseIntervalToken(token, sourceSpan);
    const index = this.items.findIndex((item) => item.degree === interval.degree && item.accidental === interval.accidental);
    if (index === -1) {
      throw new ChordSyntaxError("removal-missing", sourceSpan.start, sourceSpan.end, { interval: token }, `Interval ${token} is not present.`);
    }
    if (this.items[index].origin !== "natural") {
      throw new ChordSyntaxError("removal-manual", sourceSpan.start, sourceSpan.end, { interval: token }, `Interval ${token} was added explicitly and cannot be removed.`);
    }
    this.items.splice(index, 1);
  }

  markNatural(token) {
    const interval = parseIntervalToken(token);
    const item = this.items.find((candidate) => candidate.degree === interval.degree && candidate.accidental === interval.accidental);
    if (item) item.origin = "natural";
  }

  validate() {
    const rootIndex = this.items.findIndex((item) => item.degree === 1 && item.accidental === "");
    if (rootIndex === -1) throw new ChordSyntaxError("root-interval-missing", 0, 1, {}, "The interval structure must contain 1.");
    if (!this.isPolychord && (this.items.length < 1 || this.items.length > 12)) {
      const span = this.items.at(-1)?.sourceSpan ?? { start: 0, end: 1 };
      throw new ChordSyntaxError("interval-count", span.start, span.end, { count: this.items.length }, "An interval structure must contain 1 to 12 notes.");
    }
    if (!this.isPolychord) {
      const pitches = new Map();
      for (const item of this.items) {
        const pitch = modulo(intervalSemitones(item), 12);
        const prior = pitches.get(pitch);
        if (prior) {
          const span = item.sourceSpan ?? prior.sourceSpan ?? { start: 0, end: 1 };
          throw new ChordSyntaxError(
            "enharmonic-conflict",
            span.start,
            span.end,
            { first: intervalText(prior), second: intervalText(item) },
            `${intervalText(prior)} conflicts with ${intervalText(item)}.`,
          );
        }
        pitches.set(pitch, item);
      }
    }
    return this;
  }

  toNoteNames(specials = []) {
    return this.items.map((item) => noteNameForInterval(this.root, item, specials));
  }

  toPitchClasses() {
    return [...new Set(this.items.map((item) => modulo(intervalSemitones(item), 12)))].sort((left, right) => left - right);
  }

  toPitchClassMask() {
    return this.toPitchClasses().reduce((mask, pitchClass) => mask | (1 << pitchClass), 0);
  }

  toSlashChord(slashRoot, sourceSpan = { start: 0, end: 1 }) {
    parseRoot(slashRoot, sourceSpan);
    if (this.isSlashChord) {
      throw new ChordSyntaxError("slash-nested", sourceSpan.start, sourceSpan.end, {}, "A slash chord cannot receive another bass note.");
    }
    this.sourceHasSeventh = this.hasSeventh || shiftedRootDegree(this.root, slashRoot) === 7;
    const oldRoot = this.root;
    const baseDegree = shiftedRootDegree(slashRoot, oldRoot);
    const baseSemitones = ascendingPitchDistance(slashRoot, oldRoot);
    const slashPitch = rootPitchClass(slashRoot);
    const retained = this.items.filter((item) => modulo(rootPitchClass(oldRoot) + intervalSemitones(item), 12) !== slashPitch);
    const transformed = retained.map((item) => intervalFromPosition(
      baseDegree + item.degree - 1,
      baseSemitones + intervalSemitones(item),
      item.origin,
      item.sourceSpan,
      item,
    ));
    this.items = [makeItem("1", "manual", sourceSpan), ...transformed];
    this.root = slashRoot;
    this.isSlashChord = true;
    this.sort();
    return this;
  }

  toPolychord(lowerChord, sourceSpan = { start: 0, end: 1 }) {
    if (!(lowerChord instanceof IntervalStructure)) throw new TypeError("The lower chord must be an IntervalStructure.");
    if (this.isPolychord || lowerChord.isPolychord) {
      throw new ChordSyntaxError("polychord-nested", sourceSpan.start, sourceSpan.end, {}, "Nested polychords are not supported.");
    }
    if (lowerChord.items.length !== 3) {
      throw new ChordSyntaxError("polychord-three-notes", sourceSpan.start, sourceSpan.end, { count: lowerChord.items.length }, "The lower chord must contain exactly three notes.");
    }

    const baseDegree = shiftedRootDegree(lowerChord.root, this.root);
    const baseSemitones = ascendingPitchDistance(lowerChord.root, this.root);
    let transformed = this.items.map((item) => ({
      item,
      degree: baseDegree + item.degree - 1,
      semitones: baseSemitones + intervalSemitones(item),
    }));
    const lowerTop = intervalSemitones(lowerChord.items.at(-1));
    while (transformed[0].semitones <= lowerTop) {
      transformed = transformed.map((entry) => ({ ...entry, degree: entry.degree + 7, semitones: entry.semitones + 12 }));
    }
    const upperItems = transformed.map((entry) => intervalFromPosition(entry.degree, entry.semitones, entry.item.origin, entry.item.sourceSpan, entry.item));
    this.items = [...lowerChord.items.map(cloneItem), ...upperItems];
    this.root = lowerChord.root;
    this.isPolychord = true;
    this.sort();
    return this;
  }

  toMidiNotes() {
    const anchorIndex = this.isPolychord ? (this.isSlashChord ? 4 : 3) : (this.isSlashChord ? 1 : 0);
    const anchor = this.items[anchorIndex];
    if (!anchor) throw new Error("The interval structure does not contain its MIDI anchor.");
    const anchorPitch = modulo(rootPitchClass(this.root) + intervalSemitones(anchor), 12);
    const anchorMidi = Array.from({ length: 12 }, (_, index) => 55 + index).find((value) => modulo(value, 12) === anchorPitch);
    return this.items.map((item) => anchorMidi + intervalSemitones(item) - intervalSemitones(anchor));
  }
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Invalid special-chord CSV quoting.");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function parseSpecialChordCsv(text) {
  const [header, ...rows] = csvRows(String(text ?? "").replace(/^\uFEFF/, ""));
  const expected = ["id", "compiler_name", "display_name", "interval_structure"];
  if (!header || header.length !== expected.length || expected.some((name, index) => header[index] !== name)) throw new Error("Invalid special-chord CSV header.");
  const result = new Map();
  const ids = new Set();
  for (const row of rows) {
    if (row.length !== 4) throw new Error("Invalid special-chord CSV row.");
    const [id, compilerName, displayName, intervalList] = row.map((value) => value.trim());
    if (!id || !/^[a-z][a-z0-9_-]*$/i.test(compilerName) || !displayName) throw new Error("Invalid special-chord CSV identity.");
    if (ids.has(id)) throw new Error(`Duplicate special-chord ID: ${id}`);
    if (result.has(compilerName)) throw new Error(`Duplicate special chord: ${compilerName}`);
    const intervals = intervalList.split(/\s+/).filter(Boolean);
    new IntervalStructure(intervals).validate();
    ids.add(id);
    result.set(compilerName, { id, compilerName, displayName, intervals });
  }
  return result;
}

function listParts(source, start) {
  if (!source) return [];
  const parts = [];
  let cursor = 0;
  for (const value of source.split(",")) {
    const valueStart = start + cursor;
    parts.push({ value, start: valueStart, end: valueStart + Math.max(1, value.length) });
    cursor += value.length + 1;
  }
  return parts;
}

function addSegment(segments, text, role, start, end, notation = false) {
  segments.push({ text, role, start, end, notation });
}

class ChordParser {
  constructor(input, specialChords) {
    this.input = input;
    this.pos = 0;
    this.specialChords = specialChords ?? new Map();
    this.searchLists = [];
  }

  error(code, start = this.pos, end = Math.min(this.input.length, start + 1), details = {}, message = code) {
    throw new ChordSyntaxError(code, start, Math.max(start + 1, end), details, message);
  }

  startsWith(value) {
    return this.input.startsWith(value, this.pos);
  }

  consume(value) {
    if (!this.startsWith(value)) this.error("unexpected-token");
    const start = this.pos;
    this.pos += value.length;
    return { start, end: this.pos };
  }

  root(segments, rolePrefix = "root") {
    const start = this.pos;
    const name = this.input[this.pos];
    if (!name || !/[A-G]/.test(name)) this.error("root-expected", start, start + 1, {}, "A chord root from A to G is required.");
    this.pos += 1;
    addSegment(segments, name, rolePrefix, start, this.pos);
    let accidental = "";
    for (const candidate of ["bb", "#", "b", "x"]) {
      if (this.startsWith(candidate)) {
        const accidentalStart = this.pos;
        this.pos += candidate.length;
        accidental = candidate;
        addSegment(segments, candidate, `${rolePrefix}-accidental`, accidentalStart, this.pos, true);
        break;
      }
    }
    return { value: `${name}${accidental}`, start, end: this.pos };
  }

  bracketBody(prefix) {
    const start = this.pos;
    this.consume(prefix);
    const bodyStart = this.pos;
    const close = this.input.indexOf(")]", this.pos);
    if (close === -1) this.error("closing-bracket-expected", start, this.input.length, {}, "Expected )].");
    const body = this.input.slice(this.pos, close);
    this.pos = close + 2;
    return { start, end: this.pos, body, bodyStart, close };
  }

  parseStackedQuality(kind, structure, segments) {
    const quality = this.bracketBody(`[${kind}:(`);
    const parts = listParts(quality.body, quality.bodyStart);
    const tiers = kind === "q4" ? [["4", "#4"], ["7", "b7"], ["10", "b10"]] : [["5", "b5"], ["9", "b9"], ["13", "b13"]];
    if (parts.length < 1 || parts.length > 3) this.error("quality-list-count", quality.bodyStart, quality.close, { kind }, "This quality requires one to three intervals.");
    parts.forEach((part, index) => {
      if (!tiers[index].includes(part.value)) this.error("quality-stack-order", part.start, part.end, { kind, token: part.value }, "Stacked intervals cannot skip a level.");
      structure.append(part.value, "manual", part);
    });
    this.searchLists.push({ kind, start: quality.bodyStart - 1, end: quality.close + 1, items: parts.map((part) => part.value) });
    addSegment(segments, kind, "basic-quality", quality.start, quality.start + kind.length + 1);
    addSegment(segments, `(${quality.body})`, "tension", quality.bodyStart - 1, quality.close + 1, true);
  }

  parseNormalForm(structure, segments) {
    const quality = this.bracketBody("[nf:(");
    const parts = listParts(quality.body, quality.bodyStart);
    if (parts.length < 2) this.error("normal-form-count", quality.bodyStart, quality.close, {}, "Normal form requires at least two pitch numbers.");
    let prior = -1;
    const seen = new Set();
    for (const part of parts) {
      if (!/^\d+$/.test(part.value) || Number(part.value) > 36) this.error("normal-form-value", part.start, part.end, { token: part.value }, "Normal-form values must be integers from 0 to 36.");
      const value = Number(part.value);
      if (seen.has(value)) this.error("normal-form-duplicate", part.start, part.end, { token: part.value }, "Normal-form values cannot repeat.");
      if (value <= prior) this.error("normal-form-order", part.start, part.end, { token: part.value }, "Normal-form values must ascend.");
      seen.add(value);
      prior = value;
      const octave = Math.floor(value / 12);
      const pitch = value % 12;
      const baseDegrees = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7];
      const sharps = new Set([1, 3, 6, 8, 10]);
      structure.append(`${sharps.has(pitch) ? "#" : ""}${baseDegrees[pitch] + octave * 7}`, "manual", part);
    }
    this.searchLists.push({ kind: "nf", start: quality.bodyStart - 1, end: quality.close + 1, items: parts.map((part) => part.value) });
    addSegment(segments, `[${quality.body}]`, "tension", quality.start, quality.end, true);
  }

  parseSpecial(structure, segments) {
    const start = this.pos;
    this.consume("[sp:");
    const idStart = this.pos;
    const close = this.input.indexOf("]", this.pos);
    if (close === -1) this.error("closing-bracket-expected", start, this.input.length, {}, "Expected ].");
    const compilerName = this.input.slice(this.pos, close);
    this.pos = close + 1;
    const special = this.specialChords.get(compilerName);
    if (!special) this.error("special-not-found", idStart, close, { token: compilerName }, `Unknown special chord ${compilerName}.`);
    structure.items = special.intervals.map((token) => makeItem(token, "manual", { start: idStart, end: close }));
    structure.sort();
    addSegment(segments, special.displayName, "tension", start, this.pos, false);
  }

  addSeventh(structure, quality, majorSeventh, span) {
    const interval = majorSeventh ? "7" : quality === "dim" ? "bb7" : "b7";
    structure.append(interval, "manual", span);
  }

  highestTension(structure, segments, quality, majorSeventh) {
    const candidates = ["(b6/b9)", "(b6/9)", "6/b9", "6/9", "(b6)", "13", "11", "9", "7", "6"];
    const token = candidates.find((candidate) => this.startsWith(candidate));
    if (!token) return { extended: false, sixSeries: false };
    const start = this.pos;
    this.pos += token.length;
    const isSixSeries = token.includes("6") && !["13", "11", "9", "7"].includes(token);
    if (isSixSeries && !["major", "minor", "aug"].includes(quality)) this.error("six-series-unavailable", start, this.pos, {}, "This quality cannot use a sixth-chord shorthand.");
    if (isSixSeries) {
      const plain = token.replace(/[()]/g, "");
      for (const interval of plain.split("/")) structure.append(interval, "manual", { start, end: this.pos });
      addSegment(segments, plain, "tension", start, this.pos, true);
      return { extended: false, sixSeries: true };
    }
    this.addSeventh(structure, quality, majorSeventh, { start, end: this.pos });
    if (quality === "dim") {
      structure.markNatural("b3");
      structure.markNatural("b5");
    }
    if (token === "9") structure.append("9", "manual", { start, end: this.pos });
    if (token === "11") {
      structure.append("9", "natural", { start, end: this.pos });
      structure.append("11", "manual", { start, end: this.pos });
    }
    if (token === "13") {
      structure.append("9", "natural", { start, end: this.pos });
      structure.append("11", "natural", { start, end: this.pos });
      structure.append("13", "manual", { start, end: this.pos });
    }
    addSegment(segments, token, "tension", start, this.pos, true);
    return { extended: true, sixSeries: false };
  }

  alteredTensions(structure, segments, quality, enabled) {
    let priorDegree = 0;
    let priorAccidental = "";
    const items = [];
    let listStart = this.pos;
    let listEnd = this.pos;
    let parenthesized = false;
    if (this.startsWith("(")) {
      parenthesized = true;
      listStart = this.pos;
      this.pos += 1;
    }
    while (true) {
      const match = /^(b|#)(15|13|11|9|5)/.exec(this.input.slice(this.pos));
      if (!match) break;
      const start = this.pos;
      this.pos += match[0].length;
      if (!enabled) this.error("altered-unavailable", start, this.pos, { token: match[0] }, "Altered tensions require 7, 9, 11, or 13.");
      const degree = Number(match[2]);
      if (degree < priorDegree || (degree === priorDegree && priorAccidental === "#" && match[1] === "b")) {
        this.error("altered-order", start, this.pos, { token: match[0] }, "Altered tensions must ascend, with flats before sharps.");
      }
      if (["aug", "dim"].includes(quality) && degree === 5) this.error("altered-fifth-quality", start, this.pos, { quality }, "Augmented and diminished qualities cannot alter 5 here.");
      structure.replaceNatural(degree, match[0], { start, end: this.pos });
      addSegment(segments, match[0], "tension", start, this.pos, true);
      items.push(match[0]);
      priorDegree = degree;
      priorAccidental = match[1];
      if (parenthesized) {
        if (this.startsWith(",")) {
          this.pos += 1;
          if (this.startsWith(")")) this.error("invalid-list-item", this.pos - 1, this.pos, { token: "" }, "Altered tensions cannot contain an empty item.");
        } else break;
      }
    }
    if (parenthesized) {
      if (!items.length || !this.startsWith(")")) this.error("closing-parenthesis-expected", listStart, Math.max(this.pos + 1, listStart + 1), {}, "Expected a parenthesized altered-tension list.");
      this.pos += 1;
      listEnd = this.pos;
    } else listEnd = this.pos;
    if (items.length) this.searchLists.push({ kind: "altered", start: listStart, end: listEnd, items });
  }

  intervalList(allowed, options = {}) {
    const sortedAllowed = [...allowed].sort((left, right) => right.length - left.length);
    if (this.startsWith("(")) {
      const start = this.pos;
      this.pos += 1;
      const close = this.input.indexOf(")", this.pos);
      if (close === -1) this.error("closing-parenthesis-expected", start, this.input.length, {}, "Expected ).");
      const raw = this.input.slice(this.pos, close);
      const parts = listParts(raw, this.pos);
      this.pos = close + 1;
      if (parts.length === 0 || parts.some((part) => !allowed.has(part.value))) {
        const invalid = parts.find((part) => !allowed.has(part.value));
        this.error("invalid-list-item", invalid?.start ?? start, invalid?.end ?? this.pos, { token: invalid?.value ?? "" }, "This list contains an unsupported interval.");
      }
      return { parts, text: `(${raw})`, start, end: this.pos };
    }
    const token = sortedAllowed.find((candidate) => this.startsWith(candidate));
    if (!token) {
      if (options.allowEmpty) return { parts: [], text: "", start: this.pos, end: this.pos };
      this.error("interval-list-expected", this.pos, this.pos + 1, {}, "An interval is required here.");
    }
    const start = this.pos;
    this.pos += token.length;
    if (this.startsWith(",")) this.error("list-parentheses-required", start, this.pos + 1, {}, "Multiple intervals must be enclosed in parentheses.");
    return { parts: [{ value: token, start, end: this.pos }], text: token, start, end: this.pos };
  }

  assertAscending(parts) {
    let previous = Number.NEGATIVE_INFINITY;
    for (const part of parts) {
      const current = intervalSemitones(parseIntervalToken(part.value, part));
      if (current <= previous) this.error("interval-list-order", part.start, part.end, { token: part.value }, "Intervals in a list must ascend.");
      previous = current;
    }
  }

  suffixes(structure, segments, options) {
    if (options.allowSus && this.startsWith("sus")) {
      const keyword = this.consume("sus");
      structure.removeNatural(3, keyword);
      addSegment(segments, "sus", "keyword", keyword.start, keyword.end);
      const list = this.intervalList(new Set(["b2", "2", "4", "#4"]), { allowEmpty: true });
      this.searchLists.push({ kind: "sus", start: list.start, end: list.end, items: list.parts.map((part) => part.value) });
      this.assertAscending(list.parts);
      for (const part of list.parts) structure.append(part.value, "manual", part);
      if (list.text) addSegment(segments, list.text, "tension", list.start, list.end, true);
    } else if (this.startsWith("sus")) this.error("sus-unavailable", this.pos, this.pos + 3, {}, "This chord quality cannot use sus.");

    if (options.allowAdd && this.startsWith("add")) {
      const keyword = this.consume("add");
      addSegment(segments, "add", "keyword", keyword.start, keyword.end);
      const allowed = new Set(["b2", "2", "b3", "3", "4", "#4", "b5", "5", "#5", "b6", "6", "b7", "7", "b8", "b9", "9", "#9", "b10", "10", "11", "#11", "b12", "12", "b13", "13", "#13", "b15", "#15"]);
      const list = this.intervalList(allowed);
      this.searchLists.push({ kind: "add", start: list.start, end: list.end, items: list.parts.map((part) => part.value) });
      this.assertAscending(list.parts);
      for (const part of list.parts) structure.append(part.value, "manual", part);
      addSegment(segments, list.text, "tension", list.start, list.end, true);
    } else if (this.startsWith("add")) this.error("add-unavailable", this.pos, this.pos + 3, {}, "This chord quality cannot use add.");

    if (options.allowNo && this.startsWith("no")) {
      const keyword = this.consume("no");
      addSegment(segments, "no", "keyword", keyword.start, keyword.end);
      const list = this.intervalList(new Set(["b3", "3", "b5", "5"]));
      this.searchLists.push({ kind: "no", start: list.start, end: list.end, items: list.parts.map((part) => part.value) });
      this.assertAscending(list.parts);
      for (const part of list.parts) structure.removeNaturalInterval(part.value, part);
      addSegment(segments, list.text, "tension", list.start, list.end, true);
    } else if (this.startsWith("no")) this.error("no-unavailable", this.pos, this.pos + 2, {}, "This chord quality cannot use no.");

    if (this.startsWith("/")) {
      const slash = this.consume("/");
      addSegment(segments, "/", "separator", slash.start, slash.end);
      const bass = this.root(segments, "bass");
      structure.toSlashChord(bass.value, bass);
      if (this.startsWith("/")) this.error("slash-nested", this.pos, this.pos + 1, {}, "A slash chord cannot contain another slash chord.");
    }

    if (this.startsWith("on")) {
      if (!options.allowOn) this.error("polychord-nested", this.pos, this.pos + 2, {}, "Nested polychords are not supported.");
      const on = this.consume("on");
      addSegment(segments, "on", "separator", on.start, on.end);
      const lower = this.chord(false);
      segments.push(...lower.segments);
      structure.toPolychord(lower.structure, on);
    }
  }

  chord(allowOn = true) {
    const segments = [];
    const root = this.root(segments);
    const structure = new IntervalStructure([{ ...makeItem("1", "manual", root) }], root.value);
    let quality = "major";
    let mode = "standard";

    if (this.startsWith("7alt")) {
      mode = "seven-alt";
      quality = "seven-alt";
      const seven = this.consume("7");
      const alt = this.consume("alt");
      if (!allowOn) this.error("seven-alt-polychord", seven.start, alt.end, {}, "7alt cannot be the lower chord of a polychord.");
      structure.append("3", "manual", seven);
      structure.append("b7", "manual", { start: seven.start, end: alt.end });
      addSegment(segments, "7", "tension", seven.start, seven.end, true);
      addSegment(segments, "alt", "keyword", alt.start, alt.end);
    } else if (this.startsWith("[q4:(")) {
      mode = "stacked";
      quality = "q4";
      this.parseStackedQuality("q4", structure, segments);
    } else if (this.startsWith("[q5:(")) {
      mode = "stacked";
      quality = "q5";
      this.parseStackedQuality("q5", structure, segments);
    } else if (this.startsWith("[sp:")) {
      mode = "special";
      quality = "special";
      this.parseSpecial(structure, segments);
    } else if (this.startsWith("[nf:(")) {
      mode = "terminal";
      quality = "normal-form";
      structure.items = [];
      this.parseNormalForm(structure, segments);
    } else if (this.startsWith("1") && !this.startsWith("11") && !this.startsWith("13")) {
      mode = "terminal";
      quality = "root-only";
      const unison = this.consume("1");
      addSegment(segments, "1", "tension", unison.start, unison.end, true);
    } else if (this.startsWith("5")) {
      mode = "terminal";
      quality = "power";
      const fifth = this.consume("5");
      structure.append("5", "natural", fifth);
      addSegment(segments, "5", "tension", fifth.start, fifth.end, true);
    } else {
      let qualitySpan = null;
      if (this.startsWith("aug")) {
        quality = "aug";
        qualitySpan = this.consume("aug");
        structure.append("3", "natural", qualitySpan);
        structure.append("#5", "manual", qualitySpan);
      } else if (this.startsWith("dim")) {
        quality = "dim";
        qualitySpan = this.consume("dim");
        structure.append("b3", "natural", qualitySpan);
        structure.append("b5", "manual", qualitySpan);
      } else if (this.startsWith("m")) {
        quality = "minor";
        qualitySpan = this.consume("m");
        structure.append("b3", "manual", qualitySpan);
        structure.append("5", "natural", qualitySpan);
      } else {
        structure.append("3", "natural", root);
        structure.append("5", "natural", root);
      }
      if (qualitySpan) addSegment(segments, this.input.slice(qualitySpan.start, qualitySpan.end), "basic-quality", qualitySpan.start, qualitySpan.end);
    }

    if (mode === "terminal") {
      if (this.pos < this.input.length) this.error("terminal-suffix", this.pos, this.input.length, { quality }, "This chord form cannot receive suffixes.");
      structure.validate();
      return { structure, segments };
    }

    if (mode === "seven-alt") {
      this.suffixes(structure, segments, { allowSus: false, allowAdd: false, allowNo: false, allowOn: false });
    } else if (mode === "special") {
      this.suffixes(structure, segments, { allowSus: false, allowAdd: false, allowNo: false, allowOn });
    } else if (mode === "stacked") {
      this.suffixes(structure, segments, { allowSus: false, allowAdd: true, allowNo: false, allowOn });
    } else {
      let majorSeventh = false;
      let seventhSpan = null;
      if (this.startsWith("M")) {
        seventhSpan = this.consume("M");
        majorSeventh = true;
        addSegment(segments, "M", "tension", seventhSpan.start, seventhSpan.end);
      }
      const highest = this.highestTension(structure, segments, quality, majorSeventh);
      if (majorSeventh && !highest.extended) this.error("major-seventh-tension", seventhSpan.start, seventhSpan.end, {}, "M must be followed by 7, 9, 11, or 13.");
      this.alteredTensions(structure, segments, quality, highest.extended);
      this.suffixes(structure, segments, {
        allowSus: !highest.sixSeries && ["major", "aug"].includes(quality),
        allowAdd: true,
        allowNo: ["major", "minor", "aug", "dim"].includes(quality),
        allowOn,
      });
    }

    if (this.pos < this.input.length) this.error("unexpected-token", this.pos, this.input.length, { token: this.input.slice(this.pos) }, `Unexpected token ${this.input.slice(this.pos)}.`);
    structure.validate();
    return { structure, segments };
  }
}

export function parseChordSymbol(input, options = {}) {
  const source = String(input ?? "");
  if (!source) throw new ChordSyntaxError("empty", 0, 1, {}, "Enter a chord symbol.");
  const parser = new ChordParser(source, options.specialChords);
  const result = parser.chord(true);
  const complete = { source, ...result, searchLists: parser.searchLists };
  const search = chordSearchStructure(complete);
  return { ...complete, search, searchAtoms: search.atoms, atoms: chordSymbolAtoms(complete) };
}

function canonicalChordSearchSource(source, lists) {
  let cursor = 0;
  let output = "";
  for (const list of [...lists].sort((left, right) => left.start - right.start || left.end - right.end)) {
    if (list.start < cursor) continue;
    output += source.slice(cursor, list.start);
    if (list.items.length) output += `(${list.items.join(",")})`;
    cursor = list.end;
  }
  return output + source.slice(cursor);
}

function chordSearchAtoms(source) {
  const atoms = [];
  let cursor = 0;
  const fixed = ["[q4:", "[q5:", "[nf:", "aug", "dim", "sus", "add", "alt", "on", "no"];
  while (cursor < source.length) {
    if (source.startsWith("[sp:", cursor)) {
      const end = source.indexOf("]", cursor + 4);
      atoms.push(source.slice(cursor, end === -1 ? source.length : end + 1));
      cursor = end === -1 ? source.length : end + 1;
      continue;
    }
    const keyword = fixed.find((token) => source.startsWith(token, cursor));
    if (keyword) {
      atoms.push(keyword);
      cursor += keyword.length;
      continue;
    }
    const note = /^[A-G](?:bb|b|#|x)?/.exec(source.slice(cursor));
    if (note) {
      atoms.push(note[0]);
      cursor += note[0].length;
      continue;
    }
    const interval = /^(?:bb|b|#|x)?\d+/.exec(source.slice(cursor));
    if (interval) {
      atoms.push(interval[0]);
      cursor += interval[0].length;
      continue;
    }
    atoms.push(source[cursor]);
    cursor += 1;
  }
  return atoms;
}

export function chordSearchStructure(result) {
  const canonicalSource = canonicalChordSearchSource(String(result?.source ?? ""), result?.searchLists ?? []);
  const atoms = chordSearchAtoms(canonicalSource);
  const notes = atoms.flatMap((token, atomIndex) => /^[A-G](?:bb|b|#|x)?$/.test(token)
    ? [{ atomIndex, token, pitchClass: rootPitchClass(token) }]
    : []);
  return { canonicalSource, atoms, notes, lists: (result?.searchLists ?? []).map((list) => ({ kind: list.kind, items: [...list.items] })) };
}

export function chordSymbolAtoms(result) {
  const source = String(result?.source ?? "");
  const segments = [...(result?.segments ?? [])].sort((left, right) => left.start - right.start || left.end - right.end);
  const atoms = [];
  let cursor = 0;
  let segmentIndex = 0;

  while (cursor < source.length) {
    while (segmentIndex < segments.length && segments[segmentIndex].end <= cursor) segmentIndex += 1;

    if (source[cursor] === "[") {
      const close = source.indexOf("]", cursor + 1);
      if (close !== -1) {
        atoms.push(source.slice(cursor, close + 1));
        cursor = close + 1;
        continue;
      }
    }

    const segment = segments[segmentIndex];
    if (!segment || segment.start > cursor) {
      atoms.push(source[cursor]);
      cursor += 1;
      continue;
    }

    let end = segment.end;
    if (["root", "bass"].includes(segment.role)) {
      const accidental = segments[segmentIndex + 1];
      if (accidental?.start === end && accidental.role === `${segment.role}-accidental`) {
        end = accidental.end;
        segmentIndex += 1;
      }
    }
    atoms.push(source.slice(cursor, end));
    cursor = end;
    segmentIndex += 1;
  }
  return atoms;
}

export function renderChordParts(result, mode = DEFAULT_CHORD_RENDER_MODE, preferences = {}) {
  if (!CHORD_RENDER_MODES.includes(mode)) throw new TypeError(`Unknown chord rendering mode: ${mode}`);
  return result.segments.map((segment) => displayChordQuality({
    ...segment,
    superscript: mode === "camel" ? segment.role === "tension" : mode === "superscript" ? ["tension", "keyword"].includes(segment.role) : false,
  }, mode, preferences));
}

export function toMusicGlyphs(text, { noteName = false } = {}) {
  const source = String(text);
  // A complete note owns its first letter, even when that letter is lowercase b.
  // Isolated accidental segments and numeric intervals use the default context.
  const glyphs = { bb: "𝄫", b: "♭", "#": "♯", x: "𝄪" };
  if (noteName) return source.replace(/([A-Ga-g])(bb|b|#|x)/g, (_, note, accidental) => `${note}${glyphs[accidental]}`);
  if (source === "bb") return "\u{1D12B}";
  if (source === "x") return "\u{1D12A}";
  if (source === "b") return "\u266D";
  if (source === "#") return "\u266F";
  return source.replace(/(bb|b|#|x)(?=\d)|([A-Ga-g])(bb|b|#|x)/g,
    (_, intervalAccidental, note, accidental) => intervalAccidental
      ? glyphs[intervalAccidental] : `${note}${glyphs[accidental]}`);
}
