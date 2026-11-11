import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseRomanConfigCsv, parseRomanSymbol } from "../src/core/roman-symbol.js";
import { parseSpecialChordCsv, parseChordSymbol } from "../src/core/chord-symbol.js";
import { inlineMusicModel, inlineMusicSource, parseInlineMusicText } from "../src/core/inline-music.js";
import { chordSymbolModel, clusterSymbolModel, romanSymbolModel } from "../src/core/symbol-render-model.js";
import { renderInlineMusicText } from "../src/ui/inline-music.js";
import { createCommentPopover } from "../src/ui/comment-popover.js";

const csv = (name) => readFile(new URL(`../src/config/${name}.csv`, import.meta.url), "utf8");
const [special, basicCsv, advancedCsv, figuredBassCsv, specialCsv] = await Promise.all([csv("special-chords"), csv("roman-basic"), csv("roman-advanced"), csv("roman-figured-bass"), csv("roman-special")]);
const options = { specialChords: parseSpecialChordCsv(special), romanConfig: parseRomanConfigCsv({ basicCsv, advancedCsv, figuredBassCsv, specialCsv }), renderMode: "camel" };
const find = (model, className) => typeof model === "string" ? [] : [...(model.className.split(" ").includes(className) ? [model] : []), ...model.children.flatMap((child) => find(child, className))];

test("cluster symbols share static normal and superscript suffix rendering", () => {
  for (const mode of ["normal", "camel", "superscript"]) for (const symbol of ["Clus", "ClusWK", "ClusBK"]) {
    const model = clusterSymbolModel(symbol, mode);
    assert.equal(model.tag, "span");
    assert.equal(model.children[0], "Clus");
    assert.equal(model.children.length, symbol === "Clus" ? 1 : 2);
    if (symbol !== "Clus") {
      assert.equal(model.children[1].className, mode === "normal" ? "cluster-suffix" : "score-chord-sup");
      assert.equal(model.children[1].children[0], symbol.slice(4));
    }
  }
  assert.equal(clusterSymbolModel("Clus7", "normal"), null);
});

test("diminished o uses the same superscript class and literal glyph as Roman, even in normal chord mode", () => {
  const model = chordSymbolModel(parseChordSymbol("Cdim7", options), "normal", { diminishedDisplay: "o" });
  const circle = find(model, "score-roman-sup")[0];
  const roman = romanSymbolModel(parseRomanSymbol("viio", { config: options.romanConfig }));
  assert.equal(circle.tag, "sup");
  assert.equal(circle.children.join(""), find(roman, "score-roman-sup")[0].children.join(""));
  assert.equal(find(model, "score-chord-sup").length, 0);
  const inline = inlineMusicModel({ kind: "chord", source: "Cdim7" }, { ...options, renderMode: "normal", preferences: { diminishedDisplay: "o" } });
  assert.deepEqual(inline.model.children[0], model);
});

test("figured bass retains music glyphs for single, double and natural accidentals", () => {
  for (const [source, glyphs, numbers] of [
    ["V[#10,b9,x6,bb3-]/V", ["♯", "♭", "𝄪", "𝄫"], ["10", "9", "6", "3"]],
    ["V[n7,#5,b3-]", ["♮", "♯", "♭"], ["7", "5", "3"]],
  ]) {
    const result = inlineMusicModel({ kind: "roman", source, tonalMode: "M" }, options);
    assert.equal(result.ok, true, source);
    assert.deepEqual(find(result.model, "score-roman-figure-accidental").map((node) => node.children.join("")), glyphs);
    assert.deepEqual(find(result.model, "score-roman-figure-number").map((node) => node.children.join("")), numbers);
  }
});

test("typed inline source preserves prose, major/minor context and canonical round trips", () => {
  const source = '中文 <mstruct_chord>CM7</mstruct_chord> and <mstruct_roman mode="m" center="A">iv</mstruct_roman>.';
  const parts = parseInlineMusicText(source);
  assert.deepEqual(parts.map((part) => part.kind), ["text", "chord", "text", "roman", "text"]);
  assert.equal(parts.map((part) => source.slice(part.start, part.end)).join(""), source);
  assert.equal(parts[3].tonalMode, "m");
  assert.equal(parts[3].tonalCenter, "A");
  assert.equal(parseInlineMusicText(inlineMusicSource("roman", parts[3]))[0].source, "iv");
  assert.ok(parts.filter((part) => part.kind !== "text").every((part) => inlineMusicModel(part, options).ok));
});

test("score and inline models use identical chord segments and Roman figures", () => {
  const chord = inlineMusicModel({ kind: "chord", source: "CM7" }, options).model.children[0];
  assert.deepEqual(chord, chordSymbolModel(parseChordSymbol("CM7", options), "camel"));
  const source = "V[9,#7,5,3-]/V";
  const roman = inlineMusicModel({ kind: "roman", source, tonalMode: "M" }, options);
  assert.equal(roman.ok, true);
  assert.deepEqual(roman.model.children[0], romanSymbolModel(parseRomanSymbol(source, { config: options.romanConfig })));
  assert.equal(find(roman.model, "score-roman-figure-row").length, 4);
  assert.equal(find(roman.model, "has-four-figure-rows").length, 1);
  assert.equal(find(roman.model, "score-roman-figure-accidental").length, 1);
});

test("invalid notation/attributes remain readable and arbitrary HTML never becomes DOM", () => {
  for (const text of ['<mstruct_chord onclick="x">C</mstruct_chord>', '<mstruct_roman mode="bad">I</mstruct_roman>', '<mstruct_chord>bad</mstruct_chord>']) {
    const part = parseInlineMusicText(text)[0];
    const result = inlineMusicModel(part, options);
    assert.equal(result.ok, false);
    assert.equal(result.model.children[0], text);
  }
  const ownerDocument = {
    createTextNode: (text) => ({ text }),
    createElement: (tag) => ({ tag, className: "", attributes: {}, children: [], setAttribute(name, value) { this.attributes[name] = value; }, append(...nodes) { this.children.push(...nodes); } }),
  };
  const target = { ownerDocument, children: [], replaceChildren(...children) { this.children = children; } };
  renderInlineMusicText(target, '<script>alert(1)</script> <mstruct_chord>CM7</mstruct_chord>', options);
  assert.equal(target.children[0].text, '<script>alert(1)</script> ');
  assert.equal(target.children[1].tag, "span");
  assert.equal(target.children[1].children[0].className, "score-chord-symbol");
});

test("comment popover passes the resolved bilingual text to the shared inline renderer", () => {
  const attributes = {};
  const target = { setAttribute: (name, value) => { attributes[name] = value; } };
  const dialog = { open: false, show() { this.open = true; } };
  const body = {};
  let rendered;
  const originalWindow = globalThis.window;
  globalThis.window = { requestAnimationFrame() {} };
  try {
    const popover = createCommentPopover({ dialog, body, closeButton: { addEventListener() {} }, heading: {}, languageLabel: {}, getComments: () => [{ number: 1, texts: { zh_cn: '中文 <mstruct_chord>CM7</mstruct_chord>', en: 'English <mstruct_roman>I</mstruct_roman>' } }], getLocale: () => "en", getHostedPopoverDocument: () => null, renderCommentText: (element, text) => { rendered = { element, text }; }, tr: () => "Comment 1" });
    popover.openCommentPopover(1, target);
    assert.equal(rendered.element, body);
    assert.equal(rendered.text, 'English <mstruct_roman>I</mstruct_roman>');
    assert.equal(attributes["aria-expanded"], "true");
  } finally { globalThis.window = originalWindow; }
});
