import assert from "node:assert/strict";
import test from "node:test";
import { createTimelineHistory, selectTimelineRows } from "../src/ui/timeline-table-editing.js";
import { readFile } from "node:fs/promises";
import { planMstructtimeBulkFill, validateMstructtimeBulkFields } from "../src/core/mstructtime-bulk-fill.js";
import { parseMstruct } from "../src/core/mstruct.js";
import { compileProfileDocument } from "../src/core/profile-document.js";
import { verifyMstructProfile } from "../src/core/profile.js";
import { createEmptyMetadata, parseMstructDocument, serializeMstructDocument } from "../src/core/mstruct-document.js";
import { STANDARD_LINK_FIELDS } from "../src/core/metadata-links.js";
import {
  createEmptyMstructtimeMetadata,
  createMstructtimeFileName,
  parseMstructtimeDocument,
  parseMstructtimeLoop,
  parseMstructtimeMain,
  serializeMstructtimeDocument,
} from "../src/core/mstructtime-document.js";
import {
  buildMstructtimeEventRows,
  buildMstructtimeRoute,
  serializeMstructtimeMain,
  updateMstructtimeRows,
} from "../src/core/mstructtime-route.js";

test("analysis and timeline links share all six defaults, ordered additional links and score links", () => {
  const links = Object.fromEntries(STANDARD_LINK_FIELDS.map(([key]) => [key, `https://example.com/${key}`]));
  const linkMetadata = { links, scoreUrls: ["https://example.com/score"], additionalUrls: [{ label: "Recording details", url: "https://example.com/details" }, { label: "Other", url: "https://example.com/other" }] };
  const metadata = { ...createEmptyMstructtimeMetadata(), name: "Recording", performers: [{ name: "Performer" }], musicLength: "4:30", ...linkMetadata };
  const timelineText = serializeMstructtimeDocument({ metadata, loop: "1,1/4,1,end;", main: "{BN:1}{TS:4/4}{D:1/4}[300,1];" });
  assert.match(timelineText, /\{URL_APPLE_MUSIC\}https:\/\/example.com\/appleMusic/);
  const timeline = parseMstructtimeDocument(timelineText);
  assert.equal(timeline.ok, true);
  const analysis = parseMstructDocument(serializeMstructDocument({ metadata: { ...createEmptyMetadata(), ...linkMetadata }, main: "X;" }));
  for (const field of ["links", "scoreUrls", "additionalUrls"]) {
    assert.deepEqual(timeline.metadata[field], analysis.metadata[field]);
    assert.deepEqual(timeline.metadata[field], linkMetadata[field]);
  }
  assert.equal(serializeMstructtimeDocument(timeline), timelineText);
  for (const tag of ["SCORE_URL_10", "URL_ADDITIONAL_10:Too many"]) {
    const invalid = parseMstructtimeDocument(timelineText.replace("END_METADATA", `{${tag}}https://example.com\nEND_METADATA`));
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some(error => error.code.endsWith("url-limit")));
  }
  const legacy = parseMstructtimeDocument(timelineText.replace(/\{URL_ADDITIONAL_\d+:/g, "{URL_ADDITIONAL:"));
  assert.deepEqual(legacy.metadata.additionalUrls, linkMetadata.additionalUrls);
  const old = parseMstructtimeDocument(timelineText.replace(/^\{(?:URL_|SCORE_URL_).*\n/gm, ""));
  assert.equal(old.ok, true);
  assert.equal(old.metadata.links.appleMusic, "");
});

test("mstructtime 三段文档及录音元数据可规范往返", () => {
  const metadata = createEmptyMstructtimeMetadata();
  metadata.name = "内田光子 1985";
  metadata.nameRomanized = "Mitsuko Uchida 1985";
  metadata.performers = [
    { name: "内田光子", romanized: "Mitsuko Uchida" },
    { name: "English Performer", romanized: "" },
  ];
  metadata.recordAlbum = "モーツァルト：ピアノ・ソナタ集";
  metadata.recordAlbumRomanized = "Mozart Piano Sonatas";
  metadata.recordYear = "1985";
  metadata.musicLength = "14:22";
  const text = serializeMstructtimeDocument({
    metadata,
    loop: "2,4/4,1,1,1/4;",
    main: "{BN:1}{TS:4/4}{D:1/4}[1000,1],...[2000,1]",
  });
  const parsed = parseMstructtimeDocument(text);
  assert.equal(parsed.ok, true, parsed.errors.map((item) => item.code).join(","));
  assert.equal(parsed.metadata.performers.length, 2);
  assert.equal(parsed.metadata.musicLength, "14:22");
  assert.equal(parsed.entries[0].milliseconds, 1000);
  assert.equal(parsed.entries[1].kind, "ellipsis");
});

test("mstructtime 必填、罗马化、年代和时长会被校验", () => {
  const text = serializeMstructtimeDocument({ metadata: createEmptyMstructtimeMetadata(), loop: "", main: "" });
  const parsed = parseMstructtimeDocument(text);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((item) => item.code === "mstructtime-name-required"));
  assert.ok(parsed.errors.some((item) => item.code === "mstructtime-performer-required"));
  assert.ok(parsed.errors.some((item) => item.code === "mstructtime-length-required"));
});

test("显式 LOOP 按来源位置经过次数生成实际事件顺序", () => {
  const analysis = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;E|,F|;");
  assert.equal(analysis.ok, true);
  const loop = "1,2/4,1,1,1/4;\n1,2/4,2,2,1/4;";
  const route = buildMstructtimeRoute(analysis, loop);
  assert.equal(route.ok, true, route.errors.map((item) => item.code).join(","));
  assert.deepEqual(route.route.filter((item) => item.slot?.events.length).map((item) => [item.measure, item.beat, item.pass]), [
    [1, "1/4", 1], [1, "2/4", 1],
    [1, "1/4", 2], [1, "2/4", 2],
    [2, "1/4", 1], [2, "2/4", 1],
  ]);
});

test("LOOP end 在指定遍数的拍位结束路线并截断后续事件", () => {
  const parsed = parseMstructtimeLoop("1,2/4,2,end;");
  assert.equal(parsed.ok, true, parsed.errors.map((item) => item.code).join(","));
  assert.equal(parsed.instructions[0].type, "end");

  const analysis = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;E|,F|;");
  assert.equal(analysis.ok, true, analysis.errors.map((item) => item.code).join(","));
  const loop = "1,2/4,1,1,1/4;\n1,2/4,2,end;";
  const route = buildMstructtimeRoute(analysis, loop);
  assert.equal(route.ok, true, route.errors.map((item) => item.code).join(","));
  assert.deepEqual(route.route.filter((item) => item.slot?.events.length).map((item) => [item.measure, item.beat, item.pass]), [
    [1, "1/4", 1], [1, "2/4", 1],
    [1, "1/4", 2], [1, "2/4", 2],
  ]);

  const generated = buildMstructtimeEventRows(analysis, loop, "");
  assert.deepEqual(generated.rows.slice(1).map((row) => [row.measure, row.beat, row.pass]), [
    [1, "1/4", 1], [1, "2/4", 1],
    [1, "1/4", 2], [1, "2/4", 2],
  ]);
});

test("逗号后的省略号是带小节、开始拍位和遍数的正式事件", () => {
  const analysis = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,...{BN:4}{TS:4/4}{D:1/4}D|,E|,F|,G|;");
  assert.equal(analysis.ok, true, analysis.errors.map((item) => item.code).join(","));
  const generated = buildMstructtimeEventRows(analysis, "", "");
  assert.equal(generated.ok, true);
  const ellipsis = generated.rows.find((row) => row.kind === "ellipsis");
  assert.deepEqual([ellipsis.measure, ellipsis.beat, ellipsis.pass], [1, "2/4", 1]);
});

test("空时间戳合法，事件 MAIN 可从路线生成并保留同位置残余遍数", () => {
  const analysis = parseMstruct("{BN:1}{TS:2/4}{D:1/4}C|,D|;");
  const initial = buildMstructtimeEventRows(analysis, "", "{BN:1}{TS:2/4}{D:1/4}[100,1][900,3],[,1];");
  assert.equal(initial.ok, true);
  const rows = updateMstructtimeRows(initial.rows, 2, 800);
  const main = serializeMstructtimeMain(analysis, rows, initial.entries);
  const parsed = parseMstructtimeMain(main);
  assert.equal(parsed.ok, true, parsed.errors.map((item) => item.code).join(","));
  assert.ok(parsed.entries.some((item) => item.pass === 3 && item.milliseconds === 900));
  assert.ok(parsed.entries.some((item) => item.pass === 1 && item.milliseconds === 800));
});

test("时间轴自动文件名使用父文件名和不可复用随机标识", () => {
  assert.equal(createMstructtimeFileName("k545.mstruct", "a4f9-1c2d-extra"), "k545-time-a4f91c2d.mstructtime");
});

const bulkAnalysis = parseMstruct("{BN:1}{TS:4/4}{D:1/4}" + "C|,D|,E|,F|;".repeat(6));
const bulkLoop = "5,4/4,1,1,1/4;\n5,4/4,2,1,1/4;";
const bulkOptions = { startEvent: 25, endEvent: 56, startMilliseconds: 10000, bpm: "{BPM:1/4=120}", maximumMilliseconds: 120000 };

test("bulk field validation reports each field independently while incomplete drafts stay uncommittable", () => {
  assert.deepEqual(validateMstructtimeBulkFields(bulkOptions), []);
  const options = { startEvent: "", endEvent: "1.5", startMilliseconds: "-1", bpm: "120" };
  assert.deepEqual(validateMstructtimeBulkFields(options).map(({ field, code }) => [field, code]), [
    ["startEvent", "timelineBulkInteger"], ["endEvent", "timelineBulkInteger"],
    ["startMilliseconds", "timelineBulkInteger"], ["bpm", "timelineBulkBpmInvalid"],
  ]);
  assert.equal(planMstructtimeBulkFill(bulkAnalysis, { loop: bulkLoop, main: "" }, options).ok, false);
});

test("bulk fill follows a continuous LOOP slice through intervening measures and passes", () => {
  for (const [range, first, last] of [
    [{ startEvent: 1, endEvent: 60 }, 1, 60],
    [{ endEvent: 60 }, 25, 60],
    [{}, 25, 56],
    [{ startEvent: 33, endEvent: 48 }, 33, 48],
    [{ endEvent: 28 }, 25, 28],
    [{ startEvent: 26, endEvent: 26 }, 26, 26],
    [{ startEvent: 26, endEvent: 55 }, 26, 55],
  ]) {
    const plan = planMstructtimeBulkFill(bulkAnalysis, { loop: bulkLoop, main: "" }, { ...bulkOptions, ...range });
    assert.equal(plan.ok, true, plan.code);
    assert.deepEqual([plan.first, plan.last, plan.count], [first, last, last - first + 1]);
    assert.equal(plan.rows[last].milliseconds, 10000 + (last - first) * 500);
    assert.equal(plan.rows[0].milliseconds, 0);
    assert.ok(plan.rows.slice(1, first).every((row) => row.milliseconds === null));
    assert.ok(plan.rows.slice(last + 1).every((row) => row.milliseconds === null));
  }
});

test("bulk fill validates coordinates, BPM, ordering, duration and safe integers", () => {
  for (const [change, code] of [
    [{ startEvent: "" }, "timelineBulkInteger"],
    [{ startMilliseconds: "" }, "timelineBulkInteger"],
    [{ startEvent: 0 }, "timelineBulkInteger"],
    [{ endEvent: 0 }, "timelineBulkInteger"],
    [{ startEvent: 1.5 }, "timelineBulkInteger"],
    [{ startMilliseconds: -1 }, "timelineBulkInteger"],
    [{ bpm: "120" }, "timelineBulkBpmInvalid"],
    [{ bpm: "1/0=120" }, "timelineBulkBpmInvalid"],
    [{ bpm: "1/4=0" }, "timelineBulkBpmInvalid"],
    [{ startEvent: 500 }, "timelineBulkStartMissing"],
    [{ endEvent: 500 }, "timelineBulkEndMissing"],
    [{ startEvent: 56, endEvent: 25 }, "timelineBulkReverse"],
    [{ maximumMilliseconds: 11000 }, "timelineBulkTooLong"],
    [{ startMilliseconds: Number.MAX_SAFE_INTEGER, maximumMilliseconds: Infinity }, "timelineBulkOverflow"],
  ]) {
    const result = planMstructtimeBulkFill(bulkAnalysis, { loop: bulkLoop, main: "" }, { ...bulkOptions, ...change });
    assert.equal(result.code, code, JSON.stringify(change));
  }
  assert.equal(planMstructtimeBulkFill(bulkAnalysis, { loop: "invalid", main: "" }, bulkOptions).code, "timelineDataInvalid");
});

test("bulk fill computes every rounded timestamp from the same exact anchor", () => {
  const analysis = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,D|,E|,F|;");
  const options = { ...bulkOptions, startEvent: 1, endEvent: 4, startMilliseconds: "0", bpm: "1/4=90" };
  const plan = planMstructtimeBulkFill(analysis, { loop: "", main: "" }, options);
  assert.deepEqual(plan.rows.slice(1).map((row) => row.milliseconds), [0, 667, 1333, 2000]);
  const decimal = planMstructtimeBulkFill(analysis, { loop: "", main: "" }, { ...options, bpm: "3/8=92.5", startMilliseconds: "1e3" });
  assert.deepEqual(decimal.rows.slice(1).map((row) => row.milliseconds), [1000, 1432, 1865, 2297]);
  const long = planMstructtimeBulkFill(analysis, { loop: Array.from({ length: 99 }, (_, i) => `1,4/4,${i + 1},1,1/4;`).join("\n"), main: "" }, { ...options, endEvent: 400, maximumMilliseconds: 1000000 });
  assert.equal(long.rows.at(-1).milliseconds, 266000);
});

test("bulk fill includes empty-slot duration, rests, pickup and meter changes", () => {
  const analysis = parseMstruct("{BN:0}{TS:4/4}{D:1/4}C|;{BN:1}D|,,,;{TS:2/4}{D:1/8}0,0,E|,F|;");
  assert.equal(analysis.ok, true, JSON.stringify(analysis.errors));
  const plan = planMstructtimeBulkFill(analysis, { loop: "", main: "" }, { ...bulkOptions, startEvent: 1, endEvent: 6, startMilliseconds: 0 });
  assert.equal(plan.ok, true, plan.code);
  assert.deepEqual(plan.rows.slice(1).map((row) => row.milliseconds), [0, 500, 2500, 2750, 3000, 3250]);
  const adlib = parseMstruct("{BN:1}{TS:adlib}{D:1/12}C|,D|,E|;");
  const triplets = planMstructtimeBulkFill(adlib, { loop: "", main: "" }, { ...bulkOptions, startEvent: 1, endEvent: 3, startMilliseconds: 0 });
  assert.deepEqual(triplets.rows.slice(1).map((row) => row.milliseconds), [0, 167, 333]);
});

test("bulk fill accepts partial measure endpoints and rejects unknown ellipsis durations", () => {
  const options = { ...bulkOptions, startEvent: 1, endEvent: 2 };
  for (const loop of ["1,2/4,1,end;", "1,2/4,1,2,1/4;", "1,2/4,1,1,1/4;"]) {
    assert.equal(planMstructtimeBulkFill(bulkAnalysis, { loop, main: "" }, options).ok, true);
  }
  assert.equal(planMstructtimeBulkFill(bulkAnalysis, { loop: "1,4/4,1,end;", main: "" }, options).ok, true);
  const ellipsis = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,...{BN:4}{D:1/4}D|,E|,F|,G|;");
  assert.equal(planMstructtimeBulkFill(ellipsis, { loop: "", main: "" }, { ...options, endEvent: 3 }).code, "timelineBulkUnknownDuration");
  assert.equal(planMstructtimeBulkFill(ellipsis, { loop: "", main: "" }, options).ok, true);
  assert.equal(planMstructtimeBulkFill(ellipsis, { loop: "", main: "" }, { ...options, startEvent: 2 }).ok, true);
  const ending = parseMstruct("{BN:1}{TS:4/4}{D:1/4}C|,D|,E|,F|;...");
  const plan = planMstructtimeBulkFill(ending, { loop: "", main: "" }, { ...options, endEvent: 5 });
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.rows.at(-1).milliseconds, 12000);
});

test("bulk fill resolves IDs when a partial loop gives slots different pass counts", () => {
  const loop = "1,2/4,1,2,2/4;\n2,4/4,1,1,1/4;";
  const plan = planMstructtimeBulkFill(bulkAnalysis, { loop, main: "" }, { ...bulkOptions, startEvent: 1, endEvent: 13 });
  assert.equal(plan.ok, true, plan.code);
  assert.deepEqual([plan.first, plan.last], [1, 13]);
  const endRows = plan.rows.slice(10, 14);
  assert.deepEqual(endRows.map((row) => row.pass), [1, 2, 2, 2]);
});

test("bulk fill is atomic, checks external neighbors and preserves orphan timestamps on serialization", () => {
  const original = buildMstructtimeEventRows(bulkAnalysis, bulkLoop, "");
  const rows = original.rows.map((row) => ({ ...row, milliseconds: row.number === 0 ? 0 : row.number * 500 }));
  const main = serializeMstructtimeMain(bulkAnalysis, rows, [{ kind: "event", measure: 2, position: { numerator: 0, denominator: 1 }, pass: 8, milliseconds: 90000 }]);
  const timeline = { loop: bulkLoop, main };
  const before = structuredClone(timeline);
  const plan = planMstructtimeBulkFill(bulkAnalysis, timeline, { ...bulkOptions, startMilliseconds: 12500 });
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.existing, 32);
  assert.deepEqual(timeline, before);
  const saved = serializeMstructtimeMain(bulkAnalysis, plan.rows, parseMstructtimeMain(main).entries);
  assert.ok(parseMstructtimeMain(saved).entries.some((entry) => entry.pass === 8 && entry.milliseconds === 90000));
  assert.deepEqual(buildMstructtimeEventRows(bulkAnalysis, bulkLoop, saved).rows, plan.rows);
  const early = planMstructtimeBulkFill(bulkAnalysis, timeline, bulkOptions);
  assert.equal(early.code, "timelineBulkOrder");
  assert.deepEqual(early.details, { previous: 24, previousMs: 12000, next: 25, nextMs: 10000 });
  const late = planMstructtimeBulkFill(bulkAnalysis, timeline, { ...bulkOptions, startMilliseconds: 20000 });
  assert.equal(late.code, "timelineBulkOrder");
  assert.deepEqual(late.details, { previous: 56, previousMs: 35500, next: 57, nextMs: 28500 });
});

test("Renderer Test fixtures support all three passes and an existing start timestamp", async () => {
  const analysisText = await readFile(new URL("fixtures/timeline-bulk.mstruct", import.meta.url), "utf8");
  const timeText = await readFile(new URL("fixtures/timeline-bulk-time.mstructtime", import.meta.url), "utf8");
  const document = parseMstructDocument(analysisText);
  const timeline = parseMstructtimeDocument(timeText);
  assert.equal(timeline.ok, true, JSON.stringify(timeline.errors));
  const analysis = parseMstruct(document.main);
  assert.equal(analysis.ok, true, JSON.stringify(analysis.errors));
  const plan = planMstructtimeBulkFill(analysis, timeline, bulkOptions);
  assert.equal(plan.ok, true, plan.code);
  assert.equal(plan.existing, 1);
  assert.deepEqual([plan.first, plan.last], [25, 56]);
});

test("timeline table selection supports ranges, toggles, additive ranges and fixed START", () => {
  let state = selectTimelineRows(new Set(), null, 25);
  state = selectTimelineRows(state.selected, state.anchor, 28, { shiftKey: true });
  assert.deepEqual([...state.selected], [25, 26, 27, 28]);
  state = selectTimelineRows(state.selected, state.anchor, 26, { ctrlKey: true });
  assert.deepEqual([...state.selected], [25, 27, 28]);
  state = selectTimelineRows(state.selected, state.anchor, 30, { metaKey: true });
  state = selectTimelineRows(state.selected, state.anchor, 32, { ctrlKey: true, shiftKey: true });
  assert.deepEqual([...state.selected], [25, 27, 28, 30, 31, 32]);
  state = selectTimelineRows(state.selected, state.anchor, 0);
  state = selectTimelineRows(state.selected, state.anchor, 3, { shiftKey: true });
  assert.deepEqual([...state.selected], [1, 2, 3]);
  assert.deepEqual([...selectTimelineRows(new Set([7]), 7, 4, { shiftKey: true }).selected], [4, 5, 6, 7]);
});

test("default K545 accepts event ranges corresponding to measures 24–29 and 30–50", async () => {
  const document = parseMstructDocument(await readFile(new URL("../examples/k545.mstruct", import.meta.url), "utf8"));
  const profile = await verifyMstructProfile(JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url), "utf8")));
  const analysis = compileProfileDocument(document, profile);
  const timeline = { loop: "28,4/4,1,1,1/4;\n28,4/4,2,29,1/4;\n73,4/4,1,29,1/4;", main: "" };
  for (const [startEvent, endEvent, startMeasure, endMeasure] of [[37, 90, 24, 29], [91, 123, 30, 50]]) {
    const plan = planMstructtimeBulkFill(analysis, timeline, { ...bulkOptions, startEvent, endEvent, startMilliseconds: 0 });
    assert.equal(plan.ok, true, plan.code);
    assert.equal(plan.rows[startEvent].measure, startMeasure);
    assert.equal(plan.rows[endEvent].measure, endMeasure);
    assert.equal(plan.count, endEvent - startEvent + 1);
  }
});

test("timestamp history restores whole edits, retains redo and discards stale routes", () => {
  const history = createTimelineHistory();
  const document = {};
  const original = { document, structureKey: "source/loop", main: "original", entries: [{ milliseconds: 100 }] };
  const cleared = { ...original, main: "cleared" };
  const edited = { ...original, main: "manual edit" };
  history.record(original, cleared);
  history.record(cleared, edited);
  assert.deepEqual(history.step("undo", edited), { main: "cleared", entries: original.entries });
  assert.deepEqual(history.step("undo", cleared), { main: "original", entries: original.entries });
  assert.deepEqual(history.state(original), { undo: false, redo: true });
  const replay = history.step("redo", original);
  replay.entries[0].milliseconds = 999;
  assert.equal(original.entries[0].milliseconds, 100);
  history.record(cleared, { ...cleared, main: "new edit" });
  assert.deepEqual(history.state({ ...cleared, main: "new edit" }), { undo: true, redo: false });
  for (const change of [{ document: {} }, { structureKey: "changed source/loop" }, { main: "external change" }]) {
    history.record(original, cleared);
    assert.equal(history.step("undo", { ...cleared, ...change }), null);
    assert.deepEqual(history.state({ ...cleared, ...change }), { undo: false, redo: false });
  }
});
