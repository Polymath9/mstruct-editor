import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ChordSyntaxError,
  IntervalStructure,
  parseChordSymbol,
  parseSpecialChordCsv,
  renderChordParts,
  toMusicGlyphs,
} from "../src/core/chord-symbol.js";
import { normalizeChordQualityPreferences } from "../src/core/chord-quality-display.js";
import { chordNotesForStaff } from "../src/core/chord-staff.js";

const csv = await readFile(new URL("../src/config/special-chords.csv", import.meta.url), "utf8");
const specialChords = parseSpecialChordCsv(csv);
const parse = (source) => parseChordSymbol(source, { specialChords });

test("polychord lower size comes from the supplied rule settings", () => {
  for (const maximum of [3, 4]) {
    const options = { specialChords, globalSettings: { polychordLowerMaxNotes: maximum } };
    assert.equal(parseChordSymbol("CM7onDm", options).structure.polychordLowerNoteCount, 3);
    if (maximum === 4) assert.equal(parseChordSymbol("CM7onDm7", options).structure.polychordLowerNoteCount, 4);
    else assert.throws(() => parseChordSymbol("CM7onDm7", options), error => error.code === "polychord-note-count" && error.details.maximum === 3);
  }
});

test("polychords accept three or four lower notes and anchor above the actual lower structure", () => {
  for (const [source, count, midi] of [
    ["CM7onDm", 3, [50,53,57,60,64,67,71]],
    ["CM7onDm7", 4, [38,41,45,48,60,64,67,71]],
    ["C/GonF7/A", 4, [33,41,48,51,55,60,64]],
    ["C/EonF7", 4, [41,45,48,51,52,60,67]],
    ["ConF/G", 4, [31,41,45,48,60,64,67]],
  ]) {
    const structure = parse(source).structure;
    assert.equal(structure.polychordLowerNoteCount, count, source);
    assert.deepEqual(structure.toMidiNotes(), midi, source);
    assert.deepEqual(structure.clone().toMidiNotes(), midi, source);
    assert.equal(chordNotesForStaff(structure.toNoteNames(), midi).length, midi.length);
  }
  for (const source of ["ConC5", "ConC9", "ConC7/F#"]) {
    assert.throws(() => parse(source), error => error.code === "polychord-note-count", source);
  }
});

test("piano voicing shifts the entire polychord by octaves or reports an unfit range", () => {
  const structure = parse("G/BbonB[nf:(0,1,2,35)]").structure;
  const raw = structure.toMidiNotes();
  const voicing = structure.toPianoVoicing();
  assert.deepEqual(raw, [-1,0,1,34,46,55,59,62]);
  assert.deepEqual(voicing, { midiNotes: raw.map(note => note + 24), octaveShift: 2, rangeError: false });
  assert.equal(chordNotesForStaff(structure.toNoteNames(), voicing.midiNotes).length, raw.length);
  assert.deepEqual(parse("CM7onDm7").structure.toPianoVoicing().midiNotes, parse("CM7onDm7").structure.toMidiNotes());
  const high = new IntervalStructure(["1","36"], "C").toPolychord(new IntervalStructure(["1","3","5","b7"], "C"));
  assert.equal(high.toPianoVoicing().octaveShift, -1);
  assert.ok(high.toPianoVoicing().midiNotes.every(note => note >= 21 && note <= 108));
  const wide = new IntervalStructure(["1","57"], "C").toPolychord(new IntervalStructure(["1","3","5","b7"], "C"));
  assert.deepEqual(wide.toPianoVoicing(), { midiNotes: [], octaveShift: 0, rangeError: true });
  assert.equal(wide.toNoteNames().length, 6);
});

test("quality display preferences normalize old, missing and unsupported values to the current defaults", () => {
  const defaults = { diminishedDisplay: "dim", augmentedDisplay: "aug", majorSeventhDisplay: "M", minorDisplay: "m" };
  assert.deepEqual(normalizeChordQualityPreferences(null), defaults);
  assert.deepEqual(normalizeChordQualityPreferences({ diminishedDisplay: "invalid", augmentedDisplay: 3, majorSeventhDisplay: "△", minorDisplay: false }), defaults);
});

test("basic quality display aliases affect compiled roles and diminished o is always a Roman-style superscript", () => {
  const preferences = { diminishedDisplay: "o", augmentedDisplay: "+", minorDisplay: "mi" };
  for (const mode of ["normal", "camel", "superscript"]) {
    const diminished = renderChordParts(parse("Cdim7"), mode, preferences).find((part) => part.role === "basic-quality");
    assert.equal(diminished.text, "o");
    assert.equal(diminished.superscript, true);
    assert.equal(diminished.superscriptStyle, "roman");
    assert.equal(renderChordParts(parse("Caug"), mode, preferences).find((part) => part.role === "basic-quality").text, "+");
    assert.equal(renderChordParts(parse("Cm"), mode, preferences).find((part) => part.role === "basic-quality").text, "mi");
  }
});

test("major-seventh variants preserve each requested baseline and superscript rule on every supporting chord quality", () => {
  for (const source of ["CM7", "CM9", "CM11", "CM13", "CmM7", "CaugM7", "CdimM7"]) {
    const result = parse(source);
    for (const value of ["M", "ma", "maj", "triangle"]) {
      for (const mode of ["normal", "camel", "superscript"]) {
        const part = renderChordParts(result, mode, { majorSeventhDisplay: value }).find((item) => item.role === "tension" && item.start === result.segments.find((item) => item.text === "M").start);
        assert.equal(part.text, value === "triangle" ? "△" : value);
        assert.equal(part.superscript, mode === "superscript" || (mode === "camel" && ["M", "triangle"].includes(value)), `${source}/${value}/${mode}`);
      }
    }
  }
  assert.equal(renderChordParts(parse("C"), "normal", { majorSeventhDisplay: "maj" }).map((part) => part.text).join(""), "C");
});

test("quality display preserves source, intervals, search and slash/on notes and does not enable input aliases", () => {
  const preferences = { diminishedDisplay: "o", augmentedDisplay: "+", majorSeventhDisplay: "maj", minorDisplay: "mi" };
  const result = parse("CmM7/GonFaug/A");
  const snapshot = JSON.stringify(result);
  assert.equal(renderChordParts(result, "camel", preferences).map((part) => part.text).join(""), "Cmimaj7/GonF+/A");
  assert.equal(JSON.stringify(result), snapshot);
  for (const source of ["Co", "C+", "Cmaj7", "Cmi7"]) assert.throws(() => parse(source), ChordSyntaxError);
});

const cases = [
  ["Eb", ["1", "3", "5"], "Eb", ["Eb", "G", "Bb"], [63, 67, 70]],
  ["Dbb6", ["1", "3", "5", "6"], "Dbb", ["Dbb", "Fb", "Abb", "Bbb"], [60, 64, 67, 69]],
  ["Dbb(b6/b9)", ["1", "3", "5", "b6", "b9"], "Dbb", ["Dbb", "Fb", "Abb", "Ab", "Db"], [60, 64, 67, 68, 73]],
  ["Fx11#5sus", ["1", "#5", "b7", "9", "11"], "Fx", ["Fx", "D#", "E#", "Gx", "B#"], [55, 63, 65, 69, 72]],
  ["C7#5#9", ["1", "3", "#5", "b7", "#9"], "C", ["C", "E", "G#", "Bb", "Eb"], [60, 64, 68, 70, 75]],
  ["B11b5#9no3", ["1", "b5", "b7", "#9", "11"], "B", ["B", "F", "A", "D", "E"], [59, 65, 69, 74, 76]],
  ["A[q4:(4,b7)]", ["1", "4", "b7"], "A", ["A", "D", "G"], [57, 62, 67]],
  ["Dbsus(2,4)", ["1", "2", "4", "5"], "Db", ["Db", "Eb", "Gb", "Ab"], [61, 63, 66, 68]],
  ["Eb13b9#11", ["1", "3", "5", "b7", "b9", "#11", "13"], "Eb", ["Eb", "G", "Bb", "Db", "Fb", "A", "C"], [63, 67, 70, 73, 76, 81, 84]],
  ["Dm11b5#5", ["1", "b3", "b5", "#5", "b7", "9", "11"], "D", ["D", "F", "Ab", "A#", "C", "E", "G"], [62, 65, 68, 70, 72, 76, 79]],
  ["C7addb13", ["1", "3", "5", "b7", "b13"], "C", ["C", "E", "G", "Bb", "Ab"], [60, 64, 67, 70, 80]],
  ["A7b9/C#", ["1", "b6", "b10", "b12", "bb14"], "C#", ["C#", "A", "E", "G", "Bb"], [49, 57, 64, 67, 70]],
  ["Baug/F", ["1", "#4", "#6", "x8"], "F", ["F", "B", "D#", "Fx"], [53, 59, 63, 67]],
  ["Cadd(9,#9)onF", ["1", "3", "5", "12", "14", "16", "20", "#20"], "F", ["F", "A", "C", "C", "E", "G", "D", "Eb"], [41, 45, 48, 60, 64, 67, 74, 75]],
  ["G6/9add#15/C", ["1", "5", "7", "9", "10", "13", "#19"], "C", ["C", "G", "B", "D", "E", "A", "G#"], [48, 55, 59, 62, 64, 69, 80]],
  ["Edim7addb8onE", ["1", "3", "5", "8", "b10", "b12", "bb14", "b15"], "E", ["E", "G#", "B", "E", "G", "Bb", "Db", "Eb"], [52, 56, 59, 64, 67, 70, 73, 75]],
  ["Eb/EonDm/A", ["1", "4", "b6", "12", "b19", "b21", "b23"], "A", ["A", "D", "F", "E", "Eb", "G", "Bb"], [33, 38, 41, 52, 63, 67, 70]],
  ["C7b5#9add2", ["1", "2", "3", "b5", "b7", "#9"], "C", ["C", "D", "E", "Gb", "Bb", "Eb"], [60, 62, 64, 66, 70, 75]],
  ["C[nf:(0,1,2,3,4,5)]", ["1", "#1", "2", "#2", "3", "4"], "C", ["C", "C#", "D", "D#", "E", "F"], [60, 61, 62, 63, 64, 65]],
];

test("parses documented chord symbols into interval, note-name, and MIDI outputs", () => {
  for (const [source, intervals, root, noteNames, midi] of cases) {
    const result = parse(source);
    assert.deepEqual(result.structure.values, intervals, source);
    assert.equal(result.structure.root, root, source);
    assert.deepEqual(result.structure.toNoteNames(["sharp9_as_flat10"]), noteNames, source);
    assert.deepEqual(result.structure.toMidiNotes(), midi, source);
  }
});

test("implements special qualities, slash chords, polychords, and spelling modes", () => {
  assert.deepEqual(parse("E[sp:sowhat]").structure.values, ["1", "4", "b7", "b10", "12"]);
  const slash = new IntervalStructure(["1", "3", "5"], "C").toSlashChord("F#").validate();
  assert.deepEqual(slash.values, ["1", "b5", "b7", "b9"]);
  const doubleSharp = new IntervalStructure(["1", "x8"], "F").validate();
  assert.deepEqual(doubleSharp.values, ["1", "x8"]);
  assert.deepEqual(doubleSharp.toNoteNames(), ["F", "Fx"]);
  assert.equal(toMusicGlyphs("x8"), "𝄪8");
  const upper = new IntervalStructure(["1", "b8", "b10", "b12"], "E", { isSlashChord: true });
  const lower = new IntervalStructure(["1", "4", "6"], "A");
  upper.toPolychord(lower).validate();
  assert.deepEqual(upper.values, ["1", "4", "6", "12", "b19", "b21", "b23"]);
  const rendered = parse("C13b9#11sus(2,4)add#15no5/GonDm/A");
  assert.ok(renderChordParts(rendered, "normal").every((part) => !part.superscript));
  assert.ok(renderChordParts(rendered, "camel").some((part) => part.role === "tension" && part.superscript));
  assert.ok(renderChordParts(rendered, "superscript").some((part) => part.role === "keyword" && part.superscript));
});

test("normalizes final chord structures to root-relative pitch-class sets", () => {
  const majorNinth = parse("CM9").structure;
  const addedSecond = parse("CM7add2").structure;
  const inverted = parse("CM9/E").structure;
  assert.deepEqual(majorNinth.toPitchClasses(), [0, 2, 4, 7, 11]);
  assert.equal(majorNinth.toPitchClassMask(), addedSecond.toPitchClassMask());
  assert.equal(inverted.root, "E");
  assert.deepEqual(inverted.toPitchClasses(), [0, 3, 7, 8, 10]);
  assert.notEqual(inverted.toPitchClassMask(), majorNinth.toPitchClassMask());
});

test("validates editable special-chord CSV identity, uniqueness, and quoting", () => {
  const runtime = parseSpecialChordCsv('id,compiler_name,display_name,interval_structure\n2,quartal,quartal,"1 4 b7"\n');
  assert.deepEqual(parseChordSymbol("D[sp:quartal]", { specialChords: runtime }).structure.values, ["1", "4", "b7"]);
  assert.throws(() => parseSpecialChordCsv('id,compiler_name,display_name,interval_structure\n2,one,One,"1 3 5"\n2,two,Two,"1 4 5"\n'), /Duplicate special-chord ID/);
  assert.throws(() => parseSpecialChordCsv('id,compiler_name,display_name,interval_structure\n2,one,One,"1 3 5\n'), /quoting/);
});

test("render modes preserve source case and raise the complete Cadd2 suffix correctly", () => {
  const normal = renderChordParts(parse("Cadd2"), "normal");
  const camel = renderChordParts(parse("Cadd2"), "camel");
  const superscript = renderChordParts(parse("Cadd2"), "superscript");
  assert.deepEqual(normal.map(({ text, superscript: raised }) => [text, raised]), [["C", false], ["add", false], ["2", false]]);
  assert.deepEqual(camel.map(({ text, superscript: raised }) => [text, raised]), [["C", false], ["add", false], ["2", true]]);
  assert.deepEqual(superscript.map(({ text, superscript: raised }) => [text, raised]), [["C", false], ["add", true], ["2", true]]);
});

test("altered tensions accept formal lists while preserving the legacy rendered form", () => {
  const legacy = parse("C13b5b9#9");
  const formal = parse("C13(b5,b9,#9)");
  assert.deepEqual(formal.searchAtoms, legacy.searchAtoms);
  assert.deepEqual(formal.structure.items.map((item) => `${item.accidental}${item.degree}`), legacy.structure.items.map((item) => `${item.accidental}${item.degree}`));
  assert.equal(renderChordParts(formal, "normal").map((part) => part.text).join(""), "C13b5b9#9");
});

test("7alt is an indivisible post-root quality with only an optional slash bass", () => {
  const plain = parse("C7alt");
  const slash = parse("F#7alt/C");
  assert.deepEqual(plain.structure.values, ["1", "3", "b7"]);
  assert.equal(slash.structure.isSlashChord, true);
  assert.deepEqual(plain.segments.map(({ text, role }) => [text, role]), [
    ["C", "root"],
    ["7", "tension"],
    ["alt", "keyword"],
  ]);
  assert.deepEqual(renderChordParts(plain, "camel").map(({ text, superscript }) => [text, superscript]), [
    ["C", false],
    ["7", true],
    ["alt", false],
  ]);
  assert.deepEqual(renderChordParts(plain, "superscript").map(({ text, superscript }) => [text, superscript]), [
    ["C", false],
    ["7", true],
    ["alt", true],
  ]);
  for (const source of ["C7altadd9", "C7altonF", "EonC7alt"]) {
    assert.throws(() => parse(source), ChordSyntaxError, source);
  }
});

test("root-only chords contain only the root and end after 1", () => {
  const result = parse("C1");
  assert.deepEqual(result.structure.values, ["1"]);
  assert.deepEqual(result.structure.toNoteNames(), ["C"]);
  assert.deepEqual(result.structure.toMidiNotes(), [60]);
  assert.deepEqual(result.searchAtoms, ["C", "1"]);
  assert.deepEqual(result.segments.map(({ text, role }) => [text, role]), [["C", "root"], ["1", "tension"]]);
  for (const mode of ["normal", "camel", "superscript"]) {
    assert.deepEqual(renderChordParts(result, mode).map(({ superscript }) => superscript), [false, mode !== "normal"]);
  }
  assert.deepEqual(parse("Bb1").structure.toNoteNames(), ["Bb"]);
  assert.deepEqual(parse("C11").structure.values, ["1", "3", "5", "b7", "9", "11"]);
  assert.deepEqual(parse("C13").structure.values, ["1", "3", "5", "b7", "9", "11", "13"]);
  assert.throws(() => parse("C0"), ChordSyntaxError);
  for (const source of ["C1/G", "C1add9", "C1onF", "C1M7", "C1sus4", "C1no3"]) {
    assert.throws(() => parse(source), (error) => error instanceof ChordSyntaxError && error.code === "terminal-suffix", source);
  }
});

test("power chords contain only root and fifth and end after 5", () => {
  const result = parse("C5");
  assert.deepEqual(result.structure.values, ["1", "5"]);
  assert.deepEqual(result.structure.toNoteNames(), ["C", "G"]);
  assert.deepEqual(result.structure.toMidiNotes(), [60, 67]);
  assert.deepEqual(result.searchAtoms, ["C", "5"]);
  assert.deepEqual(result.segments.map(({ text, role }) => [text, role]), [["C", "root"], ["5", "tension"]]);
  assert.deepEqual(renderChordParts(result, "normal").map(({ superscript }) => superscript), [false, false]);
  assert.deepEqual(renderChordParts(result, "camel").map(({ superscript }) => superscript), [false, true]);
  assert.deepEqual(renderChordParts(result, "superscript").map(({ superscript }) => superscript), [false, true]);
  assert.deepEqual(parse("Bb5").structure.toNoteNames(), ["Bb", "F"]);

  for (const source of ["C5/G", "C5add9", "C5onF", "C5M7", "C55"]) {
    assert.throws(() => parse(source), (error) => error instanceof ChordSyntaxError && error.code === "terminal-suffix", source);
  }
});

test("terminal tritones retain parentheses, spell a diminished fifth and reject suffixes", () => {
  const result = parse("C(b5)");
  assert.deepEqual(result.structure.values, ["1", "b5"]);
  assert.deepEqual(result.structure.toNoteNames(), ["C", "Gb"]);
  assert.deepEqual(result.structure.toMidiNotes(), [60, 66]);
  assert.deepEqual(result.searchAtoms, ["C", "(", "b5", ")"]);
  for (const mode of ["normal", "camel", "superscript"]) {
    const parts = renderChordParts(result, mode);
    assert.equal(parts.map(part => part.text).join(""), "C(b5)");
    assert.deepEqual(parts.map(part => part.superscript), [false, mode !== "normal"]);
  }
  assert.deepEqual(parse("F#(b5)").structure.toNoteNames(), ["F#", "C"]);
  assert.deepEqual(parse("Cb5").structure.toNoteNames(), ["Cb", "Gb"]);
  assert.deepEqual(parse("C7(b5)").structure.values, ["1", "3", "b5", "b7"]);
  for (const suffix of ["7", "add9", "/G", "onF", "M7", "sus4", "no3", "(b5)"]) {
    assert.throws(() => parse(`C(b5)${suffix}`), error => error instanceof ChordSyntaxError && error.code === "terminal-suffix");
  }
  for (const source of ["C(b5", "C(b5,b9)", "Cm(b5)"]) assert.throws(() => parse(source), ChordSyntaxError);
});

test("reports a precise source range for documented syntax failures", () => {
  const failures = [
    ["G7b9#5", "altered-order", "#5"],
    ["C7#5b13", "enharmonic-conflict", "b13"],
    ["Eb/EonDm/AonE", "polychord-nested", "on"],
    ["E/Db/D", "slash-nested", "/"],
    ["C7add9,11no3", "list-parentheses-required", "9,"],
    ["D11b11", "altered-manual", "b11"],
    ["GbdimM9#11", "enharmonic-conflict", "#11"],
    ["Caddx5", "interval-list-expected", "x"],
  ];
  for (const [source, code, token] of failures) {
    assert.throws(() => parse(source), (error) => {
      assert.ok(error instanceof ChordSyntaxError);
      assert.equal(error.code, code, source);
      assert.equal(source.slice(error.start, error.end), token, source);
      return true;
    });
  }
});

test("no removes only the exact naturally added interval", () => {
  assert.throws(() => parse("Cm7#9"), (error) => error.code === "enharmonic-conflict");
  assert.throws(() => parse("Cm7#9no3"), (error) => error.code === "removal-missing");
  assert.throws(() => parse("Bm11b5#9no3"), (error) => error.code === "removal-missing");
  assert.throws(() => parse("Cmnob3"), (error) => error.code === "removal-manual");
  assert.throws(() => parse("C7b5nob5"), (error) => error.code === "removal-manual");
  assert.throws(() => parse("Caddb3nob3"), (error) => error.code === "removal-manual");

  assert.deepEqual(parse("Cdimnob3").structure.values, ["1", "b5"]);
  assert.throws(() => parse("Cdimnob5"), (error) => error.code === "removal-manual");
  assert.deepEqual(parse("Cdim7no(b3,b5)").structure.values, ["1", "bb7"]);
  assert.deepEqual(parse("CdimM13no(b3,b5)").structure.values, ["1", "7", "9", "11", "13"]);
  assert.deepEqual(parse("Cno(3,5)").structure.values, ["1"]);
  assert.deepEqual(parse("Cdim7add3no(b3,b5)").structure.values, ["1", "3", "bb7"]);
  assert.throws(() => parse("Cdim7nob3,b5"), (error) => error.code === "list-parentheses-required");
  assert.throws(() => parse("Cdim7no(b5,b3)"), (error) => error.code === "interval-list-order");
});
