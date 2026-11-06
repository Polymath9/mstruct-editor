import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSpecialChordCsv } from "../src/core/chord-symbol.js";
import { parseMstruct } from "../src/core/mstruct.js";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { syntaxErrorMessage } from "../src/editor-i18n.js";
import {
  parseRomanConfigCsv,
  parseRomanSymbol,
  RomanSyntaxError,
  romanDisplayGlyphs,
} from "../src/core/roman-symbol.js";

const readConfig = (name) => readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8");
const [basicCsv, advancedCsv, figuredBassCsv, specialCsv, chordCsv] = await Promise.all([
  readConfig("roman-basic.csv"),
  readConfig("roman-advanced.csv"),
  readConfig("roman-figured-bass.csv"),
  readConfig("roman-special.csv"),
  readConfig("special-chords.csv"),
]);
const config = parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv });
const specialChords = parseSpecialChordCsv(chordCsv);
const parse = (source, tonalMode = "M", chainContext = null) => parseRomanSymbol(source, { config, tonalMode, chainContext });

test("altered tonics work in both modes and inherit tonic advanced admissions", () => {
  for (const mode of ["M", "m"]) for (const token of ["bI", "bi", "#I", "#i"]) {
    const result = parse(token, mode);
    assert.ok(result.structure, `${token}/${mode}`);
    const base = config.basics.get(token);
    assert.equal(base.tonalMode, "");
    assert.deepEqual(base.allowedAdvanced, config.basics.get(token.endsWith("i") ? "i" : "I").allowedAdvanced);
  }
});

test("Roman validation compares bass pitch classes and recognizes seventh figures", () => {
  const check = (body, center = "C") => {
    const result = parseMstruct(`{BN:1}{TS:1/4}{D:1/4}{TC:${center}}${body};`, { specialChords, romanConfig: config });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.warnings.filter(warning => warning.romanValidation);
  };
  assert.equal(check("C|I").length, 0);
  assert.equal(check("C/E|I6").length, 0);
  assert.equal(check("C/E|I")[0].romanCode, "bass-mismatch");
  assert.equal(check("G7|V")[0].romanCode, "seventh-figure-missing");
  assert.equal(check("G7/B|V65").length, 0);
  assert.equal(check("G/B|V65")[0].romanCode, "seventh-figure-unexpected");
  assert.equal(check("G|V7")[0].romanCode, "seventh-figure-unexpected");
  assert.equal(check("G/D|V43")[0].romanCode, "seventh-figure-unexpected");
  assert.equal(check("G/F|V42").length, 0);
  assert.equal(check("G/B|nVII[6,5-x]")[0].romanCode, "seventh-figure-unexpected");
  assert.equal(check("D|V7/V")[0].romanCode, "seventh-figure-unexpected");
  const annotationWarning = check("G/B|V6\\\\V65")[0];
  assert.equal(annotationWarning.romanCode, "seventh-figure-unexpected");
  assert.match(syntaxErrorMessage(annotationWarning, "zh"), /不含七音/);
  assert.match(syntaxErrorMessage(annotationWarning, "en"), /has no seventh/);
  assert.equal(check("Gadd7|V7").length, 0);
  assert.equal(check("G6|V").length, 0);
  assert.ok(check("C/B|I").some(warning => warning.romanCode === "seventh-figure-missing"));
  assert.equal(check("C/A|vi").length, 0);
  assert.equal(check("Cdim7|io", "c")[0].romanCode, "seventh-figure-missing");
  assert.equal(check("G7|V[7,5,3-x]").length, 0);
  assert.equal(check("G7/B|nVII[6,5-x]").length, 0);
  assert.equal(check("G7/D|ii[4,3-x]").length, 0);
  assert.equal(check("G7/F|IV[4,2-x]").length, 0);
  assert.equal(check("D7|V7/V").length, 0);
  assert.equal(check("C|I\\\\V")[0].romanCode, "bass-mismatch");
  assert.equal(check("C#|bII").length, 0);
  assert.equal(check("C|i", "c").length, 0);
  assert.equal(check("|V").length, 0);
  assert.equal(check("Cdim7|cto7").length, 0);
});

test("Renderer Test covers validation warnings, equivalent figures and a wide keyboard range", async () => {
  const source = await readFile(new URL("./fixtures/validation-transposition.mstruct", import.meta.url), "utf8");
  const result = parseMstruct(parseMstructDocument(source).main, { specialChords, romanConfig: config });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.warnings.some(warning => warning.code === "roman-bass-mismatch"));
  assert.ok(result.warnings.some(warning => warning.code === "roman-seventh-figure-missing"));
  assert.ok(result.warnings.some(warning => warning.code === "roman-seventh-figure-unexpected"));
});

test("parses the documented Roman structures and applied chords", () => {
  const cases = [
    ["biii64", ["b7", "b3", "b5"]],
    ["V7b5", ["5", "7", "b2", "4"]],
    ["VI7b5", ["6", "#1", "b3", "#5"]],
    ["V[8,5,4-]", ["5", "1", "2"]],
    ["viio42/V", ["b3", "#4", "6", "1"]],
    ["V7/V/V", ["6", "#1", "3", "5"]],
    ["iiho7/iv", ["5", "b7", "b2", "4"]],
    ["V[b9,b6,4,2-]", ["5", "6", "1", "b3", "b6"]],
  ];
  for (const [source, expected] of cases) assert.deepEqual(parse(source).structure.values, expected, source);
});

test("general figures use explicit intervals in either mode and in continuation lists", () => {
  for (const mode of ["M", "m"]) {
    for (const source of ["V[6,4-]", "V[6,4-x]", "V[n6,4-x]", "V[6,n4-x]", "V[8,6,4-x]"]) {
      assert.deepEqual(parse(source, mode).structure.values, ["5", "1", "3"], `${mode}: ${source}`);
    }
    for (const source of ["V[b6,4-]", "V[b6,4-x]", "V[8,b6,4-x]"]) {
      assert.deepEqual(parse(source, mode).structure.values, ["5", "1", "b3"], `${mode}: ${source}`);
    }
    const context = { rootDegree: "5", figureCount: 2, applied: [] };
    assert.deepEqual(parse("[6,4]", mode, context).structure.values, ["5", "1", "3"]);
    assert.deepEqual(parse("[b6,4]", mode, context).structure.values, ["5", "1", "b3"]);
    assert.deepEqual(parse("I[6,4-x]", mode).structure.values, ["1", "4", "6"]);
    assert.throws(() => parse("Cad[6,4-x]", mode), RomanSyntaxError);
  }
});

test("uses whole-token special Romans and publishes chord note-name spelling modes", () => {
  const cases = [
    ["Ger+6", ["b6", "1", "b3", "#4"], "aug6"],
    ["Gero3", ["#4", "b6", "1", "b3"], "aug6dim3"],
    ["Fr+6", ["b6", "1", "2", "#4"], "aug6"],
    ["It+6", ["b6", "1", "#4"], "aug6"],
    ["Tr+6", ["b6", "7", "2", "#4"], "aug6"],
    ["Blk+6", ["b6", "b7", "2", "#4"], "aug6"],
    ["viio65", ["2", "4", "b6", "7"], ""],
    ["viioM7", ["7", "2", "4", "#6"], ""],
    ["viiho42", ["6", "7", "2", "4"], ""],
    ["ct+6", ["1", "#2", "#4", "b6"], ""],
  ];
  for (const [source, structure, noteNameSpecial] of cases) {
    const result = parse(source);
    assert.deepEqual(result.structure.values, structure, source);
    assert.equal(result.noteNameSpecial, noteNameSpecial, source);
  }
});

test("keeps cto7 notation while withholding its overly narrow Roman structure", () => {
  const result = parse("cto7/V");
  assert.equal(result.structure, null);
  assert.equal(result.baseText, "CT");
  assert.equal(result.superscriptText, "o");
  assert.deepEqual([result.figure.upper, result.figure.lower], ["7", ""]);
  assert.deepEqual(result.applied.map((entry) => entry.roman), ["V"]);
  for (const removed of ["cto65", "cto43", "cto42"]) {
    assert.throws(() => parse(removed), RomanSyntaxError, removed);
  }
});

test("enforces tonal restrictions, advanced seventh requirements, sus figures, and 7b5 quality", () => {
  assert.deepEqual(parse("nIII", "m").structure.values, ["3", "#5", "7"]);
  assert.throws(() => parse("nIII", "M"), (error) => error.code === "tonal-mode");
  assert.throws(() => parse("III", "m"), (error) => error.code === "tonal-mode");

  assert.deepEqual(parse("iM7").structure.values, ["1", "b3", "5", "7"]);
  assert.deepEqual(parse("ioM7").structure.values, ["1", "b3", "b5", "7"]);
  assert.equal(parse("io7").superscriptText, "o");
  assert.equal(parse("iho7").superscriptText, "ø");
  assert.throws(() => parse("iM"), (error) => error.code === "seventh-required");
  assert.throws(() => parse("ioM"), (error) => error.code === "seventh-required");

  const basicSus = parse("Isus");
  assert.deepEqual(basicSus.structure.values, ["1", "5"]);
  assert.deepEqual([basicSus.figure.upper, basicSus.figure.lower], ["sus", ""]);

  const suspendedSevenths = [
    ["I7sus", ["1", "5", "7"], ["7sus", ""]],
    ["V7sus", ["5", "2", "4"], ["7sus", ""]],
    ["I+sus", ["1", "#5"], ["sus", ""]],
    ["I+7sus", ["1", "5", "7"], ["7sus", ""]],
    ["IDM7sus", ["1", "5", "b7"], ["7sus", ""]],
    ["IDM7b5sus", ["1", "b5", "b7"], ["7sus", "b5"]],
  ];
  for (const [source, structure, figure] of suspendedSevenths) {
    const result = parse(source);
    assert.deepEqual(result.structure.values, structure, source);
    assert.deepEqual([result.figure.upper, result.figure.lower], figure, source);
  }

  for (const source of ["isus", "i7sus", "i7b5sus", "iM7sus", "iM7b5sus"]) {
    assert.throws(() => parse(source), (error) => error.code === "figured-sus-quality", source);
  }
  for (const source of ["io7sus", "iho7sus", "ioM7sus", "io7b5sus"]) {
    assert.throws(() => parse(source), (error) => error.code === "figured-not-allowed", source);
  }
  assert.throws(() => parse("I+7b5sus"), (error) => error.code === "figured-not-allowed");
  assert.throws(() => parse("IDMsus"), (error) => error.code === "seventh-required");

  const specialSusConfig = parseRomanConfigCsv({
    basicCsv,
    advancedCsv,
    figuredBassCsv,
    specialCsv: specialCsv.replace('"7,65,43,42,7b5,[]"', '"7,65,43,42,7b5,sus,[]"'),
  });
  assert.throws(
    () => parseRomanSymbol("VSsus", { config: specialSusConfig, tonalMode: "M" }),
    (error) => error.code === "figured-sus-quality",
  );

  assert.deepEqual(parse("IDM7b5").structure.values, ["1", "3", "b5", "b7"]);
  assert.throws(() => parse("i7b5"), (error) => error.code === "figured-flat-five-quality");
  assert.throws(() => parse("bvii+"), (error) => error.code === "advanced-third-quality");
});

test("ordinary Roman recommendations do not restrict third-compatible advanced qualities", () => {
  const compatible = { M: ["+", "DM", "M"], D: ["+", "DM", "M"], m: ["o", "ho", "oM", "M"] };
  for (const basic of config.basics.values()) for (const advanced of config.advanced.values()) {
    if (!advanced.token) continue;
    const source = basic.roman + advanced.token + (advanced.requiresSeventh ? "7" : "");
    const mode = basic.tonalMode || "M";
    if (!compatible[basic.quality].includes(advanced.token)) {
      assert.throws(() => parse(source, mode), error => error.code === "advanced-third-quality", source);
      continue;
    }
    if (advanced.token === "M" && basic.quality === "M") {
      assert.throws(() => parse(source, mode), error => error.code === "advanced-redundant-major-seventh", source);
      continue;
    }
    const result = parse(source, mode);
    const expected = basic.allowedAdvanced.includes(advanced.token) ? 0 : 1;
    assert.equal(result.warnings.length, expected, source);
    if (expected) {
      assert.deepEqual(result.warnings[0].details, { token: advanced.token, base: basic.roman });
      assert.equal(result.warnings[0].severity, "warning");
      assert.equal(source.slice(result.warnings[0].start, result.warnings[0].end), basic.roman + advanced.token);
    }
  }
  assert.deepEqual(parse("biiio7").structure.values, ["b3", "b5", "bb7", "bb2"]);
  assert.deepEqual(parse("biiiho7").structure.values, ["b3", "b5", "bb7", "b2"]);
  assert.deepEqual(parse("biiio7/ii").structure.values, ["4", "b6", "b1", "bb3"]);
  const overridden = structuredClone(config);
  overridden.basics.get("I").allowedAdvanced.push("o");
  assert.throws(() => parseRomanSymbol("Io7", { config: overridden }), error => error.code === "advanced-third-quality");
});

test("uppercase Romans except V reject redundant M sevenths and inversions even when recommended", () => {
  for (const basic of config.basics.values()) {
    if (basic.quality !== "M") continue;
    const mode = basic.tonalMode || "M";
    for (const figure of ["7", "65", "43", "42"]) {
      for (const applied of ["", "/ii"]) {
        const source = `${basic.roman}M${figure}${applied}`;
        assert.throws(() => parse(source, mode), error => {
          assert.equal(error.code, "advanced-redundant-major-seventh", source);
          assert.equal(source.slice(error.start, error.end), "M", source);
          return true;
        });
        assert.ok(parse(`${basic.roman}${figure}${applied}`, mode).structure, source);
      }
    }
  }
  for (const base of ["VM", "iM", "ivM", "ioM"]) for (const figure of ["7", "65", "43", "42"]) {
    assert.ok(parse(base + figure).structure, base + figure);
    assert.ok(parse(base + figure + "/ii").structure, base + figure);
  }
  assert.ok(parse("viioM7").structure);
  const overridden = structuredClone(config);
  overridden.basics.get("I").allowedAdvanced.push("M");
  assert.throws(() => parseRomanSymbol("IM7", { config: overridden }), error => error.code === "advanced-redundant-major-seventh");
});

test("redundant M is a hard MAIN error in ordinary, annotated and dual-Roman fields", () => {
  for (const field of ["C|IM7", "C|I\\\\IVM65", "C|IM43\\\\I", "{M:d|ii}C|I&IVM42{/M}"]) {
    const source = `{BN:1}{TS:adlib}{D:1}{TC:C}${field};`;
    const result = parseMstruct(source, { specialChords, romanConfig: config });
    assert.equal(result.ok, false, source);
    const error = result.errors.find(item => item.code === "roman-advanced-redundant-major-seventh");
    assert.ok(error, JSON.stringify(result.errors));
    assert.equal(source.slice(error.start, error.end), "M");
    assert.match(syntaxErrorMessage(error, "zh"), /重复标记/);
    assert.match(syntaxErrorMessage(error, "en"), /redundant M/);
    assert.equal(result.warnings.some(item => item.code === "roman-advanced-not-recommended"), false);
    assert.deepEqual(result.playbackRoute, []);
  }
});

test("Renderer Test retains plain major sevenths and meaningful M sevenths in all inversions", async () => {
  const source = await readFile(new URL("./fixtures/renderer-major-sevenths.mstruct", import.meta.url), "utf8");
  const result = parseMstruct(source, { romanConfig: config });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.playbackRoute.length, 16);
});

test("Roman warnings keep exact ranges in ordinary, annotated and dual-Roman events", () => {
  const cases = [
    "{BN:1}{TS:adlib}{D:1}{TC:C}Ebdim7|biiio7,Dm|ii;",
    "{BN:1}{TS:adlib}{D:1}{TC:C}C|biiio7\\\\biiiho7;",
    "{BN:1}{TS:adlib}{D:1}{TC:C}{M:d|ii}C|IV+\\\\bII+&IV+\\\\bII+{/M};",
  ];
  for (const [index, source] of cases.entries()) {
    const result = parseMstruct(source, { specialChords, romanConfig: config });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
    const recommendations = result.warnings.filter(warning => !warning.romanValidation);
    assert.equal(recommendations.length, [1, 2, 4][index]);
    assert.ok(result.playbackRoute.length > 0);
    for (const warning of recommendations) {
      assert.equal(warning.severity, "warning");
      assert.equal(source.slice(warning.start, warning.end), warning.details.base + warning.details.token);
      assert.equal(warning.line, 1);
    }
  }
  const invalid = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}C|biiiho6;", { specialChords, romanConfig: config });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.warnings, []);
});

test("validates editable Roman CSV tables as one cross-referenced configuration", () => {
  assert.equal(config.basics.size, 34);
  assert.equal(config.advanced.size, 7);
  assert.equal(config.figuredBass.size, 10);
  assert.equal(config.specials.size, 22);
  assert.equal(config.specials.get("cto7").structure, null);
  assert.throws(() => parseRomanConfigCsv({
    basicCsv: basicCsv.replace('"+,DM"', '"+,missing"'),
    advancedCsv,
    figuredBassCsv,
    specialCsv,
  }), /unknown advanced quality/);
  assert.throws(() => parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv: specialCsv.replace(",aug6\n", ",unknown\n") }), /note-name special/);
});

test("general figured bass chains retain the first root, permit documented interruptions, and terminate", () => {
  const source = [
    "{BN:1}{TS:4/4}{D:1/4}{TC:C}",
    "C|I[5,3-],Csus4|,-,C|[5,4];",
  ].join("");
  const result = parseMstruct(source, { specialChords, romanConfig: config });
  assert.equal(result.ok, true, result.errors.map((error) => `${error.code}: ${error.message}`).join("\n"));
  const events = result.measures[0].slots.flatMap((slot) => slot.events);
  assert.deepEqual(events.filter((event) => event.romanResult).map((event) => event.romanResult.structure.values), [
    ["1", "3", "5"],
    ["1", "4", "5"],
  ]);
  assert.equal(events[0].romanFigureChain.link, "continue");
  assert.equal(events[3].romanFigureChain.link, "end");
  assert.equal(events[1].roman, null);
  assert.equal(events[2].symbolType, "continuation");
});

test("Roman field - continues figured bass while Roman field X interrupts it", () => {
  const continued = parseMstruct("{BN:1}{TS:3/4}{D:1/4}{TC:C}C|I[5,3-],C|-,C|[5,4];", { specialChords, romanConfig: config });
  assert.equal(continued.ok, true, continued.errors.map((error) => error.message).join("\n"));
  assert.equal(continued.measures[0].slots[1].events[0].romanSymbolType, "continuation");
  assert.equal(continued.measures[0].slots[2].events[0].romanFigureChain.index, 1);

  const interrupted = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{TC:C}C|I[5,3-],C|X;", { specialChords, romanConfig: config });
  assert.equal(interrupted.ok, false);
  assert.ok(interrupted.errors.some((error) => error.romanCode === "figured-chain-interruption"));
});

test("general figured bass validates order, count, applied target, interruption, and -x breaking", () => {
  const chainContext = { rootDegree: "5", figureCount: 3, applied: ["V"] };
  assert.deepEqual(parse("[7,5,3]/V", "M", chainContext).structure.values, ["2", "#4", "6", "#1"]);
  assert.throws(() => parse("[7,5]/V", "M", chainContext), (error) => error.code === "figured-chain-count");
  assert.throws(() => parse("[7,5,3]", "M", chainContext), (error) => error.code === "figured-chain-applied");
  assert.throws(() => parse("I[3,5-]"), (error) => error.code === "figured-order");
  assert.throws(() => parse("I[5,3]"), (error) => error.code === "figured-chain-required");

  const broken = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{TC:C}C|I[5,3-x];", { specialChords, romanConfig: config });
  assert.equal(broken.ok, true, broken.errors.map((error) => error.message).join("\n"));
  assert.equal(broken.measures[0].slots[0].events[0].romanFigureChain.link, "break");

  const interrupted = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{TC:C}C|I[5,3-],C|V;", { specialChords, romanConfig: config });
  assert.equal(interrupted.ok, false);
  assert.ok(interrupted.errors.some((error) => error.romanCode === "figured-chain-interruption"));
});

test("general figured bass renders repeated figures while deduplicating the Roman structure", () => {
  const repeated = parse("I[8,6,6-]");
  assert.deepEqual(repeated.generalFigure.figures.map((figure) => figure.text), ["8", "6", "6"]);
  assert.deepEqual(repeated.structure.values, ["1", "6"]);

  const repeatedWithAccidentals = parse("V[n6,6,6-]");
  assert.deepEqual(repeatedWithAccidentals.generalFigure.figures.map((figure) => figure.text), ["n6", "6", "6"]);
  assert.deepEqual(repeatedWithAccidentals.structure.values, ["5", "3"]);
});

test("mstruct attaches a Roman spelling mode to the chord in the same event", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{TC:C}D7|Ger+6;", { specialChords, romanConfig: config });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const event = result.measures[0].slots[0].events[0];
  assert.equal(event.chordNoteNameSpecial, "aug6");
  assert.deepEqual(event.chordResult.structure.toNoteNames([event.chordNoteNameSpecial]), ["D", "F#", "A", "B#"]);
});

test("Roman errors expose precise ranges", () => {
  assert.equal(romanDisplayGlyphs("nVI[n6,4-]"), "♮VI[♮6,4-]");
  assert.throws(() => parse("V[6,8,6-]"), (error) => {
    assert.ok(error instanceof RomanSyntaxError);
    assert.equal(error.code, "figured-order");
    assert.equal("V[6,8,6-]".slice(error.start, error.end), "8");
    return true;
  });
});
