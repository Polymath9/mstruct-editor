import { parseChordSymbol } from "./chord-symbol.js";
import { CLUSTER_SYMBOLS } from "./cluster-symbol.js";
import { parseRomanInAnyMode, validateExactSearchTagSource } from "./semantic-tags.js";
import { validateExactHarmonySearchSource } from "./mstruct-search-source.js";
import { parseTonalReference } from "./tonal-reference.js";
import { parseDtcPair } from "./mstruct-dtc.js";
import { extractFieldExclusion, positiveFieldPattern } from "./mstruct-search-exclusion.js";
import { compileChordSearchPattern, relativeChordSource } from "./mstruct-search-chord.js";
import { romanFigureValidationSource } from "./mstruct-search-roman.js";
import {
  embeddedOrGroups,
  MSTRUCT_SEARCH_QUERY_LIMITS,
  normalizeChoiceBranches,
  semanticChoiceValue,
  stableStringify,
  wholeOrGroup,
} from "./mstruct-search-choice.js";
export { MSTRUCT_SEARCH_QUERY_LIMITS } from "./mstruct-search-choice.js";

const SEARCHABLE_SPECIAL_EVENTS = new Map([
  ["X", "placeholder"],
  ["0", "rest"],
  ["N.C.", "no-chord"],
  ...[...CLUSTER_SYMBOLS].map(([symbol, { type }]) => [symbol, type]),
]);

function diagnostic(code, start, end, details = {}) {
  return { code, start, end: Math.max(start + 1, end), details };
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  const stack = [];
  const closing = { "[": "]", "(": ")", "{": "}", "<": ">" };
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (closing[character]) stack.push(closing[character]);
    else if (stack.at(-1) === character) stack.pop();
    else if (character === delimiter && stack.length === 0) {
      parts.push({ value: source.slice(start, index), start, end: index });
      start = index + 1;
    }
  }
  parts.push({ value: source.slice(start), start, end: source.length });
  return parts;
}

function trimSpan(part, offset = 0) {
  const leading = part.value.length - part.value.trimStart().length;
  const value = part.value.trim();
  const start = offset + part.start + leading;
  return { value, start, end: start + value.length };
}


function optionBoundary(source) {
  const stack = [];
  const closing = { "[": "]", "(": ")", "{": "}", "<": ">" };
  for (let index = 0; index < source.length - 1; index += 1) {
    const character = source[index];
    if (closing[character]) stack.push(closing[character]);
    else if (stack.at(-1) === character) stack.pop();
    if (stack.length === 0 && source.startsWith("--", index) && (index === 0 || /\s/.test(source[index - 1]))) return index;
  }
  return -1;
}

function parseExactTag(raw, start, options, errors) {
  try {
    const token = validateExactSearchTagSource(raw);
    return { kind: "exact", token };
  } catch {
    errors.push(diagnostic("search-tag-invalid", start, start + raw.length + 2, { token: `<${raw}>` }));
    return null;
  }
}

function parameterizedTagFamily(raw, options) {
  const match = /^(.*):(?:([*?])|"([*?])")$/.exec(raw);
  if (!match || /[*?]/.test(match[1])) return null;
  const [, base] = match;
  if (match[3] && base !== "Centricity") return null;
  if (["pedal", "Centricity"].includes(base)) return base;
  const tonal = /^(Mode|Scale)_(.+)$/.exec(base);
  if (tonal) {
    const entry = options.semanticTagConfig?.tonal?.byBase?.get(tonal[2]);
    const hasConfiguredName = tonal[1] === "Mode"
      ? Boolean(entry?.modeZhName && entry?.modeEnName)
      : Boolean(entry?.scaleZhName && entry?.scaleEnName);
    if (hasConfiguredName) return base;
  }
  if (options.semanticTagConfig?.cadences?.parameterized?.some((entry) => entry.prefix === base)) return base;
  return null;
}

function parseSequenceTagConstraint(raw, start, options, errors, { allowSequence = true } = {}) {
  const match = /^(Seq|SeqInv):(.*)$/.exec(raw);
  if (!match) return undefined;
  const fail = () => {
    errors.push(diagnostic("search-tag-invalid", start, start + Math.max(1, raw.length + 2), { token: `<${raw}>` }));
    return null;
  };
  if (!allowSequence) return fail();
  const [, family, listSource] = match;
  const sequenceConfig = options.semanticTagConfig?.sequences;
  const values = listSource.split(",");
  if (!values.length || values.some((value) => !value || value.trim() !== value)) return fail();
  const items = [];
  const identities = new Set();
  for (const value of values) {
    let item;
    let identity;
    if (value === "*") {
      item = { kind: "many1" };
      identity = "many1";
    } else if (value === "?") {
      item = { kind: "one" };
      identity = "one";
    } else if (/[?*]$/.test(value)) {
      const sequenceType = value.slice(0, -1);
      const entry = sequenceConfig?.byType.get(sequenceType);
      if (!entry) return fail();
      item = { kind: "family", sequenceType, values: entry.values };
      identity = `family:${sequenceType}`;
    } else {
      try { validateExactSearchTagSource(`${family}:${value}`); } catch { return fail(); }
      item = { kind: "exact", value };
      identity = `exact:${value}`;
    }
    if (identities.has(identity)) return fail();
    identities.add(identity);
    items.push(item);
  }
  const wildcard = items.some((item) => item.kind !== "exact");
  return wildcard
    ? { kind: "sequence-pattern", family, items }
    : { kind: "exact", token: `<${family}:${values.join(",")}>` };
}

function parseTagConstraint(content, start, options, errors, constraintOptions = {}, context = null) {
  const raw = content.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("*/") || raw.startsWith("\\") || raw.startsWith("*\\")) {
    errors.push(diagnostic("search-tag-invalid", start, start + Math.max(1, content.length + 2), { token: `<${content}>` }));
    return null;
  }
  if (constraintOptions.allowOr !== false && raw.includes("||")) {
    const separator = raw.indexOf(":");
    const base = raw.slice(0, separator);
    const family = separator > 0 ? parameterizedTagFamily(`${base}:*`, options)
      ?? (!/[*?]/.test(raw) && /^[A-Za-z][A-Za-z0-9_]*$/.test(base) ? base : null) : null;
    const value = separator > 0 ? raw.slice(separator + 1) : "";
    const valueStart = start + 1 + separator + 1;
    const branches = family && context ? wholeOrGroup(value, valueStart, errors, context.or) : null;
    if (!family || !branches) {
      errors.push(diagnostic("search-or-invalid", start, start + Math.max(1, content.length + 2)));
      return null;
    }
    const parsed = branches.map((branch) => parseTagConstraint(
      `${family}:${branch.value}`,
      branch.start - family.length - 2,
      options,
      errors,
      { ...constraintOptions, allowOr: false },
      context,
    )).filter(Boolean);
    if (!parsed.length) return null;
    return {
      kind: "choice",
      branches: family === "Centricity" ? normalizeChoiceBranches(parsed).filter((branch) => {
        if (branch.kind === "parameter-wildcard") return true;
        const reference = parseTonalReference(branch.token.slice("<Centricity:".length, -1));
        return !parsed.some((wildcard) => wildcard.kind === "parameter-wildcard" && wildcard.ambiguous === reference?.ambiguous);
      }) : normalizeChoiceBranches(parsed, { wildcardCovers: true }),
    };
  }
  if (/^DTC(?::|$)/.test(raw)) {
    const pair = raw.startsWith("DTC:") && constraintOptions.allowDtc !== false
      ? parseDtcPair(raw.slice(4), { query: true }) : null;
    if (pair) return { kind: "dtc-pair", family: "DTC", values: [...pair].sort() };
    errors.push(diagnostic("search-tag-invalid", start, start + content.length + 2, { token: `<${content}>` }));
    return null;
  }
  const sequence = parseSequenceTagConstraint(raw, start, options, errors, constraintOptions);
  if (sequence !== undefined) return sequence;
  if (/[*?]/.test(raw)) {
    const family = parameterizedTagFamily(raw, options);
    if (!family) {
      errors.push(diagnostic("search-tag-invalid", start, start + content.length + 2, { token: `<${content}>` }));
      return null;
    }
    return { kind: "parameter-wildcard", family, prefix: `<${family}:`,
      ...(family === "Centricity" ? { ambiguous: raw.slice(raw.indexOf(":") + 1).startsWith('"') } : {}) };
  }
  return parseExactTag(raw, start, options, errors);
}

function compileConcreteField(domain, source, options) {
  if (domain === "chord") {
    const result = parseChordSymbol(source, { specialChords: options.specialChords, globalSettings: options.globalSettings });
    return result.searchAtoms ?? result.atoms;
  }
  return parseRomanInAnyMode(romanFigureValidationSource(source), options.romanConfig).atoms;
}

function wildcardParts(source, { listMany = false } = {}) {
  const parts = [];
  let start = 0;
  let roundDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "(") roundDepth += 1;
    if (source[index] === ")" && roundDepth > 0) roundDepth -= 1;
    if (!["*", "?"].includes(source[index])) continue;
    if (index > start) parts.push({ kind: "literal", value: source.slice(start, index) });
    parts.push({ kind: source[index] === "*" ? (listMany && roundDepth > 0 ? "many1" : "many") : "one" });
    start = index + 1;
  }
  if (start < source.length) parts.push({ kind: "literal", value: source.slice(start) });
  return parts;
}

function hasConcreteInstantiation(source, domain, options) {
  const choices = domain === "chord"
    ? {
        "*": ["", "C", "m", "7", "sus", "4", "/G", "onG", "add9", "b2", "2", "#4", "b5", "5", "#5", "b7", "7", "b9", "9", "#9", "11", "#11", "13", "0,1"],
        "?": ["m", "7", "sus", "4", "C", "/", "G", "on", "add", "9", "b2", "2", "#4", "b5", "5", "#5", "b7", "b9", "#9", "11", "#11", "13"],
      }
    : { "*": ["", "I", "M", "7", "/V"], "?": ["I", "M", "7", "6", "/", "V"] };
  const wildcardIndexes = [...source].flatMap((character, index) => ["*", "?"].includes(character) ? [{ character, index }] : []);
  let attempts = 0;

  function visit(wildcardIndex, cursor, output) {
    if (attempts >= 1024) return false;
    if (wildcardIndex >= wildcardIndexes.length) {
      attempts += 1;
      const concrete = output + source.slice(cursor);
      try {
        compileConcreteField(domain, concrete, options);
        return true;
      } catch {
        return false;
      }
    }
    const wildcard = wildcardIndexes[wildcardIndex];
    const prefix = output + source.slice(cursor, wildcard.index);
    for (const replacement of choices[wildcard.character]) {
      if (visit(wildcardIndex + 1, wildcard.index + 1, prefix + replacement)) return true;
    }
    return false;
  }

  return visit(0, 0, "");
}

function normalizeChordWildcardSource(source) {
  return source.replace(/\[(q4|q5|nf):\*\]/g, "[$1:(*)]");
}

function relativeWildcardParts(source, relatives) {
  const relativeByStart = new Map(relatives.map((entry) => [entry.start, entry]));
  const parts = [];
  let literalStart = 0;
  let roundDepth = 0;
  let cursor = 0;
  const flush = (end) => {
    if (end > literalStart) parts.push({ kind: "literal", value: source.slice(literalStart, end) });
  };
  while (cursor < source.length) {
    const relative = relativeByStart.get(cursor);
    if (relative) {
      flush(cursor);
      parts.push({ kind: "relative", value: relative.value });
      cursor = relative.end;
      literalStart = cursor;
      continue;
    }
    const character = source[cursor];
    if (character === "(") roundDepth += 1;
    if (character === ")" && roundDepth > 0) roundDepth -= 1;
    if (["*", "?"].includes(character)) {
      flush(cursor);
      parts.push({ kind: character === "*" ? (roundDepth > 0 ? "many1" : "many") : "one" });
      literalStart = cursor + 1;
    }
    cursor += 1;
  }
  flush(source.length);
  return parts;
}

function parseChordNoteSetRoot(source) {
  if (source === "*") return { kind: "any" };
  const relative = /^\((-?\d+)\)$/.exec(source);
  if (relative) {
    const value = Number(relative[1]);
    return Number.isInteger(value) && value >= -24 && value <= 24 ? { kind: "relative", value } : null;
  }
  return /^[A-G](?:bb|b|#|x)?$/.test(source) ? { kind: "exact", value: source } : null;
}

function parseChordNoteSetBranch(source, start, errors) {
  const match = /^\[notes:(\d+(?:,\d+)*)\]$/.exec(source);
  if (!match) {
    errors.push(diagnostic("search-note-set-invalid", start, start + Math.max(1, source.length)));
    return null;
  }
  const pitchClasses = match[1].split(",").map(Number);
  if (pitchClasses.length > 12 || pitchClasses.some((value, index) => value < 0 || value > 11
    || (index > 0 && value <= pitchClasses[index - 1]))) {
    errors.push(diagnostic("search-note-set-invalid", start, start + source.length));
    return null;
  }
  return pitchClasses.reduce((mask, pitchClass) => mask | (1 << pitchClass), 0);
}

function parseChordNoteSetPattern(source, start, errors, context) {
  if (!source.includes("[notes")) return undefined;
  const rootMatch = /^(\*|\(-?\d+\)|[A-G](?:bb|b|#|x)?)/.exec(source);
  const root = rootMatch ? parseChordNoteSetRoot(rootMatch[1]) : null;
  if (!rootMatch || !root) {
    errors.push(diagnostic("search-note-set-invalid", start, start + Math.max(1, source.length)));
    return null;
  }
  const suffix = source.slice(rootMatch[0].length);
  let branches;
  if (suffix.startsWith("[notes:")) {
    branches = [{ value: suffix, start: start + rootMatch[0].length, end: start + source.length }];
  } else if (suffix.startsWith("(") && suffix.endsWith(")")) {
    branches = wholeOrGroup(suffix, start + rootMatch[0].length, errors, context.or);
  }
  if (!branches?.length) {
    errors.push(diagnostic("search-note-set-invalid", start, start + Math.max(1, source.length)));
    return null;
  }
  const masks = branches.map((branch) => parseChordNoteSetBranch(branch.value, branch.start, errors)).filter((mask) => mask !== null);
  if (masks.length !== branches.length) return null;
  return { kind: "note-set", root, masks: [...new Set(masks)].sort((left, right) => left - right) };
}

function parseFieldPatternBase(raw, domain, start, options, errors) {
  const originalValue = raw.trim();
  const value = domain === "chord" ? normalizeChordWildcardSource(originalValue) : originalValue;
  if (!value || value.length > MSTRUCT_SEARCH_QUERY_LIMITS.fieldLength) {
    errors.push(diagnostic("search-field-pattern-invalid", start, start + Math.max(1, raw.length), { domain, value }));
    return null;
  }
  if (value === "-") {
    errors.push(diagnostic("search-continuation-unsearchable", start, start + 1, { domain }));
    return null;
  }
  if (value === "X") return { kind: "placeholder", source: value };
  if (domain === "chord" && CLUSTER_SYMBOLS.has(value)) return { kind: "source", source: value };
  const wildcardCount = [...value].filter((character) => ["*", "?"].includes(character)).length;
  if (wildcardCount > MSTRUCT_SEARCH_QUERY_LIMITS.wildcardsPerField) {
    errors.push(diagnostic("search-field-pattern-too-complex", start, start + value.length, { domain }));
    return null;
  }

  if (domain === "chord") {
    const relative = relativeChordSource(value);
    if (relative.invalid || relative.relatives.some((entry) => !Number.isInteger(entry.value) || entry.value < -24 || entry.value > 24)) {
      errors.push(diagnostic("search-relative-note-invalid", start, start + value.length));
      return null;
    }
    if (relative.relatives.length) {
      if (/[?*]/.test(value)) {
        if (!hasConcreteInstantiation(relative.source, domain, options)) {
          errors.push(diagnostic("search-field-pattern-invalid", start, start + value.length, { domain, value: originalValue }));
          return null;
        }
        return {
          kind: "relative-wildcard",
          source: originalValue,
          listAware: value !== originalValue || /\([^)]*[?*][^)]*\)/.test(value),
          parts: relativeWildcardParts(value, relative.relatives),
        };
      }
      try {
        const result = parseChordSymbol(relative.source, { specialChords: options.specialChords, globalSettings: options.globalSettings });
        const atoms = [...(result.searchAtoms ?? result.atoms)].map((atom) => ({ kind: "literal", value: atom }));
        for (const entry of relative.relatives) {
          const note = result.search?.notes?.[entry.noteIndex];
          if (!note) throw new Error("Relative note did not resolve to a chord-note position.");
          atoms[note.atomIndex] = { kind: "relative", value: entry.value };
        }
        return { kind: "relative-atoms", source: originalValue, atoms };
      } catch {
        errors.push(diagnostic("search-field-pattern-invalid", start, start + value.length, { domain, value: originalValue }));
        return null;
      }
    }
  }

  if (!wildcardCount) {
    try {
      if (domain === "roman" || value.includes("[sp:")) return { kind: "source", source: validateExactHarmonySearchSource(domain, value) };
      return { kind: "atoms", source: value, atoms: compileConcreteField(domain, value, options) };
    } catch {
      errors.push(diagnostic("search-field-pattern-invalid", start, start + value.length, { domain, value }));
      return null;
    }
  }
  if (value === "*") return { kind: "wildcard", source: value, parts: [{ kind: "many" }] };
  if (!hasConcreteInstantiation(value, domain, options)) {
    errors.push(diagnostic("search-field-pattern-invalid", start, start + value.length, { domain, value }));
    return null;
  }
  return {
    kind: "wildcard",
    source: originalValue,
    listAware: domain === "chord" && (value !== originalValue || /\([^)]*[?*][^)]*\)/.test(value)),
    parts: wildcardParts(value, { listMany: domain === "chord" }),
  };
}

function patternPartsForSource(source, domain) {
  const relatives = domain === "chord"
    ? [...source.matchAll(/\((-?\d+)\)/g)].map((match) => ({
        value: Number(match[1]),
        start: match.index,
        end: match.index + match[0].length,
      }))
    : [];
  return relativeWildcardParts(source, relatives);
}

function fieldSourceWithBranch(source, groups, selectedGroup, selectedBranch) {
  let output = "";
  let cursor = 0;
  for (const group of groups) {
    output += source.slice(cursor, group.start);
    output += group === selectedGroup ? selectedBranch.value : (group.branches[0]?.value ?? "");
    cursor = group.end + 1;
  }
  return output + source.slice(cursor);
}

function parseFieldPattern(raw, domain, start, options, errors, context) {
  const value = raw.trim();
  const exclusion = extractFieldExclusion(value, domain, start, errors, context);
  if (exclusion !== undefined) {
    if (!exclusion) return null;
    const include = parseFieldPattern(exclusion.positive.value, domain, exclusion.positive.start, options, errors, context);
    let valid = include && include.kind !== "placeholder";
    const exclude = exclusion.branches.map((branch) => {
      const parsed = branch.value.includes("[notes:") ? null : parseFieldPatternBase(branch.value, domain, branch.start, options, errors);
      if (!parsed || ["relative-atoms", "relative-wildcard", "placeholder"].includes(parsed.kind)) {
        errors.push(diagnostic("search-not-invalid", branch.start, branch.end, { domain }));
        valid = false;
      }
      return parsed;
    }).filter(Boolean);
    if (include?.kind === "placeholder") errors.push(diagnostic("search-not-invalid", start, start + value.length, { domain }));
    return valid ? { kind: "exclude", include, exclude: normalizeChoiceBranches(exclude) } : null;
  }
  if (domain === "chord") {
    const noteSet = parseChordNoteSetPattern(value, start, errors, context);
    if (noteSet !== undefined) return noteSet;
  }
  if (!value.includes("||")) return parseFieldPatternBase(raw, domain, start, options, errors);
  if (value.length > MSTRUCT_SEARCH_QUERY_LIMITS.fieldLength) {
    errors.push(diagnostic("search-field-pattern-invalid", start, start + Math.max(1, raw.length), { domain, value }));
    return null;
  }
  const wildcardCount = [...value].filter((character) => ["*", "?"].includes(character)).length;
  if (wildcardCount > MSTRUCT_SEARCH_QUERY_LIMITS.wildcardsPerField) {
    errors.push(diagnostic("search-field-pattern-too-complex", start, start + value.length, { domain }));
    return null;
  }
  const groups = embeddedOrGroups(value, start, errors, context.or);
  if (!groups.length || groups.some((group) => !group.branches?.length)) {
    errors.push(diagnostic("search-or-invalid", start, start + value.length));
    return null;
  }

  let valid = true;
  for (const group of groups) {
    for (const branch of group.branches) {
      const candidate = fieldSourceWithBranch(value, groups, group, branch);
      const branchErrors = [];
      const parsed = parseFieldPatternBase(candidate, domain, start, options, branchErrors);
      if (!parsed || branchErrors.length) {
        valid = false;
        errors.push(diagnostic("search-field-pattern-invalid", branch.start, Math.max(branch.start + 1, branch.end), { domain, value: branch.value }));
      }
    }
  }
  if (!valid) return null;

  const parts = [];
  let cursor = 0;
  let hasRelative = false;
  for (const group of groups) {
    const prefix = patternPartsForSource(value.slice(cursor, group.start), domain);
    if (prefix.some((part) => part.kind === "relative")) hasRelative = true;
    parts.push(...prefix);
    let branchSources = [...new Set(group.branches.map((branch) => branch.value))].sort();
    if (branchSources.includes("*")) branchSources = ["*"];
    const branches = branchSources.map((branchSource) => patternPartsForSource(branchSource, domain));
    if (branches.some((branch) => branch.some((part) => part.kind === "relative"))) hasRelative = true;
    parts.push({ kind: "choice", branches });
    cursor = group.end + 1;
  }
  const suffix = patternPartsForSource(value.slice(cursor), domain);
  if (suffix.some((part) => part.kind === "relative")) hasRelative = true;
  parts.push(...suffix);
  return {
    kind: "choice-pattern",
    source: value,
    listAware: domain === "chord",
    hasRelative,
    parts,
  };
}

function parseHarmonyConstraint(source, start, options, errors, context) {
  const special = SEARCHABLE_SPECIAL_EVENTS.get(source);
  if (special) return { special };
  if (source === "-") {
    errors.push(diagnostic("search-continuation-unsearchable", start, start + 1));
    return null;
  }

  let chordPart;
  let romanPart;
  if (source.startsWith("[") && source.endsWith("]")) {
    const inner = source.slice(1, -1);
    const fields = splitTopLevel(inner, "|").map((part) => trimSpan(part, start + 1));
    if (fields.length !== 2) {
      errors.push(diagnostic("search-harmony-form", start, start + source.length));
      return null;
    }
    const values = new Map();
    for (const field of fields) {
      const match = /^([CRcr])\s*:\s*(.+)$/.exec(field.value);
      if (!match || values.has(match[1].toUpperCase())) {
        errors.push(diagnostic("search-harmony-form", field.start, field.end));
        return null;
      }
      const valueOffset = field.value.indexOf(":") + 1;
      const value = field.value.slice(valueOffset).trim();
      const leading = field.value.slice(valueOffset).length - field.value.slice(valueOffset).trimStart().length;
      values.set(match[1].toUpperCase(), { value, start: field.start + valueOffset + leading });
    }
    chordPart = values.get("C");
    romanPart = values.get("R");
  } else {
    const fields = splitTopLevel(source, "|").map((part) => trimSpan(part, start));
    if (fields.length !== 2 || fields.some((field) => !field.value)) {
      errors.push(diagnostic("search-harmony-form", start, start + source.length));
      return null;
    }
    [chordPart, romanPart] = fields;
  }
  if (!chordPart || !romanPart) {
    errors.push(diagnostic("search-harmony-form", start, start + source.length));
    return null;
  }
  const chord = parseFieldPattern(chordPart.value, "chord", chordPart.start, options, errors, context);
  const roman = parseFieldPattern(romanPart.value, "roman", romanPart.start, options, errors, context);
  return chord && roman ? { chord, roman } : null;
}

function validSearchInteger(value) {
  return /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647;
}

function parseSettingSingle(type, value, start, end, options, errors) {
  if (type === "TC") {
    if (value !== "None" && !parseTonalReference(value, { query: true })) {
      errors.push(diagnostic("search-setting-invalid", start, end, { type }));
      return null;
    }
    return { type, value };
  }
  if (type === "TS") {
    const match = /^(\*|[1-9]\d*)\/(\*|[1-9]\d*)$/.exec(value);
    if (value !== "*" && value !== "adlib" && (!match
      || (match[1] !== "*" && !validSearchInteger(match[1]))
      || (match[2] !== "*" && !validSearchInteger(match[2])))) {
      errors.push(diagnostic("search-setting-invalid", start, end, { type }));
      return null;
    }
    return { type, value };
  }
  if (["M", "MH"].includes(type)) {
    const parts = value.split("|");
    const target = parts[0];
    const relation = parts[1];
    const relationPattern = /^(?:bb|b|#|x|n)?(?:I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii)$/;
    const targetReference = parseTonalReference(target, { query: true });
    if (parts.length !== 2 || !targetReference || targetReference.kind === "mode"
      || (relation !== "*" && (!relationPattern.test(relation) || (options.romanConfig && !options.romanConfig.basics.has(relation))))) {
      errors.push(diagnostic("search-setting-invalid", start, end, { type }));
      return null;
    }
    return { type, target, relation };
  }
  if (type === "MM") {
    if (value === "*") return { type, any: true };
    const match = /^(\*|[1-9]\d*)\s*\/\s*(\*|[1-9]\d*)\s*=\s*(\*|[1-9]\d*)\s*\/\s*(\*|[1-9]\d*)$/.exec(value);
    if (!match || match.slice(1).some((part) => part !== "*" && !validSearchInteger(part))) {
      errors.push(diagnostic("search-setting-invalid", start, end, { type }));
      return null;
    }
    return { type, any: false, fromNumerator: match[1], fromDenominator: match[2], toNumerator: match[3], toDenominator: match[4] };
  }
  if (type === "BPM") {
    if (value === "*") return { type, any: true };
    const match = /^(\*|[1-9]\d*)\s*\/\s*(\*|[1-9]\d*)\s*=\s*(\*|\d+(?:\.\d+)?|\[([1-9]\d*)~([1-9]\d*)\])$/.exec(value);
    if (!match
      || (match[1] !== "*" && !validSearchInteger(match[1]))
      || (match[2] !== "*" && !validSearchInteger(match[2]))
      || (match[4] && (!validSearchInteger(match[4]) || !validSearchInteger(match[5]) || Number(match[4]) > Number(match[5])))
      || (!match[4] && match[3] !== "*" && (!Number.isFinite(Number(match[3])) || Number(match[3]) <= 0))) {
      errors.push(diagnostic("search-setting-invalid", start, end, { type }));
      return null;
    }
    return {
      type,
      any: false,
      beatNumerator: match[1],
      beatDenominator: match[2],
      tempo: match[4]
        ? { kind: "range", minimum: Number(match[4]), maximum: Number(match[5]) }
        : match[3] === "*" ? { kind: "any" } : { kind: "exact", value: Number(match[3]) },
    };
  }
  errors.push(diagnostic("search-setting-unknown", start, end, { type }));
  return null;
}

function normalizeSettingChoice(type, branches) {
  const unique = normalizeChoiceBranches(branches);
  if (type === "TC") {
    return unique.filter((branch) => {
      const reference = parseTonalReference(branch.value, { query: true });
      if (!reference || reference.kind === "any") return true;
      return !unique.some((other) => {
        const wildcard = parseTonalReference(other.value, { query: true });
        return wildcard?.kind === "any" && wildcard.ambiguous === reference.ambiguous;
      });
    });
  }
  const wildcard = unique.find((branch) => branch.any === true || branch.value === "*");
  if (!wildcard) return unique;
  return [wildcard];
}

function parseSettingConstraint(content, start, options, errors, context, { allowOr = true } = {}) {
  const separator = content.indexOf(":");
  if (separator === -1) {
    errors.push(diagnostic("search-setting-invalid", start, start + content.length + 2));
    return null;
  }
  const type = content.slice(0, separator).trim().toUpperCase();
  const rawValue = content.slice(separator + 1);
  const leading = rawValue.length - rawValue.trimStart().length;
  const value = rawValue.trim();
  const valueStart = start + 1 + separator + 1 + leading;
  if (allowOr && value.includes("||")) {
    if (!["TC", "TS", "MM", "BPM"].includes(type)) {
      errors.push(diagnostic("search-or-invalid", valueStart, valueStart + value.length));
      return null;
    }
    const branches = wholeOrGroup(value, valueStart, errors, context.or);
    if (!branches) {
      errors.push(diagnostic("search-or-invalid", valueStart, valueStart + value.length));
      return null;
    }
    const parsed = branches.map((branch) => parseSettingSingle(type, branch.value, branch.start, branch.end, options, errors)).filter(Boolean);
    if (!parsed.length) return null;
    return { type, kind: "choice", branches: normalizeSettingChoice(type, parsed) };
  }
  return parseSettingSingle(type, value, start, start + content.length + 2, options, errors);
}

function parseNewRiemannianSingle(value, start, end, errors) {
  if (value === "*") return { kind: "any" };
  if (/^[PLR]{1,6}$/.test(value) || /^[NSH]$/.test(value)) return { kind: "exact", value };
  if (!/^[PLR?*]+$/.test(value)) {
    errors.push(diagnostic("search-new-riemannian-invalid", start, end));
    return null;
  }
  const parts = [...value].map((character) => character === "?"
    ? { kind: "one" }
    : character === "*" ? { kind: "many1" } : { kind: "literal", value: character });
  const minimumLength = parts.reduce((sum, part) => sum + (part.kind === "literal" || part.kind === "one" || part.kind === "many1" ? 1 : 0), 0);
  if (minimumLength > 6) {
    errors.push(diagnostic("search-new-riemannian-invalid", start, end));
    return null;
  }
  return { kind: "pattern", source: value, parts };
}

function parseNewRiemannianConstraint(content, start, errors, context) {
  const entry = /^\s*NR\s*:\s*(.*?)\s*$/.exec(content);
  if (!entry) return null;
  const value = entry[1];
  const relativeStart = content.indexOf(value);
  const valueStart = start + 1 + relativeStart;
  if (value.includes("||")) {
    const branches = wholeOrGroup(value, valueStart, errors, context.or);
    if (!branches) {
      errors.push(diagnostic("search-or-invalid", valueStart, valueStart + value.length));
      return { invalid: true };
    }
    const parsed = branches.map((branch) => parseNewRiemannianSingle(branch.value, branch.start, branch.end, errors)).filter(Boolean);
    const normalized = normalizeChoiceBranches(parsed);
    const any = normalized.find((branch) => branch.kind === "any");
    return { kind: "choice", branches: any ? [any] : normalized };
  }
  return parseNewRiemannianSingle(value, valueStart, valueStart + value.length, errors) ?? { invalid: true };
}

function parseQueryEvent(part, offset, options, errors, context) {
  const trimmed = trimSpan(part, offset);
  const source = trimmed.value;
  const event = {
    start: trimmed.start,
    end: trimmed.end,
    tags: [],
    tonalCenter: null,
    timeSignature: null,
    modulation: null,
    metricModulation: null,
    bpm: null,
    newRiemannian: null,
    harmony: null,
  };
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const opener = source[cursor];
    if (opener === "[") {
      const end = source.indexOf("]", cursor + 1);
      const content = end === -1 ? "" : source.slice(cursor + 1, end);
      if (!/^\s*NR\s*:/.test(content)) break;
      if (end === -1) {
        errors.push(diagnostic("search-token-unclosed", trimmed.start + cursor, trimmed.end, { opener }));
        return null;
      }
      const constraint = parseNewRiemannianConstraint(content, trimmed.start + cursor, errors, context);
      if (event.newRiemannian) errors.push(diagnostic("search-setting-duplicate", trimmed.start + cursor, trimmed.start + end + 1, { type: "NR" }));
      else if (constraint && !constraint.invalid) event.newRiemannian = constraint;
      cursor = end + 1;
      continue;
    }
    if (!["<", "{"].includes(opener)) break;
    const closer = opener === "<" ? ">" : "}";
    const end = source.indexOf(closer, cursor + 1);
    if (end === -1) {
      errors.push(diagnostic("search-token-unclosed", trimmed.start + cursor, trimmed.end, { opener }));
      return null;
    }
    const content = source.slice(cursor + 1, end);
    if (opener === "<") {
      const tag = parseTagConstraint(content, trimmed.start + cursor, options, errors, {}, context);
      if (tag) event.tags.push(tag);
    } else {
      const setting = parseSettingConstraint(content, trimmed.start + cursor, options, errors, context);
      if (setting) {
        const key = setting.type === "TC" ? "tonalCenter"
          : setting.type === "TS" ? "timeSignature"
            : setting.type === "MM" ? "metricModulation"
              : setting.type === "BPM" ? "bpm" : "modulation";
        if (event[key]) errors.push(diagnostic("search-setting-duplicate", trimmed.start + cursor, trimmed.start + end + 1, { type: setting.type }));
        else event[key] = setting;
      }
    }
    cursor = end + 1;
  }
  const remainder = source.slice(cursor).trim();
  if (remainder) {
    const remainderStart = trimmed.start + cursor + (source.slice(cursor).length - source.slice(cursor).trimStart().length);
    event.harmony = parseHarmonyConstraint(remainder, remainderStart, options, errors, context);
  }
  if (!event.tags.length && !event.tonalCenter && !event.timeSignature && !event.modulation
    && !event.metricModulation && !event.bpm && !event.newRiemannian && !event.harmony) {
    errors.push(diagnostic("search-empty-event", trimmed.start, trimmed.end));
    return null;
  }
  return event;
}

function parseQueryItem(part, offset, options, errors, context) {
  const trimmed = trimSpan(part, offset);
  const branches = wholeOrGroup(trimmed.value, trimmed.start, errors, context.or);
  if (!branches) return parseQueryEvent(part, offset, options, errors, context);
  const parsed = [];
  for (const branch of branches) {
    if (branch.value.includes("!")) {
      const bang = branch.start + branch.value.indexOf("!");
      errors.push(diagnostic("search-not-invalid", bang, bang + 1));
      continue;
    }
    if (splitTopLevel(branch.value, ",").length !== 1) {
      errors.push(diagnostic("search-or-event-span", branch.start, Math.max(branch.start + 1, branch.end)));
      continue;
    }
    const event = parseQueryEvent(branch, 0, options, errors, context);
    if (event) parsed.push(event);
  }
  return parsed.length ? { kind: "choice", branches: normalizeChoiceBranches(parsed), start: trimmed.start, end: trimmed.end } : null;
}

function parseOptions(source, start, parserOptions, errors, context) {
  const result = { notIgnoreSecondary: false, notAllowDifferentNotation: false, globalTags: [] };
  const seenGlobalTags = new Set();
  const pattern = /\S+/g;
  for (const match of source.matchAll(pattern)) {
    const token = match[0];
    const tokenStart = start + match.index;
    if (token === "--notallowdifferentnotation") {
      if (result.notAllowDifferentNotation) errors.push(diagnostic("search-option-duplicate", tokenStart, tokenStart + token.length, { option: token }));
      result.notAllowDifferentNotation = true;
      continue;
    }
    if (token === "--notignore2nd") {
      if (result.notIgnoreSecondary) errors.push(diagnostic("search-option-duplicate", tokenStart, tokenStart + token.length, { option: token }));
      result.notIgnoreSecondary = true;
      continue;
    }
    if (token.startsWith("--globaltag:")) {
      const tagSource = token.slice("--globaltag:".length);
      if (!tagSource.startsWith("<") || !tagSource.endsWith(">")) {
        errors.push(diagnostic("search-global-tag-option", tokenStart, tokenStart + token.length));
        continue;
      }
      const tag = parseTagConstraint(
        tagSource.slice(1, -1),
        tokenStart + "--globaltag:".length,
        parserOptions,
        errors,
        { allowSequence: false },
        context,
      );
      if (!tag) continue;
      const identity = JSON.stringify(tag);
      if (seenGlobalTags.has(identity)) errors.push(diagnostic("search-option-duplicate", tokenStart, tokenStart + token.length, { option: "--globaltag" }));
      else {
        seenGlobalTags.add(identity);
        result.globalTags.push(tag);
      }
      continue;
    }
    errors.push(diagnostic("search-option-unknown", tokenStart, tokenStart + token.length, { option: token }));
  }
  if (result.globalTags.length > MSTRUCT_SEARCH_QUERY_LIMITS.globalTags) {
    errors.push(diagnostic("search-global-tag-limit", start, start + source.length, { limit: MSTRUCT_SEARCH_QUERY_LIMITS.globalTags }));
  }
  return result;
}

function patternWorkScore(pattern) {
  if (!pattern) return 0;
  if (pattern.kind === "exclude") return 3 + patternWorkScore(pattern.include)
    + pattern.exclude.reduce((sum, branch) => sum + patternWorkScore(branch), 0);
  if (pattern.kind === "note-set") return 2 + pattern.masks.length * 2;
  if (pattern.kind === "chord-set") return 2 + pattern.variants.length * 2 + pattern.sources.length * 2;
  if (["wildcard", "relative-wildcard", "choice-pattern"].includes(pattern.kind)) {
    const visit = (parts) => parts.reduce((sum, part) => sum + 1
      + (["one", "many", "many1", "relative"].includes(part.kind) ? 2 : 0)
      + (part.kind === "choice" ? part.branches.reduce((branchSum, branch) => branchSum + visit(branch), part.branches.length * 2) : 0), 0);
    return 2 + visit(pattern.parts ?? []);
  }
  return 2 + (pattern.atoms?.length ?? 0);
}

function eventWorkScore(event) {
  if (event?.kind === "choice") return 2 + event.branches.length * 2 + event.branches.reduce((sum, branch) => sum + eventWorkScore(branch), 0);
  if (!event) return 0;
  let score = 1 + event.tags.length * 2;
  for (const constraint of [event.tonalCenter, event.timeSignature, event.modulation, event.metricModulation, event.bpm, event.newRiemannian]) {
    if (!constraint) continue;
    score += 2;
    if (constraint.kind === "choice") score += constraint.branches.length * 2;
    if (constraint.kind === "pattern") score += constraint.parts.length * 2;
  }
  if (event.harmony) score += 2 + patternWorkScore(event.harmony.chord) + patternWorkScore(event.harmony.roman);
  return score;
}

function hasObviousAnchor(event) {
  if (event?.kind === "choice") return event.branches.every(hasObviousAnchor);
  if (!event) return false;
  if (event.tags.length || event.tonalCenter || event.timeSignature || event.modulation
    || event.metricModulation || event.bpm || event.newRiemannian || event.harmony?.special) return true;
  return [event.harmony?.chord, event.harmony?.roman].map(positiveFieldPattern).some((field) => field
    && (["source", "atoms", "note-set", "chord-set", "placeholder", "roman-cad-family"].includes(field.kind) || field.anchorMasks?.length));
}

function queryWorkScore(events, queryOptions, context) {
  const base = events.reduce((sum, event) => sum + eventWorkScore(event), 0)
    + queryOptions.globalTags.length * 2
    + context.or.groups * 2
    + context.or.branches * 2;
  return base + (events.some(hasObviousAnchor) || queryOptions.globalTags.length ? 0 : 32);
}

/** @returns {any} */
export function parseMstructSearchQuery(input, options = {}) {
  const source = String(input ?? "").replace(/\r\n?/g, "\n").trim();
  const errors = [];
  const context = { or: { groups: 0, branches: 0 }, notGroups: 0 };
  const emptyOptions = { notIgnoreSecondary: false, notAllowDifferentNotation: false, globalTags: [] };
  if (source.length > MSTRUCT_SEARCH_QUERY_LIMITS.sourceLength) {
    errors.push(diagnostic("search-query-too-long", 0, source.length, { limit: MSTRUCT_SEARCH_QUERY_LIMITS.sourceLength }));
    return { source, events: [], options: emptyOptions, errors, ok: false, workScore: 0, normalizedKey: "" };
  }
  if (!source) return { source, events: [], options: emptyOptions, errors, ok: true, workScore: 0, normalizedKey: "" };

  const boundary = optionBoundary(source);
  const eventSource = (boundary === -1 ? source : source.slice(0, boundary)).trimEnd();
  const optionSource = boundary === -1 ? "" : source.slice(boundary);
  const queryOptions = parseOptions(optionSource, boundary === -1 ? source.length : boundary, options, errors, context);
  const eventParts = eventSource ? splitTopLevel(eventSource, ",") : [];
  if (eventParts.length > MSTRUCT_SEARCH_QUERY_LIMITS.events) {
    errors.push(diagnostic("search-event-limit", 0, eventSource.length, { limit: MSTRUCT_SEARCH_QUERY_LIMITS.events }));
  }
  const events = eventParts.map((part) => {
    if (!part.value.trim()) {
      errors.push(diagnostic("search-empty-event", part.start, Math.max(part.start + 1, part.end)));
      return null;
    }
    const event = parseQueryItem(part, 0, options, errors, context);
    function compileChord(event) {
      if (event?.kind === "choice") event.branches.forEach(compileChord);
      else if (event?.harmony?.chord) event.harmony.chord = compileChordSearchPattern(event.harmony.chord, options, !queryOptions.notAllowDifferentNotation);
    }
    if (event) compileChord(event);
    return event;
  }).filter(Boolean);
  if (context.or.groups > MSTRUCT_SEARCH_QUERY_LIMITS.orGroups || context.or.branches > MSTRUCT_SEARCH_QUERY_LIMITS.orBranchesTotal) {
    errors.push(diagnostic("search-or-limit", 0, eventSource.length, {
      groupLimit: MSTRUCT_SEARCH_QUERY_LIMITS.orGroups,
      branchLimit: MSTRUCT_SEARCH_QUERY_LIMITS.orBranchesTotal,
    }));
  }
  const workScore = queryWorkScore(events, queryOptions, context);
  if (context.notGroups > MSTRUCT_SEARCH_QUERY_LIMITS.notGroups) {
    errors.push(diagnostic("search-not-limit", 0, eventSource.length, { limit: MSTRUCT_SEARCH_QUERY_LIMITS.notGroups }));
  }
  if (workScore > MSTRUCT_SEARCH_QUERY_LIMITS.workScore) {
    errors.push(diagnostic("search-query-too-complex", 0, eventSource.length, { limit: MSTRUCT_SEARCH_QUERY_LIMITS.workScore, score: workScore }));
  }
  const normalizedKey = stableStringify(semanticChoiceValue({ events, options: queryOptions }));
  return { source, events, options: queryOptions, errors, ok: errors.length === 0, workScore, normalizedKey };
}
