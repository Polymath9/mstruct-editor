import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMstructProfile, sha256, verifyMstructProfile } from "../src/core/profile.js";
import { compareMstructProfiles } from "../src/core/profile-diff.js";
import { assignDocumentProfile, compileProfileDocument, resolveMstructDocument } from "../src/core/profile-document.js";
import { INITIAL_PROFILE_ID, PROFILE_FILES, readProfileIdentity } from "../src/core/profile-schema.js";
import { createEmptyMetadata, normalizeMetadata, parseMstructDocument, serializeMstructDocument } from "../src/core/mstruct-document.js";
import { createProfileResolver, prepareDocumentProfile } from "../src/runtime/profile-resolver.js";
import { createDocumentProfileSession } from "../src/runtime/document-profile.js";
import { reportDocumentProfileMigration, prepareCompatibleProfileUpgrade } from "../src/core/profile-migration.js";
import { validateHostedImportIdentity } from "../src/runtime/hosted-document.js";
import { createHostedProfiles } from "../src/runtime/hosted-profiles.js";
import { createAnalysisDocumentLoader } from "../src/runtime/analysis-document-loader.js";
import { rebindDocumentProfile } from "../src/core/profile-rebind.js";

const files = Object.fromEntries(await Promise.all(PROFILE_FILES.map(async ({ name }) => [name,
  await readFile(new URL(`../src/config/${name}`, import.meta.url), "utf8")])));
const create = (changes = {}, profileId = INITIAL_PROFILE_ID) => createMstructProfile({ profileId, files: { ...files, ...changes } });
const builtin = await create();
test("global settings are hashed, validated and applied to exact profile compilation", async () => {
  const limited = await create({ "global_settings.csv": "key,value\npolychord_lower_max_notes,3\n" });
  const source = serializeMstructDocument({ metadata: createEmptyMetadata(), main: "{BN:1}{TS:adlib}{D:1}CM7onDm7|;" });
  assert.equal((await assignDocumentProfile(source, limited)).ok, false);
  assert.equal((await assignDocumentProfile(source, builtin)).ok, true);
  assert.equal((await compareMstructProfiles(limited, builtin)).semanticLevel, "minor");
  assert.equal((await compareMstructProfiles(builtin, limited)).semanticLevel, "major");
  for (const csv of ["key,value\npolychord_lower_max_notes,5\n", "key,value\nunknown,4\n", "key,value\n"]) {
    await assert.rejects(create({ "global_settings.csv": csv }));
  }
  const { ["global_settings.csv"]: ignored, ...legacyFiles } = files;
  const legacy = await createMstructProfile({ profileId: INITIAL_PROFILE_ID, files: legacyFiles, manifestVersion: 2 });
  assert.equal(legacy.manifest.files.length, 12);
  assert.equal((await verifyMstructProfile(legacy)).manifest.bundleHash, legacy.manifest.bundleHash);
  assert.equal((await compareMstructProfiles(legacy, limited)).semanticCompatible, false);
  assert.equal((await compareMstructProfiles(legacy, builtin)).semanticCompatible, true);
});
const oldSource = serializeMstructDocument({ metadata: createEmptyMetadata(), main: "{BN:1}{TS:adlib}{D:1}[C:C];" });
const assigned = await assignDocumentProfile(oldSource, builtin, "0.1.32");
const errorCode = (code) => (error) => error.code === code;

test("explicit binding-only replacement preserves CRLF, notes and invalid music without validating it", async () => {
  const next = await create({ "tags.csv": files["tags.csv"].replace("恒定结构", "恒定结构新名") });
  const literal = `{MSTRUCT_PROFILE_HASH}${builtin.manifest.bundleHash}`;
  const source = "\uFEFF" + assigned.source.replace("{COMMENTS}\n", `{COMMENTS}\n${literal}\n`).replace("[C:C]", "[C:INVALID]").replaceAll("\n", "\r\n");
  const rebound = rebindDocumentProfile(source, next);
  // Only the first (system) hash changes; the literal in comments is retained.
  assert.equal(rebound.source, source.replace(builtin.manifest.bundleHash, next.manifest.bundleHash));
  assert.equal(rebound.previous.bundleHash, builtin.manifest.bundleHash);
  assert.equal(compileProfileDocument(rebound.document, next).ok, false);
  assert.throws(() => rebindDocumentProfile(oldSource, next), errorCode("profile-assignment-required"));
  const duplicate = assigned.source.replace("{MSTRUCT_PROFILE_HASH}", `${literal}\n{MSTRUCT_PROFILE_HASH}`);
  assert.throws(() => rebindDocumentProfile(duplicate, next), errorCode("profile-identity-mismatch"));
});

test("hosted import preserves a draft binding and rejects documents from another exact build", async () => {
  const next = await create({ "tags.csv": files["tags.csv"].replace("恒定结构", "恒定和声结构") });
  const another = await assignDocumentProfile(oldSource, next);
  assert.doesNotThrow(() => validateHostedImportIdentity(assigned.document.metadata, assigned.document.metadata));
  assert.doesNotThrow(() => validateHostedImportIdentity(createEmptyMetadata(), assigned.document.metadata));
  assert.throws(() => validateHostedImportIdentity(another.document.metadata, assigned.document.metadata), errorCode("profile-identity-mismatch"));
  assert.throws(() => validateHostedImportIdentity(assigned.document.metadata, createEmptyMetadata()), errorCode("profile-identity-mismatch"));
});

test("hosted imports silently adopt a compatible same-version build before exact session validation", async () => {
  const target = await create({ "tags.csv": `${files["tags.csv"]}<ImportAdded>,新增,Added,1\n` });
  const current = await assignDocumentProfile(oldSource, target), requests = [];
  const hosted = createHostedProfiles({ fetchJson: async (url, options) => {
    requests.push({ url, options }); return Response.json(builtin);
  } });
  const session = createDocumentProfileSession({ resolveProfile: hosted.resolve, commit() {} });
  await session.load(current.document.metadata, target);
  let imported, failure;
  const loader = createAnalysisDocumentLoader({ hostedMode: true, profileSession: session,
    getMetadata: () => current.document.metadata, metadataAfterImport: metadata => metadata,
    applyDocument: (document, metadata) => { imported = { document, metadata }; },
    render: document => compileProfileDocument(document, target), setError: error => { failure = error; },
  });
  assert.equal((await loader(assigned.source)).loaded, true);
  assert.equal(failure, undefined);
  assert.equal(imported.metadata.mstructProfileHash, target.manifest.bundleHash);
  assert.equal(imported.document.main, assigned.document.main);
  assert.equal(session.profile.manifest.bundleHash, target.manifest.bundleHash);
  await session.prepareImport(assigned.source);
  assert.equal(requests.length, 1);
  const query = new URL(requests[0].url, "https://archive.test").searchParams;
  assert.equal(query.get("hash"), builtin.manifest.bundleHash);
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.redirect, "error");
});

test("hosted imports retain their current document on breaking, foreign, missing or damaged builds", async () => {
  const target = await create({ "tags.csv": `${files["tags.csv"]}<ImportAdded>,新增,Added,1\n` });
  const foreign = await create({}, "org.mstruct.official/rulesets/2.0.0");
  const breaking = await create({ "toolbox-events.csv": files["toolbox-events.csv"].replace("[NR:],-2", "[NR:PL],-2") });
  const sources = new Map([builtin, foreign, breaking].map(profile => [profile.manifest.bundleHash + profile.manifest.profileId, profile]));
  let unavailable = false;
  const session = createDocumentProfileSession({ resolveProfile: async identity => {
    if (unavailable) throw Object.assign(Error("missing"), { code: "profile-missing" });
    return sources.get(identity.bundleHash + identity.profileId);
  }, commit() {} });
  const current = await assignDocumentProfile(oldSource, target);
  await session.load(current.document.metadata, target);
  for (const profile of [foreign, breaking]) {
    const source = (await assignDocumentProfile(oldSource, profile)).source;
    await assert.rejects(session.prepareImport(source), errorCode("profile-identity-mismatch"));
    assert.equal(session.profile.manifest.bundleHash, target.manifest.bundleHash);
  }
  unavailable = true;
  await assert.rejects(session.prepareImport(assigned.source), errorCode("profile-missing"));
  const badTransport = createHostedProfiles({ fetchJson: async () => Response.json({ ...builtin, files: { ...builtin.files, "tags.csv": "damaged" } }) });
  await assert.rejects(badTransport.resolve(readProfileIdentity(assigned.document.metadata)));
  const denied = createHostedProfiles({ fetchJson: async () => new Response("login", { status: 401 }) });
  await assert.rejects(denied.resolve(readProfileIdentity(assigned.document.metadata)), errorCode("profile-missing"));
});

test("an asynchronous compatible import cannot replace a newer document session", async () => {
  const target = await create({ "tags.csv": `${files["tags.csv"]}<ImportAdded>,新增,Added,1\n` });
  let complete;
  const session = createDocumentProfileSession({ resolveProfile: () => new Promise(resolve => { complete = resolve; }), commit() {} });
  await session.load((await assignDocumentProfile(oldSource, target)).document.metadata, target);
  const pending = session.prepareImport(assigned.source);
  session.clear(); complete(builtin);
  await assert.rejects(pending, errorCode("profile-identity-mismatch"));
  assert.equal(session.profile, null);
});

test("document sessions atomically commit exact rules and cannot render with missing or mismatched bundles", async () => {
  const first = await create({ "special-chords.csv": `${files["special-chords.csv"].trimEnd()}\ntest,test,Test,1 3 5\n` });
  const second = await create({ "special-chords.csv": `${files["special-chords.csv"].trimEnd()}\ntest,test,Test,1 b3 5\n` });
  const source = oldSource.replace("[C:C]", "[C:C[sp:test]]");
  const a = await assignDocumentProfile(source, first), b = await assignDocumentProfile(source, second);
  const configs = [];
  const sessions = [first, second].map((profile) => createDocumentProfileSession({ resolveProfile: async () => profile, commit: ({ config }) => configs.push(config) }));
  await Promise.all([sessions[0].load(a.document.metadata), sessions[1].load(b.document.metadata)]);
  assert.equal(sessions[0].compile(a.document.main, a.document.metadata, []).ok, true);
  assert.deepEqual(configs[0].specialChords.get("test").intervals, ["1", "3", "5"]);
  assert.deepEqual(configs[1].specialChords.get("test").intervals, ["1", "b3", "5"]);
  const mismatch = await sessions[0].load(a.document.metadata, second);
  assert.equal(mismatch.ok, false); assert.equal(mismatch.error.code, "profile-identity-mismatch");
  assert.equal(sessions[0].compile(a.document.main, a.document.metadata, []).ok, false);
  assert.equal(sessions[1].compile(b.document.main, b.document.metadata, []).ok, true);
  const missing = createDocumentProfileSession({ resolveProfile: async () => null, commit: () => assert.fail("must not commit") });
  assert.equal((await missing.load(a.document.metadata)).error.code, "profile-missing");
  assert.equal(missing.compile(a.document.main, a.document.metadata, []).ok, false);
});

test("a late profile response cannot replace a more recent document initialization", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const next = await create({ "special-chords.csv": files["special-chords.csv"].replace("1,sowhat,sowhat", "1,sowhat,Shown") });
  assert.notEqual(next.manifest.bundleHash, builtin.manifest.bundleHash);
  const nextDocument = await assignDocumentProfile(oldSource, next);
  const committed = [];
  const session = createDocumentProfileSession({ resolveProfile: async () => { await waiting; return builtin; }, commit: ({ profile }) => committed.push(profile.manifest.bundleHash) });
  const pending = session.load(assigned.document.metadata);
  assert.equal((await session.load(nextDocument.document.metadata, next)).ok, true);
  release(); assert.equal((await pending).cancelled, true);
  assert.deepEqual(committed, [next.manifest.bundleHash]);
  assert.equal(session.profile.manifest.bundleHash, next.manifest.bundleHash);
});

test("migration reports compare semantic projections and playback without rewriting invalid or legacy sources", async () => {
  const first = await create({ "special-chords.csv": `${files["special-chords.csv"].trimEnd()}\ntest,test,Test,1 3 5\n` });
  const display = await create({ "special-chords.csv": first.files["special-chords.csv"].replace("test,test,Test", "test,test,Shown") });
  const changed = await create({ "special-chords.csv": first.files["special-chords.csv"].replace("test,test,Test,1 3 5", "test,test,Test,1 b3 5") });
  const document = await assignDocumentProfile(oldSource.replace("[C:C]", "[C:C[sp:test]]"), first);
  assert.equal((await reportDocumentProfileMigration(document.source, display, async () => first)).structureStatus, "same");
  assert.equal((await reportDocumentProfileMigration(document.source, changed, async () => first)).structureStatus, "changed");
  assert.equal((await reportDocumentProfileMigration(oldSource, builtin, async () => null)).structureStatus, "unknown");
  const invalid = await reportDocumentProfileMigration(oldSource.replace("[C:C]", "[C:INVALID]"), builtin, async () => null);
  assert.equal(invalid.ok, false); assert.equal(invalid.source, undefined);
});

test("thirteen-table content identity ignores BOM/line endings/extra trailing LF, but retains data order", async () => {
  const normalized = await createMstructProfile({ profileId: INITIAL_PROFILE_ID,
    files: Object.fromEntries(Object.entries(files).map(([name, content], index) => [name,
      `\uFEFF${content.replace(/\r\n?/g, "\n").replace(/\n/g, index % 2 ? "\r" : "\r\n")}\n\n`])) });
  assert.deepEqual(normalized, builtin);
  assert.equal(builtin.manifest.files.length, 13);
  for (const file of builtin.manifest.files) {
    assert.equal(file.size, Buffer.byteLength(builtin.files[file.name], "utf8"));
    assert.equal(file.hash, `sha256:${createHash("sha256").update(builtin.files[file.name]).digest("hex")}`);
  }
  const [header, ...rows] = builtin.files["tags.csv"].trimEnd().split("\n");
  const reordered = await create({ "tags.csv": `${[header, ...rows.reverse()].join("\n")}\n` });
  assert.notEqual(reordered.manifest.bundleHash, builtin.manifest.bundleHash);
  assert.equal(reordered.manifest.semanticCompatibilityHash, builtin.manifest.semanticCompatibilityHash);
  assert.equal(await sha256("abc"), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("manifest and all eleven files are verified, immutable, and tied to the full composite identity", async () => {
  const portable = JSON.parse(JSON.stringify(builtin));
  assert.deepEqual(await verifyMstructProfile(portable), builtin);
  assert.throws(() => { builtin.files["tags.csv"] += "x"; }, TypeError);
  assert.throws(() => { builtin.manifest.files[0].hash = "x"; }, TypeError);
  const tampered = structuredClone(portable);
  tampered.files["tags.csv"] = tampered.files["tags.csv"].replace("恒定结构", "不同名称");
  await assert.rejects(verifyMstructProfile(tampered), errorCode("profile-hash-mismatch"));
  for (const mutate of [
    (value) => { value.manifest.files.reverse(); },
    (value) => { value.manifest.files[0].size += 1; },
    (value) => { value.manifest.semanticCompatibilityHash = value.manifest.bundleHash; },
    (value) => { value.manifest.namespace = "org.other"; },
  ]) {
    const value = structuredClone(portable); mutate(value);
    await assert.rejects(verifyMstructProfile(value), errorCode("profile-hash-mismatch"));
  }
  const missing = structuredClone(portable); delete missing.files["toolbox-events.csv"];
  await assert.rejects(verifyMstructProfile(missing), errorCode("profile-files-incomplete"));
  const added = structuredClone(portable); added.files["extra.csv"] = "x";
  await assert.rejects(verifyMstructProfile(added), errorCode("profile-files-incomplete"));
  await assert.rejects(verifyMstructProfile(portable, { ...readProfileIdentity(assigned.document.metadata), bundleHash: `sha256:${"0".repeat(64)}` }), errorCode("profile-identity-mismatch"));
});

test("content hashes do not conflate publisher/version identity, and namespace/SemVer are strict", async () => {
  const next = await create({}, "org.mstruct.official/rulesets/1.1.0");
  assert.equal(next.manifest.bundleHash, builtin.manifest.bundleHash);
  await assert.rejects(verifyMstructProfile(next, readProfileIdentity(assigned.document.metadata)), errorCode("profile-identity-mismatch"));
  for (const id of ["1.0.0", "org.mstruct.official/rulesets/01.0.0", "org.mstruct.official/rulesets/1.0.0-build.1", "org.mstruct.official/rulesets/9007199254740992.0.0"]) {
    await assert.rejects(create({}, id), errorCode("profile-id-invalid"));
  }
});

test("format/profile/app fields round-trip, stay out of extra fields, and represent real document changes", () => {
  assert.equal(assigned.ok, true);
  const document = parseMstructDocument(assigned.source.replace(/\n/g, "\r\n"));
  assert.equal(document.ok, true);
  assert.equal(document.metadata.mstructFormatVersion, "1");
  assert.equal(document.metadata.mstructProfileId, INITIAL_PROFILE_ID);
  assert.equal(document.metadata.mstructProfileHash, builtin.manifest.bundleHash);
  assert.equal(document.metadata.authoringAppVersion, "0.1.32");
  assert.deepEqual(document.metadata.extraFields, []);
  assert.equal(serializeMstructDocument(document), assigned.source);
  assert.notEqual(assigned.source, oldSource);
  const metadata = normalizeMetadata({ ...document.metadata, extraFields: [{ tag: "MSTRUCT_PROFILE_HASH", value: "forged" }, { tag: "CUSTOM", value: "kept" }] });
  assert.deepEqual(metadata.extraFields, [{ tag: "CUSTOM", value: "kept" }]);
  const duplicate = parseMstructDocument(assigned.source.replace("END_METADATA", "{MSTRUCT_PROFILE_ID}org.other/rulesets/1.0.0\nEND_METADATA"));
  assert.ok(duplicate.errors.some(({ code }) => code === "profile-field-duplicate"));
});

test("unsupported/partial/blank identities fail before resolving; pre-v1 never silently binds defaults", async () => {
  let resolutions = 0;
  const resolve = async () => { resolutions += 1; return builtin; };
  for (const source of ["{BN:1}{TS:adlib}{D:1}[C:C];", oldSource]) {
    assert.equal(readProfileIdentity(parseMstructDocument(source).metadata), null);
    await assert.rejects(resolveMstructDocument(source, resolve), errorCode("profile-assignment-required"));
  }
  for (const [source, code] of [
    [assigned.source.replace("{MSTRUCT_FORMAT_VERSION}1", "{MSTRUCT_FORMAT_VERSION}2"), "format-version-unsupported"],
    [assigned.source.replace(/\{MSTRUCT_PROFILE_HASH\}[^\n]+\n/, ""), "profile-fields-incomplete"],
    [oldSource.replace("METADATA:", "METADATA:\n{MSTRUCT_PROFILE_ID}"), "profile-fields-incomplete"],
    [assigned.source.replace("sha256:", "SHA256:"), "profile-hash-invalid"],
  ]) {
    const result = await resolveMstructDocument(source, resolve);
    assert.equal(result.ok, false);
    assert.equal(result.result, null);
    assert.ok(result.errors.some((error) => error.code === code));
  }
  assert.equal(resolutions, 0);
  await assert.rejects(resolveMstructDocument(assigned.source, async () => null), errorCode("profile-missing"));
});

test("validated assignment refuses to stamp an invalid source and checks MAIN, global tags and comments", async () => {
  for (const source of [oldSource.replace("[C:C]", "[C:Cinvalid]"), oldSource.replace("{GLOBAL_TAGS}", "{GLOBAL_TAGS}</Missing_Tag>"), oldSource.replace("[C:C]", "[/COMMENT:99][C:C]")]) {
    const failed = await assignDocumentProfile(source, builtin, "test");
    assert.equal(failed.ok, false);
    assert.equal(failed.source, source);
    assert.equal(readProfileIdentity(failed.document.metadata), null);
  }
  assert.throws(() => compileProfileDocument(assigned.document, structuredClone(builtin)), errorCode("profile-unverified"));
  const result = await resolveMstructDocument(assigned.source, async () => builtin);
  assert.equal(result.ok, true);
});

test("two hashes under 1.0.0 resolve independently, including when the registry returns a newer build", async () => {
  const first = await create({ "special-chords.csv": `${files["special-chords.csv"].trimEnd()}\ntest,test,Test,1 3 5\n` });
  const second = await create({ "special-chords.csv": `${files["special-chords.csv"].trimEnd()}\ntest,test,Test,1 b3 5\n` });
  const source = oldSource.replace("[C:C]", "[C:C[sp:test]]");
  const firstDocument = await assignDocumentProfile(source, first, "test");
  const secondDocument = await assignDocumentProfile(source, second, "test");
  assert.equal(firstDocument.ok, true);
  assert.equal(secondDocument.ok, true);
  assert.equal(first.manifest.profileId, second.manifest.profileId);
  assert.notEqual(first.manifest.bundleHash, second.manifest.bundleHash);
  const resolver = createProfileResolver({ resolveProfile: async ({ bundleHash }) => bundleHash === first.manifest.bundleHash ? first : second });
  const [a, b] = await Promise.all([resolveMstructDocument(firstDocument.source, resolver.resolve), resolveMstructDocument(secondDocument.source, resolver.resolve)]);
  assert.deepEqual(a.result.config.specialChords.get("test").intervals, ["1", "3", "5"]);
  assert.deepEqual(b.result.config.specialChords.get("test").intervals, ["1", "b3", "5"]);
  assert.deepEqual(a.result.measures[0].slots[0].events[0].chordResult.structure.values, ["1", "3", "5"]);
  assert.deepEqual(b.result.measures[0].slots[0].events[0].chordResult.structure.values, ["1", "b3", "5"]);
  await assert.rejects(resolveMstructDocument(firstDocument.source, async () => second), errorCode("profile-identity-mismatch"));
  a.result.config.specialChords.clear();
  assert.ok(compileProfileDocument(firstDocument.document, first).config.specialChords.has("test"));
});

test("display-only edits are patch, pure additions minor, changed duration/structure/whitelists major", async () => {
  const cases = [
    [{ "tags.csv": files["tags.csv"].replace("恒定结构", "恒定和声结构") }, "patch"],
    [{ "tags.csv": `${files["tags.csv"].trimEnd()}\n<New_Tag>,新标签,New Tag,1\n` }, "minor"],
    [{ "tags.csv": files["tags.csv"].replace("Constant Structure,3", "Constant Structure,2") }, "major"],
    [{ "special-chords.csv": files["special-chords.csv"].replace("1 #4 #6 9", "1 4 #6 9") }, "major"],
  ];
  for (const [changes, level] of cases) {
    const next = await create(changes);
    const diff = await compareMstructProfiles(builtin, next);
    assert.equal(diff.level, level);
    assert.equal(diff.tables.length, 13);
    assert.equal(diff.semanticLevel, level);
    assert.equal(diff.authoringLevel, "none");
    assert.equal(diff.suggestedVersion, { patch: "1.0.0", minor: "1.0.0", major: "2.0.0" }[level]);
    if (level === "patch") assert.equal(next.manifest.semanticCompatibilityHash, builtin.manifest.semanticCompatibilityHash);
  }
});

test("authoring text/order patch does not change compatibility; rewriting an existing generator is major only in authoring", async () => {
  const menu = files["toolbox-menus.csv"].replace("基础设置", "基础标记");
  const [header, ...events] = builtin.files["toolbox-events.csv"].trimEnd().split("\n");
  const reordered = await create({ "toolbox-menus.csv": menu, "toolbox-events.csv": `${[header, ...events.reverse()].join("\n")}\n` });
  assert.equal(reordered.manifest.semanticCompatibilityHash, builtin.manifest.semanticCompatibilityHash);
  assert.equal(reordered.manifest.authoringCompatibilityHash, builtin.manifest.authoringCompatibilityHash);
  assert.equal((await compareMstructProfiles(builtin, reordered)).level, "patch");
  const changed = await create({ "toolbox-events.csv": files["toolbox-events.csv"].replace("[NR:],-2", "[NR:PL],-2") });
  const diff = await compareMstructProfiles(builtin, changed);
  assert.equal(diff.level, "major");
  assert.equal(diff.semanticLevel, "none");
  assert.equal(diff.semanticCompatible, true);
  assert.equal(diff.authoringCompatible, false);
  const prepared = await prepareDocumentProfile(changed, { formatVersion: 1, profileId: changed.manifest.profileId, bundleHash: changed.manifest.bundleHash });
  assert.ok(prepared.config.toolboxConfig.events.some(({ insertion }) => insertion === "[NR:PL]"));
});

test("publication jointly checks CSV references, configured generator tokens and reserved tag collisions", async () => {
  await assert.rejects(create({ "toolbox-events.csv": files["toolbox-events.csv"].replace("</PAC>", "</Missing_Tag>") }), errorCode("profile-toolbox-invalid"));
  await assert.rejects(create({ "toolbox-events.csv": files["toolbox-events.csv"].replace("</PAC>", "[C:Cmissing]") }), errorCode("profile-toolbox-invalid"));
  await assert.rejects(create({ "roman-basic.csv": files["roman-basic.csv"].replace("quality,tonal_mode", "invalid,tonal_mode") }), errorCode("profile-config-invalid"));
  await assert.rejects(create({ "special-chords.csv": files["special-chords.csv"].replace("interval_structure", "interval_structure,extra") }), errorCode("profile-config-invalid"));
  await assert.rejects(create({ "tags.csv": `${files["tags.csv"].trimEnd()}\n<Centricity>,冲突,Conflict,2\n` }), errorCode("profile-tag-conflict"));
  await assert.rejects(create({ "toolbox-events.csv": `${files["toolbox-events.csv"].trimEnd()}\nX,-1,重复,Duplicate,2,\n` }), errorCode("profile-toolbox-duplicate"));
});

test("whitelist removals and removed tokens are major; additional toolbox generators are minor", async () => {
  const added = await create({ "tags.csv": `${files["tags.csv"].trimEnd()}\n<Historical_Tag>,历史,Historical,1\n` });
  const removed = await compareMstructProfiles(added, builtin);
  assert.equal(removed.semanticLevel, "major");
  assert.ok(removed.tables.find(({ name }) => name === "tags.csv").removed.includes("<Historical_Tag>"));
  const whitelist = await create({ "roman-basic.csv": files["roman-basic.csv"].replace('I,1,M,,"+,DM"', 'I,1,M,,+') });
  assert.equal((await compareMstructProfiles(builtin, whitelist)).semanticLevel, "major");
  const newEvent = await create({ "toolbox-events.csv": `${files["toolbox-events.csv"].trimEnd()}\nC|I,-1,新入口,New Entry,2,\n` });
  const diff = await compareMstructProfiles(builtin, newEvent);
  assert.equal(diff.level, "minor");
  assert.equal(diff.semanticLevel, "none");
  assert.equal(diff.authoringLevel, "minor");
  assert.equal((await compareMstructProfiles(builtin, builtin)).suggestedVersion, "1.0.0");
});

test("Roman admission additions keep the version and existing structures while removals or redefinitions do not", async () => {
  const originalAdvanced = files["roman-advanced.csv"].replace('oM,b5,True,7,"7,65,43,42"', "oM,b5,True,7,7");
  const previous = await create({ "roman-advanced.csv": originalAdvanced });
  const diff = await compareMstructProfiles(previous, builtin);
  assert.equal(diff.level, "minor");
  assert.equal(diff.semanticCompatible, true);
  assert.equal(diff.suggestedVersion, "1.0.0");
  const document = await assignDocumentProfile(oldSource.replace("{D:1}", "{D:1}{TC:C}").replace("[C:C]", "[C:C|R:ioM7]"), previous);
  assert.equal(document.ok, true, JSON.stringify(document.errors));
  const upgraded = await prepareCompatibleProfileUpgrade(document.source, builtin, async () => previous);
  assert.equal(upgraded.upgraded, true);
  assert.equal(parseMstructDocument(upgraded.source).main, document.document.main);
  assert.equal((await compareMstructProfiles(builtin, previous)).level, "major");

  const recommended = await create({ "roman-basic.csv": files["roman-basic.csv"].replace("biii,b3,m,,M", 'biii,b3,m,,"M,o"') });
  assert.equal((await compareMstructProfiles(builtin, recommended)).semanticCompatible, true);
  const redefined = await create({ "roman-advanced.csv": files["roman-advanced.csv"].replace('oM,b5,True,7,"7,65,43,42"', 'oM,5,True,7,"7,65,43,42"') });
  assert.equal((await compareMstructProfiles(previous, redefined)).level, "major");
});

test("compatible editing upgrades retain visible identity and reject redefinitions, authoring breaks and other series", async () => {
  const patch = await create({ "tags.csv": files["tags.csv"].replace("恒定结构", "恒定和声结构") });
  const minor = await create({ "tags.csv": `${files["tags.csv"].trimEnd()}\n<New_Tag>,新增,New,1\n` });
  const resolve = async () => builtin;
  for (const target of [patch, minor]) {
    const prepared = await prepareCompatibleProfileUpgrade(assigned.source, target, resolve);
    assert.equal(prepared.upgraded, true);
    const document = parseMstructDocument(prepared.source);
    assert.equal(document.metadata.mstructProfileId, builtin.manifest.profileId);
    assert.equal(document.metadata.mstructProfileHash, target.manifest.bundleHash);
    assert.equal(document.main, assigned.document.main);
    assert.equal(document.metadata.authoringAppVersion, assigned.document.metadata.authoringAppVersion);
    assert.equal((await compareMstructProfiles(builtin, target)).suggestedVersion, "1.0.0");
  }
  const semanticBreak = await create({ "roman-basic.csv": files["roman-basic.csv"].replace('I,1,M,,"+,DM"', 'I,1,M,,+') });
  const authoringBreak = await create({ "toolbox-events.csv": files["toolbox-events.csv"].replace("[NR:],-2", "[NR:PL],-2") });
  const otherSeries = await create({ "tags.csv": minor.files["tags.csv"] }, "org.mstruct.official/rulesets/2.0.0");
  for (const target of [builtin, semanticBreak, authoringBreak, otherSeries]) {
    assert.deepEqual(await prepareCompatibleProfileUpgrade(assigned.source, target, resolve), { upgraded: false, source: assigned.source });
  }
  assert.equal((await prepareCompatibleProfileUpgrade(oldSource, minor, resolve)).upgraded, false);
  const invalid = assigned.source.replace("[C:C]", "[C:INVALID]");
  assert.deepEqual(await prepareCompatibleProfileUpgrade(invalid, minor, resolve), { upgraded: false, source: invalid });
  await assert.rejects(prepareCompatibleProfileUpgrade(assigned.source, minor, async () => { throw new Error("missing exact build"); }), /missing exact build/);
});

test("resolver retries failed resolution and deduplicates successful downloads by exact identity", async () => {
  let calls = 0;
  const resolver = createProfileResolver({ resolveProfile: async () => { calls += 1; return calls === 1 ? null : builtin; } });
  const identity = readProfileIdentity(assigned.document.metadata);
  await assert.rejects(resolver.resolve(identity), errorCode("profile-missing"));
  const results = await Promise.all([resolver.resolve(identity), resolver.resolve(identity)]);
  assert.equal(calls, 2);
  assert.strictEqual(results[0], results[1]);
});
