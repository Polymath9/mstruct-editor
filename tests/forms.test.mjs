import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FORM_TAG_HEADERS, formTagRowsForEditing, parseFormTagConfigCsv } from "../src/core/form-tag-config.js";
import { parseGlobalTagList } from "../src/core/semantic-tags.js";
import { compareMstructProfiles } from "../src/core/profile-diff.js";
import { parseMstruct } from "../src/core/mstruct.js";
import { projectMstructSearchEvents } from "../src/core/mstruct-search-events.js";
import { buildPlaybackPlan, buildMstructtimePlaybackPlan } from "../src/core/mstruct-playback.js";
import { playbackEntryInformation } from "../src/core/mstruct-playback-info.js";
import { createMstructProfile, verifyMstructProfile } from "../src/core/profile.js";
import { PROFILE_FILES } from "../src/core/profile-schema.js";
import { tagIsVisible, visibleTagLanes } from "../src/core/renderer-layers.js";
import { parseMstructSearchQuery } from "../src/core/mstruct-search-query.js";
import { matchMstructSearchQuery } from "../src/core/mstruct-search-match.js";
import { parseTagCsvRows, parseTagConfigCsv } from "../src/core/tag-config.js";

const csv = ["token,zh_name,en_name,duration_mode,parent,replace_previous",
  "<A>,甲,A,1,,1", "<A:one>,主段,One,1,A,1", "<A:two>,次段,Two,1,A,1",
  "<A:overlay>,叠句,Overlay,2,A,0", "<B>,独立,B,2,,1", "<C>,强制,C,3,,1"].join("\n");
const formTagConfig = parseFormTagConfigCsv(csv);
const prefix = "{BN:1}{TS:adlib}{D:1}{BPM:1/4=60}";
function parse(body, config = formTagConfig, signature = "adlib") {
  return parseMstruct(prefix.replace("TS:adlib", `TS:${signature}`) + body.replace(/([A-G])(?=[,;])/g, "[C:$1]"), { formTagConfig: config, isStableTempo: true });
}
function tokens(tags) { return tags.map((tag) => tag.token).sort(); }
function slots(result) { return result.measures.flatMap((measure) => measure.slots); }

const descriptiveCsv = [FORM_TAG_HEADERS.join(","), ...formTagRowsForEditing(csv).map(row => row.join(","))].join("\n");
const descriptiveConfig = parseFormTagConfigCsv(descriptiveCsv);

test("global eligibility is configured per form and legacy CSVs retain their historical definitions", async () => {
  const sourceCsv = await readFile(new URL("../src/config/form-tags.csv", import.meta.url), "utf8");
  const sourceConfig = parseFormTagConfigCsv(sourceCsv);
  assert.deepEqual(sourceConfig.tags.filter(tag => tag.allowGlobal).map(tag => tag.token), [
    "<Binary_Form>", "<Ternary_Form>", "<Rondo_Form>", "<Arch_Form>", "<Variation_Form>", "<Sonata_Form>",
    "<12_Bar_Blues>", "<16_Bar_Blues>", "<Pop_Form>", "<Canon>", "<Fugue>", "<StropheBridge_Form>", "<EDM_Form>",
  ]);
  for (const tag of sourceConfig.tags) assert.equal(parseGlobalTagList(tag.closingToken, { formTagConfig: sourceConfig }).ok, tag.allowGlobal, tag.token);
  assert.equal(Object.hasOwn(formTagConfig.tags[0], "allowGlobal"), false);
  assert.equal(parseGlobalTagList("</A>", { formTagConfig }).ok, true);
  assert.equal(parseGlobalTagList("</A:one>", { formTagConfig }).ok, false);
  assert.equal(parseGlobalTagList("</A:one>", { formTagConfig: descriptiveConfig }).ok, false);
  const custom = parseFormTagConfigCsv(descriptiveCsv.replace("<A:one>,主段,One,1,A,1,0", "<A:one>,主段,One,1,A,1,1"));
  assert.equal(parseGlobalTagList("</A:one>", { formTagConfig: custom }).ok, true);
  assert.throws(() => parseFormTagConfigCsv(descriptiveCsv.replace(",1,A,1,0", ",1,A,1,2")), /allow_global/);
  const official = JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url), "utf8"));
  assert.equal((await verifyMstructProfile(official)).manifest.bundleHash, official.manifest.bundleHash);
  const legacyCsv = sourceCsv.trimEnd().split("\n").map(row => row.slice(0, row.lastIndexOf(","))).join("\n") + "\n";
  const historical = await createMstructProfile({ profileId: official.manifest.profileId, files: { ...official.files, "form-tags.csv": legacyCsv } });
  const candidate = await createMstructProfile({ profileId: official.manifest.profileId.replace(/1\.0\.0$/, "2.0.0"), files: { ...official.files, "form-tags.csv": sourceCsv } });
  const diff = await compareMstructProfiles(historical, candidate);
  assert.equal(diff.semanticCompatible, false);
  assert.equal(diff.suggestedVersion, "2.0.0");
});

test("descriptive forms coexist with their sections through source order and actual repeats", () => {
  const result = parse("{||:}</A>C,</A:one>D,</A>E,</A:two>[C:F]{:||};G;", descriptiveConfig);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(slots(result).map(slot => tokens(slot.activeForms)), [
    ["<A>"], ["<A:one>", "<A>"], ["<A:one>", "<A>"], ["<A:two>", "<A>"], ["<A:two>", "<A>"],
  ]);
  assert.deepEqual(result.playbackRoute.map(visit => tokens(visit.formTags)), [
    ["<A>"], ["<A:one>", "<A>"], ["<A:one>", "<A>"], ["<A:two>", "<A>"],
    ["<A>"], ["<A:one>", "<A>"], ["<A:one>", "<A>"], ["<A:two>", "<A>"], ["<A:two>", "<A>"],
  ]);
});

test("whole-song form descriptors stay active for search and playback across replacement and form end", () => {
  const global = parseGlobalTagList("</A>", { formTagConfig: descriptiveConfig });
  const result = parseMstruct(prefix + "</A:one>C|,</A:two>D|,</FORM_END>A|;", { formTagConfig: descriptiveConfig, globalTags: global.tags });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const projection = projectMstructSearchEvents(result);
  const query = parseMstructSearchQuery("<A>C|*,<A>D|*,<A>A|*");
  assert.equal(matchMstructSearchQuery(query, projection).windows.length, 1);
  assert.deepEqual(buildPlaybackPlan(result).entries.map(entry => tokens(playbackEntryInformation(entry).activeTags)),
    [["<A:one>", "<A>"], ["<A:two>", "<A>"], ["<A>"]]);
});

test("form configuration validates grouping, reserved controls and both editable policies", () => {
  assert.equal(formTagConfig.byToken.get("<B>").parent, "");
  for (const [before, after] of [[",2,,1", ",4,,1"], [",2,A,0", ",2,A,2"], [",2,A,0", ",2,Missing,0"], ["<B>", "<FORM_END>"]]) {
    assert.throws(() => parseFormTagConfigCsv(csv.replace(before, after)));
  }
});

test("implicit inheritance, same-family overlay, replacement and exact/family/all end", () => {
  const result = parse("</A:one>C,</A:overlay>D,E,</FORM_END:A:overlay>F,</B>G,</A:two>A,</FORM_END:A>B,</FORM_END>C;");
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(slots(result).map((slot) => tokens(slot.activeForms)), [
    ["<A:one>"], ["<A:one>", "<A:overlay>"], ["<A:one>", "<A:overlay>"], ["<A:one>"],
    ["<A:one>", "<B>"], ["<A:two>", "<B>"], ["<B>"], [],
  ]);
  const events = projectMstructSearchEvents(result).events;
  assert.deepEqual(tokens(events[3].tags), ["<A:one>"]);
  assert.deepEqual(tokens(events[7].tags), []);
});

test("paired forms survive both replacement and FORM_END, retain own close and endpoint", () => {
  const result = parse("</A:one>C,<A:overlay>D,</A:two>E,</FORM_END>F,</A:overlay>G,A;");
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const projected = projectMstructSearchEvents(result);
  const route = projected.segments[0].map((position) => tokens(projected.events[position].tags));
  assert.deepEqual(route, [["<A:one>"], ["<A:one>", "<A:overlay>"], ["<A:overlay>", "<A:two>"], ["<A:overlay>"], ["<A:overlay>"], []]);
  assert.equal(parse("<B>C,</FORM_END:B>D;").ok, false);
  assert.equal(parse("<B>C,</FORM_END:B>D,</B>E;").ok, true);
  assert.equal(parse("<B>C,<*/B>D;").ok, true);
});

test("duration policies are configuration-driven for arbitrary tokens", () => {
  assert.equal(parse("<A>C,</A>D;").ok, false);
  assert.equal(parse("</C>C;").ok, false);
  assert.equal(parse("<C>C,</FORM_END>D,</C>E;").ok, true);
  assert.equal(parse("<B>C,<B>D,</B>E;").ok, false);
  const changed = parseFormTagConfigCsv(csv.replace("<A>,甲,A,1,,1", "<A>,甲,A,2,,1"));
  assert.equal(parse("<A>C,</A>D;", changed).ok, true);
  const replacement = parseFormTagConfigCsv(csv.replace("<A:overlay>,叠句,Overlay,2,A,0", "<A:overlay>,叠句,Overlay,2,A,1"));
  assert.deepEqual(tokens(slots(parse("</A:one>C,</A:overlay>D;", replacement))[1].activeForms), ["<A:overlay>"]);
});

test("implicit-to-paired handoff creates no duplicate or restoration stack", () => {
  const result = parse("</B>C,<B>D,</B>E,F;");
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(tokens(slots(result)[1].activeForms), []);
  assert.deepEqual(tokens(result.playbackRoute.at(-1).formTags), []);
});

test("multi-event form queries match inherited interior harmony and reject an ended section", () => {
  const result = parse("</A:one>C,D,E,</FORM_END:A>F,G;");
  const projection = projectMstructSearchEvents(result);
  const query = parseMstructSearchQuery("<A:one>D|*,<A:one>E|*");
  assert.equal(query.ok, true, JSON.stringify(query.errors));
  assert.equal(matchMstructSearchQuery(query, projection).windows.length, 1);
  const crossing = parseMstructSearchQuery("<A:one>E|*,<A:one>F|*");
  assert.equal(matchMstructSearchQuery(crossing, projection).windows.length, 0);
});

test("source order, duplicate and unknown-target diagnostics remain precise", () => {
  assert.deepEqual(tokens(slots(parse("</A:one></FORM_END:C></FORM_END:A>C;"))[0].activeForms), []);
  assert.deepEqual(tokens(slots(parse("</FORM_END></A:one>C;"))[0].activeForms), ["<A:one>"]);
  for (const body of ["</FORM_END:>C;", "</FORM_END:Missing>C;", "<FORM_END>C;", "</A:one></A:one>C;", "</FORM_END>;"]) {
    assert.equal(parse(body).ok, false, body);
  }
});

test("repeat jumps restore form snapshots and ending skips do not leak their states", () => {
  const result = parse("{||:}</A:one>C;{ENDING:1}</A:two>D{/ENDING:1}{:||};{ENDING:2}E{/ENDING};F;".replace(/([A-G])(?=\{)/g, "[C:$1]"), formTagConfig, "1/1");
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const visits = result.playbackRoute.filter((entry) => entry.slot);
  assert.deepEqual(visits.map((entry) => tokens(entry.formTags)), [["<A:one>"], ["<A:two>"], ["<A:one>"], ["<A:one>"], ["<A:one>"]]);
  const projected = projectMstructSearchEvents(result);
  assert.deepEqual(projected.segments[0].map((position) => tokens(projected.events[position].tags)), visits.map((entry) => tokens(entry.formTags)));
  const information = buildPlaybackPlan(result).entries.map((entry) => tokens(playbackEntryInformation(entry).activeTags));
  assert.deepEqual(information, visits.map((entry) => tokens(entry.formTags)));
});

test("form layer owns labels, paired lanes and controls independently of ordinary tags", () => {
  const result = parse("<B>C,</FORM_END>D,</B>E;");
  const slot = slots(result)[1];
  assert.equal(tagIsVisible(slot.tags[0], { tags: true, form: false }), false);
  assert.deepEqual([...visibleTagLanes(slot, { tags: true, form: false })], []);
  assert.ok(visibleTagLanes(slot, { tags: false, form: true }).size > 0);
  const detached = parseMstruct(prefix + "<B>C|,</ordinary>D|,<*/B>E|;", {
    formTagConfig, tagConfig: parseTagConfigCsv("token,zh_name,en_name,duration_mode\n<ordinary>,普通,Ordinary,1\n"),
  });
  assert.equal(detached.ok, true);
  assert.deepEqual([...visibleTagLanes(slots(detached)[1], { tags: false, form: true })], []);
});

test("optional close resolves against each actual ending visit rather than source-linear pairing", () => {
  const body = "{||:}<B>C;{ENDING:1}</B>D{/ENDING:1}{:||};{ENDING:2}</B>E{/ENDING};F;".replace(/([A-G])(?=\{)/g, "[C:$1]");
  const result = parse(body, formTagConfig, "1/1");
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.playbackRoute.map((visit) => tokens(visit.formTags)), [["<B>"], ["<B>"], ["<B>"], ["<B>"], []]);
});

test("MStructTime LOOP restores form state for every timed visit", () => {
  const result = parseMstruct("{BN:1}{TS:2/4}{D:1/4}</A:one>C|,</A:two>D|;E|,F|;", { formTagConfig });
  assert.equal(result.ok, true);
  const plan = buildMstructtimePlaybackPlan(result, { metadata: { musicLength: "0:10" }, loop: "1,2/4,1,1,1/4;", main: "{BN:1}{TS:2/4}{D:1/4}[0,1][2000,2],[1000,1][3000,2];{BN:2}[4000,1],[5000,1];" });
  assert.equal(plan.ready, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.entries.map(entry => tokens(playbackEntryInformation(entry).activeTags)), [["<A:one>"],["<A:two>"],["<A:one>"],["<A:two>"],["<A:two>"],["<A:two>"]]);
});

test("thirteen-table v3 source bundle and historical v1 snapshot both verify exactly", async () => {
  const files = Object.fromEntries(await Promise.all(PROFILE_FILES.map(async ({ name }) => [name, await readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8")])));
  const profile = await createMstructProfile({ profileId: "org.mstruct.official/rulesets/1.0.0", files });
  assert.equal(profile.manifest.manifestVersion, 3);
  assert.equal(profile.manifest.files.length, 13);
  assert.equal((await verifyMstructProfile(profile)).manifest.bundleHash, profile.manifest.bundleHash);
  const legacyFiles = { ...files }; delete legacyFiles["form-tags.csv"]; delete legacyFiles["global_settings.csv"];
  legacyFiles["tags.csv"] += parseTagCsvRows(files["form-tags.csv"]).slice(1).map(row => row.slice(0, 4).join(",")).join("\n") + "\n";
  legacyFiles["toolbox-events.csv"] = files["toolbox-events.csv"].split("\n").filter(line => !line.startsWith("</FORM_END")).join("\n");
  const historical = await createMstructProfile({ profileId: profile.manifest.profileId, manifestVersion: 1, files: legacyFiles });
  assert.equal(historical.manifest.files.length, 11);
  assert.equal((await verifyMstructProfile(historical)).manifest.bundleHash, historical.manifest.bundleHash);
});
