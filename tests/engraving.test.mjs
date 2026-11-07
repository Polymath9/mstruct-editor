import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSpecialChordCsv } from "../src/core/chord-symbol.js";
import { engraveMeasure, layoutSystems, rhythmicWidth, slotDurationLabel } from "../src/core/engraving.js";
import { parseMstruct, TASK2_EXAMPLE_SOURCE } from "../src/core/mstruct.js";
import { parseRomanConfigCsv } from "../src/core/roman-symbol.js";
import { normalizeRendererScale, readRendererScale, scoreLength } from "../src/core/renderer-scale.js";

const readConfig = (name) => readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8");
const [chordCsv, basicCsv, advancedCsv, figuredBassCsv, specialCsv] = await Promise.all([
  readConfig("special-chords.csv"),
  readConfig("roman-basic.csv"),
  readConfig("roman-advanced.csv"),
  readConfig("roman-figured-bass.csv"),
  readConfig("roman-special.csv"),
]);
const specialChords = parseSpecialChordCsv(chordCsv);
const romanConfig = parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv });

test("horizontal presentations lay out each full measure independently at its natural width", () => {
  const parsed = parseMstruct('{BN:1}{TS:adlib}{D:1/4}{TC:C}{BPM:1/4=120}[F:Intro||]C|I;[F:A||]D|ii;[F:Transition||1]G|V;', { specialChords, romanConfig });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(layoutSystems(parsed.flow, 5000).length, 1, "ordinary score layout still groups measures");
  const systems = layoutSystems(parsed.flow, 5000, { independentMeasures: true });
  assert.equal(systems.length, 3);
  for (const [index, system] of systems.entries()) {
    assert.equal(system.items.length, 1);
    assert.equal(system.items[0].measure, parsed.measures[index]);
    assert.equal(system.items[0].segment.startsMeasure, true);
    assert.equal(system.items[0].segment.endsMeasure, true);
    assert.equal(system.independentMeasure, true);
    assert.equal(system.justified, false, "short measures are not stretched to a viewport-wide system");
  }
  assert.ok(systems[0].items[0].segment.slots[0].slot.annotations.bpm);
  assert.equal(Boolean(systems[1].items[0].segment.slots[0].slot.annotations.bpm), false, "A never inherits Intro's speed track");
});

test("presentation measures do not wrap or change annotation groups at viewport boundaries", () => {
  const notes = Array.from({ length: 32 }, () => "C|I").join(",");
  const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1/32}{TC:C}[F:A||]${notes};{LB}...{BN:10}[F:Transition||1]${notes};`, { specialChords, romanConfig });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const layouts = [360, 900, 1920].map(width => layoutSystems(parsed.flow, width, { independentMeasures: true }));
  for (const systems of layouts) {
    assert.deepEqual(systems.map(system => system.items.map(item => item.kind)), [["measure"], ["ellipsis"], ["measure"]]);
    for (const system of systems.filter(system => system.items[0].kind === "measure")) {
      assert.equal(system.items[0].segment.slots.length, 32);
      assert.equal(system.items[0].segment.endsMeasure, true);
    }
  }
  assert.deepEqual(layouts.map(systems => systems.map(system => system.naturalWidth)), Array(3).fill(layouts[0].map(system => system.naturalWidth)));
});

test("quality display aliases contribute their displayed width without altering default spacing or source", () => {
  const result = parseMstruct('{BN:1}{TS:adlib}{D:1/32}CmM7|;', { specialChords, romanConfig });
  assert.equal(result.ok, true);
  const original = JSON.stringify(result);
  const defaults = engraveMeasure(result.measures[0]);
  const unchanged = engraveMeasure(result.measures[0], { preferences: { majorSeventhDisplay: "M", minorDisplay: "m" } });
  const longer = engraveMeasure(result.measures[0], { preferences: { majorSeventhDisplay: "maj", minorDisplay: "mi" } });
  assert.equal(defaults.naturalWidth, unchanged.naturalWidth);
  assert.ok(longer.naturalWidth > defaults.naturalWidth);
  assert.equal(JSON.stringify(result), original);
});

test("annotated chords keep the same side guards as full-size chord text", () => {
  const parsed = parseMstruct('{BN:89}{TS:4/4}{TC:e}{D:1/2}CM7\\\\Em/B|bVI7\\\\i64,;', { specialChords, romanConfig });
  assert.equal(parsed.ok, true);
  const slot = engraveMeasure(parsed.measures[0]).slots[0];
  // The shared Academico DOM group is 135.47px at the 16px score base.
  // The old 150px core left only 7.27px per side instead of the usual 14px.
  assert.ok(slot.contentNaturalWidth >= 135.47 + 28);
  for (const rendererScale of [50, 75, 100, 120, 150, 300]) {
    const systems = layoutSystems(parsed.flow, 900, { rendererScale });
    assert.equal(systems[0].items[0].segment.slots[0].contentNaturalWidth, slot.contentNaturalWidth);
  }
});

test("renderer scale reflows complete measures and oversized measures in the same logical coordinate system", () => {
  const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1/4}{TC:C}${"C|I,,,;".repeat(16)}`, { specialChords, romanConfig });
  assert.equal(parsed.ok, true);
  const systemsByScale = [50, 100, 300].map((rendererScale) => layoutSystems(parsed.flow, 900, { rendererScale }));
  assert.ok(systemsByScale[0].length < systemsByScale[1].length);
  assert.ok(systemsByScale[1].length < systemsByScale[2].length);
  for (const [index, scale] of [50, 100, 300].entries()) {
    const systems = systemsByScale[index];
    assert.equal(systems[0].targetWidth, 900 * 100 / scale);
    const slots = systems.flatMap(system => system.items.flatMap(item => item.segment?.slots ?? []));
    assert.equal(slots.length, parsed.measures.reduce((count, measure) => count + measure.slots.length, 0));
    assert.ok(systems.every(system => system.naturalWidth * scale / 100 <= 900));
  }
  assert.equal(layoutSystems(parsed.flow, 480, { rendererScale: 300 })[0].targetWidth, 160);
  assert.deepEqual(layoutSystems(parsed.flow, 900), systemsByScale[1]);
});

test("renderer scale restores safe device values and resolves lengths against the score base font", () => {
  for (const value of [null, undefined, "300", NaN, Infinity]) assert.equal(normalizeRendererScale(value), 100);
  assert.equal(normalizeRendererScale(20), 50);
  assert.equal(normalizeRendererScale(400), 300);
  assert.equal(normalizeRendererScale(123), 125);
  assert.equal(readRendererScale({ getItem: () => "300" }), 300);
  assert.equal(readRendererScale({ getItem: () => "broken" }), 100);
  assert.equal(readRendererScale({ getItem: () => { throw new Error("unavailable"); } }), 100);
  assert.equal(scoreLength(26), "calc(1.625 * var(--score-font-size, 16px))");
});

test("quoted references contribute their quotes to ordinary and modulation prefix spacing", () => {
  for (const [plain, quoted] of [
    ['{TC:C}C|I', '{TC:"C"}C|I'],
    ['{TC:C}{MH:G|V}G|I', '{TC:"C"}{MH:"G"|V}G|I'],
    ['{TC:C}{M:d|ii}FM7|IV&bIII{/M}', '{TC:"C"}{M:"d"|ii}FM7|IV&bIII{/M}'],
  ]) {
    const width = body => {
      const parsed = parseMstruct(`{BN:1}{D:1/32}{TS:adlib}${body};`, { specialChords, romanConfig });
      assert.equal(parsed.ok, true, parsed.errors.map(error => error.code).join(","));
      return engraveMeasure(parsed.measures[0]).slots[0].naturalWidth;
    };
    assert.ok(width(quoted) > width(plain), quoted);
  }
});

test("engraving 使用对数式时值宽度，并受文字最小宽度保护", () => {
  assert.ok(rhythmicWidth({ numerator: 1, denominator: 2 }) > rhythmicWidth({ numerator: 1, denominator: 4 }));
  assert.ok(rhythmicWidth({ numerator: 1, denominator: 4 }) > rhythmicWidth({ numerator: 1, denominator: 8 }));
  assert.ok(rhythmicWidth({ numerator: 1, denominator: 8 }) > rhythmicWidth({ numerator: 1, denominator: 16 }));

  const parsed = parseMstruct("{BN:1}{TS:adlib}{D:1/4}{TC:C}[C:C13b9#11sus(2,4)add#15no5/GonDm/A|R:Ger+6/V],,,;");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  const layout = engraveMeasure(parsed.measures[0]);
  assert.ok(layout.slots[0].naturalWidth > rhythmicWidth(parsed.measures[0].slots[0].duration));
});

test("任务 2 样例支持自动 BN、LB、省略号及后续重新定义", () => {
  const parsed = parseMstruct(TASK2_EXAMPLE_SOURCE);
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(parsed.measures.map((measure) => measure.barNumber), [1, 2, 3, 4, 39, 50, 51]);
  assert.equal(parsed.measures[4].truncatedByEllipsis, true);
  assert.equal(parsed.flow.filter((item) => item.kind === "lineBreak").length, 1);
  assert.equal(parsed.flow.filter((item) => item.kind === "ellipsis").length, 2);

  const systems = layoutSystems(parsed.flow, 540);
  assert.ok(systems.length >= 4);
  assert.ok(systems.some((system) => system.endsWithEllipsis));
  assert.ok(systems.every((system) => system.items.length > 0));

  const wideSystems = layoutSystems(parsed.flow, 900);
  assert.deepEqual(
    wideSystems[0].items.filter((item) => item.kind === "measure").map((item) => item.measure.barNumber),
    [1, 2],
  );
  assert.deepEqual(
    wideSystems[0].items.filter((item) => item.kind === "measure").map((item) => item.startsSystem),
    [true, false],
  );
  assert.deepEqual(
    wideSystems[1].items.filter((item) => item.kind === "measure").map((item) => item.measure.barNumber),
    [3],
  );
});

test("独立事件按文字和合并后的时值参与制谱宽度", () => {
  const parsed = parseMstruct("{BN:1}{TS:4/4}{1/4}X,0,-,N.C.;");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));

  const engraving = engraveMeasure(parsed.measures[0]);
  assert.equal(engraving.slots.length, 4);
  assert.ok(engraving.slots[3].naturalWidth >= rhythmicWidth(parsed.measures[0].slots[3].duration));
  assert.deepEqual(parsed.measures[0].slots.map(slotDurationLabel), ["1/4", "1/4", "1/4", "1/4"]);

  const extended = parseMstruct("{BN:1}{TS:4/4}{1/4}X,,,-;");
  assert.equal(extended.ok, true, extended.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(extended.measures[0].slots.map(slotDurationLabel), ["3/4", "1/4"]);
  assert.ok(engraveMeasure(extended.measures[0]).slots[0].naturalWidth > engraving.slots[0].naturalWidth);
});

test("速度术语会扩大所在 slot 的文字宽度下限", () => {
  const plain = parseMstruct("{BN:1}{TS:adlib}{D:1}C|;");
  const marked = parseMstruct("{BN:1}{TS:adlib}{D:1}{TEMPO:Allegro con brio}C|;");
  assert.equal(plain.ok, true);
  assert.equal(marked.ok, true);
  assert.ok(engraveMeasure(marked.measures[0]).slots[0].naturalWidth > engraveMeasure(plain.measures[0]).slots[0].naturalWidth);
});

test("关闭速度图层会移除速度宽度并允许 system 重新分行", () => {
  const parsed = parseMstruct("{BN:1}{D:1/4}{TS:adlib}{TEMPO:Prestissimo molto agitato}C|,{TEMPO:Prestissimo molto agitato}D|,{TEMPO:Prestissimo molto agitato}E|,{TEMPO:Prestissimo molto agitato}F|,{TEMPO:Prestissimo molto agitato}G|,{TEMPO:Prestissimo molto agitato}A|;");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  const visible = layoutSystems(parsed.flow, 360);
  const hidden = layoutSystems(parsed.flow, 360, { layers: { speed: false } });
  assert.ok(hidden.length < visible.length);
  assert.ok(engraveMeasure(parsed.measures[0], { layers: { speed: false } }).slots[0].naturalWidth
    < engraveMeasure(parsed.measures[0]).slots[0].naturalWidth);
});

test("NR 短标签复用原事件间距，最长六字母标签补足目标左侧空间", () => {
  const plain = parseMstruct("{BN:1}{TS:adlib}{D:1}C|,Cm|;");
  const transformed = parseMstruct("{BN:1}{TS:adlib}{D:1}C|,[NR:RP]Cm|;");
  const longAcrossBarline = parseMstruct("{BN:1}{TS:adlib}{D:1/4}C|;{BN:2}[NR:PLRPLR]Cm|;");
  assert.equal(plain.ok, true, plain.errors.map((error) => error.message).join("\n"));
  assert.equal(transformed.ok, true, transformed.errors.map((error) => error.message).join("\n"));
  assert.equal(longAcrossBarline.ok, true, longAcrossBarline.errors.map((error) => error.message).join("\n"));
  const plainTarget = engraveMeasure(plain.measures[0]).slots[1];
  const transformedTarget = engraveMeasure(transformed.measures[0]).slots[1];
  assert.equal(transformedTarget.leftOverflow, plainTarget.leftOverflow);
  assert.equal(transformedTarget.naturalWidth, plainTarget.naturalWidth);
  assert.equal(transformedTarget.contentShift, plainTarget.contentShift);
  const longTarget = engraveMeasure(longAcrossBarline.measures[1]).slots[0];
  assert.ok(longTarget.leftOverflow >= 30);
  assert.ok(longTarget.leftOverflow <= 40);
});

test("MH 前缀补足实际碰撞缺口，同时不复制整段标签宽度", () => {
  const plain = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{TC:C}C|I,D|V;");
  const hardModulation = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{TC:C}C|I,{MH:G|V}D|V;");
  const longHardModulation = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{TC:Eb}Ab|IV,{MH:Db|bVII}Db|I;");
  assert.equal(plain.ok, true, plain.errors.map((error) => error.message).join("\n"));
  assert.equal(hardModulation.ok, true, hardModulation.errors.map((error) => error.message).join("\n"));
  assert.equal(longHardModulation.ok, true, longHardModulation.errors.map((error) => error.message).join("\n"));
  const plainTarget = engraveMeasure(plain.measures[0]).slots[1];
  const modulationTarget = engraveMeasure(hardModulation.measures[0]).slots[1];
  const longModulationTarget = engraveMeasure(longHardModulation.measures[0]).slots[1];
  assert.ok(modulationTarget.leftOverflow > 0);
  assert.ok(modulationTarget.leftOverflow <= 20);
  assert.ok(modulationTarget.naturalWidth - plainTarget.naturalWidth <= 20);
  assert.ok(longModulationTarget.leftOverflow >= 45);
  assert.ok(longModulationTarget.leftOverflow <= 60);
});

test("相同时值共享伸展权重，但各自内容下限不会复制给其他 slot", () => {
  const parsed = parseMstruct("{BN:1}{TS:4/4}{D:1}C|;{D:1/4}C|,Csus4|,C|,-;");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  const measure = parsed.measures[1];
  const widths = engraveMeasure(measure).slots.map((slot) => slot.naturalWidth);
  assert.equal(widths[0], widths[2]);
  assert.equal(widths[0], widths[3]);
  assert.ok(widths[1] > widths[0]);
  assert.deepEqual(engraveMeasure(measure).slots.map((slot) => slot.stretchWeight), [.25, .25, .25, .25]);
});

test("转调标签只扩展自身 slot，不复制到同小节的全部等时值事件", () => {
  const makeSlot = (event) => ({
    duration: { numerator: 1, denominator: 4 },
    durationLabel: "1/4",
    annotations: { time: null, bpm: null },
    events: [event],
    timeSignature: null,
  });
  const pivot = (chord, oldRoman, newRoman, extra = {}) => ({
    chord,
    roman: `${oldRoman}&${newRoman}`,
    romanLayers: [{ roman: oldRoman }, { roman: newRoman }],
    ...extra,
  });
  const measure = {
    complete: true,
    duration: { numerator: 1, denominator: 1 },
    slots: [
      makeSlot(pivot("G", "V", "IV", {
        modulationStart: {
          previousTonalCenter: "C",
          previousRelation: "I",
          targetTonalCenter: "d",
          targetRelation: "ii",
        },
      })),
      makeSlot(pivot("Am", "vi", "v")),
      makeSlot({ chord: null, roman: null, symbol: "X" }),
      makeSlot(pivot("Am", "vi", "v", { modulationEnd: true })),
    ],
  };
  const engraving = engraveMeasure(measure);
  const widths = engraving.slots.map((slot) => slot.naturalWidth);
  assert.ok(widths[0] > widths[1]);
  assert.ok(engraving.slots[0].leftOverflow >= 42);
  assert.equal(widths[1], widths[2]);
  assert.equal(widths[3], widths[2]);
  assert.equal(engraveMeasure(measure).slots[3].rightOverflow, 0);
  const systems = layoutSystems([{ kind: "measure", measure }], 540);
  assert.equal(systems.length, 1);
  assert.equal(systems[0].items[0].segment.slots.length, 4);
});

test("小节开头的转调为两行调性、左括号和小节线间隙保留完整宽度", () => {
  const starts = [
    { previousTonalCenter: "d", previousRelation: "i", targetTonalCenter: "a", targetRelation: "v" },
    { previousTonalCenter: "a", previousRelation: "i", targetTonalCenter: "F", targetRelation: "bVI" },
    { previousTonalCenter: "F", previousRelation: "I", targetTonalCenter: "C", targetRelation: "V" },
  ];
  for (const modulationStart of starts) {
    const slot = {
      duration: { numerator: 1, denominator: 1 },
      durationLabel: "1",
      annotations: { time: null, bpm: null },
      events: [{
        chord: "Dm",
        roman: "i&iv",
        romanLayers: [{ roman: "i" }, { roman: "iv" }],
        modulationStart,
      }],
      timeSignature: null,
    };
    const measure = { complete: true, duration: slot.duration, slots: [slot] };
    assert.ok(engraveMeasure(measure).slots[0].leftOverflow >= 20);
  }
});

test("长注释与转调标签不应把四拍小节拆行，后续小节也保持完整", () => {
  const source = String.raw`{BN:1}{BPM:1/4=60}{TS:4/4}{D:1/4}{TC:Gb}Gb7alt\\Edim/C|I\\V7/IV,{M:C#|V}Db|V&bII,X,F#7alt/C#|I&IV{/M};
{MH:F#|IV}C#|V,C#|V,F#|I,F#7alt/C#\\C#|I\\V;`;
  const parsed = parseMstruct(source, { specialChords, romanConfig });
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));

  const systems = layoutSystems(parsed.flow, 820);
  assert.equal(systems.length, 2);
  assert.deepEqual(systems.map((system) => system.items.length), [1, 1]);
  assert.deepEqual(
    systems.map((system) => system.items[0].segment.slots.length),
    [4, 4],
  );
  assert.ok(systems.every((system) => system.naturalWidth <= 820));
  const secondMeasure = engraveMeasure(parsed.measures[1]);
  assert.ok(secondMeasure.slots[0].leftOverflow > 0);
  assert.equal(secondMeasure.slots[0].rightOverflow, 0);
  assert.ok(secondMeasure.slots[0].contentShift > 0);
  assert.equal(secondMeasure.slots[1].contentShift, 0);
  assert.ok(Math.abs(
    secondMeasure.slots[0].naturalWidth
      - secondMeasure.slots[0].leftOverflow
      - secondMeasure.slots[1].naturalWidth,
  ) < 1);
});

test("超宽小节的最后片段可与下一小节共用剩余 system", () => {
  const first = parseMstruct(`{BN:1}{TS:adlib}{D:1/8}${[...Array.from({ length: 4 }, () => "C13b9#11sus|"), "C|"].join(",")};`);
  const second = parseMstruct("{BN:2}{TS:adlib}{D:1/4}C|,C|,C|,C|;");
  assert.equal(first.ok, true, first.errors.map((error) => error.message).join("\n"));
  assert.equal(second.ok, true, second.errors.map((error) => error.message).join("\n"));
  const flow = [
    { kind: "measure", measure: first.measures[0] },
    { kind: "measure", measure: second.measures[0] },
  ];
  const systems = layoutSystems(flow, 700);
  const lastFirst = systems.findIndex((system) => system.items.some((item) => item.measure === first.measures[0] && item.segment.endsMeasure));
  assert.ok(lastFirst >= 0);
  assert.ok(systems[lastFirst].items.some((item) => item.measure === second.measures[0]));
});

test("任务 2 的标准写法和简写写法渲染相同的小节语义", () => {
  const standardSource = [
    "{BN:1}{T=0:00}{BPM:1/4=60}{TS:4/4}{D:1/4}{TC:C}[C:C|R:I],",
    "{T=0:01}[C:Fm|R:iv],[C:G|R:V],",
    "{D:1/8}[C:C|R:I],[C:C|R:I];",
    "{D:1/8}[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I];",
    "{D:1}[C:C|R:I];{LB}",
    "{D:1}[C:C|R:I];...",
    "{BN:39}{D:1/4}[C:C|R:I]...",
    "{BN:50}{D:1/4}[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I];",
    "{D:1/4}[C:C|R:I],[C:C|R:I],[C:C|R:I],[C:C|R:I];",
  ].join("\n");
  const standard = parseMstruct(standardSource);
  const shorthand = parseMstruct(TASK2_EXAMPLE_SOURCE);
  const comparable = (parsed) => ({
    flow: parsed.flow.map((item) => item.kind),
    measures: parsed.measures.map((measure) => ({
      barNumber: measure.barNumber,
      duration: measure.duration,
      timeSignature: measure.timeSignature,
      truncatedByEllipsis: measure.truncatedByEllipsis,
      slots: measure.slots.map((slot) => ({
        duration: slot.duration,
        durationLabel: slot.durationLabel,
        annotations: slot.annotations,
        events: slot.events.map(({ chord, roman, tonalCenter, tonalPrefix }) => ({ chord, roman, tonalCenter, tonalPrefix })),
      })),
    })),
  });

  assert.equal(standard.ok, true, standard.errors.map((error) => error.message).join("\n"));
  assert.equal(shorthand.ok, true, shorthand.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(comparable(shorthand), comparable(standard));
});

test("BN 倒退、错误位置的 LB 与省略号后的缺失 BN 都会报错", () => {
  const conflict = parseMstruct("{BN:3}{TS:adlib}{D:1};{BN:2}{D:1};");
  assert.ok(conflict.errors.some((error) => error.code === "bar-number-backward"));

  const misplacedBreak = parseMstruct("{BN:1}{TS:adlib}{D:1}{LB};");
  assert.ok(misplacedBreak.errors.some((error) => error.code === "line-break-position"));

  const afterEllipsis = parseMstruct("{BN:1}{TS:adlib}{D:1};...{D:1};");
  assert.ok(afterEllipsis.errors.some((error) => error.code === "missing-initial-bn"));
});

test("过长小节按完整 slot 自动续排到下一行", () => {
  const thirtySecondNotes = Array.from({ length: 32 }, () => "[C:C|R:I]").join(",");
  const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1/32}{TC:C}${thirtySecondNotes};`);
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));

  const systems = layoutSystems(parsed.flow, 360);
  const fragments = systems.flatMap((system) => system.items.filter((item) => item.kind === "measure"));
  assert.ok(fragments.length > 1);
  assert.equal(fragments.reduce((count, item) => count + item.segment.slots.length, 0), 32);
  assert.equal(fragments[0].segment.startsMeasure, true);
  assert.equal(fragments.at(-1).segment.endsMeasure, true);
  assert.ok(fragments.slice(1).every((item) => item.segment.startsMeasure === false));
  assert.equal(fragments[0].startsSystem, true);
  assert.ok(fragments.slice(1).every((item) => item.startsSystem === false));
  assert.ok(systems.every((system) => system.naturalWidth <= 360));
});
