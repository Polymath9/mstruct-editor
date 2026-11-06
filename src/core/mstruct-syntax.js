import { makeError } from "./mstruct-diagnostics.js";
import { parseFraction } from "./mstruct-rational.js";
import { parseBpmValue, parseMetricModulationValue } from "./mstruct-tempo.js";
import { parseTonalReference } from "./tonal-reference.js";
import { CLUSTER_SYMBOLS } from "./cluster-symbol.js";

const SETTING_TYPES = new Set(["BN", "T", "BPM", "BPMHIDDEN", "MM", "TEMPO", "TS", "TC", "D", "M", "MH"]);
const EVENT_TYPES = new Set(["C", "R"]);
const ANNOTATION_DELIMITER = "\\\\";
export const STANDALONE_EVENT_TYPES = new Map([
  ["X", "placeholder"],
  ["0", "rest"],
  ["-", "continuation"],
  ["N.C.", "no-chord"],
  ...[...CLUSTER_SYMBOLS].map(([symbol, { type }]) => [symbol, type]),
]);
export const FIELD_EVENT_TYPES = new Map([
  ["X", "placeholder"],
  ["-", "continuation"],
]);

function assignFieldEventTypes(event) {
  event.chordSymbolType = FIELD_EVENT_TYPES.get(event.chord) ?? CLUSTER_SYMBOLS.get(event.chord)?.type ?? null;
  event.romanSymbolType = FIELD_EVENT_TYPES.get(event.roman) ?? null;
  return event;
}

export function readDelimited(source, index, opener, closer, nested = false) {
  if (source[index] !== opener) return null;
  if (!nested) {
    const end = source.indexOf(closer, index + 1);
    if (end === -1) return { content: source.slice(index + 1), start: index, end: source.length, closed: false };
    return { content: source.slice(index + 1, end), start: index, end: end + 1, closed: true };
  }
  let depth = 1;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === opener) depth += 1;
    if (source[cursor] !== closer) continue;
    depth -= 1;
    if (depth === 0) return { content: source.slice(index + 1, cursor), start: index, end: cursor + 1, closed: true };
  }
  return { content: source.slice(index + 1), start: index, end: source.length, closed: false };
}

export function splitTopLevel(value, delimiter) {
  const parts = [];
  let start = 0;
  let squareDepth = 0;
  let roundDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "[") squareDepth += 1;
    else if (character === "]" && squareDepth > 0) squareDepth -= 1;
    else if (character === "(") roundDepth += 1;
    else if (character === ")" && roundDepth > 0) roundDepth -= 1;
    else if (character === delimiter && squareDepth === 0 && roundDepth === 0) {
      parts.push({ content: value.slice(start, index), start, end: index });
      start = index + 1;
    }
  }
  parts.push({ content: value.slice(start), start, end: value.length });
  return parts;
}

export function trimFieldPart(value, absoluteStart) {
  const leading = value.length - value.trimStart().length;
  const content = value.trim();
  const start = absoluteStart + leading;
  return { content, start, end: start + content.length };
}

export function splitAnnotationField(value, absoluteStart, source, errors, field) {
  const first = value.indexOf(ANNOTATION_DELIMITER);
  if (first === -1) {
    const main = trimFieldPart(value, absoluteStart);
    return { main, annotation: null };
  }
  const second = value.indexOf(ANNOTATION_DELIMITER, first + ANNOTATION_DELIMITER.length);
  if (second !== -1) {
    makeError(
      errors,
      source,
      "annotation-count",
      absoluteStart + second,
      absoluteStart + second + ANNOTATION_DELIMITER.length,
      { field },
    );
    return null;
  }
  const main = trimFieldPart(value.slice(0, first), absoluteStart);
  const annotation = trimFieldPart(
    value.slice(first + ANNOTATION_DELIMITER.length),
    absoluteStart + first + ANNOTATION_DELIMITER.length,
  );
  if (!main.content || !annotation.content) {
    const emptyStart = !main.content ? absoluteStart : absoluteStart + first + ANNOTATION_DELIMITER.length;
    makeError(
      errors,
      source,
      "annotation-empty",
      emptyStart,
      Math.max(emptyStart + 1, absoluteStart + value.length),
      { field },
    );
    return null;
  }
  return { main, annotation };
}

export function parseSetting(token, source, errors) {
  const shorthandDuration = token.content.trim();
  if (/^\d+(?:\s*\/\s*\d+)?$/.test(shorthandDuration)) {
    if (!(parseFraction(shorthandDuration)?.numerator > 0)) {
      makeError(errors, source, "invalid-division", token.start, token.end);
      return null;
    }
    return {
      type: "D",
      value: shorthandDuration,
      start: token.start,
      end: token.end,
    };
  }

  const separator = /^\s*([A-Za-z]+)\s*([:=])\s*(.*?)\s*$/.exec(token.content);
  if (!separator) {
    makeError(errors, source, "invalid-setting", token.start, token.end);
    return null;
  }

  const [, rawType, delimiter, value] = separator;
  const type = rawType.toUpperCase();
  if (!SETTING_TYPES.has(type)) {
    makeError(errors, source, "unknown-setting", token.start, token.end, { details: { type: rawType } });
    return null;
  }
  if (type !== "T" && delimiter !== ":") {
    makeError(errors, source, "setting-delimiter", token.start, token.end, { details: { type } });
    return null;
  }
  if (!value) {
    makeError(errors, source, "missing-value", token.start, token.end, { details: { type } });
    return null;
  }

  if (type === "BN" && !/^\d+$/.test(value)) {
    makeError(errors, source, "invalid-bar-number", token.start, token.end);
    return null;
  }
  if (type === "D" && !(parseFraction(value)?.numerator > 0)) {
    makeError(errors, source, "invalid-division", token.start, token.end);
    return null;
  }
  if (type === "TS") {
    const signature = value === "adlib" ? "adlib" : parseFraction(value);
    if (!signature || (signature !== "adlib" && signature.numerator <= 0)) {
      makeError(errors, source, "invalid-time-signature", token.start, token.end);
      return null;
    }
  }
  if (type === "T") {
    if (!/^\d+:[0-5]\d(?::[0-5]\d)?$/.test(value)) {
      makeError(errors, source, "invalid-time", token.start, token.end);
      return null;
    }
  }
  if (["BPM", "BPMHIDDEN"].includes(type) && !parseBpmValue(value)) {
    makeError(errors, source, "invalid-bpm", token.start, token.end, { details: { type } });
    return null;
  }
  if (type === "MM" && !parseMetricModulationValue(value)) {
    makeError(errors, source, "invalid-mm", token.start, token.end);
    return null;
  }
  if (type === "TC" && value !== "None" && !parseTonalReference(value)) {
    makeError(errors, source, "invalid-tonal-center", token.start, token.end);
    return null;
  }

  if (["M", "MH"].includes(type)) {
    const modulation = /^([^|]+)\|((?:bb|b|#|x|n)?(?:I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii))$/.exec(value);
    if (!modulation || !parseTonalReference(modulation[1])) {
      makeError(
        errors,
        source,
        "invalid-modulation-setting",
        token.start,
        token.end,
        { details: { type } },
      );
      return null;
    }
    const valueOffset = token.content.indexOf(value);
    const relationOffset = value.indexOf("|") + 1;
    return {
      type,
      value,
      targetTonalCenter: modulation[1],
      relation: modulation[2],
      relationStart: token.start + 1 + valueOffset + relationOffset,
      relationEnd: token.start + 1 + valueOffset + value.length,
      targetStart: token.start + 1 + valueOffset,
      targetEnd: token.start + 1 + valueOffset + modulation[1].length,
      start: token.start,
      end: token.end,
    };
  }

  return { type, value, start: token.start, end: token.end };
}

export function parseControlMarker(token, source, errors) {
  const content = token.content.trim();
  const simple = { "||:": "repeat-start", "||": "double-bar", "||END": "final-bar" }[content];
  if (simple) return { kind: simple, start: token.start, end: token.end };
  if (content === ":||") {
    return {
      kind: "repeat-end",
      repeatCount: 1,
      repeatCountExplicit: false,
      continueBarNumbers: false,
      start: token.start,
      end: token.end,
    };
  }
  if (content.startsWith(":||")) {
    const repeat = /^:\|\|(?:(\d+)x)?(>>)?$/.exec(content);
    if (!repeat) {
      makeError(errors, source, "repeat-syntax", token.start, token.end);
      return { kind: "invalid-control", start: token.start, end: token.end };
    }
    const repeatCountExplicit = repeat[1] !== undefined;
    const repeatCount = repeatCountExplicit ? Number(repeat[1]) : 1;
    if (repeatCountExplicit && (repeatCount < 2 || repeatCount > 1000)) {
      makeError(errors, source, "repeat-count", token.start, token.end);
      return { kind: "invalid-control", start: token.start, end: token.end };
    }
    return {
      kind: "repeat-end",
      repeatCount,
      repeatCountExplicit,
      continueBarNumbers: Boolean(repeat[2]),
      start: token.start,
      end: token.end,
    };
  }
  if (/^\/ENDING$/i.test(content)) return { kind: "ending-end", number: null, numbers: null, start: token.start, end: token.end };
  const ending = /^(\/?ENDING):(.*)$/i.exec(content);
  if (!ending) return null;
  const numberParts = ending[2].split(",");
  if (!numberParts.length || numberParts.some((value) => !/^[1-9]\d*$/.test(value))) {
    makeError(errors, source, "ending-number", token.start, token.end);
    return { kind: "invalid-control", start: token.start, end: token.end };
  }
  const numbers = numberParts.map(Number);
  if (numbers.some((value) => value > 1000)) {
    makeError(errors, source, "ending-number", token.start, token.end);
    return { kind: "invalid-control", start: token.start, end: token.end };
  }
  if (numbers.some((value, index) => index > 0 && value <= numbers[index - 1])) {
    makeError(errors, source, "ending-number-order", token.start, token.end);
    return { kind: "invalid-control", start: token.start, end: token.end };
  }
  return {
    kind: ending[1].startsWith("/") ? "ending-end" : "ending-start",
    number: numbers.length === 1 ? numbers[0] : null,
    numbers,
    start: token.start,
    end: token.end,
  };
}

export function applyControlMarker({ marker, measure, slot, state, source, errors }) {
  if (marker.kind === "invalid-control") return;
  const atMeasureStart = measure.slots.length === 0 && measure.duration.numerator === 0;
  const hasEvent = slot.events.length > 0;
  if (marker.kind === "final-bar") {
    if (!source.slice(marker.end).trimStart().startsWith(";")
      || (!hasEvent && !measure.slots.at(-1)?.events.length)) {
      makeError(errors, source, "final-bar-position", marker.start, marker.end);
      return;
    }
    if (slot.markersAfter.some((item) => ["double-bar", "repeat-start", "repeat-end"].includes(item.kind))) {
      makeError(errors, source, "final-bar-conflict", marker.start, marker.end);
      return;
    }
    measure.finalBar = marker;
    slot.closedByControl = true;
    return;
  }
  const before = marker.kind === "repeat-start" || marker.kind === "ending-start"
    || (marker.kind === "repeat-end" && !hasEvent)
    || (marker.kind === "double-bar" && !hasEvent);
  if (before && (hasEvent || slot.closedByControl || (marker.kind === "double-bar" && !atMeasureStart)
    || (marker.kind === "repeat-end" && !atMeasureStart))) {
    makeError(errors, source, "control-marker-position", marker.start, marker.end);
    return;
  }
  if (!before && (!hasEvent || (marker.kind === "double-bar" && !source.slice(marker.end).trimStart().startsWith(";")))) {
    makeError(errors, source, "control-marker-position", marker.start, marker.end);
    return;
  }
  marker.savedState = {
    division: state.division,
    timeSignature: state.timeSignature,
    bpm: state.bpm,
    explicitBpm: state.explicitBpm,
    bpmModulated: state.bpmModulated,
  };
  (before ? slot.markersBefore : slot.markersAfter).push(marker);
  if (!before) slot.closedByControl = true;
}

export function parseEvent(token, source, errors) {
  const event = { chord: null, chordResult: null, chordStart: null, chordEnd: null, chordSymbolType: null, roman: null, romanResult: null, romanStart: null, romanEnd: null, romanSymbolType: null, symbol: null, symbolType: null, start: token.start, end: token.end };
  if (splitTopLevel(token.content, ",").length > 1) {
    makeError(errors, source, "event-delimiter", token.start, token.end);
    return null;
  }
  const parts = splitTopLevel(token.content, "|");
  if (!parts.length || !token.content.trim()) {
    makeError(errors, source, "empty-event", token.start, token.end);
    return null;
  }
  if (parts.length > 2) {
    makeError(errors, source, "event-delimiter", token.start, token.end);
    return null;
  }

  for (const part of parts) {
    const entry = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(part.content);
    if (!entry || !entry[2]) {
      makeError(errors, source, "invalid-event", token.start, token.end);
      return null;
    }
    const type = entry[1].toUpperCase();
    const value = entry[2];
    if (!EVENT_TYPES.has(type)) {
      makeError(errors, source, "unknown-event", token.start, token.end, { details: { type: entry[1] } });
      return null;
    }
    if (type === "C") {
      if (event.chord !== null) {
        makeError(errors, source, "duplicate-chord", token.start, token.end);
        return null;
      }
      event.chord = value;
      const colon = part.content.indexOf(":");
      const afterColon = part.content.slice(colon + 1);
      const leadingSpace = afterColon.length - afterColon.trimStart().length;
      event.chordStart = token.start + 1 + part.start + colon + 1 + leadingSpace;
      event.chordEnd = event.chordStart + value.length;
    }
    if (type === "R") {
      if (event.roman !== null) {
        makeError(errors, source, "duplicate-roman", token.start, token.end);
        return null;
      }
      event.roman = value;
      const colon = part.content.indexOf(":");
      const afterColon = part.content.slice(colon + 1);
      const leadingSpace = afterColon.length - afterColon.trimStart().length;
      event.romanStart = token.start + 1 + part.start + colon + 1 + leadingSpace;
      event.romanEnd = event.romanStart + value.length;
    }
  }
  return assignFieldEventTypes(event);
}

export function parseSecondaryEvent(token, source, errors) {
  const leading = token.content.length - token.content.trimStart().length;
  const content = token.content.trim();
  const contentStart = token.start + 1 + leading;
  if (!content) {
    makeError(errors, source, "invalid-secondary-event", token.start, token.end);
    return null;
  }
  let event;
  if (content.startsWith("[")) {
    if (!content.endsWith("]")) {
      makeError(errors, source, "invalid-secondary-event", token.start, token.end);
      return null;
    }
    event = parseEvent({
      content: content.slice(1, -1),
      start: contentStart,
      end: contentStart + content.length,
      closed: true,
    }, source, errors);
  } else {
    event = parseShorthandEvent({
      content,
      start: contentStart,
      end: contentStart + content.length,
    }, source, errors);
  }
  const hasFieldMarker = event && (FIELD_EVENT_TYPES.has(event.chord) || FIELD_EVENT_TYPES.has(event.roman));
  if (!event || event.symbol || hasFieldMarker || (!event.chord && !event.roman)) {
    if (event?.symbol || hasFieldMarker) makeError(errors, source, "invalid-secondary-event", token.start, token.end);
    return null;
  }
  event.secondary = true;
  event.start = token.start;
  event.end = token.end;
  return event;
}

export function parseShorthandEvent(token, source, errors) {
  const shorthand = token.content.trim();
  const symbolType = STANDALONE_EVENT_TYPES.get(shorthand);
  if (symbolType) {
    return {
      chord: null,
      chordResult: null,
      chordStart: null,
      chordEnd: null,
      chordSymbolType: null,
      roman: null,
      romanResult: null,
      romanStart: null,
      romanEnd: null,
      romanSymbolType: null,
      symbol: shorthand,
      symbolType,
      start: token.start,
      end: token.end,
    };
  }

  const parts = splitTopLevel(token.content, "|");
  if (parts.length !== 2) {
    makeError(errors, source, "invalid-shorthand-event", token.start, token.end);
    return null;
  }
  const chord = parts[0].content.trim();
  const roman = parts[1].content.trim();
  if (!chord && !roman) {
    makeError(errors, source, "empty-event", token.start, token.end);
    return null;
  }
  return assignFieldEventTypes({
    chord: chord || null,
    chordResult: null,
    chordStart: chord ? token.start + parts[0].start + (parts[0].content.length - parts[0].content.trimStart().length) : null,
    chordEnd: chord ? token.start + parts[0].start + (parts[0].content.length - parts[0].content.trimStart().length) + chord.length : null,
    chordSymbolType: null,
    roman: roman || null,
    romanResult: null,
    romanStart: roman ? token.start + parts[1].start + (parts[1].content.length - parts[1].content.trimStart().length) : null,
    romanEnd: roman ? token.start + parts[1].start + (parts[1].content.length - parts[1].content.trimStart().length) + roman.length : null,
    romanSymbolType: null,
    symbol: null,
    symbolType: null,
    start: token.start,
    end: token.end,
  });
}
