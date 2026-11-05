import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseChordSymbol, parseSpecialChordCsv, toMusicGlyphs } from "../src/core/chord-symbol.js";
import { parseRomanConfigCsv } from "../src/core/roman-symbol.js";
import { parseSemanticTagConfigCsv } from "../src/core/semantic-tags.js";
import { parseMstruct, formatAccidentals, tonalLabel } from "../src/core/mstruct.js";
import { parseTonalReference, tonalReferencePitchClass } from "../src/core/tonal-reference.js";
import { parseMstructSearchQuery } from "../src/core/mstruct-search-query.js";
import { projectMstructSearchEvents } from "../src/core/mstruct-search-events.js";
import { matchMstructSearchQuery } from "../src/core/mstruct-search-match.js";
import { layoutSystems } from "../src/core/engraving.js";
import { normalizeRendererPreferences } from "../src/core/renderer-preferences.js";
import { chordSymbolModel } from "../src/core/symbol-render-model.js";
import { displayChordParts, displayNoteName, noteDegree, projectChordDisplayFlow } from "../src/core/note-display.js";
import { TRANSPOSE_INTERVALS, normalizeTransposition, transposeNoteName, transposeMidiNotes, pianoKeyMidi, pianoKeyboardRange } from "../src/core/transposition.js";
import { chordNotesForStaff } from "../src/core/chord-staff.js";

const csv = (name) => readFile(new URL(`../src/config/${name}.csv`, import.meta.url), "utf8");
const [chords, basicCsv, advancedCsv, figuredBassCsv, specialCsv] = await Promise.all([
  csv("special-chords"), csv("roman-basic"), csv("roman-advanced"), csv("roman-figured-bass"), csv("roman-special"),
]);
const options = { specialChords: parseSpecialChordCsv(chords), romanConfig: parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv }) };
const [cadenceCsv, tonalCsv, sequenceCsv] = await Promise.all([csv("cadence-tags"), csv("tonal-tags"), csv("sequence-tags")]);
options.semanticTagConfig = parseSemanticTagConfigCsv({ cadenceCsv, tonalCsv, sequenceCsv }, options);
const prefs = { chordDegrees: true };

test("transposition preserves interval spelling, staff octaves and separate audio mapping", () => {
  const down = { transposeDirection: "down", transposeInterval: "m2" };
  assert.equal(transposeNoteName("C", down), "B");
  assert.deepEqual(transposeMidiNotes([60], down), [59]);
  assert.deepEqual(transposeMidiNotes([60], down, { audio: true }), [60]);
  assert.equal(pianoKeyMidi(59, down), 60);
  assert.equal(pianoKeyMidi(59, { ...down, pianoFollowsTranspose: true }), 59);
  assert.equal(transposeNoteName("C", { transposeInterval: "A1" }), "C#");
  assert.equal(transposeNoteName("C", { transposeInterval: "m2" }), "Db");
  assert.equal(transposeNoteName("C", { transposeInterval: "d2" }), "Dbb");
  assert.equal(transposeNoteName("Cx", { transposeInterval: "A1" }), "D#");
  assert.equal(transposeNoteName('"c"', down), '"b"');
  for (const transposeDirection of ["up", "down"]) for (const interval of TRANSPOSE_INTERVALS) {
    const settings = { transposeDirection, transposeInterval: interval.id };
    for (const note of ["C", "C#", "Dbb", "Ex", "Fb", "G", "A", "B#"]) {
      const pitch = tonalReferencePitchClass(note);
      const midi = transposeMidiNotes([60 + pitch], settings);
      const names = [transposeNoteName(note, settings)];
      assert.equal(chordNotesForStaff(names, midi)[0].midi, midi[0]);
    }
  }
  assert.deepEqual(normalizeTransposition({ transposeInterval: "bad" }), { transposeDirection: "up", transposeInterval: "none", pianoFollowsTranspose: false });
  assert.deepEqual(pianoKeyboardRange([8, 116, -3, 140]), { low: 0, high: 119 });
});
const flatten = (node) => typeof node === "string" ? node : node.children.map(flatten).join("");
const nodes = (node) => typeof node === "string" ? [] : [node, ...node.children.flatMap(nodes)];
const chord = (source, preferences, center, mode = "camel") => chordSymbolModel(parseChordSymbol(source, options), mode, preferences, center);
const events = (flow) => flow.filter((item) => item.kind === "measure").flatMap((item) => item.measure.slots.flatMap((slot) => slot.events));
function parse(source) {
  const result = parseMstruct(source, options);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
}

test("note display preferences default off and retain independent saved choices", () => {
  for (const key of ["accidentalBeforeNote", "chordDegrees", "minorTonicSix"]) {
    assert.equal(normalizeRendererPreferences(null)[key], false);
    assert.equal(normalizeRendererPreferences({ [key]: "true" })[key], false);
  }
  assert.equal(normalizeRendererPreferences({ accidentalBeforeNote: true, chordDegrees: true }).accidentalBeforeNote, true);
});

test("complete note names always preserve the first letter, including b, bb and bbb", () => {
  for (const letter of "ABCDEFGabcdefg") {
    for (const [suffix, mark] of [["", ""], ["b", "♭"], ["bb", "𝄫"], ["#", "♯"], ["x", "𝄪"]]) {
      const note = letter + suffix;
      const expected = letter + mark;
      assert.equal(displayNoteName(note), expected, note);
      assert.equal(displayNoteName(`"${note}"`), `"${expected}"`, note);
      assert.equal(displayNoteName(note, { accidentalBeforeNote: true }), mark + letter, note);
      assert.equal(formatAccidentals(note), expected, note);
      assert.equal(tonalLabel(note), `${expected}:`, note);
      assert.equal(parseTonalReference(note, { extendedAccidentals: true }).note, note);
    }
  }
  assert.deepEqual(["b", "bb", "bbb"].map(tonalReferencePitchClass), [11, 10, 9]);
  assert.equal(toMusicGlyphs("bbb"), "b𝄫");
  for (const [source, expected] of [["b", "♭"], ["bb", "𝄫"], ["bb7", "𝄫7"], ["b7", "♭7"], ["Bbb7", "B𝄫7"], ["C7add(bb9)/Bbb", "C7add(𝄫9)/B𝄫"]]) {
    assert.equal(toMusicGlyphs(source), expected, source);
  }
  assert.equal(flatten(chord("Bbb7/Bb", {})), "B𝄫7/B♭");
});

test("B minor and B flat minor keep distinct pitch, Roman, tag and search identities", () => {
  for (const [center, root, pitch] of [["b", "B", 11], ["bb", "Bb", 10]]) {
    const result = parse(`{BN:1}{TS:adlib}{D:1}{TC:${center}}${root}m|i;</Centricity:${center}><DTC:${center},C>${root}m|i;</Mode_Dorian:${center}>${root}m|i;`);
    assert.ok(events(result.flow).every(event => event.tonalCenter === center));
    assert.ok(events(result.flow).every(event => event.chordResult.structure.root === root));
    assert.equal(tonalReferencePitchClass(center), pitch);
    const projection = projectMstructSearchEvents(result);
    for (const source of [`{TC:${center}}*|i`, `<Centricity:${center}>*|i`, `<DTC:${center},C>*|i`, `<Mode_Dorian:${center}>*|i`]) {
      const query = parseMstructSearchQuery(source, options);
      assert.equal(query.ok, true, JSON.stringify(query.errors));
      assert.ok(matchMstructSearchQuery(query, projection).windows.length > 0, source);
    }
  }
  const doubleFlat = parse('{BN:1}{TS:adlib}{D:1}</Mode_Dorian:bbb>Bbb|;');
  assert.equal(events(doubleFlat.flow)[0].chordResult.structure.root, "Bbb");
});

test("prefix ordering covers every chord note segment without moving tensions or changing classes", () => {
  const source = "Dbm7/G#onF#/A#";
  for (const mode of ["normal", "camel", "superscript"]) {
    const original = chord(source, {}, null, mode);
    const before = chord(source, { accidentalBeforeNote: true }, null, mode);
    assert.equal(flatten(before), "♭Dm7/♯Gon♯F/♯A");
    assert.deepEqual(before.children.map((part) => `${part.tag}:${part.className}`).sort(), original.children.map((part) => `${part.tag}:${part.className}`).sort());
  }
  assert.equal(flatten(chord("C7add(#9,b13)", { accidentalBeforeNote: true })), "C7add(♯9,♭13)");
  assert.equal(flatten(chord("Cxm/Gbb", { accidentalBeforeNote: true })), "𝄪Cm/𝄫G");
  assert.equal(displayNoteName('"f#"', { accidentalBeforeNote: true }), '"♯f"');
});

test("degrees preserve letter spelling, slash/on notes, annotations' shared model and original structures", () => {
  assert.equal(flatten(chord("Cm7", prefs, "C")), "1m7");
  assert.equal(flatten(chord("Dbm7/G#onF#/A#", prefs, "C")), "♭2m7/♯5on♯4/♯6");
  assert.equal(flatten(chord("C#m7", prefs, '"C"')), "♯1m7");
  assert.equal(flatten(chord("Dbm7", prefs, "None")), "D♭m7");
  assert.equal(flatten(chord("Dbm7", { ...prefs, accidentalBeforeNote: true }, null)), "♭Dm7");
  assert.equal(noteDegree("Cx", "Cb").accidental, "♯♯♯");
  const result = parseChordSymbol("Dbm7/G#onF#/A#", options);
  const original = JSON.stringify(result);
  const parts = displayChordParts(result, "superscript", prefs, "C");
  assert.ok(parts.filter((part) => /^(root|bass)(-accidental)?$/.test(part.role)).every((part) => !part.superscript));
  assert.equal(JSON.stringify(result), original);
});

test("accidental position markers apply only to chord root and bass glyphs, including numeric notes", () => {
  for (const [preferences, center, position] of [[{}, null, "after"], [{ accidentalBeforeNote: true }, null, "before"], [prefs, "C", "before"]]) {
    const model = chord("Db7add#9/G#onF#/A#", preferences, center);
    const positioned = nodes(model).filter((node) => node.className.includes("score-chord-note-accidental-"));
    assert.equal(positioned.length, 4);
    assert.ok(positioned.every((node) => node.className === `score-chord-accidental score-chord-note-accidental-${position}`));
    const tension = model.children.find((part) => part.className.includes("score-chord-tension") && flatten(part).includes("♯9"));
    assert.ok(tension);
    assert.ok(nodes(tension).every((node) => !node.className.includes("score-chord-note-accidental-")));
  }
});

test("minor 1 uses major degrees and minor 6 uses the spelled relative major", () => {
  assert.equal(flatten(chord("Eb7", prefs, "c")), "♭37");
  const six = { ...prefs, minorTonicSix: true };
  for (const [source, center, expected] of [["Cm7", "c", "6m7"], ["Eb", '"c"', "1"], ["B", "a", "7"], ["G#", "a", "♯5"], ["F#", "f#", "6"], ["A", "f#", "1"], ["C", "C", "1"]]) {
    assert.equal(flatten(chord(source, six, center)), expected);
  }
});

test("display flow follows TC, quoted center, None, Centricity, M target immediately and MH without mutating AST", () => {
  const result = parse('{BN:1}{TS:adlib}{D:1}{TC:C}Dbm7\\\\Cm7/GonF#/A#|;{TC:"c"}Eb7|,Cm7|;{TC:None}Dbm7|;{TC:C}C|;{M:G|V}D7|II7&V7,G|V&I{/M};G|;{MH:d|v}Dm|i;Dm|;</Centricity:"f#">F#m7|;F#m7|;');
  const original = JSON.stringify(result);
  const shown = events(projectChordDisplayFlow(result.flow, prefs));
  assert.deepEqual(shown.map((event) => event.chordDisplayTonalCenter), ["C", '"c"', '"c"', null, "C", "G", "G", "G", "d", "d", '"f#"', '"f#"']);
  assert.deepEqual(shown.map((event) => event.chordDegreePrefix), ["C", '"c"', null, null, "C", "G", null, null, "d", null, '"f#"', null]);
  assert.equal(flatten(chordSymbolModel(shown[5].chordResult, "camel", prefs, shown[5].chordDisplayTonalCenter)), "57");
  assert.equal(flatten(chordSymbolModel(shown[0].chordAnnotationResult, "camel", prefs, "C")), "1m7/5on♯4/♯6");
  const systems = layoutSystems(result.flow, 360, { preferences: prefs });
  assert.ok(systems.length > 1);
  const first = systems[0].items.find((item) => item.kind === "measure").engraving.slots[0];
  assert.ok(first.leftOverflow >= 0);
  assert.equal(JSON.stringify(result), original);
});

test("repeated definitions reannounce a center and an intervening symbol never consumes the chord prefix", () => {
  const result = parse('{BN:1}{TS:adlib}{D:1}{TC:C}X,C|;{TC:C}C|;</Centricity:C>C|;C|;');
  const shown = events(projectChordDisplayFlow(result.flow, prefs));
  assert.deepEqual(shown.map((event) => event.chordDegreePrefix), [null, "C", "C", "C", null]);
});

test("M symbols and continuation across systems keep the target without repeating its prefix", () => {
  const result = parse('{BN:1}{TS:adlib}{D:1}{TC:C}{M:G|V}G|V&I,X,0,-,N.C.,Am|vi&ii{/M};G|;');
  const shown = events(projectChordDisplayFlow(result.flow, prefs));
  assert.ok(shown.every((event) => event.chordDisplayTonalCenter === "G"));
  assert.deepEqual(shown.map((event) => event.chordDegreePrefix), ["G", null, null, null, null, null, null]);
});
