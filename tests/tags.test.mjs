import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseMstruct } from "../src/core/mstruct.js";
import { buildPlaybackPlan } from "../src/core/mstruct-playback.js";
import { playbackEntryInformation } from "../src/core/mstruct-playback-info.js";
import { parseTagConfigCsv, tagDisplayName } from "../src/core/tag-config.js";
import { parseFormTagConfigCsv } from "../src/core/form-tag-config.js";
import { parseGlobalTagList, parseSemanticTagConfigCsv, tagDisplayParts } from "../src/core/semantic-tags.js";
import { parseRomanConfigCsv } from "../src/core/roman-symbol.js";
import { visibleTagLaneMap } from "../src/core/renderer-layers.js";

test("closing prefixes are reserved in CSV definitions and GLOBAL_TAGS accepts forward slash only", () => {
  for (const token of ["</custom>", "<*/custom>"]) {
    assert.throws(() => parseTagConfigCsv(`token,zh_name,en_name,duration_mode\n${token},标签,Tag,2\n`), /closing prefixes/);
  }
  const config = parseTagConfigCsv("token,zh_name,en_name,duration_mode\n<one>,一,One,1\n");
  const options = { tagConfig: config };
  assert.equal(parseGlobalTagList("</one>", options).ok, true);
  assert.equal(parseGlobalTagList(String.raw`<\one>`, options).ok, false);
  assert.equal(parseGlobalTagList("<*/one>", options).ok, false);
});

const defaultCsv = await readFile(new URL("../src/config/tags.csv", import.meta.url), "utf8");
const testCsv = [
  "token,zh_name,en_name,duration_mode",
  "<one>,一,One,1",
  "<two>,二,Two,2",
  "<three>,三,Three,3",
  "<four>,四,Four,1",
  "<1>,标签一,Tag 1,3",
  "<2>,标签二,Tag 2,3",
  "<3>,标签三,Tag 3,3",
  "",
].join("\n");
const tagConfig = parseTagConfigCsv(testCsv);
const [cadenceCsv, tonalCsv, sequenceCsv, romanBasicCsv, romanAdvancedCsv, romanFiguredBassCsv, romanSpecialCsv] = await Promise.all([
  readFile(new URL("../src/config/cadence-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/tonal-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/sequence-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-basic.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-advanced.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-figured-bass.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-special.csv", import.meta.url), "utf8"),
]);
const romanConfig = parseRomanConfigCsv({ basicCsv: romanBasicCsv, advancedCsv: romanAdvancedCsv, figuredBassCsv: romanFiguredBassCsv, specialCsv: romanSpecialCsv });
const semanticTagConfig = parseSemanticTagConfigCsv({ cadenceCsv, tonalCsv, sequenceCsv }, { romanConfig });
const defaultTagConfig = parseTagConfigCsv(defaultCsv);
const defaultFormTagConfig = parseFormTagConfigCsv(await readFile(new URL("../src/config/form-tags.csv", import.meta.url), "utf8"));

test("detached endpoints display the localized ending for every ranged tag family", () => {
  const options = { tagConfig: defaultTagConfig, formTagConfig: defaultFormTagConfig, semanticTagConfig, romanConfig };
  const cases = [
    ...[defaultTagConfig, defaultFormTagConfig].flatMap(config => config.tags
      .filter(tag => tag.durationMode !== 1)
      .map(tag => [tag.token, `<*/${tag.token.slice(1, -1)}>`])),
    ...["F", '"f#"'].map(note => [`<Centricity:${note}>`, "<*/Centricity>"]),
    ...[...romanConfig.basics.keys()].map(roman => [`<pedal:${roman}>`, "<*/pedal>"]),
    ...semanticTagConfig.tonal.entries.flatMap(entry => [
      ...(entry.modeZhName ? [[`<Mode_${entry.base}:Bb>`, `<*/Mode_${entry.base}>`]] : []),
      ...(entry.scaleZhName ? [[`<Scale_${entry.base}:Bb>`, `<*/Scale_${entry.base}>`]] : []),
    ]),
    ...["Seq", "SeqInv"].flatMap(family => [...semanticTagConfig.sequences.byValue.keys()]
      .map(value => [`<${family}:${value}>`, `<*/${family}>`])),
  ];
  for (const [opening, closing] of cases) {
    // Reusing a definition must not accumulate endings or change its structured parameters.
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1/4}${opening}X,X,${closing}X,${opening}X,X,${closing}X;`, options);
    assert.equal(result.ok, true, `${opening}: ${JSON.stringify(result.errors)}`);
    const allSlots = result.measures[0].slots;
    const tags = allSlots.flatMap(slot => slot.tags);
    assert.deepEqual(tags.map(tag => tag.kind), ["start", "detached-end", "start", "detached-end"]);
    assert.ok(result.tagRanges.every(range => range.visualMode === "detached"), opening);
    for (const slot of [allSlots[1], allSlots[4]]) {
      assert.equal(slot.tagOccupiedLanes.size, 0, `${opening} must not reserve interior rows`);
      assert.equal(slot.activeTags[0].visualMode, "detached", opening);
    }
    for (const locale of ["zh", "en"]) {
      const startParts = tagDisplayParts(tags[0], locale);
      const startName = tagDisplayName(tags[0], locale);
      const endName = startName + (locale === "en" ? " End" : "结束");
      assert.equal(startParts.map(part => part.value).join(""), startName, opening);
      assert.equal(tagDisplayParts(tags[2], locale).map(part => part.value).join(""), startName, opening);
      for (const tag of [tags[1], tags[3]]) {
        const parts = tagDisplayParts(tag, locale);
        assert.equal(tagDisplayName(tag, locale), endName, closing);
        assert.equal(parts.map(part => part.value).join(""), endName, closing);
        assert.deepEqual(parts.filter(part => ["note", "roman"].includes(part.type)),
          startParts.filter(part => ["note", "roman"].includes(part.type)), closing);
      }
    }
  }
});

test("a later detached semantic range does not remove an earlier ordinary range's line", () => {
  for (const [opening, closing, detached] of [
    ["<Centricity:F>", "</Centricity>", "<*/Centricity>"],
    ["<pedal:V>", "</pedal>", "<*/pedal>"],
    ["<Mode_Dorian:d>", "</Mode_Dorian>", "<*/Mode_Dorian>"],
    ["<Scale_AlteredScale:C>", "</Scale_AlteredScale>", "<*/Scale_AlteredScale>"],
  ]) {
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1/4}${opening}X,X,${closing}X,${opening}X,X,${detached}X;`,
      { semanticTagConfig, romanConfig });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.tagRanges.map(range => range.visualMode), ["line", "detached"]);
    assert.equal(result.measures[0].slots[1].tagOccupiedLanes.size, 1);
    assert.equal(result.measures[0].slots[4].tagOccupiedLanes.size, 0);
  }
});

test("default tag rows keep continuous lines fixed and reuse detached interior rows for later starts", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1/4}<Centricity:F><Scale_Phrygian:F>X;X;</Scale_Phrygian>X;<Constant_Structure>X;X;</Constant_Structure>X;<*/Centricity>X;",
    { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const slots = result.measures.map(measure => measure.slots[0]);
  const layers = { form: true, tags: true };
  assert.deepEqual([...visibleTagLaneMap([slots[0]], layers)], [[0, 0], [1, 1]]);
  assert.deepEqual([...visibleTagLaneMap([slots[1]], layers)], [[1, 1]], "the scale stays on its starting second row");
  assert.deepEqual([...visibleTagLaneMap([slots[3]], layers)], [[0, 0]], "a later line starts on the vacant first row");
  assert.deepEqual([...visibleTagLaneMap([slots[6]], layers)], [[0, 0]]);
  const independent = parseMstruct("{BN:1}{TS:adlib}{D:1/4}<Centricity:F>X;<Constant_Structure>X;<*/Centricity>X;</Constant_Structure>X;",
    { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(independent.ok, true, JSON.stringify(independent.errors));
  const endingTags = independent.measures[2].slots[0].tags;
  assert.equal(endingTags[0].lane, 1, "a detached endpoint may move to another free row");
  assert.deepEqual([...visibleTagLaneMap([slots[1]], { tags: true, form: false })], [[1, 0]], "hidden layers retain compact layout");
});

test("ordinary and one-shot semantic endings keep their existing display", () => {
  const options = { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig };
  for (const [opening, closing, oneShot] of [
    ["<Centricity:F>", "</Centricity>", "</Centricity:F>"],
    ["<pedal:V>", "</pedal>", null],
    ["<Mode_Dorian:d>", "</Mode_Dorian>", "</Mode_Dorian:d>"],
    ["<Scale_AlteredScale:C>", "</Scale_AlteredScale>", "</Scale_AlteredScale:C>"],
    ["<Seq:A2>", "</Seq>", null],
    ["<SeqInv:A2>", "</SeqInv>", null],
  ]) {
    const result = parseMstruct(`{BN:1}{TS:adlib}{D:1/4}${opening}X,${closing}X${oneShot ? `,${oneShot}X` : ""};`, options);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const tags = result.measures[0].slots.map(slot => slot.tags[0]);
    assert.equal(tags[1].kind, "end");
    for (const locale of ["zh", "en"]) for (const tag of tags) {
      assert.equal(tagDisplayParts(tag, locale).map(part => part.value).join(""), tagDisplayName(tags[0], locale));
    }
  }
});

test("special DTC and FORM_END controls include their localized ending in display parts", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1/4}</DTC>X,</FORM_END>X,</FORM_END:Sonata_Form>X;", { formTagConfig: defaultFormTagConfig });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  for (const slot of result.measures[0].slots) for (const locale of ["zh", "en"]) {
    const tag = slot.tags[0];
    const text = tagDisplayParts(tag, locale).map(part => part.value).join("");
    assert.equal(text, tagDisplayName(tag, locale));
    assert.ok(text.endsWith(locale === "en" ? " End" : "结束"));
  }
});

test("播放信息合并当前持续标签、one-shot 与活动注释", () => {
  const comments = [{ number: 1, texts: { zh_cn: "当前注释", en: "Current comment" } }];
  const result = parseMstruct(
    "{BN:1}{TS:3/4}{D:1/4}{BPM:1/4=90}[COMMENT:1]<two>C|,</one>D|,[/COMMENT]</two>E|;",
    { isStableTempo: true, comments, tagConfig },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const entry = buildPlaybackPlan(result).entries[1];
  const information = playbackEntryInformation(entry, { comments, locale: "en", sharp9AsFlat10: true });
  assert.equal(information.bpm, "1/4=90");
  assert.equal(information.timeSignatureLabel, "3/4");
  assert.deepEqual(information.activeTags.map((tag) => tag.enName), ["Two", "One"]);
  assert.equal(information.comment.text, "Current comment");
  assert.deepEqual(information.noteNames, ["D", "F#", "A"]);
});

test("版本化默认标签 CSV 提供完整本地基线并包含 constant structure", () => {
  const config = parseTagConfigCsv(defaultCsv);
  assert.ok(config.tags.length > 1);
  const constantStructure = config.tags.find((tag) => tag.token === "<Constant_Structure>");
  assert.deepEqual(constantStructure, {
    token: "<Constant_Structure>",
    closingToken: "</Constant_Structure>",
    zhName: "恒定结构",
    enName: "Constant Structure",
    durationMode: 3,
  });
  assert.equal(tagDisplayName(constantStructure, "zh"), "恒定结构");
  assert.equal(tagDisplayName(constantStructure, "en"), "Constant Structure");
});

test("标签 CSV 校验固定表头、ASCII 完整 token、唯一性和持续模式", () => {
  assert.throws(() => parseTagConfigCsv("token,zh_name,en_name\n<a>,甲,A\n"), /header/);
  assert.throws(() => parseTagConfigCsv("token,zh_name,en_name,duration_mode\n<a b>,甲,A,1\n"), /ASCII/);
  assert.throws(() => parseTagConfigCsv("token,zh_name,en_name,duration_mode\n<标签>,甲,A,1\n"), /ASCII/);
  assert.throws(() => parseTagConfigCsv("token,zh_name,en_name,duration_mode\n<a>,甲,A,4\n"), /1, 2, or 3/);
  assert.throws(() => parseTagConfigCsv("token,zh_name,en_name,duration_mode\n<a>,甲,A,1\n<a>,乙,B,2\n"), /duplicated/);
});

test("终止式、持续音与调式音阶使用各自的参数校验和持续规则", () => {
  const source = "{BN:1}{TS:adlib}{D:1/4}{TC:C}</PAC>C|I,<pedal:#IV>C|IV,</pedal>X,</Mode_Dorian:d>Dm|i;";
  const result = parseMstruct(source, { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.measures[0].slots[0].tags[0].semanticKind, "cadence");
  assert.deepEqual(result.measures[0].slots.slice(1, 3).map((slot) => slot.tags[0].kind), ["start", "end"]);
  assert.equal(result.measures[0].slots[3].events[0].tonalCenter, "C");
  assert.equal(result.measures[0].slots[3].events[0].tonalPrefix, undefined);

  const invalidCadence = parseMstruct("{BN:1}{TS:adlib}{D:1}</PC:V>X;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.ok(invalidCadence.errors.some((error) => error.code === "invalid-tag-parameter"));
  const invalidPedal = parseMstruct("{BN:1}{TS:adlib}{D:1/2}<pedal:V7>X,</pedal>X;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.ok(invalidPedal.errors.some((error) => error.code === "invalid-tag-parameter"));
});

test("DC accepts major and minor subdominant destinations in MAIN and GLOBAL_TAGS", () => {
  const options = { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig };
  for (const [destination, chord] of [["IV", "F"], ["iv", "Fm"]]) {
    const result = parseMstruct(`{BN:1}{TS:4/4}{D:1}{TC:C}G|V;${chord}|${destination}</DC:${destination}>;`, options);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const tag = result.measures[1].slots[0].tags[0];
    assert.equal(tag.token, `<DC:${destination}>`);
    assert.equal(tag.semanticKind, "cadence");
    assert.equal(tag.zhParts.filter(part => part.type === "roman").length, 1);
    assert.equal(tag.enParts.filter(part => part.type === "roman").length, 1);
    assert.equal(parseGlobalTagList(`</DC:${destination}>`, options).ok, true);
  }
  for (const destination of ["I", "V", "iV"]) {
    const result = parseMstruct(`{BN:1}{TS:4/4}{D:1}{TC:C}C|I</DC:${destination}>;`, options);
    assert.ok(result.errors.some(error => error.code === "invalid-tag-parameter"));
  }
});

test("fixed cadence labels render their Roman once in both languages", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1}</IAC:viio>X;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(result.ok, true);
  const tag = result.measures[0].slots[0].tags[0];
  assert.equal(tag.zhName, "IAC：viio");
  assert.equal(tag.enName, "IAC: viio");
  for (const parts of [tag.zhParts, tag.enParts]) {
    assert.equal(parts.filter(part => part.type === "roman").length, 1);
    assert.ok(parts.filter(part => part.type === "text").every(part => !part.value.includes("viio")));
  }
});

test("Mode 与 Scale 独立于 TC；Mode 允许 TC、Centricity 与转调并保留自身重叠限制", () => {
  const range = parseMstruct("{BN:1}{TS:adlib}{D:1/3}{TC:C}<Mode_Dorian:d>Dm|i,</Mode_Dorian>X,D|I;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(range.ok, true, range.errors.map((error) => error.message).join("\n"));
  assert.equal(range.measures[0].slots[0].events[0].tonalCenter, "C");
  assert.equal(range.measures[0].slots[2].events[0].tonalCenter, "C");

  const scale = parseMstruct("{BN:1}{TS:adlib}{D:1/2}{TC:C}C|I,</Scale_AlteredScale:d>D|II;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(scale.ok, true, scale.errors.map((error) => error.message).join("\n"));
  assert.equal(scale.measures[0].slots[1].events[0].tonalCenter, "C");

  const overlap = parseMstruct("{BN:1}{TS:adlib}{D:1/2}{TC:C}<Mode_Dorian:d><Centricity:E>C|I,</Centricity></Mode_Dorian>X;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(overlap.ok, true, overlap.errors.map((error) => error.code).join(","));
  const tcInside = parseMstruct("{BN:1}{TS:adlib}{D:1/2}{TC:C}<Mode_Dorian:d>{TC:E}E|I,</Mode_Dorian>X;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(tcInside.ok, true, tcInside.errors.map((error) => error.code).join(","));
  assert.equal(tcInside.measures[0].slots[0].events[0].tonalCenter, "E");
  const twoModes = parseMstruct("{BN:1}{TS:adlib}{D:1/2}<Mode_Dorian:d><Mode_Ionian:C>X,</Mode_Dorian>;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.ok(twoModes.errors.some((error) => error.code === "mode-tag-overlap"));
  const modulation = parseMstruct('{BN:1}{TS:adlib}{D:1/2}{TC:C}<Mode_Dorian:d>{M:"d"|ii}C|I&i,G|V&I{/M}</Mode_Dorian>;', { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(modulation.ok, true, modulation.errors.map((error) => error.code).join(","));
});

test("Centricity can establish a center after None; Mode cannot establish or restore TC", () => {
  const result = parseMstruct(
    "{BN:1}{TS:adlib}{D:1/2}{TC:None}</Mode_Dorian:d>Dm|,{TC:None}</Centricity:E>E|I;",
    { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.measures[0].slots.map((slot) => slot.events[0].tonalCenter), [null, "E"]);
  assert.deepEqual(result.measures[0].slots.map((slot) => slot.events[0].tonalPrefix), [undefined, "E"]);
  for (const [prefix, code] of [["", "missing-tonal-center"], ["{TC:None}", "roman-in-tonal-center-none"]]) {
    const invalid = parseMstruct(`{BN:1}{TS:adlib}{D:1}${prefix}</Mode_Dorian:d>Dm|i;`, { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
    assert.ok(invalid.errors.some(error => error.code === code));
  }
});

test("quoted Centricity preserves its reference through normal and detached endings", () => {
  const options = { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig };
  for (const closer of ["</Centricity>", "<*/Centricity>"]) {
    const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1/4}{TC:C}<Centricity:"f#">F#m|i,${closer}F#m|i,</Centricity:"C">C|III,C|I;`, options);
    assert.equal(parsed.ok, true, parsed.errors.map(error => error.code).join(","));
    assert.deepEqual(parsed.measures[0].slots.map(slot => slot.events[0].tonalCenter), ['"f#"', '"f#"', '"C"', '"C"']);
    assert.equal(parsed.measures[0].slots[0].tags[0].token, '<Centricity:"f#">');
  }
  const global = parseGlobalTagList('</Centricity:"C">', options);
  assert.equal(global.ok, true);
  assert.equal(global.tags[0].enName, 'Centricity: "C"');
  assert.equal(parseGlobalTagList('</Mode_Dorian:"d">', options).ok, false);
});

test("全曲标签只接受完整闭合形式并保留配置化显示结构", () => {
  const result = parseGlobalTagList("</Binary_Form></PAC></pedal:V></Mode_Dorian:C></Scale_AlteredScale:C>", {
    formTagConfig: defaultFormTagConfig,
    tagConfig: defaultTagConfig,
    semanticTagConfig,
    romanConfig,
  });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.tags.map((tag) => tag.semanticKind), [undefined, "cadence", "pedal", "mode", "scale"]);
  assert.ok(parseGlobalTagList("<PAC>", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig }).errors.some((error) => error.code === "global-tag-nonclosing"));
});

test("全曲标签拒绝重复项", () => {
  const result = parseGlobalTagList("</PAC></PAC>", {
    tagConfig: defaultTagConfig,
    semanticTagConfig,
    romanConfig,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "duplicate-global-tag"));
});

test("模进标签使用配置化类型、独立命名空间与两种闭合形式", () => {
  assert.equal(semanticTagConfig.sequences.entries.length, 10);
  assert.deepEqual(semanticTagConfig.sequences.byType.get("A2").derivedTypes, ["A2(+5/-4)", "A2(+4/-3)"]);
  const source = "{BN:1}{TS:adlib}{D:1/3}{TC:C}<Seq:A2,A3(+4/-2)>C|I,<SeqInv:D1(+4/-A4)>D|II,</Seq><*/SeqInv>E|III;";
  const result = parseMstruct(source, { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(result.measures[0].slots[0].tags.map((tag) => [tag.zhName, tag.enName]), [["模进：A2, A3(+4/-2)", "Sequence: A2, A3(+4/-2)"]]);
  assert.deepEqual(result.measures[0].slots[1].tags.map((tag) => tag.semanticKind), ["inverted-sequence"]);
  assert.deepEqual(result.measures[0].slots[2].tags.map((tag) => [tag.kind, tag.semanticKind]), [["end", "sequence"], ["detached-end", "inverted-sequence"]]);
  assert.equal(result.tagRanges.length, 2, "Seq and SeqInv ranges may overlap");

  for (const invalid of ["<Seq:Unknown>", "<Seq:A2,A2>"]) {
    const parsed = parseMstruct(`{BN:1}{TS:adlib}{D:1}${invalid}X;`, { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig });
    assert.ok(parsed.errors.some((error) => error.code === "invalid-tag-parameter"), invalid);
  }
  assert.ok(parseMstruct("{BN:1}{TS:adlib}{D:1}<Seq:A2>X;", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig }).errors.some((error) => error.code === "tag-unfinished"));
  assert.equal(parseGlobalTagList("</Seq:A2>", { tagConfig: defaultTagConfig, semanticTagConfig, romanConfig }).ok, false);
});

test("同一 slot 的多个持续标签按源码顺序分行，并分别结束在后续事件", () => {
  const source = "{BN:1}{TS:4/4}{D:1/4}<1><2><3>X,</1>X,</2>X,</3>X;";
  const result = parseMstruct(source, { tagConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.measures[0].slots.length, 4);
  assert.deepEqual(result.measures[0].slots[0].tags.map((tag) => [tag.token, tag.kind, tag.lane]), [
    ["<1>", "start", 0],
    ["<2>", "start", 1],
    ["<3>", "start", 2],
  ]);
  assert.deepEqual(result.measures[0].slots.slice(1).map((slot) => slot.tags[0].kind), ["end", "end", "end"]);
  assert.deepEqual(result.tagRanges.map((range) => [range.token, range.lane, range.end !== null]), [
    ["<1>", 0, true],
    ["<2>", 1, true],
    ["<3>", 2, true],
  ]);

  const alongsideMusic = parseMstruct("{BN:1}{TS:adlib}{D:1/2}[C:C]<two>,X</two>;", { tagConfig });
  assert.equal(alongsideMusic.ok, true, alongsideMusic.errors.map((error) => error.message).join("\n"));
  assert.equal(alongsideMusic.measures[0].slots[0].events[0].chord, "C");
  assert.equal(alongsideMusic.measures[0].slots[0].tags[0].kind, "start");
  assert.equal(alongsideMusic.measures[0].slots[1].tags[0].kind, "end");
});

test("类型 1、2、3 分别执行 one-shot、可选持续和强制持续语义", () => {
  const oneShot = parseMstruct("{BN:1}{TS:adlib}{D:1}</one>X;", { tagConfig });
  assert.equal(oneShot.ok, true, oneShot.errors.map((error) => error.message).join("\n"));
  assert.equal(oneShot.measures[0].slots[0].tags[0].kind, "oneshot");

  const optionalOneShot = parseMstruct("{BN:1}{TS:adlib}{D:1}</two>X;", { tagConfig });
  assert.equal(optionalOneShot.ok, true, optionalOneShot.errors.map((error) => error.message).join("\n"));
  assert.equal(optionalOneShot.measures[0].slots[0].tags[0].kind, "oneshot");

  const optionalRange = parseMstruct("{BN:1}{TS:adlib}{D:1/2}<two>X,</two>X;", { tagConfig });
  assert.equal(optionalRange.ok, true, optionalRange.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(optionalRange.measures[0].slots.map((slot) => slot.tags[0].kind), ["start", "end"]);

  assert.ok(parseMstruct("{BN:1}{TS:adlib}{D:1}<one>X;", { tagConfig }).errors.some((error) => error.code === "tag-start-not-allowed"));
  assert.ok(parseMstruct("{BN:1}{TS:adlib}{D:1}</three>X;", { tagConfig }).errors.some((error) => error.code === "tag-close-without-open"));
});

test("星号结束形式保留逻辑活动范围，但用首尾标签取代持续线和占行", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1/3}<three>X,</four>X,<*/three>X;", { tagConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const [start, middle, end] = result.measures[0].slots;
  assert.deepEqual(start.tags.map((tag) => [tag.kind, tag.visualMode, tag.lane]), [["start", "detached", 0]]);
  assert.deepEqual([...middle.tagOccupiedLanes], [0]);
  assert.deepEqual(middle.tags.map((tag) => [tag.kind, tag.lane]), [["oneshot", 0]]);
  assert.deepEqual(middle.activeTags.map((tag) => tag.enName), ["Three"]);
  assert.deepEqual(end.tags.map((tag) => [tag.kind, tag.zhName, tag.enName, tag.lane]), [["detached-end", "三结束", "Three End", 0]]);
  assert.equal(result.tagRanges[0].visualMode, "detached");

  const plan = buildPlaybackPlan(result);
  assert.deepEqual(
    playbackEntryInformation(plan.entries[1], { locale: "en" }).activeTags.map((tag) => tag.enName),
    ["Three", "Four"],
  );
  assert.deepEqual(
    playbackEntryInformation(plan.entries[2], { locale: "en" }).activeTags.map((tag) => tag.enName),
    ["Three End"],
  );

  assert.ok(parseMstruct("{BN:1}{TS:adlib}{D:1}<*/two>X;", { tagConfig }).errors.some((error) => error.code === "tag-close-without-open"));
  assert.ok(parseMstruct("{BN:1}{TS:adlib}{D:1}<*/one>X;", { tagConfig }).errors.some((error) => error.code === "tag-close-without-open"));
});

test("持续标签拒绝重复起点和同事件重复，并让结束事件保持占行", () => {
  const reopened = parseMstruct("{BN:1}{TS:adlib}{D:1/3}<two>X,<two>X,</two>X;", { tagConfig });
  assert.ok(reopened.errors.some((error) => error.code === "tag-already-open"));

  const duplicated = parseMstruct("{BN:1}{TS:adlib}{D:1}<two></two>X;", { tagConfig });
  assert.ok(duplicated.errors.some((error) => error.code === "duplicate-tag"));

  const lanes = parseMstruct("{BN:1}{TS:adlib}{D:1/2}<three>X,</three></four>X;", { tagConfig });
  assert.equal(lanes.ok, true, lanes.errors.map((error) => error.message).join("\n"));
  assert.deepEqual(lanes.measures[0].slots[1].tags.map((tag) => tag.lane), [0, 1]);
});

test("同一事件可按源码顺序容纳十行以上的不同标签", () => {
  const rows = Array.from({ length: 11 }, (_, index) => `<lane${index + 1}>,行${index + 1},Lane ${index + 1},1`);
  const manyTagsConfig = parseTagConfigCsv(["token,zh_name,en_name,duration_mode", ...rows, ""].join("\n"));
  const source = `{BN:1}{TS:adlib}{D:1}${rows.map((_, index) => `</lane${index + 1}>`).join("")}X;`;
  const result = parseMstruct(source, { tagConfig: manyTagsConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  assert.equal(result.measures[0].slots[0].tags.length, 11);
  assert.deepEqual(result.measures[0].slots[0].tags.map((tag) => tag.lane), Array.from({ length: 11 }, (_, index) => index));
});

test("标签严格区分大小写，未知、未闭合和未结束标签返回精确诊断", () => {
  const unknownSource = "{BN:1}{TS:adlib}{D:1}<THREE>X;";
  const unknown = parseMstruct(unknownSource, { tagConfig });
  assert.ok(unknown.errors.some((error) => error.code === "unknown-tag" && error.start === unknownSource.indexOf("<THREE>")));

  const unclosed = parseMstruct("{BN:1}{TS:adlib}{D:1}<three", { tagConfig });
  assert.ok(unclosed.errors.some((error) => error.code === "unclosed-tag"));

  const unfinished = parseMstruct("{BN:1}{TS:adlib}{D:1}<three>X;", { tagConfig });
  assert.ok(unfinished.errors.some((error) => error.code === "tag-unfinished"));
});

test("持续标签允许跨省略号，并把活动行传给省略号 system", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1}<three>X;...{BN:3}</three>X;", { tagConfig });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const ellipsis = result.flow.find((item) => item.kind === "ellipsis");
  assert.deepEqual([...ellipsis.tagOccupiedLanes], [0]);
  assert.equal(result.measures[1].slots[0].tags[0].kind, "end");
});
