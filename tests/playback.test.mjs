import assert from "node:assert/strict";
import test from "node:test";
import { parseMstruct } from "../src/core/mstruct.js";
import {
  buildPlaybackPlan,
  buildMstructtimePlaybackPlan,
  firstPlaybackEntryForSlot,
  formatPlaybackTimestamp,
  parsePlaybackOffset,
  playbackEntryAt,
  playbackEntriesForSlot,
} from "../src/core/mstruct-playback.js";
import { playbackEntryInformation } from "../src/core/mstruct-playback-info.js";
import { createRendererPlayback } from "../src/ui/renderer-playback.js";
import { ChordPianoPlayer } from "../src/core/chord-audio.js";

test("manual piano voices coexist with preview voices and pending notes respect cancellation", async () => {
  const player = new ChordPianoPlayer();
  const started = [], stopped = [];
  player.context = { currentTime: 0, close() {} };
  player.piano = { start(options) { started.push(options); return () => stopped.push(options.note); }, dispose() {} };
  player.load = async () => {};
  const release = await player.noteOn(60);
  await player.play([64]);
  player.stop();
  assert.deepEqual(stopped, [64]);
  release(); release();
  assert.deepEqual(stopped, [64, 60]);
  assert.equal(started[0].duration, undefined);
  let finish;
  player.load = () => new Promise(resolve => { finish = resolve; });
  let cancelled = false;
  const pendingManual = player.noteOn(67, () => cancelled);
  cancelled = true; finish(); await pendingManual;
  assert.equal(started.length, 2);
  const pendingPreview = player.play([69]);
  player.stop(); finish(); await pendingPreview;
  assert.equal(started.length, 2);
  const disposedManual = player.noteOn(72);
  player.dispose(); finish(); await disposedManual;
  assert.equal(started.length, 2);
});

test("injected desktop video follows the existing playback clock, volume and source lifecycle", async t => {
  class Media extends EventTarget {
    duration = 4; currentTime = 0; paused = true; ended = false;
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("canplay"))); }
    removeAttribute() { this.src = ""; }
  }
  const globals = ["CSS", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]));
  globalThis.CSS = { escape: String };
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  t.after(() => { for (const key of globals) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } });
  const canvas = { classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  const media = new Media();
  const player = createRendererPlayback({ canvas, mediaElement: media, onStateChange() {}, requestScroll() {}, closePopovers() {} });
  t.after(() => player.destroy());
  player.setDocument({ result: parseMstruct("{BN:1}{TS:4/4}{D:1}{BPM:1/4=120}{TC:C}C|I;", { isStableTempo: true }), stableTempo: true, userOffset: 0 });
  assert.equal(player.getState().enabled, true);
  const file = new File(["fixture"], "clip.mp4", { type: "video/mp4" });
  await player.loadBgmFile(file);
  assert.equal(player.getState().videoReady, true);
  assert.equal((await player.getExportSnapshot()).bgmFile, file);
  player.setBgmVolume(25); assert.equal(media.volume, .25);
  player.run("play"); await Promise.resolve(); assert.equal(media.paused, false);
  player.run("pause"); assert.equal(media.paused, true);
  player.seek(1000); assert.equal(media.currentTime, 1);
  player.run("stop"); assert.equal(media.currentTime, 0);
  player.clearBgmFile(); assert.equal(player.getState().videoReady, false);
  await player.loadBgmFile(new File(["fixture"], "clip.wav", { type: "audio/wav" }));
  assert.equal(player.getState().bgmReady, true); assert.equal(player.getState().videoReady, false);
});

test("钢琴跨小节及字段级延音合并实际时长，同音重击与静音事件仍分开", () => {
  const result = parseMstruct("{BN:15}{TS:4/4}{D:1}{BPM:1/4=60}{TC:Bb}Bbm|i7;{BPM:1/4=120}-;[C:-|R:V];Bbm|i7;0;-;N.C.;-;X;-;Clus;-;", { isStableTempo: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const plan = buildPlaybackPlan(result, -30);
  const [attack, dash, field, repeated] = plan.entries;
  assert.deepEqual([attack.endMs, dash.endMs, field.endMs], [3970, 5970, 7970]);
  for (const entry of [attack, dash, field]) {
    assert.deepEqual(entry.midiNotes, [58, 61, 65]);
    assert.equal(entry.pianoEndMs, 7970);
    assert.equal(entry.pianoAttackRouteIndex, attack.routeIndex);
  }
  assert.notEqual(repeated.pianoAttackRouteIndex, attack.pianoAttackRouteIndex);
  assert.equal(repeated.pianoEndMs, repeated.endMs);
  assert.ok(plan.entries.slice(4).every(entry => entry.midiNotes === null));
});

test("钢琴延音按真实反复路线连接，并在省略号处停止", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=60}{||:}-;C|{:||};...{BN:3}{T=0:06}-;", { isStableTempo: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const entries = buildPlaybackPlan(result).entries;
  assert.equal(entries[0].midiNotes, null);
  assert.deepEqual(entries[2].midiNotes, [60, 64, 67]);
  assert.equal(entries[1].pianoEndMs, entries[2].endMs);
  assert.equal(entries.at(-1).midiNotes, null);
});

test("时间轴钢琴延音使用时间戳并覆盖尾段，未录入的新和弦阻断旧音延续", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}C|;-;[C:-|R:X];");
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const timeline = { metadata: { musicLength: "0:08" }, loop: "", main: "{BN:1}{D:1/4}[1000,1];[2500,1];[4000,1];" };
  const plan = buildMstructtimePlaybackPlan(result, timeline, 25);
  assert.deepEqual(plan.entries.map(entry => [entry.startMs, entry.endMs, entry.pianoEndMs]), [[1025, 2525, 8000], [2525, 4025, 8000], [4025, 8000, 8000]]);
  assert.ok(plan.entries.every(entry => entry.pianoAttackRouteIndex === plan.entries[0].routeIndex));
  const interrupted = parseMstruct("{BN:1}{TS:1/4}{D:1/4}C|;D|;-;");
  const sparse = buildMstructtimePlaybackPlan(interrupted, { ...timeline, main: "{BN:1}{D:1/4}[1000,1];[,1];[4000,1];" });
  assert.equal(sparse.entries.at(-1).midiNotes, null);
});

test("临时 offset 只调整播放计划，不改谱面或时间轴文档", t => {
  const previousAudio = globalThis.Audio;
  globalThis.Audio = class { pause() {} addEventListener() {} removeEventListener() {} removeAttribute() {} load() {} };
  t.after(() => { if (previousAudio === undefined) delete globalThis.Audio; else globalThis.Audio = previousAudio; });
  const canvas = { classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  const player = createRendererPlayback({ canvas, onStateChange() {}, requestScroll() {}, closePopovers() {} });
  t.after(() => player.destroy());
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1}{BPM:1/4=60}C|I;", { isStableTempo: true }), before = JSON.stringify(result);
  player.setDocument({ result, stableTempo: true, globalOffset: 10, userOffset: -30 });
  const duration = player.getState().durationMs;
  player.setTemporaryOffset(200);
  assert.notEqual(player.getState().durationMs, duration);
  player.setTemporaryOffset(-50); player.setTemporaryOffset(0);
  assert.equal(JSON.stringify(result), before);
  const timeline = { metadata: { musicLength: "0:08", offset: "10" }, loop: "", main: "{BN:1}{D:1}[1000,1];" }, timelineBefore = JSON.stringify(timeline);
  player.setDocument({ result, stableTempo: false, userOffset: -30, timelineDocument: timeline });
  player.setTemporaryOffset(500); player.setTemporaryOffset(-100);
  assert.equal(JSON.stringify(timeline), timelineBefore); assert.equal(JSON.stringify(result), before);
});

test("播放器移动高亮经过延音时不重击，暂停续播和跳播只播放剩余时长", async t => {
  let now = 0, frame;
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "setTimeout", () => 0);
  t.mock.method(globalThis, "clearTimeout", () => {});
  class FakeAudio {
    pause() {} addEventListener() {} removeEventListener() {} removeAttribute() {} load() {}
  }
  // Browser globals are restored even when an assertion fails.
  const globals = ["Audio", "CSS", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]));
  globalThis.Audio = FakeAudio;
  globalThis.CSS = { escape: String };
  globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { for (const key of globals) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } });
  const calls = [], elements = new Map();
  const canvas = {
    classList: { add() {}, remove() {} }, addEventListener() {}, removeEventListener() {},
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} });
      return elements.get(selector);
    },
  };
  const piano = { loaded: true, stop: () => calls.push("stop"), play: async (notes, options) => calls.push({ notes, ...options }) };
  let active;
  const player = createRendererPlayback({ canvas, pianoPlayer: piano, onStateChange: (_state, entry) => { active = entry; }, requestScroll() {}, closePopovers() {} });
  t.after(() => player.destroy());
  const result = parseMstruct("{BN:15}{TS:4/4}{D:1}{BPM:1/4=60}Bbm|;-;C|;", { isStableTempo: true });
  player.setDocument({ result, stableTempo: true, userOffset: 0 });
  player.setPianoEnabled(true);
  player.run("play");
  assert.equal(calls.at(-1).durationSeconds, 8);
  const count = calls.length;
  now = 4500; frame(now);
  assert.equal(active.position, "16 1/4");
  assert.equal(calls.length, count);
  player.run("pause");
  player.run("play");
  assert.equal(calls.at(-1).durationSeconds, 3.5);
  player.seek(6500);
  assert.equal(calls.at(-1).durationSeconds, 1.5);
  now = 6000; frame(now);
  assert.deepEqual(calls.at(-1).notes, [60, 64, 67]);
  player.run("stop");
  assert.equal(calls.at(-1), "stop");
});

test("临时 offset 只接受安全整数", () => {
  assert.equal(parsePlaybackOffset(" -35 "), -35);
  assert.equal(parsePlaybackOffset("0"), 0);
  assert.equal(parsePlaybackOffset("1.5"), null);
  assert.equal(parsePlaybackOffset(""), null);
  assert.equal(parsePlaybackOffset("9007199254740992"), null);
});

test("稳定速度播放按 BPM 绝对累计并把全曲 offset 加到事件时间", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}{BPM:1/4=60}C|,{BPMhidden:1/4=120}0,-,N.C.;", { isStableTempo: true });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const plan = buildPlaybackPlan(result, 250);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.entries.map((entry) => entry.startMs), [250, 1250, 1750, 2250]);
  assert.deepEqual(plan.entries.map((entry) => entry.endMs), [1250, 1750, 2250, 2750]);
  assert.equal(plan.durationMs, 2750);
  assert.equal(plan.firstTimeSignatureSlotId, String(result.measures[0].slots[0].start));
  assert.deepEqual(plan.entries.map((entry) => entry.midiNotes), [[60, 64, 67], null, null, null]);
  assert.equal(playbackEntryAt(plan, 0), null);
  assert.equal(playbackEntryAt(plan, 1749)?.slotId, plan.entries[1].slotId);
});

test("同一 slot 的 BPM 与 BPMhidden 按源码顺序覆盖同一个播放速度", () => {
  const hiddenLast = parseMstruct(
    "{BN:1}{TS:2/4}{D:1/4}{BPM:1/4=60}{BPMhidden:1/4=120}C|,D|;",
    { isStableTempo: true },
  );
  assert.equal(hiddenLast.ok, true, hiddenLast.errors.map((error) => error.message).join("\n"));
  assert.equal(hiddenLast.measures[0].slots[0].annotations.bpm, "1/4=60");
  const hiddenLastPlan = buildPlaybackPlan(hiddenLast);
  assert.deepEqual(hiddenLastPlan.entries.map((entry) => [entry.bpm, entry.startMs, entry.endMs]), [
    ["1/4=120", 0, 500],
    ["1/4=120", 500, 1000],
  ]);

  const visibleLast = parseMstruct(
    "{BN:1}{TS:2/4}{D:1/4}{BPMhidden:1/4=120}{BPM:1/4=60}C|,D|;",
    { isStableTempo: true },
  );
  assert.equal(visibleLast.ok, true, visibleLast.errors.map((error) => error.message).join("\n"));
  assert.equal(visibleLast.measures[0].slots[0].annotations.bpm, "1/4=60");
  const visibleLastPlan = buildPlaybackPlan(visibleLast);
  assert.deepEqual(visibleLastPlan.entries.map((entry) => [entry.bpm, entry.startMs, entry.endMs]), [
    ["1/4=60", 0, 1000],
    ["1/4=60", 1000, 2000],
  ]);
});

test("MM 保持 BPM 数值并在显式 BPM 前提供基准拍单位换算", () => {
  const parsed = parseMstruct("{BN:1}{D:1}{TS:adlib}{TC:C}{BPM:1/4=100}{MM:1/4=1/8}C|I,{BPM:1/2=80}D|ii,{MM:1/2=1/4}E|iii;");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  const plan = buildPlaybackPlan(parsed);
  assert.deepEqual(plan.entries.map((entry) => [entry.bpm, entry.explicitBpm, entry.bpmModulated]), [
    ["1/8=100", "1/4=100", true],
    ["1/2=80", "1/2=80", false],
    ["1/4=80", "1/2=80", true],
  ]);
  assert.equal(playbackEntryInformation(plan.entries[0]).bpmReference, "1/4=50");
  assert.equal(playbackEntryInformation(plan.entries[1]).bpmReference, null);
  assert.equal(playbackEntryInformation(plan.entries[2]).bpmReference, "1/2=40");

  const ellipsis = parseMstruct("{BN:1}{D:1}{TS:adlib}{TC:C}{BPM:1/4=100}{MM:1/4=1/8}C|I;...{BN:2}{T=0:02}D|ii;");
  assert.equal(ellipsis.ok, true, ellipsis.errors.map((error) => error.message).join("\n"));
  const ellipsisEntry = buildPlaybackPlan(ellipsis).entries.find((entry) => entry.kind === "ellipsis");
  assert.equal(playbackEntryInformation(ellipsisEntry).bpmReference, "1/4=50");
});

test("全屏信息直接携带曲式数据，不依赖谱面图层是否渲染", () => {
  const parsed = parseMstruct("{BN:1}{D:1}{TS:adlib}[F:A|1|intro]C|;");
  assert.equal(parsed.ok, true, parsed.errors.map((error) => error.message).join("\n"));
  const form = playbackEntryInformation(buildPlaybackPlan(parsed).entries[0]).formSymbol;
  assert.deepEqual(Object.fromEntries(Object.entries(form).filter(([key]) => !["start", "end"].includes(key))), {
    body: "A", superscript: "1", subscript: "intro",
  });
});

test("fullscreen form symbols persist along the repeat route and remain correct after seeking", () => {
  const parsed = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{BPM:1/4=60}C|,C|;{||:}[F:A|1|intro]D|,E|;[F:B||]F|,G|{:||};A|,B|;", { isStableTempo: true });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const plan = buildPlaybackPlan(parsed);
  const symbols = plan.entries.map(entry => playbackEntryInformation(entry).formSymbol);
  assert.deepEqual(symbols.map(form => form?.body ?? null), [null, null, "A", "A", "B", "B", "A", "A", "B", "B", "B", "B"]);
  assert.equal(symbols[3].superscript, "1");
  assert.equal(symbols[3].subscript, "intro");
  for (const index of [10, 3, 7, 0, 5]) {
    assert.equal(playbackEntryInformation(playbackEntryAt(plan, plan.entries[index].startMs)).formSymbol, symbols[index]);
  }
  assert.equal(parsed.measures[1].slots[1].annotations.form, null, "inheritance must not add score annotations");
  assert.equal(playbackEntryInformation(null).formSymbol, null);
  const fresh = buildPlaybackPlan(parseMstruct("{BN:1}{TS:adlib}{D:1}C|;"));
  assert.equal(playbackEntryInformation(fresh.entries[0]).formSymbol, null, "new documents start without a form");
});

test("fullscreen forms cross omissions and unassigned timeline rows until the next symbol", () => {
  const omitted = parseMstruct("{BN:1}{TS:adlib}{D:1}{BPM:1/4=60}[F:A||]C|;...{BN:2}{T=0:02}D|;[F:B||]E|;F|;");
  assert.equal(omitted.ok, true, JSON.stringify(omitted.errors));
  assert.deepEqual(buildPlaybackPlan(omitted).entries.map(entry => playbackEntryInformation(entry).formSymbol?.body), ["A", "A", "A", "B", "B"]);

  const parsed = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,[F:A|1|intro]D|,E|,[F:B||]F|;G|,A|,B|,C|;");
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const timeline = { metadata: { musicLength: "0:08" }, loop: "",
    main: "{BN:1}{TS:4/4}{D:1/4}[0,1],[,1],[2000,1],[3000,1];{BN:2}[4000,1],[5000,1],[6000,1],[7000,1];" };
  const plan = buildMstructtimePlaybackPlan(parsed, timeline);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.entries.map(entry => playbackEntryInformation(entry).formSymbol?.body ?? null), [null, "A", "B", "B", "B", "B", "B"]);
  assert.equal(playbackEntryInformation(playbackEntryAt(plan, 2500)).formSymbol.superscript, "1");
  assert.equal(playbackEntryInformation(playbackEntryAt(plan, 6500)).formSymbol.body, "B");
});

test("selecting a timeline row without a timestamp displays its inherited form", t => {
  class Media extends EventTarget { pause() {} load() {} removeAttribute() {} }
  const globals = ["CSS", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]));
  globalThis.CSS = { escape: String };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { for (const key of globals) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } });
  const result = parseMstruct("{BN:1}{TS:3/4}{D:1/4}C|,[F:A||]D|,E|;[F:B||]F|,G|,A|;");
  const timeline = { metadata: { musicLength: "0:08" }, loop: "", main: "{BN:1}{TS:3/4}{D:1/4}[0,1],[1000,1],[,1];{BN:2}[2000,1],[,1],[5000,1];" };
  const plan = buildMstructtimePlaybackPlan(result, timeline);
  assert.equal(plan.ready, true);
  const rows = plan.rows.filter(row => row.kind === "event" && row.milliseconds === null);
  assert.deepEqual(rows.map(row => row.formSymbol?.body), ["A", "B"]);
  const canvas = { classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  let currentEntry;
  const player = createRendererPlayback({ canvas, mediaElement: new Media(), onStateChange(state, entry) { currentEntry = entry; }, requestScroll() {}, closePopovers() {} });
  t.after(() => player.destroy());
  player.setDocument({ result, stableTempo: false, userOffset: 0 });
  player.setTimelineDocument(timeline);
  for (const row of [rows[1], rows[0]]) {
    player.selectTimelineRow(row.number);
    assert.equal(playbackEntryInformation(currentEntry).formSymbol.body, row.formSymbol.body);
  }
});

test("延长符按实际播放路线分别回读前一和弦与 Roman", () => {
  const result = parseMstruct(
    "{BN:1}{TS:4/4}{D:1/4}{BPM:1/4=120}{TC:C}C|I,[C:-|R:V],[C:D|R:-],-;",
    { isStableTempo: true },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const [first, chordContinues, romanContinues, bothContinue] = buildPlaybackPlan(result).entries;

  assert.equal(chordContinues.chordDisplayItems[0].slotId, first.slotId);
  assert.equal(chordContinues.romanDisplayItems[0].slotId, chordContinues.slotId);
  assert.equal(chordContinues.resolvedChordEvent.chord, "C");
  assert.equal(romanContinues.chordDisplayItems[0].slotId, romanContinues.slotId);
  assert.equal(romanContinues.romanDisplayItems[0].slotId, chordContinues.slotId);
  assert.equal(romanContinues.resolvedChordEvent.chord, "D");
  assert.equal(bothContinue.chordDisplayItems[0].slotId, romanContinues.slotId);
  assert.equal(bothContinue.romanDisplayItems[0].slotId, chordContinues.slotId);
  assert.equal(bothContinue.resolvedChordEvent.chord, "D");
  assert.deepEqual(playbackEntryInformation(bothContinue).noteNames, ["D", "F#", "A"]);
});

test("负 offset 从零时刻进入曲内位置且时间戳不显示负数", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}{BPM:1/4=60}X,0,-,N.C.;", { isStableTempo: true });
  const plan = buildPlaybackPlan(result, -1500);
  assert.equal(plan.ready, true);
  assert.equal(playbackEntryAt(plan, 0)?.slotId, plan.entries[1].slotId);
  assert.equal(formatPlaybackTimestamp(-15), "00:00.000");
  assert.equal(formatPlaybackTimestamp(61234.9), "01:01.234");
});

test("小节位置使用 TS 与时值分母的最小公倍数并按一开始计数", () => {
  const quarters = parseMstruct("{BN:2}{TS:4/4}{D:1/4}{BPM:1/4=120}X,0,-,N.C.;", { isStableTempo: true });
  assert.equal(buildPlaybackPlan(quarters).entries.at(-1).position, "2 4/4");

  const result = parseMstruct("{BN:2}{TS:4/4}{D:1/8}{BPM:1/8=120}X,0,-,N.C.,Clus,ClusWK,ClusBK,C|;", { isStableTempo: true });
  const plan = buildPlaybackPlan(result);
  assert.deepEqual(plan.entries.map((entry) => entry.position), [
    "2 1/8", "2 2/8", "2 3/8", "2 4/8", "2 5/8", "2 6/8", "2 7/8", "2 8/8",
  ]);

  const compound = parseMstruct("{BN:3}{TS:12/8}{D:1/8}{BPM:1/8=120}X,0,-,N.C.,Clus,ClusWK,ClusBK,C|,D|,E|,F|,G|;", { isStableTempo: true });
  const compoundPlan = buildPlaybackPlan(compound);
  assert.equal(compoundPlan.entries.at(-1).position, "3 12/8");

  const romanOnly = parseMstruct("{BN:4}{TS:1/4}{D:1/4}{BPM:1/4=120}{TC:C}|I;", { isStableTempo: true });
  assert.equal(romanOnly.ok, true, romanOnly.errors.map((error) => error.message).join("\n"));
  assert.equal(buildPlaybackPlan(romanOnly).entries.length, 1);
});

test("缺少开头 TS 时不能播放，adlib 按 BPM 与事件时值建立时间线", () => {
  const withoutTimeSignature = parseMstruct("{BN:1}{D:1/4}{BPM:1/4=60}X;", { isStableTempo: true });
  assert.ok(withoutTimeSignature.errors.some((error) => error.code === "missing-initial-time-signature"));
  const noTimeSignaturePlan = buildPlaybackPlan(withoutTimeSignature, 300);
  assert.equal(noTimeSignaturePlan.ready, false);
  assert.deepEqual(noTimeSignaturePlan.entries, []);
  assert.equal(noTimeSignaturePlan.firstTimeSignatureSlotId, null);

  const adlib = parseMstruct("{BN:1}{TS:adlib}{D:1/8}{BPM:1/8=90}X,0,-;", { isStableTempo: true });
  const adlibPlan = buildPlaybackPlan(adlib);
  assert.equal(adlib.ok, true);
  assert.equal(adlibPlan.ready, true);
  assert.equal(adlibPlan.entries.length, 3);
});

test("T 只作阅读标签，省略号不从标签推测播放时长", () => {
  const result = parseMstruct(
    "{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=60}C|;...{BN:4}{T=0:05}D|;...",
    { isStableTempo: true },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const plan = buildPlaybackPlan(result);
  assert.deepEqual(plan.entries.map((entry) => [entry.kind, entry.startMs, entry.endMs]), [
    ["event", 0, 1000],
    ["ellipsis", 1000, 1000],
    ["event", 1000, 2000],
    ["ellipsis", 2000, 2000],
  ]);
  assert.equal(plan.durationMs, 2000);
  assert.equal(playbackEntryAt(plan, 1000)?.kind, "event");
  assert.equal(playbackEntryAt(plan, 1000)?.position, "4 1/4");
  assert.match(plan.entries[1].slotId, /^ellipsis-/);
  assert.equal(firstPlaybackEntryForSlot(plan, plan.entries[1].slotId), plan.entries[1]);
});

test("增删或修改 T 不改变事件时间、反复路线、offset 或 MStructTime 播放", () => {
  const plain = "{BN:1}{TS:1/4}{D:1/4}{BPM:1/4=60}{||:}C|{:||};...{BN:4}D|;";
  const labeled = plain.replace("C|", "{T=12:34:56}C|").replace("D|", "{T=00:01}D|");
  const backwards = labeled.replace("12:34:56", "0:01").replace("00:01", "0:00");
  const timing = (plan) => ({ ready: plan.ready, duration: plan.durationMs,
    entries: plan.entries.map(({ kind, startMs, endMs, bpm, position }) => ({ kind, startMs, endMs, bpm, position })) });
  for (const offset of [-500, 0, 250]) {
    const baseline = timing(buildPlaybackPlan(parseMstruct(plain, { isStableTempo: true }), offset));
    for (const main of [labeled, backwards]) {
      const parsed = parseMstruct(main, { isStableTempo: true });
      assert.equal(parsed.ok, true);
      assert.deepEqual(timing(buildPlaybackPlan(parsed, offset)), baseline);
    }
  }
  const timeline = { metadata: { musicLength: "0:08" }, loop: "",
    main: "{BN:1}{TS:1/4}{D:1/4}[1000,1];...[3000,1]{BN:4}[5000,1];" };
  assert.equal(buildMstructtimePlaybackPlan(parseMstruct(plain), timeline, 200).ready, true);
  assert.deepEqual(timing(buildMstructtimePlaybackPlan(parseMstruct(labeled), timeline, 200)),
    timing(buildMstructtimePlaybackPlan(parseMstruct(plain), timeline, 200)));
});

test("MM 缺少数值 BPM 时不能伪造稳定播放计划", () => {
  const parsed = parseMstruct("{BN:1}{TS:adlib}{D:1}{MM:1/4=1/8}C|,{BPM:1/4=60}D|;");
  assert.equal(parsed.ok, true);
  assert.equal(buildPlaybackPlan(parsed).ready, false);
});

test("不同拍单位的 MM 精确换速，并在反复时恢复 BPM 基准", () => {
  const result = parseMstruct("{BN:1}{TS:adlib}{D:1/4}{BPM:1/4=100}{||:}{MM:3/8=1/4}C|,{MM:1/4=3/8}D|{:||};", { isStableTempo: true });
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const plan = buildPlaybackPlan(result);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.entries.map(({ bpm, startMs, endMs }) => [bpm, startMs, endMs]), [
    ["1/6=100", 0, 900], ["1/4=100", 900, 1500],
    ["1/6=100", 1500, 2400], ["1/4=100", 2400, 3000],
  ]);
  assert.equal(playbackEntryInformation(plan.entries[0]).bpmReference, "1/4=66.667");
});

test("播放路线复用普通反复和多 ending 的实际演奏顺序，选择取第一次出现", () => {
  const repeated = parseMstruct("{BN:1}{TS:2/4}{D:1/4}{BPM:1/4=60}{||:}C|,D|{:||};", { isStableTempo: true });
  const repeatedPlan = buildPlaybackPlan(repeated);
  assert.deepEqual(repeatedPlan.entries.map((entry) => entry.slotId), [
    String(repeated.measures[0].slots[0].start),
    String(repeated.measures[0].slots[1].start),
    String(repeated.measures[0].slots[0].start),
    String(repeated.measures[0].slots[1].start),
  ]);
  assert.equal(firstPlaybackEntryForSlot(repeatedPlan, repeated.measures[0].slots[0].start)?.startMs, 0);
  assert.deepEqual(
    playbackEntriesForSlot(repeatedPlan, repeated.measures[0].slots[0].start).map((entry) => entry.startMs),
    [0, 2000],
  );

  const endings = parseMstruct(String.raw`{BN:0}{TS:4/4}{D:1/4}{BPM:1/4=60}A|;C|,C|,C|,C|;C|,{ENDING:1}D|,D|{/ENDING:1}{:||},{ENDING:2}E|,E|,E|{/ENDING};`, { isStableTempo: true });
  const endingPlan = buildPlaybackPlan(endings);
  assert.equal(endingPlan.ready, true);
  assert.deepEqual(endingPlan.entries.map((entry) => entry.slotId), endings.playbackRoute
    .filter((visit) => visit.slot.events.length)
    .map((visit) => String(visit.slot.start)));
});

test(">> 的累计小节号进入稳定速度播放位置标签", () => {
  const result = parseMstruct(
    "{BN:1}{TS:4/4}{D:1}{BPM:1/4=60}{||:}C|;D|;E|;F|{:||2x>>};G|;",
    { isStableTempo: true },
  );
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const plan = buildPlaybackPlan(result);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.entries.map((entry) => entry.position.split(" ")[0]),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

test("没有可计算 BPM 的时值路线不会启用播放", () => {
  const result = parseMstruct("{BN:1}{TS:4/4}{D:1/4}, {BPM:1/4=60}C|,D|,E|;", { isStableTempo: true });
  assert.equal(result.ok, true);
  assert.equal(buildPlaybackPlan(result).ready, false);
});

test("非稳定速度播放只使用 mstructtime 时间戳和会话临时偏移", () => {
  const result = parseMstruct("{BN:1}{TS:3/4}{D:1/4}C|,D|,E|;");
  const timeline = {
    metadata: { musicLength: "0:08" },
    loop: "",
    main: "{BN:1}{TS:3/4}{D:1/4}[1000,1],[,1],[5000,1];",
  };
  const plan = buildMstructtimePlaybackPlan(result, timeline, 25);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.entries.map((entry) => [entry.startMs, entry.endMs]), [[1025, 5025], [5025, 8000]]);
  assert.equal(playbackEntryAt(plan, 3000)?.position, "1 1/4");
  assert.equal(playbackEntryAt(plan, 5024)?.slotId, String(result.measures[0].slots[0].start));
});

test("非稳定速度播放持续继承当前拍号，并让 end 指定的末事件保持到音乐结束", () => {
  const result = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;E|,F|;{TS:3/4}G|,A|,B|;");
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join("\n"));
  const timeline = {
    metadata: { musicLength: "0:08" },
    loop: "2,2/4,1,end;",
    main: "{BN:1}{D:1/4}[0,1],[1000,1];{BN:2}{D:1/4}[2000,1],[3000,1];{BN:3}{D:1/4}[4000,1],[5000,1],[6000,1];",
  };
  const plan = buildMstructtimePlaybackPlan(result, timeline);
  assert.equal(plan.ready, true, plan.errors.map((error) => error.code).join(","));
  assert.deepEqual(plan.entries.map((entry) => entry.timeSignatureLabel), ["2/4", "2/4", "2/4", "2/4"]);
  assert.equal(plan.entries.at(-1).position, "2 2/4");
  assert.equal(plan.entries.at(-1).endMs, 8000);
  assert.equal(playbackEntryAt(plan, 7999), plan.entries.at(-1));
});

test("尚未录入事件的有效时间轴仍能启动播放时钟", () => {
  const result = parseMstruct("{BN:1}{TS:1/4}{D:1/4}C|;");
  const plan = buildMstructtimePlaybackPlan(result, { metadata: { musicLength: "0:10" }, loop: "", main: "" });
  assert.equal(plan.ready, true);
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.durationMs, 10000);
  assert.equal(plan.preRollEndMs, 10000);
});
