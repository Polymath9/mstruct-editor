import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSpecialChordCsv } from "../src/core/chord-symbol.js";
import { EXAMPLE_SOURCE, equalRational, parseMstruct, rational } from "../src/core/mstruct.js";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { createMstructtimeLoopInstructions } from "../src/core/mstructtime-loop.js";
import { buildMstructtimeEventRows } from "../src/core/mstructtime-route.js";
import { parseRomanConfigCsv } from "../src/core/roman-symbol.js";
import { parseSemanticTagConfigCsv } from "../src/core/semantic-tags.js";
import { parseTagConfigCsv } from "../src/core/tag-config.js";
import { parseFormTagConfigCsv } from "../src/core/form-tag-config.js";
const formTagConfig = parseFormTagConfigCsv(await readFile(new URL("../src/config/form-tags.csv", import.meta.url), "utf8"));

const [specialChordCsv, romanBasicCsv, romanAdvancedCsv, romanFiguredBassCsv, romanSpecialCsv, tagCsv, cadenceTagCsv, tonalTagCsv, sequenceTagCsv, k545DocumentSource] = await Promise.all([
  readFile(new URL("../src/config/special-chords.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-basic.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-advanced.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-figured-bass.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-special.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/cadence-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/tonal-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/sequence-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../examples/k545.mstruct", import.meta.url), "utf8"),
]);
const specialChords = parseSpecialChordCsv(specialChordCsv);
const romanConfig = parseRomanConfigCsv({ basicCsv: romanBasicCsv, advancedCsv: romanAdvancedCsv, figuredBassCsv: romanFiguredBassCsv, specialCsv: romanSpecialCsv });
const tagConfig = parseTagConfigCsv(tagCsv);
const semanticTagConfig = parseSemanticTagConfigCsv({ cadenceCsv: cadenceTagCsv, tonalCsv: tonalTagCsv, sequenceCsv: sequenceTagCsv }, { romanConfig });

test("modal references preserve quoted centers, modulation and explicit None across state changes", () => {
  const source = [
    '{BN:1}{D:1/2}{TS:4/4}{TC:"C"}</Mode_Phrygian:E>FM7|IV,Em7|iii;',
    '{TC:"e"}</Mode_Phrygian:E>FM7|bII,Em7|i;',
    '{TC:C}<Mode_Dorian:d>F|IV,{TC:"C"}Em|iii;',
    '</Centricity:"g">Gm|i,</Mode_Dorian>Gm|i;',
    '{TC:"C"}{M:"d"|ii}FM7|IV&bIII,Dm|ii&i{/M};',
    '{MH:"A"|V}A|I,A|I;',
    '{TC:C}{M:"G"|V}G|V&I,Am|vi&ii{/M};',
    '{MH:D|V}D|I,D|I;',
    '{TC:"C"}<Centricity:"f#">F#m|i,</Centricity>F#m|i;',
    '{TC:None}</Mode_Phrygian:E>FM7|,Em7|;',
    '</Centricity:C>C|I,C|I;',
  ].join("\n");
  const parsed = parseMstruct(source, { specialChords, romanConfig, tagConfig, semanticTagConfig });
  assert.equal(parsed.ok, true, parsed.errors.map(error => error.code).join(","));
  assert.equal(parsed.measures[0].slots[0].events[0].tonalCenter, '"C"');
  assert.equal(parsed.measures[1].slots[0].events[0].tonalCenter, '"e"');
  assert.equal(parsed.measures[9].slots[0].events[0].tonalCenter, null);
  assert.equal(parsed.measures[10].slots[0].events[0].tonalCenter, "C");
});

test("quoted TC compiles Roman using its underlying mode and preserves annotations and figure chains", () => {
  const options = { specialChords, romanConfig, tagConfig, semanticTagConfig };
  const major = parseMstruct('{BN:1}{TS:adlib}{D:1}{TC:"C"}E|III\\\\iii;', options);
  assert.equal(major.ok, true, major.errors.map(error => error.code).join(","));
  assert.equal(major.measures[0].slots[0].events[0].tonalPrefix, '"C"');
  const minor = parseMstruct('{BN:1}{TS:adlib}{D:1/2}{TC:"c"}Cm|i[5,3-],Cm|[6,3];', options);
  assert.equal(minor.ok, true, minor.errors.map(error => error.code).join(","));
  assert.equal(minor.measures[0].slots[1].events[0].romanFigureChain.index, 1);
  assert.ok(parseMstruct('{BN:1}{TS:adlib}{D:1}{TC:"c"}E|III;', options).errors.some(error => error.code === "roman-tonal-mode"));
  for (const value of ['""', '"M"', '"m"', '"None"', '"C', 'C"', '"H"', '" C"']) {
    assert.ok(parseMstruct(`{BN:1}{TS:adlib}{D:1}{TC:${value}}C|;`, options).errors.some(error => error.code === "invalid-tonal-center"), value);
  }
});

test("M and MH preserve all four reference certainty combinations and enforce pitch and case", () => {
  const options = { specialChords, romanConfig, tagConfig, semanticTagConfig };
  for (const previous of ["C", '"C"']) for (const target of ["d", '"d"']) {
    const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1/2}{TC:${previous}}{M:${target}|ii}C|I&i,G|V&I{/M};{D:1}Dm|i;`, options);
    assert.equal(parsed.ok, true, parsed.errors.map(error => error.code).join(","));
    const first = parsed.measures[0].slots[0].events[0];
    assert.deepEqual(first.romanLayers.map(layer => layer.tonalCenter), [previous, target]);
    assert.equal(first.modulationStart.previousRelation, "I");
    assert.equal(parsed.measures[1].slots[0].events[0].tonalCenter, target);
    const hard = parseMstruct(`{BN:1}{TS:adlib}{D:1}{TC:${previous}}{MH:${target}|ii}Dm|i;Dm|i;`, options);
    assert.equal(hard.ok, true, hard.errors.map(error => error.code).join(","));
    assert.equal(hard.measures[1].slots[0].events[0].tonalCenter, target);
  }
  assert.ok(parseMstruct('{BN:1}{TS:adlib}{D:1}{TC:"C"}{MH:"E"|V}E|I;', options).errors.some(error => error.code === "modulation-pitch"));
  assert.ok(parseMstruct('{BN:1}{TS:adlib}{D:1}{TC:"C"}{MH:"d"|II}Dm|i;', options).errors.some(error => error.code === "modulation-mode-case"));
});

test("only forward-slash closers are accepted; fractions, slash harmony and annotations retain their meaning", () => {
  const options = { specialChords, romanConfig, tagConfig, semanticTagConfig, comments: [{ number: 1, texts: { en: "Comment" } }] };
  const sources = [
    "{BN:1}{D:1/4}{TS:4/4}{TC:C}{M:G|V}G|V&I,Am|vi&ii{/M},G|I,G|I;",
    "{BN:1}{TS:adlib}{D:1}{ENDING:1}C|{/ENDING:1}{:||};{ENDING:2}G|{/ENDING};",
    "{BN:1}{TS:adlib}{D:1}[COMMENT:1][C:C],[C:G][/COMMENT];",
    "{BN:1}{TS:adlib}{D:1}[/COMMENT:1]C|;",
    "{BN:1}{TS:adlib}{D:1}{TC:C}<Constant_Structure>CM7/E|V7/V,C7\\\\Edim/C|V7/V\\\\V7/IV<*/Constant_Structure></PAC>;",
  ];
  for (const source of sources) {
    const valid = parseMstruct(source, options);
    assert.equal(valid.ok, true, `${source}: ${valid.errors.map((error) => error.code).join(", ")}`);
    const legacy = source.replace(/([<{\[]\*?)\//g, "$1\\");
    assert.equal(parseMstruct(legacy, options).ok, false, legacy);
  }
});

test("K545 文档是独立编辑器的有效启动测试用例", () => {
  const documentResult = parseMstructDocument(k545DocumentSource);
  assert.equal(documentResult.ok, true, documentResult.errors.map((error) => error.message).join("\n"));

  const result = parseMstruct(documentResult.main, { specialChords, romanConfig, tagConfig, semanticTagConfig, formTagConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.ok(result.measures.length >= 13);
  const measure11 = result.measures.find((measure) => measure.barNumber === 11);
  assert.deepEqual(measure11?.slots[1].events[0].romanLayers.map((layer) => layer.roman), ["[6,4-]", "IV64"]);
  assert.deepEqual(measure11?.slots[0].events[0].romanLayers.map((layer) => [layer.romanResult.baseText, layer.romanFigureChain?.index]), [["V", 0], ["I", undefined]]);
  assert.deepEqual(measure11?.slots[1].events[0].romanLayers.map((layer) => [layer.romanResult.baseText, layer.romanFigureChain?.index]), [["", 1], ["IV", undefined]]);
});

test("NR 回归覆盖同小节、跨小节、延长符来源和强制跨 system", () => {
  const source = "{BN:1}{TS:2/4}{D:1/4}{TC:C}C|I,[NR:P]Cm|i;[NR:L]Em|iii,-;[NR:R]Am|vi,Dm|ii;F|IV,G|V;{LB}[NR:H]C|I,G|V;";
  const result = parseMstruct(source, { specialChords, romanConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const transformed = result.measures.flatMap((measure) => measure.slots.flatMap((slot) => slot.events)).filter((event) => event.newRiemannian);
  assert.deepEqual(transformed.map((event) => [event.newRiemannian.value, event.newRiemannian.sourceType]), [
    ["P", "chord"],
    ["L", "chord"],
    ["R", "continuation"],
    ["H", "chord"],
  ]);
  assert.equal(result.flow.filter((item) => item.kind === "lineBreak").length, 1);
});

test("任务 1 示例：解析为 C 大调的四拍和弦小节", () => {
  const result = parseMstruct(EXAMPLE_SOURCE);

  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.measures.length, 1);

  const [measure] = result.measures;
  assert.equal(measure.complete, true);
  assert.equal(measure.barNumber, 1);
  assert.ok(equalRational(measure.timeSignature, rational(1)), "4/4 应等于一个全音符长度");
  assert.ok(equalRational(measure.duration, rational(1)), "四个 1/4 应填满 4/4 小节");
  assert.equal(measure.tonalCenter, "C");
  assert.equal(measure.slots.length, 4);
  assert.deepEqual(
    measure.slots.map((slot) => slot.events[0]?.chord),
    ["C", "Fm", "G", "C"],
  );
  assert.deepEqual(
    measure.slots.map((slot) => slot.events[0]?.roman),
    ["I", "iv", "V", "I"],
  );
  assert.equal(measure.slots[1].annotations.time, "0:01");
  assert.equal(measure.slots[0].events[0].tonalPrefix, "C");
});

test("缺少乐曲起始 BN 或 D 时返回 Syntax Error", () => {
  const result = parseMstruct("{TS:4/4}{D:1/4}{TC:C}[R:I],[R:V],[R:I],[R:V];");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "missing-initial-bn"));

  const delayedDivision = parseMstruct("{BN:1}{TS:adlib}[C:C]{D:1/4},{D:1/4},{D:1/4},{D:1/4};");
  assert.equal(delayedDivision.ok, false);
  assert.ok(delayedDivision.errors.some((error) => error.code === "missing-initial-division"));
});

test("出现罗马数字却没有 TC 时返回 Syntax Error", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}[C:C|R:I],[C:G|R:V],[C:C|R:I],[C:G|R:V];");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "missing-tonal-center"));
});

test("TC:None is an explicit non-tonal state and a later concrete TC restores Roman support", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1/3}{TC:None}C|,D|,{TC:C}G|V;", { romanConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const events = result.measures[0].slots.map((slot) => slot.events[0]);
  assert.deepEqual(events.map((event) => event.tonalCenter), [null, null, "C"]);
  assert.deepEqual(events.map((event) => event.tonalCenterWasDefined), [true, true, true]);
  assert.equal(events[0].tonalPrefix, undefined);
  assert.equal(events[2].tonalPrefix, "C");
  assert.equal(parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:none}C|;").errors.some((error) => error.code === "invalid-tonal-center"), true);
});

test("TC:None rejects Roman content and both modulation forms with precise diagnostics", () => {
  const roman = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:None}C|I\\\\V;", { romanConfig });
  assert.ok(roman.errors.some((error) => error.code === "roman-in-tonal-center-none"));
  for (const type of ["M", "MH"]) {
    const modulation = parseMstruct(`{BN:1}{TS:adlib}{D:1}{TC:None}{${type}:C|I}X;`, { romanConfig });
    assert.ok(modulation.errors.some((error) => error.code === "modulation-in-tonal-center-none"), type);
  }
});

test("TC 可在较早位置定义，并标注其后的第一个罗马数字", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}{TC:c},[R:i],[R:iv],[R:V];");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.measures[0].slots[1].events[0].tonalPrefix, "c");
});

test("完整小节的时值与 TS 不一致时停止渲染", () => {
  const result = parseMstruct("{BN:1}{TS:3/4}{D:1/4}{TC:C}[R:I],[R:V],[R:I],[R:V];");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "meter-mismatch"));
});

test("开头 BN:0 的预备拍必须严格短于 TS，之后从第一小节恢复完整时值校验", () => {
  const valid = parseMstruct("{BN:0}{TS:4/4}{D:1/4}C|;C|,C|,C|,C|;");
  assert.equal(valid.ok, true, valid.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(valid.measures.map((measure) => measure.barNumber), [0, 1]);
  for (const pickup of ["C|,C|,C|,C|", "C|,C|,C|,C|,C|"]) {
    const result = parseMstruct(`{BN:0}{TS:4/4}{D:1/4}${pickup};C|,C|,C|,C|;`);
    assert.equal(result.ok, false);
    const error = result.errors.find((item) => item.code === "pickup-duration-not-shorter");
    assert.ok(error);
    assert.equal(error.details.expected, "1/1");
    assert.equal(error.start, 0);
    assert.equal(error.end, result.measures[0].end);
    assert.deepEqual(result.playbackRoute, []);
  }
  const invalid = parseMstruct("{BN:0}{TS:4/4}{D:1/4}C|;C|;");
  assert.ok(invalid.errors.some((error) => error.code === "meter-mismatch"));
  const latePickup = parseMstruct("{BN:1}{TS:adlib}{D:1}C|;{BN:0}C|;");
  assert.ok(latePickup.errors.some((error) => error.code === "bar-number-backward"));
});

test("开头必须显式定义数字 TS 或 adlib，不能延迟到后续 slot 或小节", () => {
  for (const bn of [0, 1]) {
    for (const tail of ["X;", "X;{TS:4/4}{D:1}X;", "X,{TS:4/4}X;"]) {
      const result = parseMstruct(`{BN:${bn}}{D:1/4}${tail}`);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.code === "missing-initial-time-signature"));
      assert.deepEqual(result.playbackRoute, []);
    }
  }
  for (const source of [
    "{BN:1}{D:1}{TS:4/4}X;",
    "{TS:adlib}{D:1}{BN:1}X,X;",
    "{BN:0}{TS:adlib}{D:1}X,X;X;{TS:3/4}{D:1/4}X,X,X;",
    "{BN:1}{TS:4/4}{D:1}X;...{BN:3}X;",
  ]) {
    const result = parseMstruct(source);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
});

test("预备拍按精确分数比较，控制标记不能绕过严格上限", () => {
  for (const control of ["", "{||}"]) {
    for (const [duration, valid] of [["5/8", true], ["3/4", false], ["7/8", false]]) {
      const result = parseMstruct(`{BN:0}{TS:6/8}{D:${duration}}X${control};{D:3/4}X;`);
      assert.equal(result.ok, valid, `${duration} ${control}`);
      if (!valid) assert.ok(result.errors.some((error) => error.code === "pickup-duration-not-shorter"));
    }
  }
  for (const [duration, valid] of [
    ["9007199254740989/9007199254740990", true],
    ["9007199254740990/9007199254740991", false],
    ["1", false],
  ]) {
    const result = parseMstruct(`{BN:0}{TS:9007199254740990/9007199254740991}{D:${duration}}X;`);
    assert.equal(result.ok, valid, JSON.stringify(result.errors));
    if (!valid) assert.ok(result.errors.some((error) => error.code === "pickup-duration-not-shorter"));
  }
  const repeated = parseMstruct("{BN:0}{TS:4/4}{D:1/4}X;X,X,X,X{:||};");
  assert.ok(repeated.errors.some((error) => error.code === "repeat-meter-mismatch"));
});

test("BN 可跳号但不可倒退，省略号后仍需单调递增", () => {
  const forward = parseMstruct("{BN:1}{TS:adlib}{D:1}C|;{BN:5}C|;...{BN:9}C|;");
  assert.equal(forward.ok, true, forward.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(forward.measures.map((measure) => measure.barNumber), [1, 5, 9]);
  const backward = parseMstruct("{BN:7}{TS:adlib}{D:1}C|;...{BN:6}C|;");
  assert.ok(backward.errors.some((error) => error.code === "bar-number-backward"));
});

test("终止小节线支持音乐与空槽延长，并保留实际路线和时值", () => {
  for (const body of ["C|,D|,E|,F|", "C|,,,", "0,,,", "C|,-,,"]) {
    const source = `{BN:1}{TS:4/4}{D:1/4}${body}`;
    const ordinary = parseMstruct(`${source};`);
    const result = parseMstruct(`${source}{||END} \n; \n`);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.measures[0].finalBar.kind, "final-bar");
    assert.deepEqual(result.measures[0].duration, ordinary.measures[0].duration);
    assert.deepEqual(result.playbackRoute.map(({ slot }) => slot.duration), ordinary.playbackRoute.map(({ slot }) => slot.duration));
    assert.deepEqual(createMstructtimeLoopInstructions(result), createMstructtimeLoopInstructions(ordinary));
  }
  const endings = "{BN:1}{TS:4/4}{D:1}{||:}C|;{ENDING:1}G|{/ENDING:1}{:||};{ENDING:2}C|{/ENDING}";
  const result = parseMstruct(`${endings}{||END};`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.playbackRoute.map(({ slot }) => slot.events[0].chord), ["C", "G", "C", "C"]);
});

test("终止小节线严格限定结束位置、后续内容和小节拍数", () => {
  const prefix = "{BN:1}{TS:4/4}{D:1}";
  const cases = [
    ["{||END};", "final-bar-position"],
    ["C|{||END}", "final-bar-position"],
    ["C|{||END},C|;", "final-bar-position"],
    ["C|{||END}{LB};", "final-bar-position"],
    ["C|{:||}{||END};", "final-bar-conflict"],
    ["C|{||END};D|;", "final-bar-content"],
    ["C|{||END};...", "final-bar-content"],
    ["C|{||END};{LB}", "final-bar-content"],
    ["C|{||END};{BN:20}D|;", "final-bar-content"],
    ["{D:1/4}C|{||END};", "repeat-meter-mismatch"],
  ];
  for (const [body, code] of cases) {
    const result = parseMstruct(prefix + body);
    assert.equal(result.ok, false, body);
    assert.ok(result.errors.some(error => error.code === code), `${body}: ${JSON.stringify(result.errors)}`);
  }
  for (const body of ["C|{||}{||END};", "C|{||:}{||END};", "C|{||END}{||END};"]) {
    assert.equal(parseMstruct(prefix + body).ok, false, body);
  }
});

test("TS:adlib 暂停小节时值校验，恢复数字 TS 时重新校验并保存可见标记", () => {
  const valid = parseMstruct("{BN:1}{TS:adlib}{D:1/4}C|;C|,C|,C|;{TS:3/4}C|,C|,C|;");
  assert.equal(valid.ok, true, valid.errors.map((error) => error.message).join("\n"));
  assert.equal(valid.measures[0].slots[0].timeSignature, "adlib");
  assert.equal(valid.measures[2].slots[0].timeSignature, "3/4");
  const invalid = parseMstruct("{BN:1}{TS:adlib}{D:1/4}C|;{TS:3/4}C|;");
  assert.ok(invalid.errors.some((error) => error.code === "meter-mismatch"));
});

test("单次反复在小节中间返回时，以预备拍补足当前拍号", () => {
  const valid = parseMstruct("{BN:0}{TS:4/4}{D:1/4}C|;C|,C|,C|,C|;C|,C|,C|{:||},C|;");
  assert.equal(valid.ok, true, valid.errors.map((error) => error.message).join("\n"));
  const invalid = parseMstruct("{BN:0}{TS:4/4}{D:1/4}C|;{||:}C|,C|,C|,C|;C|,C|,C|{:||},C|;");
  assert.ok(invalid.errors.some((error) => error.code === "repeat-meter-mismatch"));
});

test("两套 ending 在同一文本小节内互斥，逐条校验返回路线", () => {
  const valid = parseMstruct(String.raw`{BN:0}{TS:4/4}{D:1/4}A|;C|,C|,C|,C|;C|,{ENDING:1}D|,D|{/ENDING:1}{:||},{ENDING:2}E|,E|,E|{/ENDING};`);
  assert.equal(valid.ok, true, valid.errors.map((error) => error.message).join("\n"));
  assert.equal(valid.measures[2].slots[1].markersBefore[0].number, 1);
  assert.equal(valid.measures[2].slots[2].markersAfter[1].kind, "repeat-end");
  const wrongEnding = parseMstruct(String.raw`{BN:0}{TS:4/4}{D:1/4}A|;C|,C|,C|,C|;C|,{ENDING:1}D|,D|{/ENDING:1}{:||},{ENDING:2}E|,E|{/ENDING};`);
  assert.ok(wrongEnding.errors.some((error) => error.code === "repeat-meter-mismatch"));
});

test("四套 ending 可共用套件内反复起点，最后以无编号 ENDING 关闭", () => {
  const source = String.raw`{BN:0}{TS:4/4}{D:1/4}A|;C|,C|,C|,C|;C|,{ENDING:1}D|,D|{/ENDING:1}{:||},{ENDING:2}E|,E|{/ENDING:2}{:||},{ENDING:3}F|,F|{/ENDING:3}{:||},{ENDING:4}G|,G|,G|{/ENDING};`;
  const result = parseMstruct(source);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const outside = parseMstruct(`${source}C|{:||};`);
  assert.ok(outside.errors.some((error) => error.code === "repeat-start-reused"));
});

test("同一 ending 可覆盖连续多遍，并要求起止编号列表完全一致", () => {
  const source = String.raw`{BN:0}{TS:4/4}{D:1/4}A|;C|,C|,C|,C|;C|,{ENDING:1,2}D|,D|{/ENDING:1,2}{:||},{ENDING:3}E|,E|,E|{/ENDING};`;
  const result = parseMstruct(source);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const opening = result.measures[2].slots[1].markersBefore.find((marker) => marker.kind === "ending-start");
  assert.deepEqual(opening.numbers, [1, 2]);
  assert.equal(result.playbackRoute.filter((entry) => entry.slot?.events[0]?.chord === "D").length, 4);
  assert.equal(result.playbackRoute.filter((entry) => entry.slot?.events[0]?.chord === "E").length, 3);

  const mismatchedClose = parseMstruct(source.replace(String.raw`{/ENDING:1,2}`, String.raw`{/ENDING:2}`));
  assert.ok(mismatchedClose.errors.some((error) => error.code === "ending-pair"));
  const unordered = parseMstruct(source.replace("{ENDING:1,2}", "{ENDING:2,1}"));
  assert.ok(unordered.errors.some((error) => error.code === "ending-number-order"));
  const skipped = parseMstruct(source.replaceAll("1,2", "1,3"));
  assert.ok(skipped.errors.some((error) => error.code === "ending-sequence"));
  const groupedFinal = parseMstruct(String.raw`{BN:1}{TS:adlib}{D:1}{ENDING:1,2}C|{/ENDING};`);
  assert.ok(groupedFinal.errors.some((error) => error.code === "ending-final-number"));
});

test("反复次数扩展完整小节路线，范围限制为 2–1000", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{||:}C|{:||3x};D|;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.playbackRoute.filter((entry) => entry.slot).map((entry) => entry.slot.events[0]?.chord), ["C", "C", "C", "D"]);
  const marker = result.measures[0].slots[0].markersAfter.find((item) => item.kind === "repeat-end");
  assert.equal(marker.repeatCount, 3);
  assert.equal(marker.repeatCountExplicit, true);
  assert.deepEqual(createMstructtimeLoopInstructions(result), [
    "1,1/4,1,1,1/4;",
    "1,1/4,2,1,1/4;",
    "1,1/4,3,2,1/4;",
  ]);

  const tooLarge = parseMstruct("{BN:1}{TS:adlib}{D:1}C|{:||1001x};");
  assert.ok(tooLarge.errors.some((error) => error.code === "repeat-count"));
  const midMeasure = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,D|{:||3x},E|,F|;");
  assert.ok(midMeasure.errors.some((error) => error.code === "repeat-expanded-boundary"));
});

test(">> 仅用于稳定速度并累计实际演奏小节号", () => {
  const source = "{BN:1}{TS:4/4}{D:1}{BPM:1/4=60}{||:}C|;D|;E|;F|{:||2x>>};G|;";
  const unstable = parseMstruct(source);
  assert.ok(unstable.errors.some((error) => error.code === "repeat-continuous-bars-stable-only"));
  const result = parseMstruct(source, { isStableTempo: true });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.hasContinuousBarNumberRepeats, true);
  assert.deepEqual(result.measures.map((measure) => measure.displayBarNumber), [1, 2, 3, 4, 9]);
  assert.deepEqual(result.playbackRoute.filter((entry) => entry.slot).map((entry) => entry.displayBarNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(createMstructtimeLoopInstructions(result), null);

  const exactRegression = parseMstruct("{BN:1}{BPM:1/4=120}{TEMPO:Allegro}{TS:4/4}{2/4}{TC:C}X,X{:||2x>>};X,;", { isStableTempo: true });
  assert.equal(exactRegression.ok, true, exactRegression.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(exactRegression.measures.map((measure) => measure.displayBarNumber), [1, 3]);
  assert.deepEqual(exactRegression.playbackRoute.filter((entry) => entry.slot).map((entry) => entry.displayBarNumber), [1, 1, 2, 2, 3]);

  const cumulative = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=60}{||:}C|{:||>>};{||:}D|{:||>>};E|;", { isStableTempo: true });
  assert.equal(cumulative.ok, true, cumulative.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(cumulative.measures.map((measure) => measure.displayBarNumber), [1, 3, 5]);
  const backwardBn = parseMstruct("{BN:1}{TS:4/4}{D:1}{BPM:1/4=60}{||:}C|;D|;E|;F|{:||2x>>};{BN:8}G|;", { isStableTempo: true });
  assert.ok(backwardBn.errors.some((error) => error.code === "bar-number-backward"));
});

test("反复及 ending 的位置、配对、二次返回和 TS 边界均严格校验", () => {
  const cases = [
    ["{BN:1}{TS:adlib}{D:1}C|{||:};", "control-marker-position"],
    [String.raw`{BN:1}{TS:adlib}{D:1}{ENDING:1}C|{/ENDING:2};`, "ending-pair"],
    [String.raw`{BN:1}{TS:adlib}{D:1}{ENDING:2}C|{/ENDING};`, "ending-sequence"],
    ["{BN:1}{TS:adlib}{D:1}{||};", "control-marker-position"],
    ["{BN:1}{TS:adlib}{D:1}C|{:||};C|{:||};", "repeat-start-reused"],
    ["{BN:1}{TS:4/4}{D:1}C|;{||:}C|;{TS:3/4}{D:3/4}C|{:||};", "repeat-time-signature-mismatch"],
  ];
  for (const [source, code] of cases) {
    const result = parseMstruct(source);
    assert.ok(result.errors.some((error) => error.code === code), `${code}: ${result.errors.map((error) => error.message).join("; ")}`);
  }
});

test("反复起点紧接 TS 时，跳回后按该处重新定义的拍号演奏", () => {
  const source = "{BN:1}{TS:4/4}{D:1/4}{||:}{TS:3/4}C|,C|,C|;C|,C|,C|{:||};";
  const result = parseMstruct(source);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
});

test("简单反复路线可导入为显式 mstructtime LOOP 指令", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}{||:}C|,C|,C|,C|{:||};D|,D|,D|,D|;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(createMstructtimeLoopInstructions(result), [
    "1,4/4,1,1,1/4;",
    "1,4/4,2,2,1/4;",
  ]);
});

test("LOOP 导入以小节拍位而非 slot 时值生成跳转目标", () => {
  const result = parseMstruct(String.raw`{BN:1}{TEMPO:Allegro}{TS:4/4}{D:2/4}{TC:C}X,;{ENDING:1}F/C|I64,C|I{/ENDING:1}{:||};{ENDING:2}G/B|V65,C|I{/ENDING};`);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const instructions = createMstructtimeLoopInstructions(result);
  assert.deepEqual(instructions, [
    "1,4/4,1,2,1/4;",
    "2,4/4,1,1,1/4;",
    "1,4/4,2,3,1/4;",
  ]);
  const generated = buildMstructtimeEventRows(result, instructions.join("\n"), "");
  assert.equal(generated.ok, true, JSON.stringify(generated.errors));
  assert.deepEqual(generated.rows.slice(1).map((row) => [row.measure, row.beat, row.pass]), [
    [1, "1/4", 1], [2, "1/4", 1], [2, "3/4", 1],
    [1, "1/4", 2], [3, "1/4", 1], [3, "3/4", 1],
  ]);
});

test("最后一个没有分号的小节报闭合错误，不再进入路线或节拍校验", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}{TC:C}[R:I],[R:V]");
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), ["measure-unfinished"]);
  assert.deepEqual(result.playbackRoute, []);
  assert.equal(result.measures[0].complete, false);
});

test("标准语法与两项语法糖产生相同的和声语义", () => {
  const standard = parseMstruct("{BN:1}{TS:4/4}{D:1/4}{TC:C}[C:C|R:I],[C:Fm|R:iv],[C:G|R:V],[C:C|R:I];");
  const shorthand = parseMstruct("{BN:1}{TS:4/4}{1/4}{TC:C}C|I,Fm|iv,G|V,C|I;");

  assert.equal(standard.ok, true, standard.errors.map((error) => error.message).join("\n"));
  assert.equal(shorthand.ok, true, shorthand.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(
    shorthand.measures.map((measure) => ({
      barNumber: measure.barNumber,
      duration: measure.duration,
      slots: measure.slots.map((slot) => ({ duration: slot.duration, events: slot.events.map(({ chord, roman }) => ({ chord, roman })) })),
    })),
    standard.measures.map((measure) => ({
      barNumber: measure.barNumber,
      duration: measure.duration,
      slots: measure.slots.map((slot) => ({ duration: slot.duration, events: slot.events.map(({ chord, roman }) => ({ chord, roman })) })),
    })),
  );
});

test("简化和弦允许只写和弦或罗马数字", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{1/4}{TC:C}C|,|V,C|I,C|I;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(
    result.measures[0].slots.map((slot) => slot.events[0] && ({ chord: slot.events[0].chord, roman: slot.events[0].roman })),
    [{ chord: "C", roman: null }, { chord: null, roman: "V" }, { chord: "C", roman: "I" }, { chord: "C", roman: "I" }],
  );
});

test("X、0、- 与 N.C. 解析为独立事件并继承当前时值", () => {
  const result = parseMstruct([
    "{BN:1}{BPM:1/4=60}{TS:4/4}{1/4}{TC:C}",
    "C|I,,0,{D:1/8}X,C|I;",
    "{1/4}-,G|V,,{D:1/8},N.C.;",
  ].join("\n"));

  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(
    result.measures[0].slots.map((slot) => ({
      chord: slot.events[0]?.chord ?? null,
      roman: slot.events[0]?.roman ?? null,
      symbol: slot.events[0]?.symbol ?? null,
      symbolType: slot.events[0]?.symbolType ?? null,
      duration: slot.duration,
      durationLabel: slot.durationLabel,
    })),
    [
      { chord: "C", roman: "I", symbol: null, symbolType: null, duration: rational(1, 2), durationLabel: "1/2" },
      { chord: null, roman: null, symbol: "0", symbolType: "rest", duration: rational(1, 4), durationLabel: "1/4" },
      { chord: null, roman: null, symbol: "X", symbolType: "placeholder", duration: rational(1, 8), durationLabel: "1/8" },
      { chord: "C", roman: "I", symbol: null, symbolType: null, duration: rational(1, 8), durationLabel: "1/8" },
    ],
  );
  assert.deepEqual(
    result.measures[1].slots.map((slot) => ({
      chord: slot.events[0]?.chord ?? null,
      roman: slot.events[0]?.roman ?? null,
      symbol: slot.events[0]?.symbol ?? null,
      symbolType: slot.events[0]?.symbolType ?? null,
      duration: slot.duration,
      durationLabel: slot.durationLabel,
    })),
    [
      { chord: null, roman: null, symbol: "-", symbolType: "continuation", duration: rational(1, 4), durationLabel: "1/4" },
      { chord: "G", roman: "V", symbol: null, symbolType: null, duration: rational(5, 8), durationLabel: "5/8" },
      { chord: null, roman: null, symbol: "N.C.", symbolType: "no-chord", duration: rational(1, 8), durationLabel: "1/8" },
    ],
  );
});

test("X 与 - 可作为和弦或 Roman 字段的完整值", () => {
  const markerOnly = parseMstruct("{BN:1}{TS:2/4}{D:1/4}[C:X],[R:-];", { specialChords, romanConfig });
  assert.equal(markerOnly.ok, true, markerOnly.errors.map((error) => error.message).join("\n"));
  const result = parseMstruct(
    "{BN:1}{TS:4/4}{D:1/8}{TC:C}X|V,-|V,C|X,C|-,[C:X|R:V],[C:-|R:V],[C:C|R:X],[C:C|R:-];",
    { specialChords, romanConfig },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.measures[0].slots.map((slot) => {
    const event = slot.events[0];
    return [event.chordSymbolType, event.romanSymbolType, Boolean(event.chordResult), Boolean(event.romanResult)];
  }), [
    ["placeholder", null, false, true],
    ["continuation", null, false, true],
    [null, "placeholder", true, false],
    [null, "continuation", true, false],
    ["placeholder", null, false, true],
    ["continuation", null, false, true],
    [null, "placeholder", true, false],
    [null, "continuation", true, false],
  ]);
});

test("Clus、ClusWK 与 ClusBK 解析为不可点击的独立音簇事件", () => {
  const result = parseMstruct("{BN:1}{TS:3/4}{D:1/4}Clus,ClusWK,ClusBK;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(
    result.measures[0].slots.map((slot) => {
      const event = slot.events[0];
      return [event.symbol, event.symbolType, event.chordResult, event.romanResult];
    }),
    [
      ["Clus", "cluster", null, null],
      ["ClusWK", "white-key-cluster", null, null],
      ["ClusBK", "black-key-cluster", null, null],
    ],
  );
});

test("clusters are complete chord fields, with Roman and secondary harmony kept separate", () => {
  for (const [symbol, type] of [["Clus", "cluster"], ["ClusWK", "white-key-cluster"], ["ClusBK", "black-key-cluster"]]) {
    for (const source of [`[C:${symbol}]`, `${symbol}|`, `[C:${symbol}|R:I]`, `${symbol}|I`, `'${symbol}|I'`]) {
      const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1/4}{TC:C}${source};`, { specialChords, romanConfig });
      assert.equal(parsed.ok, true, `${source}: ${JSON.stringify(parsed.errors)}`);
      const event = parsed.measures[0].slots[0].events[0];
      assert.equal(event.chordSymbolType, type);
      assert.equal(event.chordResult, null);
      assert.equal(event.symbol, null);
      assert.equal(Boolean(event.romanResult), source.includes("I"));
      assert.equal(Boolean(event.secondary), source.startsWith("'"));
    }
    for (const source of [`[R:${symbol}]`, `C|${symbol}`, `${symbol}7|I`, `${symbol}/C|I`, `C${symbol}|I`]) {
      assert.equal(parseMstruct(`{BN:1}{TS:adlib}{D:1}{TC:C}${source};`, { specialChords, romanConfig }).ok, false, source);
    }
    assert.equal(parseMstruct(`{BN:1}{TS:adlib}{D:1}C|,[NR:P]${symbol}|;`).ok, false);
  }
});

test("cluster symbols can occupy either side of a chord annotation", () => {
  const separator = String.fromCharCode(92).repeat(2);
  const chord = "Fm7add(b2,4,b6)";
  for (const cluster of ["Clus", "ClusWK", "ClusBK"]) {
    for (const [main, annotation] of [[chord, cluster], [cluster, chord], [cluster, "ClusWK"]]) {
      const field = `${main}${separator}${annotation}`;
      for (const value of [`${field}|`, `[C:${field}]`, `${field}|I`, `'${field}|I'`]) {
        const source = `{BN:1}{TS:adlib}{D:1}{TC:C}${value};`;
        const result = parseMstruct(source, { specialChords, romanConfig });
        assert.equal(result.ok, true, `${value}: ${JSON.stringify(result.errors)}`);
        const event = result.measures[0].slots[0].events[0];
        assert.equal(event.chord, main);
        assert.equal(event.chordAnnotation, annotation);
        assert.equal(Boolean(event.chordResult), main === chord);
        assert.equal(Boolean(event.chordAnnotationResult), annotation === chord);
        assert.equal(Boolean(event.chordSymbolType), main !== chord);
        assert.equal(Boolean(event.chordAnnotationSymbolType), annotation !== chord);
        assert.equal(source.slice(event.chordStart, event.chordEnd), main);
        assert.equal(source.slice(event.chordAnnotationStart, event.chordAnnotationEnd), annotation);
      }
    }
  }
  for (const field of [`C${separator}X`, `X${separator}Clus`, `C${separator}Clus7`, `Clus${separator}`, `Clus${separator}C${separator}ClusWK`]) {
    assert.equal(parseMstruct(`{BN:1}{TS:adlib}{D:1}[C:${field}];`, { specialChords }).ok, false, field);
  }
  assert.equal(parseMstruct(`{BN:1}{TS:adlib}{D:1}{TC:C}C|I${separator}Clus;`, { specialChords, romanConfig }).ok, false);
});

test("NR 接受规定变换并绑定前一个和弦或紧邻的延长符", () => {
  for (const value of ["P", "L", "R", "LP", "PLRPLR", "N", "S", "H"]) {
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1}C|,[NR:${value}]Cm|;`);
    assert.equal(result.ok, true, `${value}: ${result.errors.map((error) => error.message).join("\n")}`);
    assert.deepEqual(result.measures[0].slots[1].events[0].newRiemannian, {
      value,
      start: result.source.indexOf(`[NR:${value}]`),
      end: result.source.indexOf(`[NR:${value}]`) + `[NR:${value}]`.length,
      sourceEventOrder: 0,
      sourceType: "chord",
    });
  }

  const continuation = parseMstruct("{BN:1}{TS:adlib}{D:1}C|,-,[NR:LP]F|;");
  assert.equal(continuation.ok, true, continuation.errors.map((error) => error.message).join("\n"));
  assert.equal(continuation.measures[0].slots[2].events[0].newRiemannian.sourceEventOrder, 1);
  assert.equal(continuation.measures[0].slots[2].events[0].newRiemannian.sourceType, "continuation");
});

test("NR 严格校验内容、源码顺序、唯一性及绝对和弦目标", () => {
  for (const value of ["", "p", "PLRPLRP", "NS", "PN", "HH"]) {
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1}C|,[NR:${value}]Cm|;`);
    assert.ok(result.errors.some((error) => error.code === "invalid-new-riemannian"), value || "empty");
  }
  const lowerType = parseMstruct("{BN:1}{TS:adlib}{D:1}C|,[nr:P]Cm|;");
  assert.ok(lowerType.errors.some((error) => error.code === "invalid-new-riemannian"));

  const afterTarget = parseMstruct("{BN:1}{TS:adlib}{D:1}[C:C][NR:P];");
  assert.ok(afterTarget.errors.some((error) => error.code === "new-riemannian-target-required"));
  const duplicate = parseMstruct("{BN:1}{TS:adlib}{D:1}C|,[NR:P][NR:L]Cm|;");
  assert.ok(duplicate.errors.some((error) => error.code === "duplicate-new-riemannian"));
  const missingTarget = parseMstruct("{BN:1}{TS:adlib}{D:1}[NR:P];");
  assert.ok(missingTarget.errors.some((error) => error.code === "new-riemannian-target-required"));

  const romanOnlyTarget = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}C|I,[NR:P]|V;");
  assert.ok(romanOnlyTarget.errors.some((error) => error.code === "new-riemannian-target-chord"));
});

test("NR 拒绝缺失来源以及 Roman、X、0、N.C. 和 Cluster 来源", () => {
  const noSource = parseMstruct("{BN:1}{TS:adlib}{D:1}[NR:P]C|;");
  assert.ok(noSource.errors.some((error) => error.code === "new-riemannian-source"));

  for (const previous of ["X", "0", "N.C.", "Clus", "ClusWK", "ClusBK"]) {
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1}${previous},[NR:P]C|;`);
    assert.ok(result.errors.some((error) => error.code === "new-riemannian-source"), previous);
  }
  for (const previous of ["X|V", "-|V"]) {
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1}{TC:C}${previous},[NR:P]C|I;`, { specialChords, romanConfig });
    assert.ok(result.errors.some((error) => error.code === "new-riemannian-source"), previous);
  }
  const invalidTarget = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}C|I,[NR:P]X|V;", { specialChords, romanConfig });
  assert.ok(invalidTarget.errors.some((error) => error.code === "new-riemannian-target-chord"));
  const romanOnlySource = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}|I,[NR:P]C|I;");
  assert.ok(romanOnlySource.errors.some((error) => error.code === "new-riemannian-source"));
});

test("TEMPO 与 BPM 共用 slot，BPMhidden 只更新速度状态且可满足稳定速度校验", () => {
  const visible = parseMstruct("{BN:1}{TS:adlib}{D:1}{TEMPO:Allegro}{BPM:1/4=120}C|;");
  assert.equal(visible.ok, true, visible.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(visible.measures[0].slots[0].annotations, {
    time: null,
    bpm: "1/4=120",
    metricModulations: [],
    tempo: "Allegro",
    form: null,
  });

  const hidden = parseMstruct("{BN:1}{TS:adlib}{D:1}{BPMhidden:1/4=96}Clus;", { isStableTempo: true });
  assert.equal(hidden.ok, true, hidden.errors.map((error) => error.message).join("\n"));
  assert.equal(hidden.measures[0].slots[0].annotations.bpm, null);

  const uncovered = parseMstruct("{BN:1}{TS:adlib}{D:1}C|;", { isStableTempo: true });
  assert.ok(uncovered.errors.some((error) => error.code === "missing-stable-tempo"));

  const invalidHidden = parseMstruct("{BN:1}{TS:adlib}{D:1}{BPMhidden:fast}C|;");
  assert.ok(invalidHidden.errors.some((error) => error.code === "invalid-bpm"));
});

test("MM 独立记录拍值关系，有 BPM 时按比例更新播放路线", () => {
  const result = parseMstruct("{BN:1}{D:1}{TS:adlib}{BPM:1/4=120}{MM:2/8=1/8}C|;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const modulation = result.measures[0].slots[0].annotations.metricModulations[0];
  assert.deepEqual([modulation.fromBeat, modulation.toBeat, modulation.resultBpm, modulation.referenceBpm], ["1/4", "1/8", "1/8=120", "1/4=120"]);
  assert.deepEqual(result.playbackRoute[0].parts[0], {
    duration: { numerator: 1, denominator: 1 },
    bpm: "1/8=120",
    explicitBpm: "1/4=120",
    bpmModulated: true,
  });

  const missing = parseMstruct("{BN:1}{D:1}{TS:adlib}{MM:1/4=1/8}C|;");
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.measures[0].slots[0].annotations.metricModulations.map((entry) =>
    [entry.fromBeat, entry.toBeat, entry.resultBpm, entry.referenceBpm]), [["1/4", "1/8", null, null]]);
  assert.equal(missing.playbackRoute[0].parts[0].bpm, null);
  const mismatch = parseMstruct("{BN:1}{D:1}{TS:adlib}{BPM:1/4=120}{MM:1/8=1/16}C|;");
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.playbackRoute[0].parts[0].bpm, "1/8=120");

  const ordered = parseMstruct("{BN:1}{D:1}{TS:adlib}{BPM:1/4=120}{MM:1/4=1/8}{MM:1/8=1/16}C|,{BPMhidden:1/2=90}D|;");
  assert.equal(ordered.ok, true, ordered.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(ordered.measures[0].slots[0].annotations.metricModulations.map((entry) => entry.resultBpm), ["1/8=120", "1/16=120"]);
  assert.deepEqual(ordered.playbackRoute[0].parts[0], {
    duration: { numerator: 1, denominator: 1 },
    bpm: "1/16=120",
    explicitBpm: "1/4=120",
    bpmModulated: true,
  });
  assert.deepEqual(ordered.playbackRoute[1].parts[0], {
    duration: { numerator: 1, denominator: 1 },
    bpm: "1/2=90",
    explicitBpm: "1/2=90",
    bpmModulated: false,
  });
});

test("没有 BPM 的多个 MM 不猜测速度，后写 BPM 可以重建速度状态", () => {
  const result = parseMstruct("{BN:1}{D:1/4}{TS:adlib}{MM:1/4=1/8}C|,{MM:1/8=1/16}D|,{BPMhidden:1/4=90}E|,{MM:3/8=1/4}F|;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.playbackRoute.map((visit) => visit.parts[0].bpm), [null, null, "1/4=90", "1/6=90"]);
  assert.deepEqual(result.playbackRoute.map((visit) => visit.parts[0].bpmModulated), [false, false, false, true]);
  const stable = parseMstruct("{BN:1}{D:1}{TS:adlib}{MM:1/4=1/8}C|;", { isStableTempo: true });
  assert.deepEqual(stable.errors.map((error) => error.code), ["missing-stable-tempo"]);
  const sameSlot = parseMstruct("{BN:1}{D:1}{TS:adlib}{MM:1/4=1/8}{BPM:1/4=60}C|;", { isStableTempo: true });
  assert.equal(sameSlot.ok, true);
  assert.equal(sameSlot.playbackRoute[0].parts[0].bpm, "1/4=60");
  for (const value of ["0/4=1/8", "1/4=1/0", "1/4=0/8", "1/4=-1/8", "9007199254740992/4=1/8"]) {
    const invalid = parseMstruct(`{BN:1}{D:1}{TS:adlib}{MM:${value}}C|;`);
    assert.ok(invalid.errors.some((error) => error.code === "invalid-mm"), value);
  }
});

test("Renderer Test 覆盖独立 MM、三个 T 格式、后续 BPM 和反复", async () => {
  const source = await readFile(new URL("./fixtures/renderer-tempo-labels.mstruct", import.meta.url), "utf8");
  const result = parseMstruct(source);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const slots = result.measures.flatMap((measure) => measure.slots);
  assert.deepEqual(slots.filter((slot) => slot.annotations.time).map((slot) => slot.annotations.time), ["0:01", "01:23", "1:02:03"]);
  assert.equal(slots.flatMap((slot) => slot.annotations.metricModulations).length, 4);
  assert.deepEqual(result.playbackRoute.filter((visit) => visit.kind !== "ellipsis").map((visit) => visit.parts[0].bpm),
    [null, null, "1/4=60", "1/8=60", "1/4=60", "1/6=60", "1/4=60", "1/6=60"]);
});

test("曲式记号附着事件并保存必填主体、可选上下标", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1}[F:A|1|intro]C|;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.measures[0].slots[0].annotations.form).filter(([key]) => !["start", "end"].includes(key))),
    { body: "A", superscript: "1", subscript: "intro" },
  );

  const optional = parseMstruct("{BN:1}{TS:adlib}{D:1}[F:B||]C|;");
  assert.equal(optional.ok, true);
  assert.equal(optional.measures[0].slots[0].annotations.form.body, "B");

  for (const source of [
    "{BN:1}{TS:adlib}{D:1}[F:|1|intro]C|;",
    "{BN:1}{TS:adlib}{D:1}[F:A|上|intro]C|;",
    "{BN:1}{TS:adlib}{D:1}[F:A|1|intro][F:B|2|theme]C|;",
    "{BN:1}{TS:adlib}{D:1}[F:A|1|intro];",
  ]) {
    const invalid = parseMstruct(source);
    assert.equal(invalid.ok, false, source);
  }
});

test("速度、时间戳、曲式、注释和 NR 等附着内容不能单独构成事件", () => {
  const comments = [{ number: 1, texts: { zh_cn: "一", en: "One" } }];
  const cases = [
    ["{BN:1}{TS:adlib}{D:1}{TEMPO:Allegro};", {}],
    ["{BN:1}{TS:adlib}{D:1}{BPM:1/4=120};", {}],
    ["{BN:1}{TS:adlib}{D:1}{BPMhidden:1/4=120};", {}],
    ["{BN:1}{TS:adlib}{D:1}{BPM:1/4=120}{MM:1/4=1/8};", {}],
    ["{BN:1}{TS:adlib}{D:1}{T=0:00};", {}],
    ["{BN:1}{TS:adlib}{D:1}[F:A||];", {}],
    ["{BN:1}{TS:adlib}{D:1}[COMMENT:1];", { comments }],
    ["{BN:1}{TS:adlib}{D:1}[NR:P];", {}],
  ];
  for (const [source, options] of cases) {
    const result = parseMstruct(source, options);
    assert.ok(result.errors.some((error) => error.code === "musical-event-required"), source);
  }
});

test("注释支持单事件、范围和同事件先结束再开始，但禁止重叠与悬空引用", () => {
  const comments = [
    { number: 1, texts: { zh_cn: "一", en: "One" } },
    { number: 2, texts: { zh_cn: "二", en: "Two" } },
  ];
  const result = parseMstruct(
    "{BN:1}{TS:4/4}{D:1/4}[COMMENT:1]C|,[/COMMENT][COMMENT:2]F|,G|,[/COMMENT]C|;",
    { comments },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.commentRanges.length, 2);
  assert.deepEqual(result.measures[0].slots.map((slot) => slot.commentActive), [true, true, true, true]);
  assert.deepEqual(result.measures[0].slots[1].comments.map((comment) => comment.kind), ["end", "start"]);

  const oneShot = parseMstruct("{BN:1}{TS:adlib}{D:1}[/COMMENT:1]C|;", { comments });
  assert.equal(oneShot.ok, true);
  assert.equal(oneShot.measures[0].slots[0].comments[0].kind, "oneshot");

  const cases = [
    ["{BN:1}{TS:adlib}{D:1}[COMMENT:3]C|;", "unknown-comment"],
    ["{BN:1}{TS:adlib}{D:1}[COMMENT:1][COMMENT:2]C|;", "comment-overlap"],
    ["{BN:1}{TS:adlib}{D:1}[COMMENT:1]C|;", "comment-unfinished"],
    ["{BN:1}{TS:adlib}{D:1}[/COMMENT]C|;", "comment-close-without-open"],
  ];
  for (const [source, code] of cases) {
    const invalid = parseMstruct(source, { comments });
    assert.ok(invalid.errors.some((error) => error.code === code), `${source} should report ${code}`);
  }
});

test("没有事件的 slot 把时值合并到前一个事件", () => {
  const whole = parseMstruct("{BN:1}{TS:4/4}{1/4}{TC:C}C|I,,,;");
  assert.equal(whole.ok, true, whole.errors.map((error) => error.message).join("\n"));
  assert.equal(whole.measures[0].slots.length, 1);
  assert.deepEqual(whole.measures[0].slots[0].duration, rational(1));
  assert.equal(whole.measures[0].slots[0].durationLabel, "1");

  const threeQuarters = parseMstruct("{BN:1}{TS:4/4}{1/4}{TC:C}C|I,,,G|V;");
  assert.equal(threeQuarters.ok, true, threeQuarters.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(threeQuarters.measures[0].slots.map((slot) => slot.duration), [rational(3, 4), rational(1, 4)]);
  assert.deepEqual(threeQuarters.measures[0].slots.map((slot) => slot.durationLabel), ["3/4", "1/4"]);
});

test("旧的小节起始符和事件逗号分隔会明确报错", () => {
  const oldBarline = parseMstruct("|{BN:1}{TS:adlib}{D:1}[C:C];");
  assert.equal(oldBarline.ok, false);
  assert.ok(oldBarline.errors.some((error) => error.code === "legacy-barline"));

  const oldEventDelimiter = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}[C:C,R:I];");
  assert.equal(oldEventDelimiter.ok, false);
  assert.ok(oldEventDelimiter.errors.some((error) => error.code === "event-delimiter"));
});

test("MAIN 和弦字段复用唯一和弦编译器，并保留嵌套括号与列表", () => {
  const result = parseMstruct(
    "{BN:1}{TS:4/4}{D:1/2}{TC:C}[C:A[q4:(4,b7)]|R:vi],Cadd(9,#9)onF|V;",
    { specialChords },
  );

  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const [stacked, polychord] = result.measures[0].slots.map((slot) => slot.events[0]);
  assert.deepEqual(stacked.chordResult.structure.values, ["1", "4", "b7"]);
  assert.deepEqual(polychord.chordResult.structure.values, ["1", "3", "5", "12", "14", "16", "20", "#20"]);
  assert.deepEqual([stacked.roman, polychord.roman], ["vi", "V"]);

  const slash = parseMstruct("{BN:1}{TS:adlib}{D:1}Baug/F|;", { specialChords });
  assert.equal(slash.ok, true, slash.errors.map((error) => error.message).join("\n"));
  const slashStructure = slash.measures[0].slots[0].events[0].chordResult.structure;
  assert.deepEqual(slashStructure.values, ["1", "#4", "#6", "x8"]);
  assert.deepEqual(slashStructure.toNoteNames(), ["F", "B", "D#", "Fx"]);
});

test("MAIN 将 power chord 保存为根音与五度，并拒绝后缀", () => {
  const valid = parseMstruct("{BN:1}{TS:adlib}{D:1}C5|;");
  assert.equal(valid.ok, true, valid.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(valid.measures[0].slots[0].events[0].chordResult.structure.values, ["1", "5"]);

  const invalid = parseMstruct("{BN:1}{TS:adlib}{D:1}C5/G|;");
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.code === "chord-terminal-suffix"));
});

test("和弦与 Roman 注释按同栏语法独立编译并保存精确结果", () => {
  const result = parseMstruct(
    "{BN:1}{TS:adlib}{D:1}{TC:C}C7\\\\Edim/C|IDM7\\\\V7/IV;",
    { specialChords, romanConfig },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const event = result.measures[0].slots[0].events[0];
  assert.equal(event.chord, "C7");
  assert.equal(event.chordAnnotation, "Edim/C");
  assert.deepEqual(event.chordAnnotationResult.structure.toNoteNames(), ["C", "E", "G", "Bb"]);
  assert.equal(event.roman, "IDM7");
  assert.equal(event.romanAnnotation, "V7/IV");
  assert.deepEqual(event.romanAnnotationResult.structure.values, ["1", "3", "5", "b7"]);

  const wrongChordType = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}C7\\\\V|I;", { specialChords, romanConfig });
  assert.ok(wrongChordType.errors.some((error) => error.domain === "chord" && error.chordCode === "root-expected"));
  const wrongRomanType = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}C|I\\\\C;", { specialChords, romanConfig });
  assert.ok(wrongRomanType.errors.some((error) => error.domain === "roman" && error.romanCode === "base-not-found"));
});

test("M 转调区域编译两行 Roman、允许中间独立事件并在闭合后更新 TC", () => {
  const source = [
    "{BN:1}{TS:adlib}{D:1/4}{TC:C}{M:d|ii}G\\\\G7|V\\\\V7/IV&I\\\\i,X,0,-,N.C.,Am|vi&ii{/M};",
    "A|V;",
  ].join("");
  const result = parseMstruct(source, { specialChords, romanConfig });
  assert.equal(result.ok, true, result.errors.map((error) => `${error.code}: ${error.message}`).join("\n"));
  const [first, placeholder, rest, continuation, noChord, last] = result.measures[0].slots.map((slot) => slot.events[0]);
  assert.deepEqual(first.romanLayers.map((layer) => [layer.tonalCenter, layer.roman]), [["C", "V"], ["d", "I"]]);
  assert.deepEqual(first.modulationStart, {
    previousTonalCenter: "C",
    previousRelation: "I",
    targetTonalCenter: "d",
    targetRelation: "ii",
  });
  assert.equal(first.chordAnnotation, "G7");
  assert.deepEqual(first.romanLayers.map((layer) => [layer.romanAnnotation, layer.romanAnnotationResult?.source]), [
    ["V7/IV", "V7/IV"],
    ["i", "i"],
  ]);
  assert.equal(last.modulationEnd, true);
  assert.deepEqual([placeholder.symbol, rest.symbol, continuation.symbol, noChord.symbol], ["X", "0", "-", "N.C."]);
  assert.equal(result.measures[1].slots[0].events[0].tonalCenter, "d");
});

test("M 关系按旧调可用性、大小写与同音异名音高校验", () => {
  for (const relation of ["#IV", "bV"]) {
    const result = parseMstruct(
      `{BN:1}{TS:adlib}{D:1}{TC:C}{M:F#|${relation}}F#|${relation}&I{/M};`,
      { specialChords, romanConfig },
    );
    assert.equal(result.ok, true, `${relation}: ${result.errors.map((error) => error.message).join("\n")}`);
  }
  const pitchMismatch = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}{M:d|v}G|V&I{/M};", { specialChords, romanConfig });
  assert.ok(pitchMismatch.errors.some((error) => error.code === "modulation-pitch"));
  const caseMismatch = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}{M:d|II}G|V&I{/M};", { specialChords, romanConfig });
  assert.ok(caseMismatch.errors.some((error) => error.code === "modulation-mode-case"));
  const unavailable = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}{M:e|niii}E|iii&i{/M};", { specialChords, romanConfig });
  assert.ok(unavailable.errors.some((error) => error.domain === "roman" && error.romanCode === "tonal-mode"));
});

test("MH 只标注并更新紧随其后的单行 Roman 事件", () => {
  const result = parseMstruct(
    "{BN:1}{TS:adlib}{D:1}{TC:C}C|I;{MH:d|ii}A|V;",
    { specialChords, romanConfig },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const event = result.measures[1].slots[0].events[0];
  assert.deepEqual(event.hardModulationPrefix, { targetTonalCenter: "d", targetRelation: "ii" });
  assert.equal(event.tonalCenter, "d");

  const invalidRegionEvent = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}{M:d|ii}N.C.{/M};", { specialChords, romanConfig });
  assert.ok(invalidRegionEvent.errors.some((error) => error.code === "modulation-event"));
  const invalidRegionEdges = [
    "{BN:1}{TS:adlib}{D:1/2}{TC:C}{M:d|ii}X,G|V&I{/M};",
    "{BN:1}{TS:adlib}{D:1/2}{TC:C}{M:d|ii}G|V&I,X{/M};",
    "{BN:1}{TS:adlib}{D:1}{TC:C}{M:d|ii}G{/M};",
    "{BN:1}{TS:adlib}{D:1}{TC:C}{MH:d|ii}G|V&I;",
  ];
  for (const source of invalidRegionEdges) {
    const invalid = parseMstruct(source, { specialChords, romanConfig });
    assert.ok(
      invalid.errors.some((error) => ["modulation-event", "modulation-close-position", "hard-modulation-event"].includes(error.code)),
      source,
    );
  }
  const lateTc = parseMstruct("{BN:1}{TS:adlib}{D:1}{TC:C}C|I;{TC:d}A|V;", { specialChords, romanConfig });
  assert.equal(lateTc.ok, true, lateTc.errors.map((error) => error.message).join("\n"));
  assert.equal(lateTc.measures[1].slots[0].events[0].tonalPrefix, "d");
});

test("次要和弦保留语义标记，并接受简写和完整事件", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1/2}{TC:C}'C|I','[C:G|R:V]';", { specialChords, romanConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.measures[0].slots.map((slot) => slot.events[0].secondary), [true, true]);
  assert.deepEqual(result.measures[0].slots.map((slot) => slot.events[0].roman), ["I", "V"]);

  for (const secondary of ["N.C.", "X|V", "C|-"]) {
    const invalid = parseMstruct(`{BN:1}{TS:adlib}{D:1}'${secondary}';`, { specialChords, romanConfig });
    assert.ok(invalid.errors.some((error) => error.code === "invalid-secondary-event"), secondary);
  }
});

test("MAIN 支持特殊和弦配置并将和弦错误精确映射回源码", () => {
  const special = parseMstruct("{BN:1}{TS:adlib}{D:1}E[sp:sowhat]|;", { specialChords });
  assert.equal(special.ok, true, special.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(special.measures[0].slots[0].events[0].chordResult.structure.values, ["1", "4", "b7", "b10", "12"]);

  const source = "{BN:1}{TS:adlib}{D:1}{TC:C}[C:G7b9#5|R:V];";
  const invalid = parseMstruct(source, { specialChords });
  const error = invalid.errors.find((candidate) => candidate.code === "chord-altered-order");
  assert.equal(invalid.ok, false);
  assert.ok(error);
  assert.equal(source.slice(error.start, error.end), "#5");
  assert.equal(error.domain, "chord");
  assert.equal(error.chordCode, "altered-order");
  assert.deepEqual(error.details, { token: "#5" });
});
