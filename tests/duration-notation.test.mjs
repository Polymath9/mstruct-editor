import assert from "node:assert/strict";
import test from "node:test";
import { describeDuration, durationDisplayWidth } from "../src/core/duration-notation.js";
import { engraveMeasure } from "../src/core/engraving.js";
import { parseMstruct } from "../src/core/mstruct.js";
import { makeDurationLabel, makeDurationNotes } from "../src/ui/duration-label.js";
import { normalizeRendererPreferences } from "../src/core/renderer-preferences.js";
import { readFile } from "node:fs/promises";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { compileProfileDocument } from "../src/core/profile-document.js";
import { verifyMstructProfile } from "../src/core/profile.js";

const value = (numerator, denominator = 1) => ({ numerator, denominator });
const notes = (numerator, denominator) => describeDuration(value(numerator, denominator));

function makeElement(tag, className, textContent = "") {
  return {
    tag, className, textContent, children: [], attributes: {},
    classList: { add() {} },
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
  };
}

test("down stems keep the original advance, use upright noteheads and preserve dots and tuplets", () => {
  for (const denominator of [1, 2, 4, 8, 16, 32, 64]) {
    const up = makeDurationNotes(value(1, denominator), "", makeElement, "duration");
    const down = makeDurationNotes(value(1, denominator), "", makeElement, "duration", true);
    const original = up.children[0].children[0].children[0];
    const flipped = down.children[0].children[0].children[0];
    assert.equal(flipped.children[0].textContent, original.textContent);
    assert.equal(flipped.children[1].textContent.codePointAt(0), original.textContent.codePointAt(0) + (denominator === 1 ? 0 : 1));
  }
  for (const duration of [value(3, 8), value(7, 16), value(15, 32), value(2, 3), value(31, 32), value(11, 16)]) {
    const up = makeDurationNotes(duration, "", makeElement, "duration");
    const down = makeDurationNotes(duration, "", makeElement, "duration", true);
    assert.deepEqual(down.attributes, up.attributes);
    assert.equal(down.children[0].children.length, up.children[0].children.length);
    down.children[0].children.forEach((symbol, index) => {
      assert.equal(JSON.stringify(symbol.children.slice(1)), JSON.stringify(up.children[0].children[index].children.slice(1)));
    });
  }
  const slot = { duration: value(1, 4) };
  const tr = () => "duration";
  assert.equal(JSON.stringify(makeDurationLabel(slot, "fraction", makeElement, tr, true)), JSON.stringify(makeDurationLabel(slot, "fraction", makeElement, tr)));
  assert.equal(makeDurationNotes(value(1, 128), "1/128", makeElement, "duration", true), null);
});

test("stem preference defaults off and survives fraction mode", () => {
  for (const input of [undefined, null, {}, { durationStemDown: "true" }]) assert.equal(normalizeRendererPreferences(input).durationStemDown, false);
  assert.equal(normalizeRendererPreferences({ durationDisplayMode: "fraction", durationStemDown: true }).durationStemDown, true);
});

test("Renderer Test covers four-row figured bass with all duration shapes", async () => {
  const source = await readFile(new URL("fixtures/renderer-duration-stems.mstruct", import.meta.url), "utf8");
  const document = parseMstructDocument(source);
  assert.equal(document.ok, true);
  const profile = await verifyMstructProfile(JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url), "utf8")));
  const parsed = compileProfileDocument(document, profile);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.ok(document.main.includes("V[9,7,5,3-x]"));
  assert.ok(parsed.measures.length >= 4);
});

test("非二进制分母使用连音数字和分子乘数", () => {
  for (const [denominator, basicDenominator] of [[3, 2], [5, 4], [6, 4], [11, 8]]) {
    assert.deepEqual(notes(1, denominator), {
      kind: "notes", fraction: `1/${denominator}`,
      notes: [{ denominator: basicDenominator, dots: 0, tuplet: denominator }], multiplier: 1,
    });
  }
  assert.deepEqual(notes(2, 3).multiplier, 2);
  assert.deepEqual(notes(7, 129), { kind: "fraction", fraction: "7/129" });
});

test("单个附点优先，其余分解为最多四个独立音符", () => {
  assert.deepEqual(notes(3, 4).notes, [{ denominator: 2, dots: 1, tuplet: null }]);
  assert.deepEqual(notes(7, 8).notes, [{ denominator: 2, dots: 2, tuplet: null }]);
  assert.deepEqual(notes(15, 16).notes, [{ denominator: 2, dots: 3, tuplet: null }]);
  assert.deepEqual(notes(5, 16).notes.map((note) => note.denominator), [4, 16]);
  assert.deepEqual(notes(11, 16).notes.map((note) => note.denominator), [2, 8, 16]);
  assert.deepEqual(notes(5, 2).notes.map((note) => note.denominator), [1, 1, 2]);
  assert.deepEqual(notes(3, 1).notes.map((note) => note.denominator), [1, 1, 1]);
});

test("五个以上音符改为乘法，基本音符范围外回退分数", () => {
  assert.deepEqual(notes(31, 32), {
    kind: "notes", fraction: "31/32",
    notes: [{ denominator: 32, dots: 0, tuplet: null }], multiplier: 31,
  });
  assert.deepEqual(notes(5, 1).multiplier, 5);
  assert.deepEqual(notes(1, 128), { kind: "fraction", fraction: "1/128" });
  assert.deepEqual(describeDuration(value(0, 1), "0"), { kind: "fraction", fraction: "0" });
});

test("分数与音符模式共用稳定宽度，不因切换而改变横向制谱", () => {
  assert.equal(durationDisplayWidth(value(11, 64), "note", "11/64"), durationDisplayWidth(value(11, 64), "fraction", "11/64"));
  for (const source of ["{BN:1}{TS:adlib}{D:11/64}C|;", "{BN:1}{TS:adlib}{D:11/64}X;"]) {
    const parsed = parseMstruct(source);
    assert.equal(parsed.ok, true);
    const fraction = engraveMeasure(parsed.measures[0]);
    const note = engraveMeasure(parsed.measures[0], { durationDisplayMode: "note" });
    assert.equal(note.slots[0].naturalWidth, fraction.slots[0].naturalWidth);
  }
});
