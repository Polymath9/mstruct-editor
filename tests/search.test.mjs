import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSpecialChordCsv } from "../src/core/chord-symbol.js";
import { parseMstruct } from "../src/core/mstruct.js";
import { activeMstructSearchTags, projectMstructSearchEvents } from "../src/core/mstruct-search-events.js";
import { matchMstructSearchQuery } from "../src/core/mstruct-search-match.js";
import { parseMstructSearchQuery, MSTRUCT_SEARCH_QUERY_LIMITS } from "../src/core/mstruct-search-query.js";
import { searchHighlightBox } from "../src/ui/renderer-search.js";
import { parseRomanConfigCsv } from "../src/core/roman-symbol.js";
import { parseGlobalTagList, parseSemanticTagConfigCsv } from "../src/core/semantic-tags.js";
import { parseTagConfigCsv } from "../src/core/tag-config.js";

const [specialChordCsv, romanBasicCsv, romanAdvancedCsv, romanFiguredBassCsv, romanSpecialCsv, cadenceCsv, tonalCsv, sequenceCsv] = await Promise.all([
  readFile(new URL("../src/config/special-chords.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-basic.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-advanced.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-figured-bass.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/roman-special.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/cadence-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/tonal-tags.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/sequence-tags.csv", import.meta.url), "utf8"),
]);
const specialChords = parseSpecialChordCsv(specialChordCsv);
const romanConfig = parseRomanConfigCsv({
  basicCsv: romanBasicCsv,
  advancedCsv: romanAdvancedCsv,
  figuredBassCsv: romanFiguredBassCsv,
  specialCsv: romanSpecialCsv,
});
const tagConfig = parseTagConfigCsv([
  "token,zh_name,en_name,duration_mode",
  "<one>,一,One,1",
  "<two>,二,Two,2",
  "<three>,三,Three,3",
  "",
].join("\n"));
const semanticTagConfig = parseSemanticTagConfigCsv({ cadenceCsv, tonalCsv, sequenceCsv }, { romanConfig });
const options = { specialChords, romanConfig, tagConfig, semanticTagConfig };

function compile(source, { globalTags = [] } = {}) {
  const parsed = parseMstruct(source, options);
  assert.equal(parsed.ok, true, parsed.errors.map((error) => `${error.code}: ${error.message}`).join("\n"));
  return projectMstructSearchEvents(parsed, { globalTags });
}

function search(projection, source) {
  const query = parseMstructSearchQuery(source, options);
  assert.equal(query.ok, true, query.errors.map((error) => error.code).join("\n"));
  return matchMstructSearchQuery(query, projection).windows;
}

test("cluster chord fields match exact, wildcard and NOT queries separately from standalone clusters", () => {
  const projected = compile("{BN:1}{TS:adlib}{D:1}{TC:C}ClusWK,[C:ClusWK|R:I],ClusBK|V,[C:Clus],C|I;");
  for (const [query, count] of [["ClusWK",1],["ClusWK|*",1],["[C:ClusBK|R:V]",1],["Clus|*",1],["*|I",2],["*!(ClusWK)|*",3],["(ClusWK||ClusBK)|*",2]]) {
    assert.equal(search(projected, query).length, count, query);
  }
  assert.equal(search(projected, "*|ClusWK").length, 0);
});

test("DC subdominant destinations remain distinct in exact and wildcard searches", () => {
  const projected = compile("{BN:1}{TS:4/4}{D:1}{TC:C}G|V;F|IV</DC:IV>;G|V;Fm|iv</DC:iv>;");
  assert.equal(search(projected, "<DC:IV>").length, 1);
  assert.equal(search(projected, "<DC:iv>").length, 1);
  assert.equal(search(projected, "<DC:*>").length, 2);
  assert.equal(search(projected, "<DC:vi>").length, 0);
  const globalTags = parseGlobalTagList("</DC:IV>", options);
  assert.equal(globalTags.ok, true);
  const globallyTagged = compile("{BN:1}{TS:4/4}{D:1}{TC:C}C|I;", { globalTags: globalTags.tags });
  assert.equal(search(globallyTagged, "*|* --globaltag:<DC:IV>").length, 1);
  assert.equal(search(globallyTagged, "*|* --globaltag:<DC:iv>").length, 0);
});

test("field NOT excludes complete chord patterns, including slash in polychord lower structures", () => {
  const projected = compile("{BN:1}{TS:adlib}{D:1}{TC:C}Cm|i,Cm7|i7,Cm7/G|i7,Cm7onF|i7,Cm7/GonF|i7,Cm7onF/A|i7;");
  for (const [query, count] of [
    ["Cm*!(*/*)|*", 3], ["Cm*!(*on*)|*", 3], ["Cm*!(*/*||*on*)|*", 2],
    ["Cm*!(Cm7)|*", 5], ["Cm*!(Cm7*)|*", 1], ["Cm*!(*)|*", 0],
    ["[C:Cm*!(*/*||*on*)|R:*]", 2], ["(Cm*||Dm*)!(*/*||*on*)|*", 2],
    ["C(m||7)!(*/*||*on*)|*", 1],
  ]) assert.equal(search(projected, query).length, count, query);
});

test("cluster chord annotations participate in exact, wildcard, OR and NOT searches", () => {
  const separator = String.fromCharCode(92).repeat(2);
  const projected = compile(`{BN:1}{TS:adlib}{D:1}{TC:C}Fm7add(b2,4,b6)${separator}Clus|I,Clus${separator}C|I,ClusBK${separator}ClusWK|I,Clus;`);
  for (const [query, count] of [["Clus|*", 2], ["C|*", 1], ["*|*", 3], ["(Clus||ClusWK)|*", 3], ["*!(Clus)|*", 1], ["Clus!(C)|*", 1], ["*!(ClusWK)|*", 2], ["Clus", 1]]) {
    assert.equal(search(projected, query).length, count, query);
  }
});

test("field NOT rejects prohibited alternatives in both directions without annotation escape", () => {
  const separator = String.fromCharCode(92).repeat(2);
  const projected = compile(`{BN:1}{TS:adlib}{D:1}{TC:C}[C:Cm${separator}Cm7/G|R:V${separator}V7],[C:Cm7/G${separator}Cm|R:V7${separator}V],[C:Cm${separator}Dm|R:V${separator}I];`);
  assert.equal(search(projected, "Cm*|V*").length, 3);
  assert.equal(search(projected, "Cm*!(*/*)|*").length, 1);
  assert.equal(search(projected, "*|V*!(V7)").length, 1);
  assert.equal(search(projected, "Cm*!(*/*)|V*!(V7)").length, 1);
});

test("Roman NOT respects complete patterns and explicit figure lists in both polarities", () => {
  const projected = compile("{BN:1}{TS:adlib}{D:1}{TC:C}C|V,C|V7,C|V7/V,C|V/V,C|V[5,3-x],C|V[6,4-x],C|I;");
  for (const [query, count] of [
    ["*|V*!(V7||V/V)", 4], ["*|*!(V)", 6], ["*|*!(V*)", 1],
    ["*|V*!(V[6,4-x])", 5], ["*|*!(*)", 0], ["[C:*|R:V*!(V7||V/V)]", 4],
  ]) assert.equal(search(projected, query).length, count, query);
});

test("Roman NOT checks every tonal layer while positive Roman alone maintains path state", () => {
  const projected = compile('{BN:1}{TS:adlib}{D:1}{TC:"C"}{M:"F"|IV}F|IV&I,C|I&V{/M};');
  assert.equal(search(projected, "*|IV,*|I").length, 1);
  assert.equal(search(projected, "*|IV!(I)").length, 0, "another layer can veto the whole field");
  assert.equal(search(projected, '*|IV!(V),*|I!(ii)').length, 1);
  assert.equal(search(projected, '*|IV!(V),*|V!(ii)').length, 0, "NOT must not mix paths across layers");
  assert.equal(search(projected, '{TC:"C"}*|IV!(I)').length, 0, "explicit TC does not hide excluded alternatives");
  assert.equal(search(projected, '*|*!(ii),*|*!(iii)').length, 1);
});

test("NOT preserves relative offsets, note-set roots and ordinary-event adjacency", () => {
  const projected = compile("{BN:1}{TS:adlib}{D:1}{TC:C}Cm|i,Dm|ii,Em|iii,Cm|i,Dm/G|ii,Em|iii;");
  assert.equal(search(projected, '(0)m*!(*/*||*on*)|*,(2)m*!(*/*||*on*)|*,(4)m*!(*/*||*on*)|*').length, 1);
  assert.equal(search(projected, 'C[notes:0,3,7]!(*/*||*on*)|*').length, 2);
  assert.equal(search(projected, '(0)[notes:0,3,7]!(*/*)|*,(2)[notes:0,3,7]!(*/*)|*,(4)[notes:0,3,7]!(*/*)|*').length, 1);
  assert.equal(search(projected, 'Cm*!(*/*)|*,Em*!(*/*)|*').length, 0, "rejected chords are not transparent");
  const transparent = compile("{BN:1}{TS:adlib}{D:1}{TC:C}Cm|i,'Dm/G|ii',0,-,Em|iii;");
  assert.equal(search(transparent, 'Cm*!(*/*)|*,Em*!(*/*)|*').length, 1);
  assert.equal(search(transparent, 'Cm*!(*/*)|*,Em*!(*/*)|* --notignore2nd').length, 0);
});

test("NOT requires a real field but leaves old missing-field wildcard behavior intact", () => {
  const projected = compile('{BN:1}{TS:adlib}{D:1}{TC:C}[C:C],[R:I],[C:X|R:I],[C:C|R:X],0,N.C.,X,Clus;');
  assert.equal(search(projected, '*|*').length, 2);
  assert.equal(search(projected, '*!(*/*)|*').length, 1);
  assert.equal(search(projected, '*|*!(V)').length, 1);
  assert.equal(search(projected, '*!(*/*)|*!(V)').length, 0);
});

test("NOT accepts arbitrary full symbols and eight flat branches and normalizes exclusions", () => {
  for (const query of [
    '*!(C||Cm7||D7sus4||E7(b5,b9)||Fadd9||G/B||AonD||Bdim)|*',
    '*|*!(I||II||III||IV||V||VI||VII||V7)', 'Cm*!(Cm7(b5,b9)||*on*)|*',
    '*!(C[sp:Never])|*!(Never)', 'C(7||m)!(*/*||*on*)|(I||V)!(V7||V[6,4-x])',
  ]) { const parsed = parseMstructSearchQuery(query, options); assert.equal(parsed.ok, true, `${query}: ${JSON.stringify(parsed.errors)}`); }
  const a = parseMstructSearchQuery('Cm*!(Cm7||Cm9)|V*!(V7||V/V)', options);
  const b = parseMstructSearchQuery('Cm*!(Cm9||Cm7||Cm7)|V*!(V/V||V7)', options);
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(a.normalizedKey, b.normalizedKey);
  assert.ok(a.workScore > parseMstructSearchQuery('Cm*|V*', options).workScore);
});

test("NOT rejects nesting, wrong fields, incomplete patterns and every invalid branch before simplification", () => {
  for (const query of [
    'Cm!|*', '!(Cm)|*', 'Cm!()|*', 'Cm!(||C)|*', 'Cm!(C||)|*', 'Cm!(C||||D)|*',
    'Cm!(*/*|*', 'Cm!(*/*)]|*', 'Cm!(*/*)!(*on*)|*', 'Cm!(*/*)7|*',
    '(Cm!(*/*)|*||Dm|*)', '(Cm!(*/*)||Dm)|*', '*|(V!(V7)||I)',
    'Cm!((C||D)||E)|*', 'Cm!(C(7||9))|*', 'Cm!(!(*/*))|*', 'Cm7(!(/G))|*',
    'Cm!(m||7||/G)|*', 'Cm!((0)m)|*', 'Cm!(C[notes:0,4,7])|*', 'X!(*/*)|*',
    '*|X!(V)', 'Cm!(*||Cadd3)|*', '{TC:C!(D)}', '<pedal:I!(V)>', '[NR:P!(L)]',
    '*!(C||D||E||F||G||A||B||Cm||Dm)|*',
  ]) { const parsed = parseMstructSearchQuery(query, options); assert.equal(parsed.ok, false, query); assert.ok(parsed.errors.every((error) => error.end > error.start), query); }
});

test("NOT shares OR, wildcard, field-length and work budgets across chord and Roman", () => {
  const queries = [
    [Array.from({ length: 9 }, () => 'C!(C||D)|I').join(','), 'search-or-limit'],
    [Array.from({ length: 5 }, () => 'C!(C||D||E||F||G||A||B)|I').join(','), 'search-or-limit'],
    [Array.from({ length: 17 }, () => 'C!(D)|I!(V)').join(','), 'search-not-limit'],
    [`C*!(${'*'.repeat(16)})|I`, 'search-field-pattern-too-complex'],
    [`*!(${'C'.repeat(254)})|I`, 'search-field-pattern-invalid'],
    [Array.from({ length: 32 }, () => 'C!(D)|I!(V)').join(','), 'search-query-too-complex'],
  ];
  assert.equal(MSTRUCT_SEARCH_QUERY_LIMITS.notGroups, 32);
  for (const [source, code] of queries) { const query = parseMstructSearchQuery(source, options); assert.equal(query.ok, false); assert.ok(query.errors.some((error) => error.code === code), `${code}: ${JSON.stringify(query.errors)}`); }
});

test("quoted TC search strictly separates exact, mode, wildcard and OR while Roman ignores certainty", () => {
  const projection = compile('{BN:1}{D:1}{TS:adlib}{TC:C}F|IV,{TC:"C"}Em|iii,{TC:c}Cm|i,{TC:"c"}Fm|iv,{TC:None}C|;');
  for (const [query, count] of [
    ['{TC:C}', 1], ['{TC:"C"}', 1], ['{TC:M}', 1], ['{TC:"M"}', 1],
    ['{TC:m}', 1], ['{TC:"m"}', 1], ['{TC:*}', 2], ['{TC:"*"}', 2],
    ['{TC:None}', 1], ['{TC:(C||"C")}', 2], ['{TC:(*||"C"||None)}', 4],
    ['{TC:("*"||C)}', 3], ['{TC:(*||"*")}', 4],
    ['*|IV,*|iii', 1], ['{TC:C}*|IV,{TC:"C"}*|iii', 1], ['{TC:C}*|IV,{TC:C}*|iii', 0],
  ]) assert.equal(search(projection, query).length, count, query);
  for (const query of ['{TC:"None"}', '{TC:""}', '{TC:"C}']) assert.equal(parseMstructSearchQuery(query, options).ok, false, query);
});

test("quoted modulation targets and Roman alternatives stay bound to their exact layers", () => {
  const projection = compile('{BN:1}{TS:adlib}{D:1/2}{TC:"C"}{M:"d"|ii}C|I&i,G|V&I{/M};{D:1}{MH:"A"|V}A|I;');
  for (const [query, count] of [
    ['{M:"d"|ii}', 2], ['{M:d|ii}', 0], ['{M:"*"|*}', 2], ['{M:*|*}', 0],
    ['{MH:"A"|V}', 1], ['{MH:A|V}', 0], ['{MH:"*"|*}', 1], ['{MH:*|*}', 0],
    ['*|I,*|V', 1], ['*|i,*|I', 1], ['*|i,*|V', 0],
    ['{TC:"C"}*|I,{TC:"d"}*|I', 0], ['{TC:C}*|I', 0],
  ]) assert.equal(search(projection, query).length, count, query);
});

test("Centricity parameter queries preserve quoted status including global tags and OR", () => {
  const projection = compile('{BN:1}{TS:adlib}{D:1/2}{TC:C}</Centricity:C>C|I,</Centricity:"C">C|I;');
  for (const [query, count] of [['<Centricity:*>*|*', 1], ['<Centricity:"*">*|*', 1], ['<Centricity:"?">*|*', 1], ['<Centricity:(*||"C")>*|*', 2], ['<Centricity:("*"||C)>*|*', 2]]) {
    assert.equal(search(projection, query).length, count, query);
  }
  const global = parseGlobalTagList('</Centricity:"C">', options);
  assert.equal(global.ok, true);
  const globalProjection = compile('{BN:1}{TS:adlib}{D:1}{TC:d}Dm|i;', { globalTags: global.tags });
  assert.equal(search(globalProjection, '{TC:d}<Centricity:"C">*|i').length, 1);
  assert.equal(search(globalProjection, '{TC:"C"}').length, 0);
});

test("power chords match their exact symbol and root-fifth note set", () => {
  const projection = compile("{BN:1}{TS:adlib}{D:1}C5|,Cno3|;");
  assert.equal(search(projection, "C5|*").length, 2);
  assert.equal(search(projection, "C5|* --notallowdifferentnotation").length, 1);
  assert.equal(search(projection, "Cno3|*").length, 2);
  assert.equal(search(projection, "Cno3|* --notallowdifferentnotation").length, 1);
  assert.equal(search(projection, "C[notes:0,7]|*").length, 2);
});

test("terminal tritones share note-set search while retaining exact parentheses and OR/NOT", () => {
  const projection = compile("{BN:1}{TS:adlib}{D:1}C(b5)|,Caddb5no(3,5)|,C5|;");
  assert.equal(search(projection, "C(b5)|*").length, 2);
  assert.equal(search(projection, "C(b5)|* --notallowdifferentnotation").length, 1);
  assert.equal(search(projection, "C[notes:0,6]|*").length, 2);
  assert.equal(search(projection, "(C(b5)||C5)|*").length, 3);
  assert.equal(search(projection, "C*!(C(b5))|*").length, 1);
});

test("renderer search joins chord and Roman text into one tight range box", () => {
  const box = searchHighlightBox([
    { left: 120, top: 60, right: 148, bottom: 78, width: 28, height: 18 },
    { left: 116, top: 82, right: 151, bottom: 98, width: 35, height: 16 },
    { left: 190, top: 60, right: 224, bottom: 98, width: 34, height: 38 },
  ], { left: 100, top: 40 });
  assert.deepEqual(box, { left: 13, top: 18, width: 114, height: 42 });
  assert.equal(searchHighlightBox([{ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }], { left: 0, top: 0 }), null);
});

test("search query parses exact fields and compiler-token wildcards", () => {
  for (const source of ["C?|*", "C??|*", "C?sus?|*", "C*sus*|*", "*m7|*", "*|ii"]) {
    const query = parseMstructSearchQuery(source, options);
    assert.equal(query.ok, true, `${source}: ${query.errors.map((error) => error.code).join(", ")}`);
  }
  const partialAtom = parseMstructSearchQuery("C*su*|*", options);
  assert.equal(partialAtom.ok, false);
  assert.ok(partialAtom.errors.some((error) => error.code === "search-field-pattern-invalid"));
  assert.equal(parseMstructSearchQuery("C|-", options).ok, false);
});

test("sequence search anchors the whole list and keeps Seq separate from SeqInv", () => {
  const projection = compile("{BN:1}{TS:adlib}{D:1/5}{TC:C}<Seq:A2>C|I,</Seq><Seq:A2(+5/-4),D4>D|II,</Seq><Seq:A3(+4/-2),D4,A1>E|III,</Seq><SeqInv:A2(+4/-3)>F|IV,</SeqInv>G|V;");
  assert.equal(search(projection, "<Seq:A2> *|*").length, 2);
  assert.equal(search(projection, "<Seq:*> *|*").length, 4);
  assert.equal(search(projection, "<Seq:?> *|*").length, 2);
  assert.equal(search(projection, "<Seq:*,D4> *|*").length, 2);
  assert.equal(search(projection, "<Seq:A2*> *|*").length, 2);
  assert.equal(search(projection, "<Seq:A2?> *|*").length, 2);
  assert.equal(search(projection, "<SeqInv:A2*> *|*").length, 2);
  assert.equal(search(projection, "<Seq:A2(+4/-3)> *|*").length, 0);

  for (const source of ["<Seq:A2,A2> *|*", "<Seq:A2*,A2?> *|*", "<Seq:*,*> *|*", "*|* --globaltag:<Seq:A2>"]) {
    assert.equal(parseMstructSearchQuery(source, options).ok, false, source);
  }
});

test("field matching is exact without wildcards and binds a chord root accidental", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C7|V7,C7#9|V7,Cm|i,Caug|I,Cdim|i,C#m7|i,C7sus4|V7;");
  assert.equal(search(projection, "C7|V7").length, 1);
  assert.equal(search(projection, "C?|*").length, 4);
  assert.equal(search(projection, "C??|*").length, 1);
  assert.equal(search(projection, "C?sus?|*").length, 1);
  assert.equal(search(projection, "C*sus*|*").length, 1);
  assert.equal(search(projection, "C*|*").length, 6, "C* must not consume the accidental bound to C#");
  assert.equal(search(projection, "*m7|*").length, 1);
});

test("missing fields, X placeholders, and annotations follow field-domain semantics", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}|V,[C:X|R:V],C7\\\\Edim/C|V7\\\\viio7;");
  assert.equal(search(projection, "*|V").length, 1, "a general wildcard must not consume C:X");
  assert.equal(search(projection, "[C:X|R:V]").length, 1);
  for (const source of ["C7|V7", "Edim/C|V7", "C7|viio7", "Edim/C|viio7"]) {
    assert.equal(search(projection, source).length, 1, source);
  }
});

test("active, endpoint, one-shot, parameter wildcard, and global tags are searchable", () => {
  const globalResult = parseGlobalTagList("</one></pedal:V>", options);
  assert.equal(globalResult.ok, true);
  const projection = compile(
    "{BN:1}{D:1}{TS:adlib}{TC:C}<two><pedal:V>C|I,</one>D|ii,</two></pedal>E|iii;",
    { globalTags: globalResult.tags },
  );
  assert.equal(search(projection, "<two>*|*").length, 3);
  assert.equal(search(projection, "<one>*|*").length, 3);
  assert.equal(search(projection, "<pedal:*>*|*").length, 3);
  assert.equal(search(projection, "<pedal:?>*|*").length, 3);
  assert.equal(search(projection, "*|* --globaltag:<one> --globaltag:<pedal:*>").length, 3);
  assert.equal(search(projection, "*|* --globaltag:<one> --globaltag:<pedal:?>").length, 3);
  assert.equal(search(projection, "*|* --globaltag:<three>").length, 0);
});

test("whole-song tags stay active across local endpoints, repeats, and ellipses without changing TC", () => {
  const globalResult = parseGlobalTagList("</two></Mode_Dorian:d>", options);
  assert.equal(globalResult.ok, true);
  const projection = compile(
    "{BN:1}{D:1}{TS:adlib}{TC:C}{||:}<two>C|I,</two>D|ii;E|iii{:||};...{BN:10}F|IV;",
    { globalTags: globalResult.tags },
  );
  assert.equal(search(projection, "<two><Mode_Dorian:?>*|*").length, 4);
  assert.equal(search(projection, "<two>E|iii,<two>C|I").length, 1);
  assert.equal(search(projection, "<two>E|iii,<two>F|IV").length, 0, "global tags do not bridge an ellipsis");
  assert.equal(search(projection, "{TC:C}<Mode_Dorian:d>*|*").length, 4);
  assert.equal(search(projection, "{TC:d}*|*").length, 0, "global Mode remains metadata and does not set TC");
  assert.equal(activeMstructSearchTags(projection.events[0], projection.globalTags).filter((tag) => tag.token === "<two>").length, 1);
  assert.equal(projection.events[2].tags.length, 0, "global tags need not be copied into every serialized event");
});

test("local active tags do not satisfy global-only filters and global tags preserve event barriers", () => {
  const local = compile("{BN:1}{D:1}{TS:adlib}<two>C|,D|,</two>E|;");
  assert.equal(search(local, "<two>*|*").length, 3);
  assert.equal(search(local, "<two>*|* --globaltag:<two>").length, 0);
  const globalResult = parseGlobalTagList("</one>", options);
  assert.equal(globalResult.ok, true);
  const projection = compile("{BN:1}{D:1}{TS:adlib}C|,X,D|;", { globalTags: globalResult.tags });
  assert.equal(search(projection, "<one>X").length, 1);
  assert.equal(search(projection, "<one>C|*,<one>D|*").length, 0);
  assert.equal(search(projection, "<one>C|*,<one>X,<one>D|*").length, 1);
});

test("all typed parameter tags accept equivalent star and question-mark constraints", () => {
  const projection = compile([
    "{BN:1}{D:1}{TS:adlib}{TC:C}<pedal:V>X,</pedal></PC:IV>X,",
    "</Phrygian_Cadence_to_Tonic:bII>X,</Mediant_Cadence:III>X,</DC:vi>X,",
    "</Mode_Dorian:d>X,</Scale_WholeTone:C>X,</Centricity:E>X;",
  ].join(""));
  for (const family of [
    "pedal",
    "PC",
    "Phrygian_Cadence_to_Tonic",
    "Mediant_Cadence",
    "DC",
    "Mode_Dorian",
    "Scale_WholeTone",
    "Centricity",
  ]) {
    assert.equal(search(projection, `<${family}:?>`).length, search(projection, `<${family}:*>`).length, family);
  }
  assert.equal(parseMstructSearchQuery("<IAC:?>", options).ok, false, "fixed colon tags stay exact-only");
  for (const [base, entry] of semanticTagConfig.tonal.byBase) {
    for (const [variant, configured] of [
      ["Mode", Boolean(entry.modeZhName && entry.modeEnName)],
      ["Scale", Boolean(entry.scaleZhName && entry.scaleEnName)],
    ]) {
      for (const wildcard of ["*", "?"]) {
        assert.equal(parseMstructSearchQuery(`<${variant}_${base}:${wildcard}>`, options).ok, configured, `${variant}_${base}:${wildcard}`);
      }
    }
  }
});

test("TC and TS use inherited state, including major/minor and wildcard components", () => {
  const projection = compile("{BN:1}{D:1/4}{TS:4/4}{TC:C}C|I,C|I,C|I,C|I;{TS:adlib}{TC:d}Dm|i;");
  assert.equal(search(projection, "{TC:C}{TS:*/4}*|*").length, 4);
  assert.equal(search(projection, "{TC:M}{TS:4/*}*|*").length, 4);
  assert.equal(search(projection, "{TC:m}{TS:adlib}*|*").length, 1);
});

test("TC None matches only the explicit inherited none state", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}C|,{TC:None}D|,E|,{TC:C}F|I;");
  assert.deepEqual(projection.events.map((event) => event.tonalCenterNone === true), [false, true, true, false]);
  assert.equal(search(projection, "{TC:None}").length, 2);
  assert.equal(search(projection, "{TC:*}").length, 1);
  assert.equal(search(projection, "{TC:M}").length, 1);
  assert.equal(search(projection, "{TC:m}").length, 0);
  assert.equal(search(projection, "{TC:C}").length, 1);
});

test("M spans all ordinary pivot events while MH remains a single event", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}{M:d|ii}C|I&i,X,0,-,N.C.,G|V&I{/M};{MH:A|V}A|I;");
  assert.equal(search(projection, "{M:*|*}").length, 2);
  assert.equal(search(projection, "{M:d|ii}{TC:C}*|I").length, 1, "TC and Roman stay on the C layer");
  assert.equal(search(projection, "{M:d|ii}{TC:d}*|i").length, 1);
  assert.equal(search(projection, "{MH:*|V}").length, 1);
});

test("Roman sequences stay on one continuous tonal layer through modulation", () => {
  const projection = compile("{BN:50}{D:1}{TS:adlib}{TC:F}F|I;{M:C|V}F|I&IV,C/E|V6&I6{/M};");
  assert.equal(search(projection, "*|I,*|IV").length, 0, "a sequence cannot jump from the F layer to the C layer");
  assert.equal(search(projection, "*|I,*|I").length, 1, "the pre-modulation event continues through the F layer");
  assert.equal(search(projection, "*|I,*|V6").length, 1, "the upper F layer remains searchable without an explicit TC");
  assert.equal(search(projection, "*|IV,*|I6").length, 1, "the lower C layer remains searchable without an explicit TC");
  assert.equal(search(projection, "{TC:F}*|IV").length, 0, "TC and Roman must bind to the same layer");
  assert.equal(search(projection, "{TC:C}*|IV").length, 1);
});

test("secondary, rest, continuation, barriers, and ellipsis control sequence adjacency", () => {
  const transparent = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C|I,'D|ii',0,-,E|iii;");
  assert.equal(search(transparent, "C|I,E|iii").length, 1);
  assert.equal(search(transparent, "C|I,E|iii --notignore2nd").length, 0);
  assert.equal(search(transparent, "C|I,0,E|iii").length, 1);

  const barrier = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C|I,X,E|iii;");
  assert.equal(search(barrier, "C|I,E|iii").length, 0);
  assert.equal(search(barrier, "C|I,X,E|iii").length, 1);

  const ellipsis = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C|I;...{BN:10}E|iii;");
  assert.equal(search(ellipsis, "C|I,E|iii").length, 0);
});

test("和弦进行按实际反复路线判断相邻关系，并断开不同 ending 的伪相邻", () => {
  const repeated = compile("{BN:1}{D:1}{TS:adlib}{TC:C}{||:}C|I;D|ii{:||3x};E|iii;");
  assert.equal(search(repeated, "D|ii,E|iii").length, 1, "最后一遍离开反复后仍与后续事件相邻");
  assert.equal(search(repeated, "D|ii,C|I").length, 1, "实际回跳形成的相邻关系也可搜索");

  const endings = compile(String.raw`{BN:1}{D:1}{TS:adlib}{TC:C}{||:}A|I;{ENDING:1}B|ii{/ENDING:1}{:||};{ENDING:2}C|iii{/ENDING};D|IV;`);
  assert.equal(search(endings, "B|ii,C|iii").length, 0, "两套 ending 在结构文本中相邻，但实际演奏从不相邻");
  assert.equal(search(endings, "A|I,C|iii").length, 1, "第二遍从反复主体进入第二套 ending");
  assert.equal(search(endings, "C|iii,D|IV").length, 1, "最后一套 ending 与后续正文保持相邻");
});

test("query errors are stable diagnostics and invalid queries cannot execute partially", () => {
  const query = parseMstructSearchQuery("C|I,,D|ii --unknown", options);
  assert.equal(query.ok, false);
  assert.ok(query.errors.some((error) => error.code === "search-empty-event"));
  assert.ok(query.errors.some((error) => error.code === "search-option-unknown"));
  assert.throws(() => matchMstructSearchQuery(query, compile("{BN:1}{TS:adlib}{D:1}C|;")), /invalid/);
});

test("MM is searchable as an explicit one-shot setting with component wildcards", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}{BPM:1/4=100}{MM:1/4=1/8}C|I,{MM:1/8=4/16}D|ii;");
  assert.equal(search(projection, "{MM:*}").length, 2);
  assert.equal(search(projection, "{MM:*/*=*/*}").length, 2);
  assert.equal(search(projection, "{MM:*/*=4/*}").length, 1);
  const independent = compile("{BN:1}{D:1}{TS:adlib}{MM:1/4=1/8}C|,{MM:1/8=1/16}D|;E|;");
  assert.equal(search(independent, "{MM:*}").length, 2);
  assert.equal(search(independent, "{MM:1/4=1/8}").length, 1);
  assert.equal(search(independent, "{BPM:*}").length, 0);
});

test("formal and legacy altered tensions share semantics and list wildcards are non-empty", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C13b5|I,C13b5b9|I,C13(b5,b9,#9)|I,Cadd9|I,Cadd(9,#11)|I,Csus4|I,Csus(2,4)|I,Cno3|I,Cno(3,5)|I,A[q4:(4,b7,b10)]|vi,D[q5:(5,b9,b13)]|ii,C[nf:(0,4,7)]|I;");
  assert.equal(search(projection, "C13(b5,b9,#9)|*").length, 1);
  assert.equal(search(projection, "C13b5b9#9|*").length, 1);
  assert.equal(search(projection, "C13(b5,*)|*").length, 2);
  assert.equal(search(projection, "C13(b5,?)|*").length, 1);
  assert.equal(search(projection, "Cadd(?)|*").length, 1);
  assert.equal(search(projection, "Cadd(*)|*").length, 2);
  assert.equal(search(projection, "Csus(?)|*").length, 1);
  assert.equal(search(projection, "Csus(*)|*").length, 2);
  assert.equal(search(projection, "Cno(?)|*").length, 1);
  assert.equal(search(projection, "Cno(*)|*").length, 2);
  assert.equal(search(projection, "A[q4:(4,*)]|*").length, 1);
  assert.equal(search(projection, "A[q4:*]|*").length, 1);
  assert.equal(search(projection, "D[q5:*]|*").length, 1);
  assert.equal(search(projection, "C[nf:*]|*").length, 1);
});

test("relative chord notes share one mod-12 offset across events and all chord-note roles", () => {
  const progression = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C#m|i,D#m|ii,F|I,C/GonD/A|I;");
  assert.equal(search(progression, "(1)m|*,(3)m|*,(5)|*").length, 1);
  assert.equal(search(progression, "(0)m|*,(2)m|*,(4)|*").length, 1);
  assert.equal(search(progression, "(0)m|*,(3)m|*,(4)|*").length, 0);
  assert.equal(search(progression, "(0)/(7)on(2)/(9)|*").length, 1);
  assert.equal(search(progression, "C/(7)onD/(9)|*").length, 1);
  assert.equal(search(progression, "(0)/*on(2)/(9)|*").length, 1);
  assert.equal(search(progression, "(24)m|*,(-22)m|*,(-20)|*").length, 1);
  assert.equal(parseMstructSearchQuery("(25)m|*", options).ok, false);
  assert.equal(parseMstructSearchQuery("(-25)m|*", options).ok, false);
  assert.equal(parseMstruct("{BN:1}{D:1}{TS:adlib}{TC:C}(0)m|i;").ok, false);
});

test("terminal chord note sets compare the final slash or polychord structure", () => {
  const projection = compile([
    "{BN:1}{D:1}{TS:adlib}CM9|,CM7add2|,CM9/E|,F#M9|,",
    "Cdim7|,Cdim7/Eb|,Cadd(9,#9)onF|,E[sp:sowhat]|,",
    "A[q4:(4,b7)]|,C[nf:(0,4,7)]|,G\\\\CM9|;",
  ].join(""));

  assert.equal(search(projection, "C[notes:0,2,4,7,11]|*").length, 3, "equivalent symbols and chord annotations match");
  assert.equal(search(projection, "E[notes:0,3,7,8,10]|*").length, 1, "a slash chord uses its final bass root");
  assert.equal(search(projection, "C[notes:0,2,4,7,11]|*").some((window) => window.startPosition === 2), false);
  assert.equal(search(projection, "*[notes:0,2,4,7,11]|*").length, 4, "any final root keeps the root-relative set");
  assert.equal(search(projection, "*([notes:0,2,4,7,11]||[notes:0,3,6,9])|*").length, 6);
  assert.equal(search(projection, "*[notes:0,3,6,9]|*").length, 2, "symmetric diminished-seventh inversions remain equivalent");
  assert.equal(search(projection, "F[notes:0,2,4,7,9,10,11]|*").length, 1, "polychords use the integrated lower-root structure");
  assert.equal(search(projection, "E[notes:0,3,5,7,10]|*").length, 1, "special chords use their configured final structure");
  assert.equal(search(projection, "A[notes:0,5,10]|*").length, 1, "q4 structures are supported");
  assert.equal(search(projection, "C[notes:0,4,7]|*").length, 1, "normal-form structures are supported");

  const slash = projection.events[2].chord.alternatives[0];
  assert.equal(slash.root, "C", "ordinary chord search keeps the written upper root");
  assert.deepEqual(slash.pitchSet, ["E", 4, 1 | (1 << 3) | (1 << 7) | (1 << 8) | (1 << 10)]);
});

test("relative terminal note-set roots share the existing query offset", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}F#M9|,Abm|;{BN:2}GM9|,Am|;");
  assert.equal(search(projection, "(0)[notes:0,2,4,7,11]|*,(2)m|*").length, 2);
  assert.equal(search(projection, "(0)[notes:0,2,4,7,11]|*,(3)m|*").length, 0);
});

test("terminal note-set syntax rejects noncanonical lists and further chord suffixes", () => {
  for (const source of [
    "C[notes:]|*",
    "C[notes:0,12]|*",
    "C[notes:0,2.5]|*",
    "C[notes:2,0]|*",
    "C[notes:0,0]|*",
    "C[notes:0,*]|*",
    "C[notes:0||2]|*",
    "CM[notes:0,4,7]|*",
    "C[notes:0,4,7]/E|*",
    "C[notes:0,4,7]onE|*",
    "C[notes:0,4,7]add9|*",
    "(25)[notes:0,4,7]|*",
    "C([notes:0,4,7]||*)|*",
  ]) {
    const query = parseMstructSearchQuery(source, options);
    assert.equal(query.ok, false, source);
    assert.ok(query.errors.some((error) => error.code === "search-note-set-invalid"), source);
  }
});

test("figure-chain continuations expose the inherited Roman without changing their literal source", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}G|V[5,3-],C/G|[6,4-],G|[5,3];");
  assert.equal(projection.events[1].roman.alternatives[0].source, "[6,4-]");
  assert.deepEqual(projection.events[1].roman.alternatives[0].atoms, ["[6,4-]"]);
  for (const field of ["V[6,4-]", "V[6,4]", "*[6,4-]", "*[6,4]", "[6,4-]", "[6,4]"]) {
    const windows = search(projection, `*|${field}`);
    assert.equal(windows.length, 1, field);
    assert.equal(windows[0].startPosition, 1, "the match stays on the middle event");
  }
  assert.equal(search(projection, "*|vi[6,4]").length, 0);
  assert.equal(search(projection, "*|V[6,4-x]").length, 0);
  assert.equal(search(projection, "*|[5,3]").length, 2, "named and pure lists share the figure-only view");
  assert.equal(search(projection, "*|V").length, 0, "a bare exact Roman still excludes lists");
});

test("figure search ignores ordinary endings and restricts an explicit -x in OR and NOT", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}G|V[6,4-],G|[6,4-],G|[6,4];G|V[6,4-x];");
  for (const field of ["V[6,4]", "V[6,4-]", "*[6,4]", "[6,4]", "[6,4-]"]) assert.equal(search(projection, `*|${field}`).length, 4, field);
  for (const field of ["V[6,4-x]", "*[6,4-x]", "[6,4-x]"]) assert.equal(search(projection, `*|${field}`).length, 1, field);
  assert.equal(search(projection, "*|V([6,4]||[5,3-x])").length, 4);
  assert.equal(search(projection, "*|(V[6,4-x]||vi[6,4])").length, 1);
  assert.equal(search(projection, "*|V*!(V[6,4])").length, 0);
  assert.equal(search(projection, "*|V*!(V[6,4-x])").length, 3);
  assert.equal(search(projection, "*|V[6,4]!(V[6,4-x])").length, 3);
});

test("inherited figure search preserves qualities, special spellings, applied targets and annotations", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}G|V[5,3-]/V,C|[6,4]/V;G|VS[5,3-],C|[6,4];G|V\\\\I[6,4-x];");
  for (const field of ["V[6,4]/V", "[6,4]/V", "VS[6,4]", "I[6,4]"]) assert.equal(search(projection, `*|${field}`).length, 1, field);
  assert.equal(search(projection, "*|V[6,4]").length, 0, "applied V/V is not plain V");
  assert.equal(search(projection, "*|I[6,4-x]").length, 1);
  assert.equal(search(projection, "*|V!(I[6,4])").length, 0, "a figure annotation can veto the event");
  const advanced = new Map(romanConfig.advanced);
  advanced.set("+", { ...advanced.get("+"), allowedFiguredBass: [...advanced.get("+").allowedFiguredBass, "[]"] });
  const parsed = parseMstruct("{BN:1}{D:1}{TS:adlib}{TC:C}G|I+[5,3-],C|[6,4];", { ...options, romanConfig: { ...romanConfig, advanced } });
  assert.equal(parsed.ok, true);
  const quality = projectMstructSearchEvents(parsed);
  assert.equal(search(quality, "*|I+[6,4]").length, 1);
  assert.equal(search(quality, "*|I[6,4]").length, 0);
});

test("figure heads remain independent in both modulation layers and keep Roman path continuity", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}{M:G|V}G|V[5,3-]&I[5,3-],C|[6,4-]&[6,4-],G|[5,3]&[5,3]{/M};");
  for (const field of ["V[6,4]", "I[6,4]"]) assert.equal(search(projection, `*|${field}`).length, 1);
  assert.equal(search(projection, "*|V[6,4],*|V[5,3]").length, 1);
  assert.equal(search(projection, "*|I[6,4],*|I[5,3]").length, 1);
  assert.equal(search(projection, "*|V[6,4],*|I[5,3]").length, 0);
  assert.equal(search(projection, "*|V[6,4]!(I[6,4])").length, 0);
});

test("figure queries validate the list while the document parser keeps authored chain requirements", () => {
  for (const field of ["V[6,4]", "*[6,4]", "[6,4]"]) assert.equal(parseMstructSearchQuery(`*|${field}`, options).ok, true, field);
  for (const field of ["V[3,5]", "V[6,1]", "V[15,4]", "V[6]", "V[6,4--]", "V[6,4]extra"]) assert.equal(parseMstructSearchQuery(`*|${field}`, options).ok, false, field);
  const document = parseMstruct("{BN:1}{D:1}{TS:adlib}{TC:C}G|V[6,4];", options);
  assert.equal(document.ok, false);
  assert.ok(document.errors.some((error) => error.code === "roman-figured-chain-required"));
});

test("explicit V figure searches combine major and minor spellings with ordinary OR", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C/G|V[6,4-],G|[5,3];{TC:c}Cm/G|V[b6,4-],G|[5,3];G|V,G|V7;");
  assert.equal(search(projection, "*|(V[6,4-]||V[b6,4-])").length, 2);
  assert.equal(search(projection, "*|V[6,4-]").length, 1);
  assert.equal(search(projection, "*|V[b6,4-]").length, 1);
  assert.equal(search(projection, "*|V").length, 1);
  assert.equal(search(projection, "*|V*").length, 6);
  assert.equal(search(projection, "*|V*!(V[6,4-]||V[b6,4-])").length, 4);
  const retired = parseMstructSearchQuery("*|V --VequalCad", options);
  assert.equal(retired.ok, false);
  assert.ok(retired.errors.some((error) => error.code === "search-option-unknown"));
});

test("OR keeps complete event and field choices in the shared AST", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}<pedal:I>C7|V7,</pedal>Cm|i,<pedal:V>Dm|ii,</pedal>G7|V7/V;");
  assert.equal(search(projection, "(C7|V7||Dm|ii)").length, 2);
  assert.equal(search(projection, "(C7||Dm)|*").length, 2);
  assert.equal(search(projection, "C(7||m)|*").length, 2);
  assert.equal(search(projection, "C(7||m)|(V7||i)").length, 2);
  assert.equal(search(projection, "*|(V7||ii)").length, 2);
  assert.equal(search(projection, "<pedal:(I||V)>*|*").length, 4);
  assert.equal(search(projection, "<pedal:(I||V||*)>*|*").length, 4);

  const query = parseMstructSearchQuery("(Dm|ii||C7|V7||Dm|ii)", options);
  assert.equal(query.ok, true);
  assert.equal(query.events[0].kind, "choice");
  assert.equal(query.events[0].branches.length, 2, "duplicate branches are normalized");
  assert.equal(typeof query.normalizedKey, "string");
  assert.ok(query.workScore > 0);

  const eightBranches = parseMstructSearchQuery("(C|I||D|I||E|I||F|I||G|I||A|I||B|I||C7|V7)", options);
  assert.equal(eightBranches.ok, true, eightBranches.errors.map((error) => error.code).join(", "));
  for (const source of [
    "C7(b5#9add2||sus4||*)|*",
    "*|(V7||V7/V||V[6,4-x])",
    "({M:C|V}||{M:c|iv})",
  ]) {
    const parsed = parseMstructSearchQuery(source, options);
    assert.equal(parsed.ok, true, `${source}: ${parsed.errors.map((error) => error.code).join(", ")}`);
  }

  const listProjection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}C7(b5,b9)|V7,C7(b5,#9)|V7,C7sus4|V7;");
  assert.equal(search(listProjection, "C7((b5,b9)||(b5,#9))|*").length, 2);
  assert.equal(search(listProjection, "C7((b5,b9)||(b5,#9)||*)|*").length, 3);
});

test("setting OR enumerates complete values and rejects cross-product syntax", () => {
  const projection = compile([
    "{BN:1}{D:1/4}{TS:3/4}{TC:C}{BPM:1/4=100}{MM:1/4=1/8}C|I,C|I,C|I;",
    "{D:1/8}{TS:6/8}{TC:d}{BPM:1/8=120}{MM:1/8=1/4}Dm|i,Dm|i,Dm|i,Dm|i,Dm|i,Dm|i;",
    "{TS:adlib}{TC:None}E|;",
  ].join(""));
  assert.equal(search(projection, "{TC:(C||d||None)}").length, 10);
  assert.equal(search(projection, "{TS:(3/4||6/8||adlib)}").length, 10);
  assert.equal(search(projection, "{MM:(1/4=1/8||1/8=1/4)}").length, 2);
  assert.equal(search(projection, "{BPM:(1/4=[90~110]||1/8=120)}").length, 2);

  for (const source of ["{TS:(3||6)/8}", "{MM:1/(4||8)=1/8}", "{BPM:1/(4||8)=120}", "{M:(C||d)|V}"]) {
    assert.equal(parseMstructSearchQuery(source, options).ok, false, source);
  }
});

test("BPM search uses only explicit values in the current slot", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}{BPM:1/4=99.5}{BPMhidden:1/8=120}C|I,D|ii,{BPM:1/4=200}E|iii;");
  assert.equal(search(projection, "{BPM:*}").length, 2);
  assert.equal(search(projection, "{BPM:1/4=[99~100]}").length, 1);
  assert.equal(search(projection, "{BPM:1/8=120}").length, 1);
  assert.equal(search(projection, "{BPM:1/4=[100~200]}").length, 1);
  assert.equal(search(projection, "{BPM:1/4=*}").length, 2);
  assert.equal(search(projection, "{BPM:1/4=120}").length, 0, "inherited playback tempo is not searchable");
  for (const source of ["{BPM:1/4=[100.5~120]}", "{BPM:1/4=[121~120]}", "{BPM:0/4=120}", "{BPM:2147483648/4=120}"]) {
    assert.equal(parseMstructSearchQuery(source, options).ok, false, source);
  }
});

test("NR patterns use transformation units and complete-pattern OR", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}C|,[NR:P]Cm|,D|,[NR:LR]Dm|,E|,[NR:RLP]Em|,F|,[NR:PLRL]Fm|,G|,[NR:N]Gm|;");
  assert.equal(search(projection, "[NR:?]").length, 1, "question mark is one P/L/R transform");
  assert.equal(search(projection, "[NR:????]").length, 1);
  assert.equal(search(projection, "[NR:R*P]").length, 1);
  assert.equal(search(projection, "[NR:*]").length, 5);
  assert.equal(search(projection, "[NR:(P||LR||H||R*P)]").length, 3);
  for (const source of ["[NR:N?]", "[NR:PS]", "[NR:???????]", "[NR:(P||||L)]"]) {
    assert.equal(parseMstructSearchQuery(source, options).ok, false, source);
  }
});

test("event OR consumes one query position and preserves following state", () => {
  const projection = compile("{BN:1}{D:1}{TS:adlib}{TC:C}0,D|ii,C|I,D|ii;");
  assert.equal(search(projection, "(0||C|I),D|ii").length, 2);
  assert.equal(search(projection, "({TC:C}C|I||{TC:d}Dm|i),D|ii").length, 1);
  assert.equal(parseMstructSearchQuery("(C|I,D|ii||E|iii)", options).ok, false);

  const relative = compile("{BN:1}{D:1}{TS:adlib}C#m|,D#m|,F|;");
  assert.equal(search(relative, "((0)m|*||(1)m|*),(2)m|*,(4)|*").length, 1);
});

test("OR validates every branch before simplification and enforces hard limits", () => {
  for (const source of [
    "(C|I||)",
    "(||C|I)",
    "(C|I||||D|ii)",
    "((C|I||D|ii)||E|iii)",
    "C7(b5,(b9||#9))|*",
    "C7(b5#9add2||add3)|*",
    "(C|I||D|ii||E|iii||F|IV||G|V||A|vi||B|vii||C7|V7||D7|V7/V)",
  ]) assert.equal(parseMstructSearchQuery(source, options).ok, false, source);

  const tooManyGroups = Array.from({ length: 9 }, () => "{TC:(C||d)}").join(",");
  assert.equal(parseMstructSearchQuery(tooManyGroups, options).ok, false);
  const tooManyBranches = Array.from({ length: 5 }, () => "{TC:(C||d||E||f||G||a||B)}").join(",");
  assert.equal(parseMstructSearchQuery(tooManyBranches, options).ok, false);
});
