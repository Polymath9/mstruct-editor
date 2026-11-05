import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMstructDocument, serializeMstructDocument } from "../../src/core/mstruct-document.js";
import { coverFields, fitText, wrapText } from "./cover.js";
import { copy } from "./copy.js";

test("cover metadata uses original song and composer names, never romanized or analyst credits", () => {
  const source = serializeMstructDocument({ metadata: { songName: "月の光 · 달빛", songNameRomanized: "wrong title", composers: [{ name: "作曲者", romanized: "wrong author" }, { name: "第二作者" }], creator: "analyst" }, main: "" });
  const parsed = parseMstructDocument(source);
  assert.equal(parsed.ok, true);
  assert.deepEqual(coverFields(parsed.metadata), { title: "月の光 · 달빛", author: "作曲者 / 第二作者" });
  assert.deepEqual(coverFields({ songNameRomanized: "do not substitute", composers: [{ romanized: "do not substitute" }] }), { title: "", author: "" });
});

test("existing editor example is read through the shared document parser", async () => {
  const source = await readFile(new URL("../../examples/k545.mstruct", import.meta.url), "utf8");
  const parsed = parseMstructDocument(source);
  assert.equal(parsed.ok, true);
  assert.match(coverFields(parsed.metadata).title, /K\.545/);
  assert.equal(coverFields(parsed.metadata).author, "Wolfgang Amadeus Mozart");
});

const context = {
  font: "",
  measureText(text) { const size = Number(this.font.match(/(\d+)px/)?.[1] || 10); return { width: [...text].length * size * .7 }; },
};
test("long unbroken text and manual line breaks fit without discarding content", () => {
  for (const title of ["很长的标题".repeat(20), "A".repeat(180), "First movement\n第一乐章", "月の光 달빛".repeat(12)]) {
    const layout = fitText(context, title, { width: 1200, height: 260, maximum: 110 });
    assert.ok(layout.height <= 260);
    assert.ok(layout.lines.length <= 4);
    assert.equal(layout.lines.join("").replace(/\s/g, ""), title.replace(/\s/g, ""));
  }
  assert.throws(() => fitText(context, "x\n".repeat(30), { width: 1200, height: 260, maximum: 110 }), /too-long/);
  assert.deepEqual(wrapText(context, "A\nB", 1000), ["A", "B"]);
});
test("prototype copy is bilingual", () => assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort()));

test("fixed title size wraps at the requested size and rejects overflowing layouts", () => {
  const layout = fitText(context, "A".repeat(20), { width: 1500, height: 300, maximum: 120, minimum: 120 });
  assert.equal(layout.size, 120);
  assert.equal(layout.lines.length, 2);
  assert.throws(() => fitText(context, "A", { width: 1500, height: 300, maximum: 320, minimum: 320 }), /too-long/);
  assert.throws(() => fitText(context, "A".repeat(50), { width: 1200, height: 440, maximum: 160, minimum: 160 }), /too-long/);
});
