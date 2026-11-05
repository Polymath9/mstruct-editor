import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeRendererPreferences } from "../src/core/renderer-preferences.js";
import { normalizeRendererLayers, readRendererLayers, writeRendererLayers } from "../src/core/renderer-layers.js";
import { renderFullscreenBpm } from "../src/ui/renderer-fullscreen.js";
import { createSourceEditor } from "../src/ui/source-editor.js";
import { createEditorLineNumbering } from "../src/ui/editor-line-numbering.js";
import { createEditorWarningSettings } from "../src/ui/editor-warning-settings.js";
import { createEditorStartupSettings } from "../src/ui/editor-startup-settings.js";
import { snapScoreBarline, alignScoreBarlines } from "../src/ui/score-barlines.js";
import { createScoreRenderer } from "../src/ui/score-renderer.js";
import { createScoreFeedback } from "../src/ui/score-feedback.js";
import { createRendererPianoKeyboard, pianoKeyboardOverlaps, pianoKeyboardScrollTarget } from "../src/ui/renderer-piano-keyboard.js";
import { presentationStripGeometry, presentationScrollGeometry, presentationHeightRanges, joinPresentationBoundaries, presentationContentBounds } from "../src/ui/renderer-scroll-strip.js";

test("source numbering shares measure labels, continuation blanks and cumulative bar numbers", () => {
  const source = "{BN:1}C\nG\n\n{BN:5}F\n";
  const sourceInput = { value: source, scrollTop: 17 };
  const lineGutter = {};
  const settings = { lineNumberMode: "measure", autoWrap: false };
  const editor = createSourceEditor({ sourceInput, lineGutter, getEditorSettings: () => settings });
  const result = { measures: [
    { barNumber: 1, slots: [{ events: [{ start: 0 }, { start: source.indexOf("G") }] }] },
    { barNumber: 5, displayBarNumber: 17, slots: [{ events: [{ start: source.indexOf("{BN:5}") }] }] },
  ] };
  assert.deepEqual(editor.updateLineGutter(source.split("\n"), result), ["1", " ", "", "17", ""]);
  assert.equal(lineGutter.scrollTop, 17);
  settings.lineNumberMode = "line";
  assert.deepEqual(editor.updateLineGutter(source.split("\n"), result), ["1", "2", "3", "4", "5"]);
});

test("editor numbering defaults to measures, persists the choice and follows other same-origin pages", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const button = Object.assign(new EventTarget(), { setAttribute() {} });
  const control = { classList: { toggle() {} } };
  const view = new EventTarget();
  let changes = 0;
  const numbering = createEditorLineNumbering({ button, control, storage, view, onChange: () => changes++ });
  assert.equal(numbering.mode, "measure");
  button.dispatchEvent(new Event("click"));
  assert.equal(numbering.mode, "line");
  const reloaded = createEditorLineNumbering({ button: Object.assign(new EventTarget(), { setAttribute() {} }), control, storage, view, onChange() {} });
  assert.equal(reloaded.mode, "line");
  const key = [...values.keys()][0];
  values.set(key, "measure");
  view.dispatchEvent(Object.assign(new Event("storage"), { key }));
  assert.equal(numbering.mode, "measure");
  assert.equal(reloaded.mode, "measure");
  values.set(key, "invalid");
  view.dispatchEvent(Object.assign(new Event("storage"), { key }));
  assert.equal(numbering.mode, "measure");
  numbering.destroy();
  reloaded.destroy();
  button.dispatchEvent(new Event("click"));
  assert.equal(changes, 3);
  const blocked = createEditorLineNumbering({ button, control, view, storage: {
    getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); },
  }, onChange() {} });
  assert.equal(blocked.mode, "measure");
  button.dispatchEvent(new Event("click"));
  assert.equal(blocked.mode, "line");
  blocked.destroy();
});

test("piano obstruction uses the highlighted rectangle and scrolls the system or a tall system's event", () => {
  const keyboard = { left: 10, right: 790, top: 600, bottom: 700 };
  const system = { left: 0, right: 800, top: 480, bottom: 700, height: 220 };
  const clear = { left: 80, right: 150, top: 500, bottom: 590, height: 90 };
  const blocked = { ...clear, top: 580, bottom: 630, height: 50 };
  assert.equal(pianoKeyboardScrollTarget(clear, system, keyboard, 80), null);
  assert.equal(pianoKeyboardScrollTarget(blocked, system, keyboard, 80), system);
  assert.equal(pianoKeyboardScrollTarget(blocked, { ...system, height: 620 }, keyboard, 80), blocked);
  assert.equal(pianoKeyboardOverlaps({ ...blocked, left: 800, right: 900 }, keyboard), false);
  assert.equal(pianoKeyboardOverlaps({ ...clear, bottom: 600 }, keyboard), false);
});

test("piano layer preloads on enable and reserves space only while available and enabled", async t => {
  const previous = new Map(["window", "document", "ResizeObserver"].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  function node() {
    const classes = new Set();
    return { ...fakeDomNode(null), dataset: {}, offsetHeight: 94,
      classList: { contains: key => classes.has(key), remove: key => classes.delete(key),
        toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } },
      style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, addEventListener() {}, remove() {},
      querySelector: () => null, getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 700 }),
    };
  }
  globalThis.document = { createElement: node, body: node() };
  globalThis.window = { innerHeight: 700, innerWidth: 800, addEventListener() {}, removeEventListener() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  let enabled = false, loads = 0, finish;
  const canvas = node(), nav = node();
  nav.getBoundingClientRect = () => ({ bottom: 40 });
  const keyboard = createRendererPianoKeyboard({ panel: node(), canvas, nav, tr: key => key,
    player: { load(options) { assert.equal(options.resume, false); loads += 1; return new Promise(resolve => { finish = resolve; }); } },
    getPreferences: () => ({}), getLayers: () => ({ pianoKeyboard: enabled }), requestScroll() {}, isHostedViewer: false });
  keyboard.refresh(); assert.equal(loads, 0);
  enabled = true; keyboard.refresh(); keyboard.refresh();
  assert.equal(loads, 1); assert.equal(canvas.classList.contains("renderer-has-piano-space"), true);
  finish(); await Promise.resolve(); await Promise.resolve(); assert.equal(loads, 1);
  enabled = false; keyboard.refresh(); assert.equal(canvas.classList.contains("renderer-has-piano-space"), false);
  enabled = true; canvas.dataset.fixedScale = "true"; keyboard.refresh(); assert.equal(loads, 1);
  canvas.dataset.fixedScale = "false"; keyboard.refresh(); assert.equal(loads, 2);
  keyboard.destroy(); finish(); await Promise.resolve();
  assert.equal(canvas.classList.contains("renderer-has-piano-space"), false);
});

test("video strip reserves ordinary rows and expands only for the active tall system", () => {
  const settings = { viewportHeight: 1080, maximumLeading: 420, maximumTrailing: 160 };
  const ordinary = presentationStripGeometry({ ...settings, current: { leading: 70, trailing: 120 } });
  const tall = presentationStripGeometry({ ...settings, current: { leading: 420, trailing: 160 } });
  assert.equal(ordinary.height, 456);
  assert.equal(tall.height, 608);
  assert.equal(presentationStripGeometry({ ...settings, current: { leading: 70, trailing: 120 } }).height, ordinary.height);
  assert.equal(presentationStripGeometry({ viewportHeight: 1080, maximumLeading: 100, maximumTrailing: 120, current: { leading: 100, trailing: 120 } }).height, 248);
});

test("scroll height follows individual BPM, tags and overlays as they fully leave either viewport edge", () => {
  const items = [
    { left: 0, right: 3000, top: -30, bottom: 120 },
    { left: 80, right: 120, top: -100, bottom: -50 },
    { left: 200, right: 300, top: 180, bottom: 220 },
    { left: 300, right: 450, top: 199, bottom: 201 },
    { left: 1150, right: 1250, top: -70, bottom: -40 },
  ];
  const geometry = offset => presentationScrollGeometry({ items, offset, viewportWidth: 800, viewportHeight: 1080 });
  assert.deepEqual(geometry(-119.9), { leading: 100, height: 342 });
  assert.deepEqual(geometry(-120), { leading: 30, height: 272 });
  assert.deepEqual(geometry(-299.9), { leading: 30, height: 272 });
  assert.deepEqual(geometry(-300), { leading: 30, height: 253 });
  assert.deepEqual(geometry(-350), { leading: 30, height: 253 });
  assert.deepEqual(geometry(-350.1), { leading: 70, height: 293 });
  assert.deepEqual(geometry(-450), { leading: 70, height: 212 });
  assert.deepEqual(geometry(-1250), { leading: 30, height: 172 });
  assert.deepEqual(geometry(-120), { leading: 30, height: 272 });
});

test("ordinary score rows share the precomputed height and nearby tall passages share one held range", () => {
  const settings = { viewportHeight: 900, maximumLeading: 137, maximumTrailing: 176 };
  for (const current of [{ leading: 137, trailing: 170 }, { leading: 70, trailing: 176 }, { leading: 100, trailing: 150 }]) {
    assert.equal(presentationStripGeometry({ ...settings, current }).height, 336);
  }
  const ranges = presentationHeightRanges([
    { startMs: 2000, endMs: 3000, leading: 420, trailing: 160, height: 632 },
    { startMs: 5000, endMs: 6000, leading: 250, trailing: 300, height: 600 },
    { startMs: 10000, endMs: 11000, leading: 420, trailing: 160, height: 632 },
  ], { leading: 203, height: 456 }, 1080);
  assert.deepEqual(ranges.map(range => [range.start, range.end, range.height]), [[2000, 9000, 744], [10000, 14000, 608]]);
});

test("presentation bounds discard outer empty tracks and retain duration and dense tag boxes", () => {
  const boxes = [
    { top: 25, bottom: 60, width: 80, height: 35 },
    { top: 100, bottom: 195, width: 100, height: 95 },
    { top: 200, bottom: 245, width: 30, height: 45 },
    { top: 250, bottom: 670, width: 180, height: 420 },
    { top: -80, bottom: 800, width: 10, height: 880, hidden: true },
  ];
  const system = { ownerDocument: { defaultView: { getComputedStyle: element => ({ visibility: element.rect.hidden ? 'hidden' : 'visible' }) } },
    querySelectorAll: () => boxes.map(rect => ({ rect, getBoundingClientRect: () => rect })),
    getBoundingClientRect: () => ({ top: 0, bottom: 740 }) };
  assert.deepEqual(presentationContentBounds(system), { top: 23, bottom: 672 });
});

test("strip joins draw a boundary once while retaining repeat sides and mid-measure continuations", () => {
  const element = (classes, x = 0) => ({
    classes: new Set(classes), style: { setProperty(key, value) { this[key] = value; } }, getBoundingClientRect: () => ({ left: x }),
    get classList() { return { contains: key => this.classes.has(key), add: key => this.classes.add(key) }; },
  });
  for (const [endDouble, startDouble] of [[false, false], [true, false], [false, true], [true, true]]) {
    const end = element(endDouble ? ['is-double-bar'] : [], 100), start = element(startDouble ? ['is-double-bar'] : [], 102.5);
    const last = element(['measure']), first = element(['measure']);
    last.querySelector = () => end; first.querySelector = () => start;
    joinPresentationBoundaries([{ lastElementChild: last }, { firstElementChild: first }]);
    assert.equal(end.style['--strip-boundary-shift'], '2.5px');
    assert.equal(start.classes.has('is-strip-duplicate-line'), endDouble && !startDouble);
    assert.equal(end.classes.has('is-strip-duplicate-line'), !(endDouble && !startDouble));
  }
  const start = element([]), first = element(['measure', 'is-measure-continuation']);
  first.querySelector = () => start;
  joinPresentationBoundaries([{ lastElementChild: element(['measure']) }, { firstElementChild: first }]);
  assert.equal(start.classes.has('is-strip-continuation-start'), true);
});

const hostedDocumentSource = await readFile(new URL("../src/runtime/hosted-document.js", import.meta.url), "utf8");
const headerSource = await readFile(new URL("../src/ui/score-document-header.js", import.meta.url), "utf8");

test("final barline pixel alignment preserves a separately snapped thick right stroke", () => {
  for (const ratio of [1, 1.25, 2]) {
    const values = new Map();
    const classes = new Set(['measure-barline', 'is-double-bar', 'is-final-bar']);
    const boundary = {
      getBoundingClientRect: () => ({ left: 100.35, width: 2.5 }),
      classList: { contains: name => classes.has(name), add: name => classes.add(name) },
      style: { setProperty: (key, value) => values.set(key, value) },
    };
    alignScoreBarlines({
      ownerDocument: { defaultView: { devicePixelRatio: ratio, getComputedStyle: () => ({ fontSize: '20px' }) } },
      querySelectorAll: () => [boundary],
    });
    assert.equal(parseFloat(values.get('--barline-pixel-width')), snapScoreBarline(0, 2.5, ratio).width);
    assert.equal(parseFloat(values.get('--barline-after-pixel-width')), snapScoreBarline(0, 7.5, ratio).width);
    assert.ok(classes.has('is-pixel-aligned'));
  }
});

test("screen barline edges occupy uniform whole device pixels at fractional zoom", () => {
  for (const ratio of [1, 1.25, 1.5, 2]) {
    for (const scale of [.5, .75, 1, 1.2, 1.5, 3]) {
      const lines = [30, 65.224, 281.390625, 683.609375].map(left => snapScoreBarline(left, 2 * scale, ratio));
      assert.ok(lines.every(line => Math.abs(line.left * ratio - Math.round(line.left * ratio)) < 1e-8));
      assert.ok(lines.every(line => Math.abs(line.width * ratio - Math.round(line.width * ratio)) < 1e-8));
      assert.ok(lines.every(line => line.width === lines[0].width));
      assert.ok(lines.every((line, index) => Math.abs(line.left - [30, 65.224, 281.390625, 683.609375][index]) <= .5 / ratio));
    }
  }
  assert.deepEqual(snapScoreBarline(30, 2, 1), { left: 30, width: 2 });
  assert.deepEqual(snapScoreBarline(30.4, 2.4, NaN), { left: 30, width: 2 });
});

const [editorHtml, mainSource, scoreSource, symbolSource, navSource, playbackSource, timelineSource, rendererSettingsSource, rendererPreferencesSource, fullscreenSource, tempoLabelSource, toolboxSource, commentDialogSource, documentSessionSource, devBrowserSource, desktopAdapterSource, desktopExportSource, scoreExportSource, hostedPopoversSource, editorConfigSource, metadataDialogSource, languageSwitcherSource, stylesheet, durationStylesheet, popoverStylesheet, romanPopoverStylesheet, staffSource, audioSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/score-renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/symbol-ui.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/renderer-nav.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/renderer-playback.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/timeline-editor.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/renderer-settings.js", import.meta.url), "utf8"),
  readFile(new URL("../src/core/renderer-preferences.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/renderer-fullscreen.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/tempo-label.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/toolbox.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/comment-dialog.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/document-session.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/dev-browser.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/desktop.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/desktop-export.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/score-export.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/hosted-popovers.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/editor-config.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/metadata-dialog.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/language-switcher.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../public/duration-notes.css", import.meta.url), "utf8"),
  readFile(new URL("../public/chord-popover.css", import.meta.url), "utf8"),
  readFile(new URL("../public/roman-popover.css", import.meta.url), "utf8"),
  readFile(new URL("../src/core/chord-staff.js", import.meta.url), "utf8"),
  readFile(new URL("../src/core/chord-audio.js", import.meta.url), "utf8"),
]);
const symbolModelSource = await readFile(new URL("../src/core/symbol-render-model.js", import.meta.url), "utf8");
const rendererSource = [mainSource, scoreSource, symbolSource, symbolModelSource, tempoLabelSource, hostedPopoversSource, editorConfigSource].join("\n");

function fakeDomNode(ownerDocument, tagName = "output") {
  return {
    ownerDocument,
    tagName,
    className: "",
    textContent: "",
    childNodes: [],
    append(...children) { this.childNodes.push(...children); },
    replaceChildren(...children) { this.childNodes = [...children]; this.textContent = ""; },
  };
}

function fakeDocument() {
  const ownerDocument = {
    createElement: (tagName) => fakeDomNode(ownerDocument, tagName),
    createTextNode: (textContent) => ({ textContent }),
  };
  return ownerDocument;
}

test("tag names preserve plain English while Roman parameters use music notation", () => {
  const romanValues = [];
  const { makeTagLabel } = createScoreRenderer({
    makeElement(tag, className) {
      return { ...fakeDomNode(null, tag), className, setAttribute() {} };
    },
    appendRomanNotation(parent, value) { romanValues.push(value); },
    getLocale: () => "en",
  });
  for (const name of ["IAC: Soprano isn't Tonic", "IAC: Inverted Chord", "Phrygian Cadence to Tonic:"]) {
    const label = makeTagLabel({ enName: name });
    assert.equal(label.childNodes[0].textContent, name);
  }
  assert.deepEqual(romanValues, []);
  makeTagLabel({ enName: "Roman", enParts: [{ type: "roman", value: "nII" }] });
  assert.deepEqual(romanValues, ["nII"]);
});

test("source editor highlights syntax and coalesces overlapping error ranges", () => {
  const { highlightSource } = createSourceEditor({});
  const html = highlightSource('X,{BAD}[C:C|R:I];', [{ start: 2, end: 5 }, { start: 4, end: 7 }]);
  assert.match(html, /<mark class="syntax-error">\{BAD\}<\/mark>/);
  assert.match(html, /<span class="syntax-event">\[C:C\|R:I\]<\/span>/);
  assert.equal(highlightSource("<", []), "&lt;");
});

test("source recommendations are escaped, optional, and subordinate to real errors", () => {
  let enabled = true;
  const { highlightSource } = createSourceEditor({ getEditorSettings: () => ({ showRomanWarnings: enabled }),
    formatDiagnostic: () => 'Advice: <safe> "quoted"' });
  const warnings = [{ start: 2, end: 7 }];
  const html = highlightSource("C|biiio7;", [], warnings);
  assert.match(html, /class="syntax-warning" data-warning-message="Advice: &lt;safe&gt; &quot;quoted&quot;">biiio<\/mark>/);
  assert.doesNotMatch(highlightSource("C|biiio7;", [{ start: 3, end: 6 }], warnings), /syntax-warning/);
  enabled = false;
  assert.doesNotMatch(highlightSource("C|biiio7;", [], warnings), /syntax-warning/);
});

test("Roman recommendation settings default on and persist without altering compilation", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let click, changed = 0;
  const button = { setAttribute() {}, addEventListener(type, callback) { if (type === "click") click = callback; } };
  const control = { classList: { toggle() {} } };
  const settings = createEditorWarningSettings({ button, control, storage, onChange: () => changed++ });
  assert.equal(settings.enabled, true);
  click();
  assert.equal(settings.enabled, false);
  assert.equal(changed, 1);
  assert.equal(createEditorWarningSettings({ button, control, storage, onChange() {} }).enabled, false);
  assert.equal(createEditorWarningSettings({ button, control, storage: { getItem() { throw Error("unavailable"); } }, onChange() {} }).enabled, true);
});

test("blank preview clears a previous score or error without suppressing real diagnostics", () => {
  const ownerDocument = fakeDocument(), canvas = fakeDomNode(ownerDocument, "main"), status = {};
  const feedback = createScoreFeedback({ canvas, status, tr: key => key, formatDiagnostic: error => error.code,
    makeElement: (tag, className, textContent) => ({ ...fakeDomNode(ownerDocument, tag), className, textContent }) });
  canvas.append({ className: "chart" });
  assert.equal(feedback.renderBlank(" \r\n\t", { errors: [{ code: "empty-file" }] }), true);
  assert.equal(canvas.childNodes.length, 0);
  assert.equal(status.textContent, "");
  feedback.renderError([{ code: "missing-initial-bn", line: 1 }]);
  assert.equal(canvas.childNodes[0].className, "render-error");
  assert.equal(feedback.renderBlank("C;", { errors: [{ code: "empty-file" }] }), false);
  assert.equal(feedback.renderBlank("", { errors: [{ code: "profile-missing", metadataDomain: true }] }), false);
  assert.equal(feedback.renderBlank("", { errors: [{ code: "empty-file" }, { code: "invalid-tag", metadataDomain: true }] }), false);
  assert.equal(feedback.renderBlank("", { errors: [{ code: "empty-file" }] }), true);
  assert.equal(canvas.childNodes.length, 0);
  assert.equal(status.className, "render-status");
});

test("startup DEMO preference defaults on, survives reopening, and reports failed writes", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  function mount(options = {}) {
    let click;
    const row = {}, status = { hidden: true }, attributes = {};
    const button = { setAttribute: (key, value) => attributes[key] = value, addEventListener: (_, callback) => click = callback };
    const control = { classList: { toggle() {} } };
    const settings = createEditorStartupSettings({ row, status, button, control, storage, available: true, ...options });
    return { settings, row, status, attributes, click: () => click() };
  }
  const first = mount();
  assert.equal(first.settings.openDemo, true);
  assert.equal(first.row.hidden, false);
  first.click();
  assert.equal(first.attributes["aria-checked"], "false");
  assert.equal(mount().settings.openDemo, false);
  const reopened = mount();
  reopened.click();
  assert.equal(mount().settings.openDemo, true);
  const unavailable = mount({ storage: { getItem() { throw Error("read"); }, setItem() { throw Error("write"); } } });
  unavailable.click();
  assert.equal(unavailable.settings.openDemo, true);
  assert.equal(unavailable.status.hidden, false);
  const hosted = mount({ available: false });
  hosted.click();
  assert.equal(hosted.row.hidden, true);
  assert.equal(hosted.settings.openDemo, true);
});

test("渲染图层默认全开并只保存到提供的 session 存储", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(normalizeRendererLayers(), { speed: true, form: true, tags: true, comments: true, newRiemannian: true, pianoKeyboard: false });
  writeRendererLayers({ speed: false, comments: false }, storage);
  assert.deepEqual(readRendererLayers(storage), { speed: false, form: true, tags: true, comments: false, newRiemannian: true, pianoKeyboard: false });
  assert.match(navSource, /command === "layers"/);
  assert.match(navSource, /new BroadcastChannel\(RENDERER_LAYERS_CHANNEL\)/);
  assert.match(scoreSource, /layers\.speed/);
  assert.match(scoreSource, /layers\.form/);
  assert.match(scoreSource, /tagIsVisible\(tag, getRendererLayers\(\)\)/);
  assert.match(scoreSource, /layers\.comments/);
  assert.match(scoreSource, /layers\.newRiemannian|getRendererLayers\(\)\.newRiemannian/);
  assert.match(fullscreenSource, /information\.formSymbol/);
  assert.doesNotMatch(fullscreenSource, /querySelector\("\.form-symbol"\)/);
});

test("工具箱由 CSV 筛选事件、定位光标，并提供可拖动分栏", () => {
  assert.match(editorHtml, /<aside class="toolbox" id="toolbox"/);
  assert.doesNotMatch(editorHtml, /data-insert=/);
  assert.match(mainSource, /toolbox-menus\.csv\?raw/);
  assert.doesNotMatch(mainSource, /event\.data\.type === "toolbox-config"/);
  assert.match(toolboxSource, /entry\.primaryId === primaryId && \(!secondaryId \|\| entry\.secondaryId === secondaryId\)/);
  assert.match(toolboxSource, /sourceInput\.setSelectionRange\(cursor, cursor\)/);
  assert.match(toolboxSource, /document\.execCommand\("insertText", false, entry\.insertion\)/);
  assert.match(toolboxSource, /if \(!inputObserved\) onChange\(\)/);
  assert.match(toolboxSource, /primaryScrollTop = currentPrimaryPanel\.scrollTop/);
  assert.match(toolboxSource, /primaryPanel\.scrollTop = primaryScrollTop/);
  assert.match(toolboxSource, /secondaryScrollTopByPrimary/);
  assert.match(toolboxSource, /setupPaneResizer/);
  assert.match(stylesheet, /\.toolbox\.has-secondary-menu/);
  assert.match(stylesheet, /\.toolbox-column-resizer/);
});

test("standalone 新建入口清空完整文档，并只在真实未保存改动时确认", () => {
  assert.match(editorHtml, /id="newButton"[^>]*data-i18n="newFile"/);
  assert.ok(editorHtml.indexOf('id="newButton"') < editorHtml.indexOf('id="importButton"'));
  assert.match(editorHtml, /id="newButton"[^>]*>New<\/button>\s*<button[^>]*id="importButton"/);
  assert.match(mainSource, /function isDocumentDirty\(\) \{\s*return currentDocumentSignature\(\) !== savedDocumentSignature;/);
  assert.match(mainSource, /function resetToBlankDocument\([^)]*\)[\s\S]*metadata = nextMetadata;[\s\S]*comments = normalizeComments\(\[\]\);[\s\S]*sourceInput\.value = "";[\s\S]*markDocumentSaved\(\)/);
  assert.match(desktopAdapterSource, /desktopApi\.newDocument\(\)/);
  assert.match(devBrowserSource, /!dirty \|\| window\.confirm\(confirmMessage\)/);
  assert.match(hostedDocumentSource, /controls\.newButton\.hidden = true/);
  assert.match(mainSource, /if \(!hostedMode\) \{\s*await standaloneProfiles\.ready;[\s\S]*if \(startupSettings\.openDemo\)[\s\S]*await documentProfile\.load\(metadata\);[\s\S]*resetToBlankDocument\(\{ announce: false \}\)/);
  assert.match(mainSource, /setupRenderOnResize\(refreshScoreLayout\)/);
  assert.match(mainSource, /document\.fonts\?\.ready\.then\(\(\) => refreshScoreLayout\(\{ force: true \}\)\)/);
  assert.match(documentSessionSource, /if \(result\.loaded && markSavedAfterIo && !result\.changed\) markSaved\(\)/);
  assert.match(devBrowserSource, /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(objectUrl\), 0\)/);
  assert.match(mainSource, /markSavedAfterIo: !hostedMode/);
  assert.match(commentDialogSource, /function currentDraftComments\(\)[\s\S]*textArea\.value/);
  assert.match(commentDialogSource, /textArea\.addEventListener\("input", \(\) => \{ textArea\.setCustomValidity\(""\); notifyDirtyState\(\); \}\)/);
});

test("standalone 语言切换与自由填写的原唱歌手行保持独立运行", () => {
  assert.match(editorHtml, /id="standaloneLanguage"[\s\S]*id="standaloneLanguageButton"[\s\S]*data-locale="zh"[\s\S]*data-locale="en"/);
  assert.match(mainSource, /if \(!hostedMode\) setInterfaceLocale\(readStandaloneLocale\(\)\)/);
  assert.match(mainSource, /setupLanguageSwitcher\([\s\S]*renderSource\(\{ preserveScroll: true \}\)/);
  assert.match(languageSwitcherSource, /mstruct-interface-locale/);
  assert.match(stylesheet, /body\.mstruct-hosted \.standalone-language\s*\{\s*display:\s*none/s);
  assert.match(metadataDialogSource, /normalized\.originalVocalists = value\.originalVocalists\.slice/);
  assert.match(metadataDialogSource, /normalized\.originalVocalists = originalVocalists\.slice/);
  assert.match(metadataDialogSource, /draft\.originalVocalists\.push\(\{ name: "", romanized: "" \}\)/);
});

test("main 入口只保留装配，并把平台与配置职责交给 runtime 适配层", () => {
  // Allow the desktop cover adapter's assembly while keeping its implementation outside main.
  assert.ok(mainSource.split(/\r?\n/).length < 1100);
  assert.match(mainSource, /import \{ setupDesktopVideoCover \} from "\.\/runtime\/desktop-video-cover\.js"/);
  assert.doesNotMatch(mainSource, /getContext\("2d"\)|new FontFace\(/);
  assert.match(mainSource, /createDevBrowserDocumentAdapter/);
  assert.match(mainSource, /createDesktopDocumentAdapter/);
  assert.match(mainSource, /createDesktopExportAdapter/);
  assert.match(mainSource, /setupDocumentSession/);
  assert.match(mainSource, /setupScoreExport/);
  assert.match(mainSource, /mountHostedPopovers/);
  assert.match(mainSource, /createEditorConfig/);
  assert.match(desktopExportSource, /desktopApi\.prepareScoreExport/);
  assert.match(scoreExportSource, /export function setupScoreExport/);
  assert.match(editorHtml, /id="scoreExportOutputMode"/);
  assert.match(editorHtml, /id="scoreExportFillThreshold"/);
  assert.match(editorHtml, /id="scoreExportPngBackground"/);
  assert.match(scoreExportSource, /scoreExportContinuousGeometry/);
  assert.match(scoreExportSource, /scoreExportPageDistribution/);
  assert.match(scoreExportSource, /chart\.style\.rowGap/);
  assert.match(scoreExportSource, /geometry\.logicalScoreWidthPx/);
  assert.match(scoreExportSource, /fillThreshold: settings\.fillThreshold/);
  assert.match(scoreExportSource, /function redrawDistributedPageOverlays/);
  assert.match(scoreExportSource, /content\.style\.transform = "none"/);
  assert.match(scoreExportSource, /chart\.style\.transform = "none"/);
  assert.match(scoreExportSource, /function vectorizeBarlines/);
  assert.match(scoreExportSource, /document\.createElementNS\(SVG_NAMESPACE, "line"\)/);
  assert.doesNotMatch(scoreExportSource, /snapBarlines/);
  assert.doesNotMatch(scoreExportSource, /toBlob|createElement\("canvas"\)/);
  assert.match(stylesheet, /\.score-export-vectorized-barline::before, \.score-export-vectorized-barline::after \{ content: none !important; \}/);
});

test("独立事件固定对齐第一行，Roman 字段延长符对齐第二行", () => {
  assert.match(stylesheet, /\.chord-line\s*\{[^}]*grid-column:\s*1;/s);
  assert.match(stylesheet, /\.roman-line\s*\{[^}]*grid-column:\s*1;/s);
  assert.match(stylesheet, /\.standalone-line\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/s);
  assert.doesNotMatch(stylesheet, /\.standalone-line\s*\{[^}]*place-self:/s);
  assert.match(rendererSource, /event\.symbolType === "continuation" \? "—" : event\.symbol/);
  assert.match(symbolSource, /symbolType === "continuation" \? "—"/);
  assert.match(scoreSource, /const hasRomanRows = measureItems\.some/);
  assert.match(scoreSource, /const rowClass = hasRomanRows \? "two-rows" : "one-row"/);
  assert.doesNotMatch(stylesheet, /\.continuation-mark/);
  assert.match(symbolSource, /target\[`\$\{field\}SymbolType`] === "placeholder"/);
  assert.match(symbolSource, /field === "chord" \? "score-chord-symbol" : "score-roman-symbol"/);
  assert.match(symbolSource, /field === "roman"[^\n]*"score-roman-base", "X"/);
});

test("音簇、速度轨与文档标题使用各自的非交互渲染结构", () => {
  assert.match(rendererSource, /\["cluster", "white-key-cluster", "black-key-cluster"\]/);
  assert.match(rendererSource, /getChordPreferences\(\)\.renderMode === "normal" \? "cluster-suffix" : "score-chord-sup"/);
  assert.match(stylesheet, /\.cluster-symbol\s*\{[^}]*font-family:\s*"MStruct Text Accidentals", "Academico"/s);
  assert.match(rendererSource, /const tempoBpmStack = makeElement\("div", `tempo-bpm-stack/);
  assert.doesNotMatch(rendererSource, /has-time-label/);
  assert.match(stylesheet, /\.tempo-bpm-stack\s*\{[^}]*grid-row:\s*var\(--speed-row\);[^}]*align-self:\s*end;[^}]*display:\s*grid;[^}]*gap:\s*\.22em/s);
  assert.match(stylesheet, /\.bpm-label\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*baseline/s);
  assert.match(stylesheet, /\.tempo-bpm-stack \.bpm-label\s*\{[^}]*translate:\s*0 \.6875em/s);
  assert.match(stylesheet, /\.tempo-bpm-stack \.bpm-note\.duration-notes,[\s\S]*\.tempo-bpm-stack \.bpm-note \.duration-note\s*\{ block-size:\s*1\.25em; translate:\s*0 -\.06em; \}/);
  assert.match(stylesheet, /\.tempo-bpm-stack \.bpm-note \.duration-note\s*\{[^}]*min-block-size:\s*1\.25em;[^}]*padding-block-end:\s*0/s);
  assert.doesNotMatch(stylesheet, /\.tempo-bpm-stack\s*\{[^}]*var\(--music-row\)|\.tempo-bpm-stack\s*\{[^}]*-100%/s);
  assert.match(stylesheet, /\.time-label\s*\{[^}]*grid-row:\s*var\(--reference-row\)/s);
  assert.match(stylesheet, /\.score-system\s*\{[^}]*--reference-row:\s*1;/s);
  assert.doesNotMatch(scoreSource, /slotLayout\.slot\.annotations\.time\),\s*\n\s*\);/);
  assert.match(rendererSource, /tempoBpmStack\.append\(makeElement\("span", "tempo-label"/);
  assert.ok(rendererSource.indexOf('"tempo-label"') < rendererSource.indexOf("makeMetricModulationLabel(modulation.value)"));
  assert.ok(rendererSource.indexOf("makeMetricModulationLabel(modulation.value)") < rendererSource.indexOf("makeBpmLabel(slot.annotations.bpm)"));
  assert.match(stylesheet, /\.tempo-label\s*\{[^}]*font-family:\s*"MStruct Text Accidentals", "Academico"[^}]*font-weight:\s*700/s);
  assert.match(popoverStylesheet, /fonts\/Academico-Bold\.otf/);
  assert.match(mainSource, /createScoreDocumentHeader/);
  assert.match(headerSource, /renderDocumentHeader\(/);
  assert.match(headerSource, /normalized\.composers\.map\(composer => composer\.name\)/);
  assert.match(stylesheet, /\.score-document-title\s*\{[^}]*text-align:\s*center/s);
  assert.match(stylesheet, /\.score-document-composers\s*\{[^}]*justify-self:\s*end/s);
});

test("同一 system 的 BPM 轨道统一高度，避免预备拍和后续小节错位", () => {
  assert.match(
    stylesheet,
    /\.score-system\.has-top-annotations\s*\{[^}]*--speed-track-size:\s*2\.125em;[^}]*--system-rows:\s*1\.25em minmax\(var\(--speed-track-size\), auto\) minmax\(1\.35em, \.45fr\) var\(--music-line-size\) auto var\(--comment-track\) var\(--tag-content-extra\) 1fr;[^}]*--speed-row:\s*2;[^}]*--reference-row:\s*3;/s,
  );
  assert.match(stylesheet, /\.score-system\.has-top-annotations\.has-form-symbols\s*\{[^}]*--form-row:\s*2;[^}]*--speed-row:\s*3;[^}]*--reference-row:\s*4;/s);
  assert.doesNotMatch(stylesheet, /--bpm-row|--time-row|--bpm-track-size/);
});

test("音符时值按新增内容高度扩展 system，不挤占既有上下留白", () => {
  assert.match(scoreSource, /element\.querySelector\("\.duration-notes"\).*element\.classList\.add\("has-note-durations"\)/);
  assert.match(stylesheet, /--duration-content-extra:\s*0em/);
  assert.match(durationStylesheet, /\.score-system\.has-note-durations\s*\{[^}]*--duration-content-extra:\s*1\.8375em/s);
  assert.match(stylesheet, /min-height:\s*calc\(var\(--system-base-height\) \+ var\(--system-content-extra\) \+ var\(--duration-content-extra\) \+ var\(--form-content-extra\) \+ var\(--comment-content-extra\) \+ var\(--tag-content-extra\)\)/);
  assert.match(durationStylesheet, /\.score-system\.has-note-durations\.has-comments \.duration-label\.duration-notes\s*\{[^}]*margin-block-end:\s*-1\.3em/s);
});

test("标签使用本地化空心圆角框、动态行高与跨 system 持续线", () => {
  assert.match(mainSource, /tags\.csv\?raw/);
  assert.match(mainSource, /tagConfig:\s*editorConfig\.tagConfig/);
  assert.doesNotMatch(mainSource, /event\.data\.type === "tag-config"/);
  assert.match(scoreSource, /function renderTagStack/);
  assert.match(scoreSource, /tagDisplayName\(tag, getLocale\(\)\)/);
  assert.match(scoreSource, /function drawTagRangeLines/);
  assert.match(scoreSource, /sourceRect\.right/);
  assert.match(scoreSource, /tag-range-end-mark/);
  assert.match(stylesheet, /\.tag-label\s*\{[^}]*border:\s*1px solid #879987;[^}]*background:\s*transparent/s);
  assert.match(stylesheet, /\.tag-stack\s*\{[^}]*grid-template-rows:\s*repeat\(var\(--tag-lane-count\), 1\.75em\)/s);
  assert.match(stylesheet, /\.tag-range-segment/);
  assert.match(stylesheet, /\.tag-range-end-mark/);
  assert.match(stylesheet, /\.tag-lane-guide, \.tag-range-end-anchor \{[^}]*grid-column: 1;/s);
});

test("播放控制组提供钢琴、本地 BGM、竖向音量与同步状态", () => {
  assert.match(editorHtml, /<div class="renderer-transport">[\s\S]*id="rendererPlaybackTime"[\s\S]*id="rendererAutoScroll"[\s\S]*id="rendererStop"[\s\S]*id="rendererPlayPause"[\s\S]*id="rendererGoTo"[\s\S]*id="rendererPiano"[\s\S]*id="rendererVolume"[\s\S]*id="rendererBgmFile"[\s\S]*id="rendererPlaybackPosition"[\s\S]*<\/div>/);
  assert.match(editorHtml, /id="rendererBgmInput"[^>]*accept="\.mp3,\.wav,audio\/mpeg,audio\/wav,audio\/x-wav"/);
  assert.match(editorHtml, /id="rendererBgmInput"[^>]*hidden/);
  assert.match(editorHtml, /id="rendererGoTo"[^>]*aria-pressed="false"[^>]*data-i18n-aria="rendererGoTo"/);
  assert.match(navSource, /goTo\.addEventListener\("click", playback\.toggleSelecting\)/);
  assert.match(navSource, /autoScroll\.addEventListener\("click", playback\.toggleAutoScroll\)/);
  assert.match(navSource, /piano\.addEventListener\("click", playback\.togglePiano\)/);
  assert.match(navSource, /volumeSlider\.addEventListener\("input"/);
  assert.match(navSource, /document\.addEventListener\("pointerdown", handleOutsideVolumePointer\)/);
  assert.match(navSource, /volumeControl\?\.contains\(event\.target\)/);
  assert.match(navSource, /event\.key === "Control"[\s\S]*playback\.setModifierSelecting\(true\)/);
  assert.match(navSource, /shortcuts\.playPause/);
  assert.match(playbackSource, /playFromSelection:\s*ctrlSelecting && event\.altKey === true/);
  assert.match(playbackSource, /void play\(\)/);
  assert.match(editorHtml, /data-shortcut-action="playPause"/);
  assert.doesNotMatch(editorHtml, /data-shortcut-action="pause"/);
  assert.match(playbackSource, /URL\.createObjectURL\(file\)/);
  assert.match(playbackSource, /URL\.revokeObjectURL\(bgmUrl\)/);
  assert.match(playbackSource, /await pianoPlayer\.load\(\)/);
  assert.match(playbackSource, /pianoPlayer\.play\(transposeMidiNotes\(entry\.midiNotes, getPreferences\(\), \{ audio: true \}\), \{ durationSeconds: remainingSeconds \}\)/);
  assert.match(playbackSource, /mode = bgmHasRemaining\(\) \? "bgm-tail" : "paused"/);
  assert.match(playbackSource, /bgmAudio\.addEventListener\("ended", handleBgmEnded\)/);
  assert.match(playbackSource, /bgmAudio\.currentTime \* 1000 - elapsedMs/);
  assert.match(playbackSource, /mode = "stopped"[\s\S]*displayedPosition = EMPTY_POSITION[\s\S]*clearHighlight\(\)/);
  assert.match(playbackSource, /matchingRows = stableTempo[\s\S]*plan\.rows/);
  assert.match(playbackSource, /if \(lastSelectedSlotId === String\(slotId\)\)[\s\S]*selectedSlotPassIndex = \(selectedSlotPassIndex \+ 1\) % choices\.length/);
  assert.match(playbackSource, /function selectTimelineRow\(rowNumber\)/);
  assert.match(playbackSource, /selectionSerial \+= 1/);
  assert.match(scoreSource, /harmony\.dataset\.playbackSelectable/);
  assert.match(scoreSource, /ellipsis\.dataset\.playbackSelectable = "true"/);
  assert.match(stylesheet, /\.renderer-transport\s*\{[^}]*justify-self:\s*center/s);
  assert.match(stylesheet, /\.renderer-volume-panel input\s*\{[^}]*width:\s*22px;[^}]*height:\s*92px;[^}]*writing-mode:\s*vertical-lr/s);
  assert.match(stylesheet, /\.harmony-stack\.is-playback-active::before/);
  assert.match(stylesheet, /\.harmony-stack\.is-playback-active::before,[\s\S]*z-index:\s*0;/);
  assert.match(stylesheet, /\.renderer-search-highlight-layer\s*\{[^}]*z-index:\s*1;/s);
  assert.match(stylesheet, /\.chord-line, \.roman-line, \.standalone-line\s*\{[^}]*z-index:\s*2;/s);
  assert.match(stylesheet, /\.control-boundary\s*\{[^}]*z-index:\s*3;/s);
  assert.match(stylesheet, /transform:\s*translateX\(calc\(0px - var\(--slot-content-shift, 0px\)\)\)/);
  assert.match(navSource, /playPause\.addEventListener\("pointerdown"[\s\S]*event\.preventDefault\(\);[\s\S]*runPlayPause\(\)/);
  assert.match(navSource, /playPause\.addEventListener\("click"[\s\S]*event\.detail === 0/);
});

test("顶部进度条只预览 MStruct 进度，放开后才提交跳转", () => {
  assert.match(editorHtml, /id="rendererPlaybackProgress"[^>]*type="range"[^>]*data-i18n-aria="rendererPlaybackProgress"/);
  assert.ok(editorHtml.indexOf('id="rendererPlaybackProgress"') > editorHtml.indexOf('class="renderer-nav-right"'));
  assert.match(navSource, /playbackProgress\.max = String\(Math\.max\(0, Math\.round\(state\.durationMs/);
  assert.doesNotMatch(navSource, /playbackProgress\.max[\s\S]{0,120}bgmDurationMs/);
  assert.match(navSource, /playbackProgress\.addEventListener\("pointerdown"[\s\S]*playback\.beginScrub/);
  assert.match(navSource, /playbackProgress\.addEventListener\("input"[\s\S]*playback\.previewScrub/);
  assert.match(navSource, /playbackProgress\.addEventListener\("change"[\s\S]*playback\.commitScrub/);
  assert.match(playbackSource, /const previewElapsedMs = scrubElapsedMs \?\? reportedElapsedMs/);
  assert.match(playbackSource, /elapsedMs: reportedElapsedMs,[\s\S]*timestamp: formatPlaybackTimestamp\(previewElapsedMs\)/);
  assert.match(playbackSource, /function beginScrub\(value\)[\s\S]*scrubWasPlaying = mode === "playing" \|\| mode === "bgm-tail"[\s\S]*emit\(\)/);
  assert.match(playbackSource, /function commitScrub\(value\)[\s\S]*pauseAudio\(\);[\s\S]*elapsedMs = target;[\s\S]*mode = resume \? "playing" : "paused"/);
  assert.match(stylesheet, /\.renderer-playback-progress\s*\{[^}]*position:\s*absolute;[^}]*inline-size:\s*calc\(100% - 12px\)/s);
  assert.match(stylesheet, /\.renderer-playback-progress::\-webkit-slider-thumb\s*\{[^}]*inline-size:\s*9px;[^}]*border-radius:\s*50%/s);
  assert.match(navSource, /--renderer-progress/);
  assert.match(navSource, /command === "scrub-start"/);
});

test("ending 与反复次数使用独立渲染轨道并显示多遍编号", () => {
  assert.match(scoreSource, /repeat-count-label", `\$\{countedRepeat\.repeatCount\}×`/);
  assert.match(scoreSource, /numbers\.map\(\(number\) => `\$\{number\}\.`\)\.join\(""\)/);
  assert.match(scoreSource, /const maximumBottom = bracketTop - fontSize \* \.22/);
  assert.match(scoreSource, /Math\.min\(numberShifts\.get\(number\) \?\? 0, maximumBottom - numberRect\.bottom\)/);
  assert.match(scoreSource, /const regularBarNumberTop = system\.querySelector\("\.bar-number"\)\?\.getBoundingClientRect\(\)\.top/);
  assert.match(scoreSource, /const bracketTop = regularBarNumberTop \?\? guideTop/);
  assert.doesNotMatch(scoreSource, /speed-lane-guide|speedLaneTop/);
  assert.match(scoreSource, /system\.querySelector\("\.ending-lane-guide"\)/);
  assert.match(scoreSource, /--ending-bar-number-shift/);
  assert.match(stylesheet, /\.score-system\.has-top-annotations\.has-endings\s*\{[^}]*--ending-row:\s*3;[^}]*--system-rows:\s*1\.25em minmax\(var\(--speed-track-size\), auto\) minmax\(1\.35em, \.45fr\)[^}]*--speed-row:\s*2;[^}]*--reference-row:\s*3;[^}]*--music-row:\s*4/s);
  assert.match(stylesheet, /\.score-system\.has-top-annotations\.has-form-symbols\.has-endings\s*\{[^}]*--ending-row:\s*4;[^}]*--system-rows:\s*1\.25em minmax\(3em, auto\) minmax\(var\(--speed-track-size\), auto\) minmax\(1\.35em, \.45fr\)[^}]*--form-row:\s*2;[^}]*--speed-row:\s*3;[^}]*--reference-row:\s*4;[^}]*--music-row:\s*5/s);
  assert.match(stylesheet, /\.score-system\.has-endings:not\(\.has-top-annotations\) \.measure\s*\{[^}]*\+ 1\.35em\)/s);
  assert.doesNotMatch(stylesheet, /\.score-system\.has-endings \.measure\s*\{[^}]*\+ 2\.55em\)/s);
  assert.match(stylesheet, /\.repeat-count-label\s*\{[^}]*inset-inline-end:\s*\.65em;[^}]*inset-block-start:\s*-1\.35em;[^}]*translate:\s*0 1\.1em/s);
  assert.doesNotMatch(stylesheet, /\.bar-number\.has-ending-over-bar-number\s*\{[^}]*margin-block-end/);
});

test("时间轴录入保持播放、单击编辑当前毫秒，并只让文本输入拦截快捷键", () => {
  assert.match(timelineSource, /timestamp\.addEventListener\("click"/);
  assert.doesNotMatch(timelineSource, /timestamp\.addEventListener\("dblclick"/);
  assert.match(timelineSource, /metadataForm\.addEventListener\("input", refreshMetadataFormValidity\)/);
  assert.match(timelineSource, /rendererNav\?\.refreshTimelineDocument\(current\)/);
  assert.match(navSource, /refreshTimelineDocument\(value\)[\s\S]*playback\.refreshTimelineDocument\(value\)/);
  assert.match(playbackSource, /function refreshTimelineDocument\(next\)[\s\S]*const wasRunning = isPlaybackRunning\(\)/);
  assert.match(playbackSource, /function selectTimelineRow\(rowNumber\)[\s\S]*const wasPlaying = mode === "playing" \|\| mode === "bgm-tail"/);
  assert.match(playbackSource, /function liveElapsedMs\(now = performance\.now\(\)\)/);
  assert.match(playbackSource, /function refreshTimelineDocument\(next\)[\s\S]*elapsedMs = liveElapsedMs\(\);[\s\S]*rebuildPlan\(\{ synchronizeAudio: !wasRunning, preserveClockAnchor: wasRunning \}\)/);
  assert.match(playbackSource, /const entry = choice\?\.number === undefined[\s\S]*candidate\.rowNumber === choice\.number/);
  assert.match(timelineSource, /!isEditableShortcutTarget\(event\.target\) && !event\.target\.closest\?\.\("dialog"\)/);
  assert.match(timelineSource, /function beginMarkerDrag[\s\S]*rows = updateMstructtimeRows\(rows, rowNumber, next\);[\s\S]*updateTimestampPresentation\(rowNumber\)/);
  assert.match(timelineSource, /input\.setSelectionRange\(input\.value\.length, input\.value\.length\)/);
  assert.match(timelineSource, /function beginTimestampEdit\(rowNumber, cell\)[\s\S]*rows\.find\(\(candidate\) => candidate\.number === rowNumber\)/);
  assert.match(timelineSource, /function revealSelectedEventRow\(\)[\s\S]*eventTableWrap\.scrollTop/);
  assert.match(timelineSource, /function zoomTimeline\(delta\)[\s\S]*nextPlayhead\.offsetTop - viewportPosition/);
  assert.match(timelineSource, /timelineShortcut && \(event\.key === "\+" \|\| event\.key === "-"\)/);
  assert.match(stylesheet, /\.timeline-scale\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(stylesheet, /\.timeline-scale\s*\{[^}]*linear-gradient/s);
});

test("全局播放延迟默认负 30 毫秒，并与曲目及临时 offset 按入口叠加", () => {
  assert.deepEqual(normalizeRendererPreferences(null), {
    diminishedDisplay: "dim", augmentedDisplay: "aug", majorSeventhDisplay: "M", minorDisplay: "m",
    accidentalBeforeNote: false,
    chordDegrees: false,
    minorTonicSix: false,
    renderMode: "camel",
    sharp9AsFlat10: true,
    durationDisplayMode: "note",
    globalPlaybackOffset: -30,
  });
  assert.equal(normalizeRendererPreferences({ globalPlaybackOffset: -45 }).globalPlaybackOffset, -45);
  assert.equal(normalizeRendererPreferences({ globalPlaybackOffset: 1.5 }).globalPlaybackOffset, -30);
  assert.match(editorHtml, /id="rendererGlobalPlaybackOffset"[^>]*value="-30"/);
  assert.match(rendererPreferencesSource, /DEFAULT_GLOBAL_PLAYBACK_OFFSET = -30/);
  assert.match(rendererPreferencesSource, /globalPlaybackOffset: Number\.isSafeInteger\(value\?\.globalPlaybackOffset\)/);
  assert.match(mainSource, /userOffset: chordPreferences\.globalPlaybackOffset/);
  assert.match(navSource, /playback\.setDocument\(\{ result, stableTempo: isStableTempo, globalOffset, userOffset, timelineDocument \}\)/);
  assert.match(playbackSource, /const playbackOffset = userOffset \+ temporaryOffset \+ \(stableTempo \? globalOffset : 0\)/);
  assert.match(playbackSource, /buildMstructtimePlaybackPlan\(result, timelineDocument, playbackOffset\)/);
  assert.match(rendererSettingsSource, /globalPlaybackOffset\.value = String\(preferences\.globalPlaybackOffset\)/);
  assert.match(rendererSettingsSource, /window\.localStorage\.setItem\(storageKey, JSON\.stringify\(next\)\)/);
});

test("全屏展示复用当前播放 entry，并提供双栏信息面板与注释缩字", () => {
  assert.match(editorHtml, /id="rendererFullscreen"[^>]*aria-pressed="false"/);
  assert.match(editorHtml, /id="rendererFullscreenInfo"[\s\S]*id="rendererFullscreenTimestamp"[\s\S]*id="rendererFullscreenChord"[\s\S]*id="rendererFullscreenStaff"[\s\S]*id="rendererFullscreenTags"[\s\S]*id="rendererFullscreenComment"/);
  assert.match(navSource, /createRendererFullscreen/);
  assert.match(navSource, /command === "fullscreen-view"/);
  assert.match(navSource, /let navLocked = true/);
  assert.match(navSource, /nav\.classList\.toggle\("is-auto-hidden"/);
  assert.match(navSource, /renderer-fullscreen-external/);
  assert.match(playbackSource, /onStateChange\(state\(\), activeEntry\)/);
  assert.match(fullscreenSource, /rendererPanel\.requestFullscreen\(\)/);
  assert.doesNotMatch(fullscreenSource, /desktopApi/);
  assert.match(fullscreenSource, /desktopPreviewMode/);
  assert.match(fullscreenSource, /renderer-fullscreen-desktop-preview/);
  assert.match(fullscreenSource, /event\.key !== "Escape"/);
  assert.match(fullscreenSource, /postToHost\("fullscreen-exit-request"\)/);
  assert.match(fullscreenSource, /drawChordStaff\(staff, information\.noteNames, information\.midiNotes/);
  assert.match(fullscreenSource, /renderFullscreenBpm\(bpm, information, makeBpmLabel\)/);
  assert.match(fullscreenSource, /appendChordNotation\(noteNames, name, true\)/);
  assert.match(fullscreenSource, /openChordPopover\(/);
  assert.match(fullscreenSource, /querySelectorAll\(lineSelector\)[\s\S]*find\(\(candidate\) => candidate\.querySelector\(valueSelector\)\)/);
  assert.match(fullscreenSource, /while \(size > 12 && comment\.scrollHeight > available \+ 1\)/);
  assert.match(fullscreenSource, /fitInlineField\(chord\)/);
  assert.match(fullscreenSource, /fitInlineField\(noteNames\)/);
  assert.match(fullscreenSource, /entry\.chordDisplayItems/);
  assert.match(fullscreenSource, /data-modulation-id/);
  assert.match(fullscreenSource, /\.modulation-opening/);
  assert.match(fullscreenSource, /clone\.querySelectorAll\("\[data-roman-chain-id\]"\)/);
  assert.match(fullscreenSource, /value\.dataset\.romanChainId/);
  assert.doesNotMatch(fullscreenSource, /item\.event\?\.romanFigureChain\?\.pure/);
  assert.match(fullscreenSource, /\.score-roman-base/);
  assert.match(fullscreenSource, /function restoreRomanTonalContext/);
  assert.match(fullscreenSource, /item\.event\?\.tonalCenter/);
  assert.match(fullscreenSource, /\.modulation-pair, \.tonal-prefix, \.modulation-prefix/);
  assert.match(fullscreenSource, /appendChordNotation\(key, tonalCenter\)/);
  assert.match(fullscreenSource, /value\.closest\("\.modulation-pair"\)[\s\S]*value\.closest\("\.tonal-cluster"\)[\s\S]*value\.closest\("\.event-value-with-annotation"\)/);
  assert.match(fullscreenSource, /onLayoutChange/);
  assert.match(mainSource, /onFullscreenLayoutChange:\s*refreshScoreLayout/);
  assert.match(rendererPreferencesSource, /durationDisplayMode: value\?\.durationDisplayMode === "fraction" \? "fraction" : "note"/);
  assert.match(mainSource, /const nextTargetWidth = scoreTargetWidth\(\)/);
  assert.match(mainSource, /renderResult\(renderedScoreResult\);[\s\S]*rendererNav\?\.refreshRenderedScore\(\)/);
  assert.match(navSource, /refreshRenderedScore\(\)\s*\{[\s\S]*playback\.refreshRenderedScore\(\);[\s\S]*fullscreen\.refresh\(\)/);
  assert.match(playbackSource, /refreshRenderedScore\(\)\s*\{[\s\S]*updateActive\(\);[\s\S]*emit\(\)/);
  assert.match(fullscreenSource, /canvas\.classList\.add\("is-scrollbar-active"\)/);
  assert.match(navSource, /const scrollTarget = element\.closest\("\.score-system"\) \?\? element/);
  assert.match(navSource, /const rect = obstruction\?\.target \?\? scrollTarget\.getBoundingClientRect\(\)/);
  assert.match(navSource, /const nextTop = rendererCanvas\.scrollTop \+ rect\.top - visibleTop/);
  assert.doesNotMatch(navSource, /availableHeight - rect\.height/);
  assert.match(stylesheet, /grid-template-columns:\s*minmax\(0, 2fr\) minmax\(320px, 1fr\)/);
  assert.match(stylesheet, /body\.renderer-fullscreen-external \.renderer-fullscreen-info/);
  assert.match(stylesheet, /body\.renderer-fullscreen-desktop-preview \.renderer-panel \{ position: fixed; inset: 0; z-index: 1000; \}/);
  assert.match(stylesheet, /\.renderer-fullscreen-comment-field\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s);
  assert.match(stylesheet, /\.renderer-nav\.is-auto-hidden\s*\{[^}]*translateY\(calc\(-100% \+ 5px\)\)/s);
  assert.match(stylesheet, /\.renderer-canvas\.is-scrollbar-active/);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.standalone-line \{[^}]*justify-content:\s*flex-start;[^}]*text-align:\s*start/s);
  assert.match(stylesheet, /#rendererFullscreenChord \{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-start;[^}]*text-align:\s*start/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.renderer-fullscreen-fit \.chord-line,[\s\S]*justify-self:\s*start;[^}]*margin-inline:\s*0 auto/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.modulation-pair \{[^}]*grid-template-columns:\s*max-content max-content max-content/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.modulation-prefix,[\s\S]*\.renderer-fullscreen-info \.tonal-prefix \{[^}]*color:\s*inherit/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.tonal-cluster \{[^}]*align-items:\s*center/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.tonal-prefix \{[^}]*align-self:\s*center/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.tonal-label \{[^}]*translate:\s*0 \.08em/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.secondary-harmony-event,[\s\S]*font-size:\s*1em/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.bpm-label \{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*font-family:\s*"MStruct Text Accidentals", Arial, "Noto Sans SC", sans-serif;[^}]*font-size:\s*1em;[^}]*font-weight:\s*400/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.bpm-note \{[^}]*font-size:\s*1em;[^}]*line-height:\s*1;[^}]*translate:\s*0 -\.14em/s);
  assert.match(stylesheet, /\.renderer-fullscreen-info \.bpm-value \{[^}]*font-family:\s*inherit;[^}]*font-size:\s*1em;[^}]*font-weight:\s*400/s);
  assert.match(stylesheet, /#rendererFullscreenBpm \{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(5, max-content\);[^}]*align-items:\s*baseline/s);
  assert.match(stylesheet, /#rendererFullscreenBpm \.bpm-line,[\s\S]*#rendererFullscreenBpm \.bpm-label \{ display:\s*contents; \}/);
  assert.doesNotMatch(stylesheet, /#rendererFullscreenBpm \.bpm-note \{/);
  assert.doesNotMatch(stylesheet, /\.bpm-comparison \.bpm-label \{[^}]*font-size:\s*\.72em/s);
  assert.match(editorHtml, /data-i18n="rendererFullscreenNoteNames">Chord Note Names</);
  assert.match(symbolSource, /const topEdge = edge \+ fullscreenTop/);
  assert.match(mainSource, /setFullscreenPopovers:[\s\S]*target\.append\(chordPopover, romanPopover, commentPopover\)/);
});

test("全屏 MM BPM 在主速度后追加原拍单位换算且不抛错", () => {
  const ownerDocument = fakeDocument();
  const target = fakeDomNode(ownerDocument);
  const makeBpmLabel = (value) => ({ kind: "bpm", value });
  assert.doesNotThrow(() => renderFullscreenBpm(target, {
    bpm: "1/8=147",
    bpmReference: "1/4=73.5",
  }, makeBpmLabel));
  assert.equal(target.childNodes[0].className, "bpm-line bpm-primary");
  assert.deepEqual(target.childNodes[0].childNodes.map((node) => node.value ?? node.textContent), ["", "1/8=147", ""]);
  assert.equal(target.childNodes[1].className, "bpm-line bpm-comparison");
  assert.deepEqual(target.childNodes[1].childNodes.map((node) => node.value ?? node.textContent), ["(", "1/4=73.5", ")"]);
});

test("手动渲染保留渲染器滚动位置，元数据对话框不再点击遮罩关闭", () => {
  assert.match(mainSource, /renderSource\(\{ preserveScroll = false \} = \{\}\)/);
  assert.match(mainSource, /rendererCanvas\.scrollLeft = rendererScroll\.left/);
  assert.match(mainSource, /renderButton\.addEventListener\("click", \(\) => renderSource\(\{ preserveScroll: true \}\)\)/);
  assert.doesNotMatch(mainSource, /metadataDialog\.addEventListener\("click"/);
});

test("临时 offset 提交后生效且不读取曲目信息 OFFSET", () => {
  assert.match(editorHtml, /id="rendererOffset"[^>]*value="0"/);
  assert.match(navSource, /offset\.addEventListener\("blur", commitOffset\)/);
  assert.match(navSource, /offset\.addEventListener\("keydown"[\s\S]*event\.key !== "Enter"[\s\S]*offset\.blur\(\)/);
  assert.doesNotMatch(navSource, /offset\.addEventListener\("input"/);
  assert.match(navSource, /offset\.value = String\(committedOffset\)/);
  assert.doesNotMatch(mainSource, /updateDocumentOffset/);
  assert.doesNotMatch(navSource, /documentOffset|updateDocumentOffset/);
});

test("乐谱和弦使用共享编译结果、渲染偏好与可交互详情弹层", () => {
  assert.match(editorConfigSource, /isStableTempo:\s*metadata\.isStableTempo/);
  assert.match(mainSource, /editorConfig\.compileMain\(source, normalizedMetadata, comments\)/);
  assert.match(rendererSource, /classList\.add\("secondary-harmony-event"\)/);
  assert.match(stylesheet, /\.secondary-harmony-event\s*\{[^}]*align-self:\s*center;[^}]*font-size:\s*\.78em/s);
  assert.match(mainSource, /editorConfig\.applyProfile/);
  assert.doesNotMatch(rendererSource, /event\.data\.type === "special-chords"/);
  assert.match(symbolSource, /chordSymbolModel\(result, getChordPreferences\(\)\.renderMode, getChordPreferences\(\), center\)/);
  assert.match(symbolModelSource, /displayChordParts\(result, mode, preferences, center\)/);
  assert.match(rendererSource, /valueElement\.addEventListener\("click", \(\) => openChordPopover/);
  assert.match(rendererSource, /result\.structure\.toNoteNames\(noteNameSpecials\)/);
  assert.match(rendererSource, /drawChordStaff\(chordPopoverStaff/);
  assert.match(rendererSource, /chordPianoPlayer\.play\(current\.audioMidiNotes\)/);
  assert.match(editorHtml, /id="chordPopover"/);
  assert.match(editorHtml, /id="chordPopoverIntervals"/);
  assert.match(editorHtml, /id="chordPopoverNoteNames"/);
  assert.match(editorHtml, /id="chordPopoverStaff"/);
  assert.match(editorHtml, /href="\/chord-popover\.css"/);
  assert.match(popoverStylesheet, /\.chord-popover\[open\]/);
  assert.match(popoverStylesheet, /font-family:\s*"Academico"/);
  assert.match(popoverStylesheet, /fonts\/Academico-Regular\.otf/);
  assert.match(popoverStylesheet, /\.chord-popover h2 \.score-chord-symbol \{[^}]*font-size:\s*30px/s);
  assert.match(popoverStylesheet, /\.score-chord-accidental[^}]*"Noto Music"/);
  assert.match(popoverStylesheet, /\.score-chord-accidental[^}]*display:\s*inline-block;[^}]*line-height:\s*0;[^}]*vertical-align:\s*baseline;[^}]*transform:\s*translateY\(-\.08em\)/s);
  assert.doesNotMatch(stylesheet, /\.chord-popover\[open\]/);
  assert.match(hostedPopoversSource, /for \(const popover of \[chordPopover, romanPopover, commentPopover\]\)[\s\S]*parentDocument\.body\.append\(popover\)/);
  assert.match(rendererSource, /frameRect\.top \+ rect\.top/);
  assert.match(hostedPopoversSource, /mstructChordPopoverStyles/);
  assert.match(rendererSource, /bindHostedPopoverLifecycle/);
  assert.match(popoverStylesheet, /\.score-chord-symbol \{[^}]*display:\s*inline-flex;[^}]*align-items:\s*baseline;[^}]*block-size:\s*1\.2em/s);
  assert.match(popoverStylesheet, /\.score-chord-sup \{[^}]*position:\s*static;[^}]*top:\s*auto;[^}]*font-size:\s*\.68em;[^}]*vertical-align:\s*baseline;[^}]*transform:\s*translateY\(-\.5em\)/s);
  assert.doesNotMatch(popoverStylesheet, /\.score-chord-sup \{[^}]*position:\s*relative/s);
  assert.match(staffSource, /export async function drawChordStaff/);
  assert.match(staffSource, /import\("vexflow\/core"\)/);
  assert.match(staffSource, /document\.fonts\.load\('40px "Bravura"'\)/);
  assert.match(durationStylesheet, /font-family:\s*"Bravura";[\s\S]*Bravura\.woff2/);
  assert.match(staffSource, /targetDocument\.fonts\.add\(fontFace\)/);
  assert.match(audioSource, /export class ChordPianoPlayer/);
  assert.match(audioSource, /async load\(/);
  assert.match(audioSource, /stop\(\)/);
});

test("BPM 拍单位复用时值音符规则，连音数字可读且新里曼弧不覆盖导航", () => {
  assert.match(tempoLabelSource, /makeDurationNotes\(duration, unit, makeElement/);
  assert.match(tempoLabelSource, /parseFraction\(unit\)/);
  assert.doesNotMatch(tempoLabelSource, /glyphByUnit/);
  assert.match(durationStylesheet, /\.duration-note-tuplet[^}]*translate:\s*-50% 25%;[^}]*font:\s*400 1\.75em\/1 "Bravura Duration"/s);
  assert.match(stylesheet, /\.bpm-note\.duration-notes/);
  assert.match(stylesheet, /\.renderer-nav \{[^}]*z-index:\s*10/s);
  assert.match(stylesheet, /@media \(max-width: 1000px\)[\s\S]*\.renderer-nav \{[^}]*z-index:\s*10/s);
});

test("figured-bass lines start after the complete annotation in each Roman row", (t) => {
  const previousStyle = globalThis.getComputedStyle;
  const previousCss = globalThis.CSS;
  globalThis.getComputedStyle = () => ({ fontSize: "16px" });
  globalThis.CSS = { escape: value => value };
  t.after(() => {
    if (previousStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousStyle;
    if (previousCss === undefined) delete globalThis.CSS;
    else globalThis.CSS = previousCss;
  });
  const box = (left, right, top = 20, height = 8) => ({ left, right, top, height, bottom: top + height });
  const node = rect => ({ getBoundingClientRect: () => rect });
  const { drawRomanVoiceLeadingLines } = createScoreRenderer({
    makeElement: (tag, className) => ({ className, style: {}, children: [], setAttribute() {}, append(child) { this.children.push(child); } }),
  });
  for (const mode of ["same-system", "next-system", "break"]) {
    for (const annotationRight of [null, 180, 260]) {
      const system = { ...node(box(0, 500)), querySelectorAll: () => [node(box(300, 302))] };
      const nextSystem = { ...node(box(0, 500, 200)), querySelectorAll: () => [] };
      const measure = { ...node(box(0, 500)), querySelector: () => node(box(490, 492)) };
      const sourceRows = [node(box(110, 120, 20)), node(box(110, 120, 32))];
      const targetLeft = mode === "next-system" ? 200 : 400;
      const targetTop = mode === "next-system" ? 220 : 20;
      const source = {
        ...node(box(100, 120, 18, 24)),
        dataset: { romanChainLink: mode === "break" ? "break" : "continue", romanChainId: "1", romanChainIndex: "0", eventOrder: "1" },
        querySelectorAll: () => sourceRows,
        closest: selector => selector === ".event-value-with-annotation" ? (annotationRight ? node(box(100, annotationRight)) : null)
          : selector === ".score-system" ? system : measure,
      };
      const target = {
        ...node(box(targetLeft, targetLeft + 10, targetTop)), dataset: { eventOrder: "2" },
        querySelectorAll: () => [node(box(targetLeft, targetLeft + 10, targetTop)), node(box(targetLeft, targetLeft + 10, targetTop + 12))],
        closest: selector => selector === ".score-system" ? (mode === "next-system" ? nextSystem : system) : measure,
      };
      const chart = {
        ...node(box(10, 510, 5)),
        querySelector: selector => selector === ".roman-voice-leading-layer" ? null : target,
        querySelectorAll: selector => selector === "[data-event-order]" ? [source, target] : [source],
        append(layer) { this.layer = layer; },
      };
      drawRomanVoiceLeadingLines(chart);
      const segments = chart.layer.children.filter(child => child.className === "roman-voice-leading-segment");
      for (const rowTop of [19, 31]) {
        const rowSegments = segments.filter(segment => Number.parseFloat(segment.style.top) === rowTop);
        assert.ok(rowSegments.length, `${mode}: both figure rows retain their lines`);
        assert.equal(Number.parseFloat(rowSegments[0].style.left), (annotationRight ?? 120) + 16 * .7 - 10,
          `${mode}: line clears the closing annotation parenthesis`);
        assert.ok(rowSegments.every(segment => Number.parseFloat(segment.style.width) > 0));
      }
      if (mode === "next-system") assert.equal(segments.filter(segment => Number.parseFloat(segment.style.top) > 200).length, 2);
      const cuts = chart.layer.children.filter(child => child.className === "roman-voice-leading-cut");
      assert.equal(cuts.length, mode === "break" ? 2 : 0);
    }
  }
});

test("罗马数字使用独立的上下标、详情弹层与跨小节 voice-leading 线", () => {
  assert.match(rendererSource, /function makeRomanSymbol/);
  assert.match(rendererSource, /openRomanPopover/);
  assert.match(rendererSource, /event\.chordNoteNameSpecial/);
  assert.match(rendererSource, /function drawRomanVoiceLeadingLines/);
  assert.match(rendererSource, /\.measure-barline/);
  assert.doesNotMatch(rendererSource, /event\.data\.type === "roman-config"/);
  assert.match(editorHtml, /id="romanPopover"/);
  assert.match(editorHtml, /href="\/roman-popover\.css"/);
  assert.match(romanPopoverStylesheet, /\.score-roman-sup/);
  assert.match(romanPopoverStylesheet, /\.score-roman-figures/);
  assert.match(rendererSource, /hasAccidental = visibleRows\.some/);
  assert.match(rendererSource, /hasSus = visibleRows\.some/);
  assert.match(symbolModelSource, /classes\.push\("has-single-quality-figure"\)/);
  assert.match(rendererSource, /hasAccidental \? " has-accidental" : ""/);
  assert.match(rendererSource, /hasSus \? " has-sus" : ""/);
  assert.match(symbolModelSource, /classes\.push\("has-sus-figure"\)/);
  assert.match(romanPopoverStylesheet, /\.roman-line \.score-roman-symbol\.has-sus-figure\s*\{[^}]*translateX\(-\.12em\)/s);
  assert.match(romanPopoverStylesheet, /\.score-roman-figures\s*\{[^}]*justify-items:\s*end/s);
  assert.match(romanPopoverStylesheet, /\.roman-voice-leading-segment/);
  assert.match(romanPopoverStylesheet, /\.score-roman-symbol\s*\{[^}]*align-items:\s*center/s);
  assert.match(romanPopoverStylesheet, /\.score-roman-figure-row\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*0/s);
  assert.doesNotMatch(romanPopoverStylesheet, /grid-template-columns/);
  assert.match(romanPopoverStylesheet, /\.score-roman-figures\.has-sus\s*\{[^}]*align-self:\s*flex-start;[^}]*font-size:\s*\.62em;[^}]*line-height:\s*1;[^}]*translateY\(-\.18em\)/s);
  assert.match(romanPopoverStylesheet, /\.score-roman-figures\.has-sus \.score-roman-figure-row\s*\{[^}]*justify-self:\s*center/s);
  assert.match(romanPopoverStylesheet, /\.score-roman-figures \+ \.score-roman-slash\s*\{[^}]*margin-inline-start:\s*-\.05em/s);
  assert.match(romanPopoverStylesheet, /\.score-roman-symbol\.has-single-quality-figure > \.score-roman-sup\s*\{[^}]*translateY\(\.18em\)/s);
  assert.match(romanPopoverStylesheet, /\.score-roman-figure-accidental\s*\{[^}]*align-self:\s*end;[^}]*font-size:\s*1\.25em;[^}]*line-height:\s*\.82;[^}]*transform:\s*translateY\(-\.25em\)/s);
  assert.match(romanPopoverStylesheet, /\.roman-trigger\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(rendererSource, /score-chord-accidental score-roman-accidental score-roman-figure-accidental/);
  assert.match(popoverStylesheet, /\.score-chord-accidental[^}]*"Noto Music"[^}]*line-height:\s*0;[^}]*vertical-align:\s*baseline;[^}]*translateY\(-\.08em\)/s);
  assert.match(rendererSource, /appendRomanNotation\(romanPopoverStructure, degree\)/);
  assert.match(stylesheet, /--music-line-size:\s*calc\(var\(--music-line-base-size\) \+ var\(--system-content-extra\)\)/);
  assert.match(stylesheet, /\.measure\s*\{[^}]*--system-base-height:\s*9\.375em;[^}]*min-height:\s*calc\(var\(--system-base-height\) \+ var\(--system-content-extra\) \+ var\(--duration-content-extra\) \+ var\(--form-content-extra\) \+ var\(--comment-content-extra\) \+ var\(--tag-content-extra\)\)/s);
  assert.match(stylesheet, /\.measure\.one-row\s*\{[^}]*--system-base-height:\s*8\.75em/s);
  assert.match(stylesheet, /\.score-system\.has-top-annotations \.measure\s*\{[^}]*--system-base-height:\s*13\.375em/s);
  assert.match(stylesheet, /\.ellipsis-marker\s*\{[^}]*min-height:\s*calc\(var\(--system-base-height\) \+ var\(--system-content-extra\) \+ var\(--duration-content-extra\) \+ var\(--form-content-extra\) \+ var\(--comment-content-extra\) \+ var\(--tag-content-extra\)\)/s);
  assert.match(rendererSource, /const contentExtra = \(hasModulationRows \? 1\.8 : 0\) \+ Math\.max\(0, tallestRomanStack - 2\) \* 1\.05/);
  assert.match(rendererSource, /element\.style\.setProperty\("--system-content-extra", `\$\{contentExtra\}em`\)/);
  assert.match(stylesheet, /\.tonal-cluster\s*\{[^}]*align-items:\s*baseline/s);
  assert.match(stylesheet, /\.tonal-prefix\s*\{[^}]*align-self:\s*baseline/s);
  assert.match(rendererSource, /tallestRomanStack/);
  assert.match(rendererSource, /const eventGap = scoreFontSize \* \.7/);
  assert.match(rendererSource, /const fixedOffset = slotLayout\.naturalWidth - share \* totalNaturalWidth/);
  assert.match(rendererSource, /const breakLimit = \(sourceEndBar\?\.left \?\? sourceMeasureRect\.right\) - systemEdgeGap/);
  assert.match(rendererSource, /if \(link === "break"\) \{/);
  assert.doesNotMatch(romanPopoverStylesheet, /\.score-chord-sup/);
});

test("NR 使用和弦或延长符端点绘制同 system 与跨 system 弧线", () => {
  assert.match(rendererSource, /new-riemannian-target/);
  assert.match(rendererSource, /newRiemannianSourceOrder/);
  assert.match(rendererSource, /function drawNewRiemannianConnections/);
  assert.match(rendererSource, /newRiemannianSourceType === "continuation"/);
  assert.match(rendererSource, /sourceSystem === targetSystem/);
  assert.match(rendererSource, /marker-end/);
  assert.match(rendererSource, /sourcePeak = sourceTop - curveHeight \* \.5/);
  assert.match(rendererSource, /targetPeak = targetTop - curveHeight \* \.5/);
  assert.match(rendererSource, /targetArcRight - fontSize \* 3\.25/);
  assert.match(rendererSource, /appendNewRiemannianLabel/);
  assert.doesNotMatch(rendererSource, /harmony-playback-highlight/);
  assert.match(stylesheet, /\.harmony-stack\.is-playback-active::before,/);
  assert.match(stylesheet, /\.chart\s*\{[^}]*isolation:\s*isolate/s);
  assert.match(stylesheet, /\.harmony-stack\s*\{[^}]*inset-inline-start:\s*var\(--slot-content-shift, 0\);[^}]*inline-size:\s*100%/s);
  assert.doesNotMatch(stylesheet, /\.harmony-stack\s*\{[^}]*isolation:\s*isolate/s);
  assert.match(stylesheet, /\.harmony-stack\.is-playback-active::before,[\s\S]*?z-index:\s*0;[\s\S]*?transform:\s*translateX\(calc\(0px - var\(--slot-content-shift, 0px\)\)\)/);
  assert.doesNotMatch(stylesheet, /\.modulation-line\.is-playback-active/);
  assert.match(mainSource, /drawNewRiemannianConnections\(chart\)/);
  assert.match(stylesheet, /\.new-riemannian-layer/);
  assert.match(stylesheet, /\.new-riemannian-arc/);
  assert.match(stylesheet, /\.new-riemannian-arrow/);
  assert.match(stylesheet, /\.new-riemannian-label/);
});

test("注释与转调行使用独立可点击记号、零宽标签侧栏和 system 高度通道", () => {
  assert.match(rendererSource, /function appendAnnotation/);
  assert.match(rendererSource, /event-annotation-trigger/);
  assert.match(rendererSource, /function renderModulationGroup/);
  assert.match(rendererSource, /function makeModulationOpening/);
  assert.match(rendererSource, /function makeTonalLabel/);
  assert.match(rendererSource, /appendChordNotation\(key, tonalCenter\)/);
  assert.match(rendererSource, /hardModulationPrefix/);
  assert.match(stylesheet, /\.event-annotation\s*\{[^}]*color:\s*#929b95/s);
  assert.match(stylesheet, /\.score-system\.has-modulation-rows \.harmony-stack\s*\{[^}]*grid-template-rows:\s*repeat\(3, 1fr\)/s);
  assert.match(rendererSource, /makeElement\("span", "time-signature-values"\)/);
  assert.match(stylesheet, /\.score-system\.has-modulation-rows \.time-signature\s*\{[^}]*grid-template-rows:\s*repeat\(3, 1fr\)/s);
  assert.match(stylesheet, /\.score-system\.has-modulation-rows \.time-signature-values\s*\{[^}]*grid-row:\s*1 \/ 3/s);
  assert.match(stylesheet, /\.modulation-pair\s*\{[^}]*grid-template-columns:\s*0 max-content 0/s);
  assert.match(stylesheet, /\.modulation-opening\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1 \/ 3/s);
  assert.match(stylesheet, /\.modulation-bracket-open\s*\{[^}]*border-inline-start/s);
  assert.match(stylesheet, /\.modulation-bracket-close\s*\{[^}]*border-inline-end/s);
  assert.match(stylesheet, /\.tonal-prefix, \.modulation-prefix\s*\{[^}]*color:\s*#53695d;[^}]*font-family:\s*"MStruct Text Accidentals", "Academico"[^}]*font-size:\s*\.82em/s);
  assert.match(stylesheet, /\.tonal-label\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*baseline/s);
  assert.match(rendererSource, /--slot-content-shift/);
  assert.match(stylesheet, /\.harmony-stack\s*\{[^}]*inset-inline-start:\s*var\(--slot-content-shift, 0\)/s);
  assert.match(stylesheet, /\.duration-label\s*\{[^}]*translate:\s*var\(--slot-content-shift, 0\) 0/s);
});
