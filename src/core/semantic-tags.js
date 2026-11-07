import { makeError } from "./mstruct-diagnostics.js";
import { isRomanBasicToken, parseRomanSymbol } from "./roman-symbol.js";
import { parseTagCsvRows } from "./tag-config.js";
import { parseTonalReference } from "./tonal-reference.js";
import { dtcDefinition, parseDtcPair } from "./mstruct-dtc.js";

export const CADENCE_TAG_HEADERS = ["token", "zh_name", "en_name", "roman_kind", "allowed_romans"];
export const TONAL_TAG_HEADERS = ["token", "mode_zh_name", "scale_zh_name", "mode_en_name", "scale_en_name"];
export const SEQUENCE_TAG_HEADERS = ["sequence_type", "derived_types"];
const NOTE_NAME_PATTERN = /^[A-Ga-g](?:bb|b|#|x)?$/;
const SEQUENCE_VALUE_PATTERN = /^[A-Z][A-Za-z0-9]*(?:\([A-Za-z0-9+\-#/]+\))?$/;

/** Exact search tokens are opaque; reserved parameter shapes still have grammar. */
export function validateExactSearchTagSource(raw) {
  requireAsciiToken(`<${raw}>`, 0, "Search");
  if (/[*?{}|]/.test(raw) || raw.split(":").some((part) => !part)) throw new Error("Invalid exact search tag.");
  const stack = [];
  for (const character of raw) {
    if (character === "(" || character === "[") stack.push(character === "(" ? ")" : "]");
    else if (character === ")" || character === "]") { if (stack.pop() !== character) throw new Error("Unbalanced search tag."); }
  }
  if (stack.length) throw new Error("Unbalanced search tag.");
  const sequence = /^(Seq|SeqInv):(.*)$/.exec(raw);
  if (sequence) {
    const values = sequence[2].split(",");
    if (values.some((value) => !SEQUENCE_VALUE_PATTERN.test(value)) || new Set(values).size !== values.length) throw new Error("Invalid sequence list.");
  } else if (raw.startsWith("DTC:")) {
    if (!parseDtcPair(raw.slice(4))) throw new Error("Invalid DTC pair.");
  } else if (raw.startsWith("Centricity:")) {
    if (!parseTonalReference(raw.slice("Centricity:".length))) throw new Error("Invalid centricity.");
  } else if (raw.startsWith("pedal:")) {
    if (!isRomanBasicToken(raw.slice(6))) throw new Error("Invalid pedal degree.");
  } else if (/^(Mode|Scale)_/.test(raw)) {
    const match = /^(?:Mode|Scale)_[^:]+:([^:]+)$/.exec(raw);
    if (!match || !NOTE_NAME_PATTERN.test(match[1])) throw new Error("Invalid tonal tag.");
  } else if (["Seq", "SeqInv", "pedal", "Centricity", "DTC"].includes(raw)) throw new Error("Closing tag is not a search constraint.");
  return `<${raw}>`;
}

function requireHeaders(header, expected, label) {
  if (!header || header.length !== expected.length || header.some((cell, index) => cell !== expected[index])) {
    throw new Error(`${label} CSV header must be: ${expected.join(",")}`);
  }
}

function requireAsciiToken(token, rowNumber, label) {
  const inner = token.slice(1, -1);
  if (!token.startsWith("<") || !token.endsWith(">") || !inner
    || /[<>\\\s]/.test(inner) || /[^\x00-\x7F]/.test(token) || /^(?:\/|\*\/)/.test(inner)) {
    throw new Error(`${label} token on CSV row ${rowNumber} must use a nonempty ASCII <token> form without spaces, backslashes or closing prefixes / and */.`);
  }
  return inner;
}

export function parseRomanInAnyMode(value, romanConfig) {
  if (!romanConfig) throw new TypeError("A Roman configuration is required.");
  let lastError;
  for (const tonalMode of ["M", "m"]) {
    try {
      return parseRomanSymbol(value, { config: romanConfig, tonalMode });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Invalid Roman numeral: ${value}`);
}

export function parseCadenceTagConfigCsv(csv, { romanConfig = null } = {}) {
  const [header, ...body] = parseTagCsvRows(csv);
  requireHeaders(header, CADENCE_TAG_HEADERS, "Cadence-tag");
  const entries = [];
  const exact = new Map();
  const parameterized = [];
  body.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== CADENCE_TAG_HEADERS.length) throw new Error(`Cadence-tag CSV row ${rowNumber} must contain exactly ${CADENCE_TAG_HEADERS.length} columns.`);
    const token = row[0].trim();
    const zhName = row[1].trim();
    const enName = row[2].trim();
    const romanKind = row[3].trim();
    const allowedRomans = row[4].split(",").map((value) => value.trim()).filter(Boolean);
    const inner = requireAsciiToken(token, rowNumber, "Cadence-tag");
    if (!zhName || !enName) throw new Error(`Cadence-tag CSV row ${rowNumber} requires both Chinese and English names.`);
    if (!new Set(["none", "fixed", "parameter"]).has(romanKind)) throw new Error(`Cadence-tag CSV row ${rowNumber} has an invalid roman_kind.`);
    if (romanKind === "parameter" && (!inner.endsWith(":") || !allowedRomans.length)) {
      throw new Error(`Parameterized cadence-tag CSV row ${rowNumber} requires a token ending in : and at least one allowed Roman numeral.`);
    }
    if (romanKind !== "parameter" && allowedRomans.length) throw new Error(`Cadence-tag CSV row ${rowNumber} may only list allowed Romans when roman_kind is parameter.`);
    const fixedRoman = romanKind === "fixed" ? inner.slice(inner.lastIndexOf(":") + 1) : "";
    if (romanKind === "fixed" && (!fixedRoman || fixedRoman === inner)) throw new Error(`Fixed-Roman cadence-tag CSV row ${rowNumber} requires a Roman suffix after :.`);
    const romanValues = romanKind === "fixed" ? [fixedRoman] : allowedRomans;
    if (new Set(romanValues).size !== romanValues.length) throw new Error(`Cadence-tag CSV row ${rowNumber} contains duplicate Roman values.`);
    if (romanConfig) romanValues.forEach((value) => parseRomanInAnyMode(value, romanConfig));
    const entry = { token, inner, zhName, enName, romanKind, allowedRomans, fixedRoman };
    if (romanKind === "parameter") {
      const prefix = inner.slice(0, -1);
      if (parameterized.some((candidate) => candidate.prefix === prefix) || exact.has(inner)) throw new Error(`Cadence-tag token ${token} is duplicated.`);
      entry.prefix = prefix;
      parameterized.push(entry);
    } else {
      if (exact.has(inner) || parameterized.some((candidate) => candidate.prefix === inner)) throw new Error(`Cadence-tag token ${token} is duplicated.`);
      exact.set(inner, entry);
    }
    entries.push(entry);
  });
  if (!entries.length) throw new Error("Cadence-tag CSV cannot be empty.");
  parameterized.sort((left, right) => right.prefix.length - left.prefix.length);
  return { entries, exact, parameterized };
}

function validateNoteTemplate(value, rowNumber, label) {
  if (!value) return;
  if ((value.match(/\{note\}/g) ?? []).length !== 1) throw new Error(`${label} on tonal-tag CSV row ${rowNumber} must contain {note} exactly once.`);
}

export function parseTonalTagConfigCsv(csv) {
  const [header, ...body] = parseTagCsvRows(csv);
  requireHeaders(header, TONAL_TAG_HEADERS, "Tonal-tag");
  const entries = [];
  const byBase = new Map();
  body.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== TONAL_TAG_HEADERS.length) throw new Error(`Tonal-tag CSV row ${rowNumber} must contain exactly ${TONAL_TAG_HEADERS.length} columns.`);
    const [rawToken, rawModeZh, rawScaleZh, rawModeEn, rawScaleEn] = row;
    const token = rawToken.trim();
    const inner = requireAsciiToken(token, rowNumber, "Tonal-tag");
    if (!inner.endsWith(":")) throw new Error(`Tonal-tag token on CSV row ${rowNumber} must end in : before >.`);
    const base = inner.slice(0, -1);
    const modeZhName = rawModeZh.trim();
    const scaleZhName = rawScaleZh.trim();
    const modeEnName = rawModeEn.trim();
    const scaleEnName = rawScaleEn.trim();
    if (Boolean(modeZhName) !== Boolean(modeEnName) || Boolean(scaleZhName) !== Boolean(scaleEnName) || (!modeZhName && !scaleZhName)) {
      throw new Error(`Tonal-tag CSV row ${rowNumber} requires complete Chinese/English name pairs for every allowed variant.`);
    }
    validateNoteTemplate(modeZhName, rowNumber, "Mode Chinese name");
    validateNoteTemplate(modeEnName, rowNumber, "Mode English name");
    validateNoteTemplate(scaleZhName, rowNumber, "Scale Chinese name");
    validateNoteTemplate(scaleEnName, rowNumber, "Scale English name");
    if (byBase.has(base)) throw new Error(`Tonal-tag token ${token} is duplicated.`);
    const entry = { token, base, modeZhName, scaleZhName, modeEnName, scaleEnName };
    byBase.set(base, entry);
    entries.push(entry);
  });
  if (!entries.length) throw new Error("Tonal-tag CSV cannot be empty.");
  return { entries, byBase };
}

export function parseSequenceTagConfigCsv(csv) {
  const [header, ...body] = parseTagCsvRows(csv);
  requireHeaders(header, SEQUENCE_TAG_HEADERS, "Sequence-tag");
  const entries = [];
  const byType = new Map();
  const byValue = new Map();
  body.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== SEQUENCE_TAG_HEADERS.length) throw new Error(`Sequence-tag CSV row ${rowNumber} must contain exactly ${SEQUENCE_TAG_HEADERS.length} columns.`);
    const sequenceType = row[0].trim();
    const derivedTypes = row[1].split(",").map((value) => value.trim()).filter(Boolean);
    if (!SEQUENCE_VALUE_PATTERN.test(sequenceType) || sequenceType.includes("(")) throw new Error(`Sequence type on CSV row ${rowNumber} is invalid.`);
    if (byType.has(sequenceType)) throw new Error(`Sequence type ${sequenceType} is duplicated.`);
    if (new Set(derivedTypes).size !== derivedTypes.length) throw new Error(`Sequence-tag CSV row ${rowNumber} contains duplicate derived types.`);
    for (const value of derivedTypes) {
      if (!SEQUENCE_VALUE_PATTERN.test(value) || !value.startsWith(`${sequenceType}(`)) throw new Error(`Derived sequence type ${value} on CSV row ${rowNumber} must extend ${sequenceType}.`);
      if (byValue.has(value)) throw new Error(`Derived sequence type ${value} is duplicated.`);
    }
    const values = [sequenceType, ...derivedTypes];
    const entry = { sequenceType, derivedTypes, values };
    entries.push(entry);
    byType.set(sequenceType, entry);
    values.forEach((value) => byValue.set(value, entry));
  });
  if (!entries.length) throw new Error("Sequence-tag CSV cannot be empty.");
  return { entries, byType, byValue };
}

export function parseSemanticTagConfigCsv({ cadenceCsv, tonalCsv, sequenceCsv }, options = {}) {
  return {
    cadences: parseCadenceTagConfigCsv(cadenceCsv, options),
    tonal: parseTonalTagConfigCsv(tonalCsv),
    sequences: parseSequenceTagConfigCsv(sequenceCsv),
  };
}

function templateParts(template, type, value, result = null) {
  const [before, after] = template.split("{note}");
  if (after === undefined) return [{ type: "text", value: template }];
  return [
    ...(before ? [{ type: "text", value: before }] : []),
    { type, value, result },
    ...(after ? [{ type: "text", value: after }] : []),
  ];
}

function romanLabelParts(prefix, value, result, fixed = false) {
  if (fixed && prefix.endsWith(value)) prefix = prefix.slice(0, -value.length);
  return [
    ...(prefix ? [{ type: "text", value: prefix }] : []),
    { type: "roman", value, result },
  ];
}

function definition({ key, token, durationMode, zhParts, enParts, semanticKind, tonalCenter = null, closingToken = null, detachedClosingToken = null }) {
  return {
    key,
    token,
    durationMode,
    zhName: zhParts.map((part) => part.value).join(""),
    enName: enParts.map((part) => part.value).join(""),
    zhParts,
    enParts,
    semanticKind,
    tonalCenter,
    closingToken,
    detachedClosingToken,
    affectsTonalCenter: semanticKind === "centricity",
  };
}

function invalid(details = {}) {
  return { kind: "invalid", details };
}

export function resolveSemanticTagToken(content, { semanticTagConfig, romanConfig }) {
  if (!semanticTagConfig || !romanConfig) return null;
  const detachedClosing = content.startsWith("*/");
  const closing = detachedClosing || content.startsWith("/");
  const body = closing ? content.slice(detachedClosing ? 2 : 1) : content;

  if (["Seq", "SeqInv"].includes(body)) {
    return { kind: "close", closing, key: `semantic:${body}`, token: `<${body}>` };
  }
  const sequence = /^(Seq|SeqInv):(.*)$/.exec(body);
  if (sequence) {
    if (closing) return invalid({ token: `<${content}>` });
    const [, family, rawValues] = sequence;
    const values = rawValues.split(",");
    if (!values.length || values.some((value) => !value || value.trim() !== value || !semanticTagConfig.sequences.byValue.has(value)) || new Set(values).size !== values.length) {
      return invalid({ token: `<${content}>` });
    }
    const valueText = values.join(", ");
    return {
      kind: "definition",
      closing: false,
      canCloseActive: false,
      definition: definition({
        key: `semantic:${family}`,
        token: `<${family}:${values.join(",")}>`,
        durationMode: 3,
        zhParts: [{ type: "text", value: `${family === "Seq" ? "模进" : "转位模进"}：${valueText}` }],
        enParts: [{ type: "text", value: `${family === "Seq" ? "Sequence" : "Inverted Sequence"}: ${valueText}` }],
        semanticKind: family === "Seq" ? "sequence" : "inverted-sequence",
        closingToken: `</${family}>`,
        detachedClosingToken: `<*/${family}>`,
      }),
    };
  }

  if (body === "pedal") return { kind: "close", closing, key: "semantic:pedal", token: "<pedal>" };
  if (body.startsWith("pedal:")) {
    const roman = body.slice("pedal:".length);
    if (!roman || !romanConfig.basics.has(roman)) return invalid({ token: `<${content}>` });
    let result;
    try { result = parseRomanInAnyMode(roman, romanConfig); } catch { return invalid({ token: `<${content}>` }); }
    return {
      kind: "definition",
      closing,
      canCloseActive: false,
      definition: definition({
        key: "semantic:pedal",
        token: `<pedal:${roman}>`,
        durationMode: 3,
        zhParts: romanLabelParts("持续音：", roman, result),
        enParts: romanLabelParts("Pedal Note: ", roman, result),
        semanticKind: "pedal",
        closingToken: "</pedal>",
        detachedClosingToken: "<*/pedal>",
      }),
    };
  }

  if (body === "Centricity") return { kind: "close", closing, key: "semantic:centricity", token: "<Centricity>" };
  if (body.startsWith("Centricity:")) {
    const note = body.slice("Centricity:".length);
    if (!parseTonalReference(note)) return invalid({ token: `<${content}>` });
    return {
      kind: "definition",
      closing,
      canCloseActive: false,
      definition: definition({
        key: "semantic:centricity",
        token: `<Centricity:${note}>`,
        durationMode: 2,
        zhParts: templateParts("中心性：{note}", "note", note),
        enParts: templateParts("Centricity: {note}", "note", note),
        semanticKind: "centricity",
        tonalCenter: note,
        closingToken: "</Centricity>",
        detachedClosingToken: "<*/Centricity>",
      }),
    };
  }

  const tonal = /^(Mode|Scale)_([^:]+)(?::(.*))?$/.exec(body);
  if (tonal) {
    const [, variant, base, note] = tonal;
    const entry = semanticTagConfig.tonal.byBase.get(base);
    if (!entry) return null;
    const isMode = variant === "Mode";
    const zhTemplate = isMode ? entry.modeZhName : entry.scaleZhName;
    const enTemplate = isMode ? entry.modeEnName : entry.scaleEnName;
    const key = `semantic:${variant}_${base}`;
    if (note === undefined) return { kind: "close", closing, key, token: `<${variant}_${base}>` };
    if (!zhTemplate || !enTemplate || !NOTE_NAME_PATTERN.test(note)) return invalid({ token: `<${content}>` });
    return {
      kind: "definition",
      closing,
      canCloseActive: false,
      definition: definition({
        key,
        token: `<${variant}_${base}:${note}>`,
        durationMode: 2,
        zhParts: templateParts(zhTemplate, "note", note),
        enParts: templateParts(enTemplate, "note", note),
        semanticKind: isMode ? "mode" : "scale",
        closingToken: `</${variant}_${base}>`,
        detachedClosingToken: `<*/${variant}_${base}>`,
      }),
    };
  }

  const cadence = semanticTagConfig.cadences.exact.get(body);
  let cadenceEntry = cadence;
  let roman = cadence?.fixedRoman ?? "";
  if (!cadenceEntry) {
    cadenceEntry = semanticTagConfig.cadences.parameterized.find((entry) => body.startsWith(`${entry.prefix}:`));
    if (cadenceEntry) roman = body.slice(cadenceEntry.prefix.length + 1);
  }
  if (cadenceEntry) {
    if (cadenceEntry.romanKind === "parameter" && (!roman || !cadenceEntry.allowedRomans.includes(roman))) return invalid({ token: `<${content}>` });
    let romanResult = null;
    if (roman) {
      try { romanResult = parseRomanInAnyMode(roman, romanConfig); } catch { return invalid({ token: `<${content}>` }); }
    }
    const suffix = cadenceEntry.romanKind === "parameter" ? `:${roman}` : "";
    const canonicalBody = cadenceEntry.romanKind === "parameter" ? `${cadenceEntry.prefix}:${roman}` : cadenceEntry.inner;
    const zhParts = roman ? romanLabelParts(cadenceEntry.zhName, roman, romanResult, cadenceEntry.romanKind === "fixed") : [{ type: "text", value: cadenceEntry.zhName }];
    const enParts = roman ? romanLabelParts(cadenceEntry.enName, roman, romanResult, cadenceEntry.romanKind === "fixed") : [{ type: "text", value: cadenceEntry.enName }];
    return {
      kind: "definition",
      closing,
      canCloseActive: false,
      definition: definition({
        key: `cadence:${canonicalBody}`,
        token: `<${canonicalBody}>`,
        durationMode: 1,
        zhParts,
        enParts,
        semanticKind: "cadence",
      }),
    };
  }
  return null;
}

function globalOccurrence(definitionValue, start, end) {
  return { ...definitionValue, global: true, kind: "oneshot", lane: null, rangeId: null, start, end };
}

export function parseGlobalTagList(value, { tagConfig, semanticTagConfig, romanConfig, formTagConfig }) {
  const source = String(value ?? "");
  const errors = [];
  const tags = [];
  const seen = new Set();
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length) break;
    if (source[index] !== "<") {
      makeError(errors, source, "global-tag-form", index, index + 1, { domain: "tag" });
      break;
    }
    const end = source.indexOf(">", index + 1);
    if (end === -1) {
      makeError(errors, source, "unclosed-tag", index, source.length, { domain: "tag" });
      break;
    }
    const content = source.slice(index + 1, end);
    if (!content.startsWith("/")) {
      makeError(errors, source, "global-tag-nonclosing", index, end + 1, { domain: "tag", details: { token: source.slice(index, end + 1) } });
      index = end + 1;
      continue;
    }
    const body = content.slice(1);
    const formDefinition = formTagConfig?.byToken?.get(`<${body}>`);
    if ((formDefinition && !(formDefinition.allowGlobal ?? !formDefinition.parent)) || /^FORM_END(?::|$)/.test(body)) {
      makeError(errors, source, "global-tag-unavailable", index, end + 1, { domain: "tag", details: { token: source.slice(index, end + 1) } });
      index = end + 1;
      continue;
    }
    if (/^DTC(?::|$)/.test(body)) {
      const pair = body.startsWith("DTC:") && parseDtcPair(body.slice(4));
      if (!pair) makeError(errors, source, "invalid-tag-parameter", index, end + 1, { domain: "tag", details: { token: source.slice(index, end + 1) } });
      else if (tags.some(tag => tag.semanticKind === "dtc")) makeError(errors, source, "duplicate-global-dtc", index, end + 1, { domain: "tag" });
      else tags.push(globalOccurrence(dtcDefinition(pair), index, end + 1));
      index = end + 1;
      continue;
    }
    const staticDefinition = formDefinition ?? tagConfig?.byToken?.get(`<${body}>`);
    const semantic = staticDefinition ? null : resolveSemanticTagToken(content, { semanticTagConfig, romanConfig });
    const resolved = staticDefinition ?? (semantic?.kind === "definition" ? semantic.definition : null);
    if (!resolved) {
      makeError(errors, source, semantic?.kind === "invalid" ? "invalid-tag-parameter" : "unknown-tag", index, end + 1, {
        domain: "tag",
        details: { token: source.slice(index, end + 1) },
      });
      index = end + 1;
      continue;
    }
    const identity = resolved.token;
    if (seen.has(identity)) {
      makeError(errors, source, "duplicate-global-tag", index, end + 1, { domain: "tag", details: { token: identity } });
    } else {
      seen.add(identity);
      tags.push(globalOccurrence(resolved, index, end + 1));
    }
    index = end + 1;
  }
  return { source, tags, errors, ok: errors.length === 0 };
}

export function tagDisplayParts(definitionValue, locale) {
  const parts = locale === "en" ? definitionValue.enParts : definitionValue.zhParts;
  return parts?.length ? parts : [{ type: "text", value: locale === "en" ? definitionValue.enName : definitionValue.zhName }];
}
