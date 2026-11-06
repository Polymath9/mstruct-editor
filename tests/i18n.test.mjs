import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  chordErrorCopy,
  documentErrorCopy,
  documentErrorMessage,
  interfaceCopy,
  mstructErrorCopy,
  romanErrorCopy,
  syntaxErrorMessage,
} from "../src/editor-i18n.js";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { parseMstruct } from "../src/core/mstruct.js";

const coreSources = await Promise.all(["mstruct", "mstruct-syntax", "mstruct-repeat", "mstruct-harmony", "mstruct-tags"]
  .map((name) => readFile(new URL(`../src/core/${name}.js`, import.meta.url), "utf8")));
const documentSource = await readFile(new URL("../src/core/mstruct-document.js", import.meta.url), "utf8");
const uiSources = await Promise.all([
  "../index.html",
  "../src/main.js",
  "../src/ui/metadata-dialog.js",
  "../src/ui/timeline-editor.js",
  "../src/ui/timeline-bulk-dialog.js",
  "../src/ui/timeline-table-editing.js",
  "../src/ui/metadata-links.js",
  "../src/ui/application-settings.js",
  "../src/ui/score-renderer.js",
  "../src/ui/symbol-ui.js",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("every editor catalog has matching Chinese and English keys", () => {
  for (const catalog of [interfaceCopy, chordErrorCopy, romanErrorCopy, mstructErrorCopy, documentErrorCopy]) {
    assert.deepEqual(Object.keys(catalog.zh).sort(), Object.keys(catalog.en).sort());
    for (const key of Object.keys(catalog.en)) {
      const parameters = (copy) => [...new Set([...copy.matchAll(/\{([a-z][a-z0-9]*)\}/g)].map((match) => match[1]))].sort();
      assert.deepEqual(parameters(catalog.zh[key]), parameters(catalog.en[key]), key);
      assert.doesNotMatch(catalog.zh[key], /Roman/, key);
      if (key !== "languageChinese") assert.doesNotMatch(catalog.en[key], /\p{Unified_Ideograph}/u, key);
    }
  }
});

test("all literal MAIN and document diagnostic codes have translations", () => {
  const mainCodes = new Set(coreSources.flatMap((source) => [...source.matchAll(/makeError\(\s*errors,\s*source,\s*"([a-z][a-z-]+)"/g)]
    .map((match) => match[1])));
  for (const code of mainCodes) {
    assert.ok(code in mstructErrorCopy.en || (code.startsWith("roman-") && code.slice(6) in romanErrorCopy.en), code);
  }
  const documentCodes = new Set([...documentSource.matchAll(/documentError\([^,]+,\s*"([a-z][a-z-]+)"/g)]
    .map((match) => match[1]));
  for (const code of documentCodes) assert.ok(code in documentErrorCopy.en, code);
});

test("all literal interface keys used by HTML and editor modules have translations", () => {
  const keys = new Set(uiSources.flatMap((source) => [
    ...[...source.matchAll(/\btr\("([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/data-i18n(?:-aria)?="([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]),
  ]));
  for (const key of keys) assert.ok(key in interfaceCopy.en, key);
});

test("English diagnostics contain no Chinese or unresolved parameters", () => {
  const examples = [
    "{BN:1}{D:1/4}{TS:4/4}X;",
    "{BN:1}{TS:adlib}{D:1/4}{FOO:1}X;",
    "{BN:1}{D:1/4}{TS:adlib}X;...X;",
    "{BN:1}{D:1/4}X;",
    "{BN:0}{TS:4/4}{D:1}X;",
  ];
  for (const source of examples) {
    for (const error of parseMstruct(source).errors) {
      const message = syntaxErrorMessage(error, "en");
      assert.doesNotMatch(message, /[\p{Script=Han}]/u);
      assert.doesNotMatch(message, /\{(?:actual|expected|context|type)\}/);
      assert.notEqual(message, syntaxErrorMessage(error, "zh"));
    }
  }
  const document = parseMstructDocument("METADATA:\n{IS_STABLE_TEMPO}TRUE\nEND_METADATA\nMAIN:\nX;\nEND_MAIN");
  assert.equal(document.ok, false);
  assert.doesNotMatch(documentErrorMessage(document.errors[0], "en"), /[\p{Script=Han}]/u);
});
