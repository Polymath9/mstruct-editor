import { parseChordSymbol } from "./chord-symbol.js";
import { parseRomanSymbol } from "./roman-symbol.js";
import { chordSymbolModel, romanSymbolModel } from "./symbol-render-model.js";

export const INLINE_MUSIC_SOURCE_LIMIT = 512;

/** @typedef {{ kind: "text", text: string, start: number, end: number } | { kind: "chord" | "roman", source: string, tonalMode: string, tonalCenter: string, raw: string, start: number, end: number, error: string }} InlineMusicPart */

// These tags are plain source text, never HTML. Unknown markup stays text.
/** @returns {InlineMusicPart[]} */
export function parseInlineMusicText(input) {
  const text = String(input ?? "");
  const pattern = /<mstruct_(chord|roman)\b([^<>]*)>([^<>]*)<\/mstruct_\1\s*>/g;
  /** @type {InlineMusicPart[]} */
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push({ kind: "text", text: text.slice(offset, match.index), start: offset, end: match.index });
    const part = { kind: /** @type {"chord" | "roman"} */ (match[1]), source: match[3].trim(), tonalMode: "M", tonalCenter: "", raw: match[0], start: match.index, end: match.index + match[0].length, error: "" };
    let attributes = match[2].trim();
    const seen = new Set();
    while (attributes) {
      const attribute = /^(mode|center)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(attributes);
      if (!attribute || part.kind !== "roman" || seen.has(attribute[1])) { part.error = "attributes"; break; }
      const value = attribute[2] ?? attribute[3];
      seen.add(attribute[1]);
      if (attribute[1] === "mode") {
        if (value !== "M" && value !== "m") part.error = "mode";
        else part.tonalMode = value;
      } else {
        if (!/^[A-G](?:bb|b|#|x)?$/.test(value)) part.error = "center";
        else part.tonalCenter = value;
      }
      attributes = attributes.slice(attribute[0].length);
    }
    if (!part.source || part.source.length > INLINE_MUSIC_SOURCE_LIMIT || /[\r\n]/.test(part.source)) part.error = "source";
    parts.push(part);
    offset = part.end;
  }
  if (offset < text.length) parts.push({ kind: "text", text: text.slice(offset), start: offset, end: text.length });
  return parts;
}

export function inlineMusicSource(kind, attrs) {
  const context = kind === "roman" ? ` mode="${attrs.tonalMode === "m" ? "m" : "M"}"${attrs.tonalCenter ? ` center="${attrs.tonalCenter}"` : ""}` : "";
  return `<mstruct_${kind}${context}>${attrs.source}</mstruct_${kind}>`;
}

export function inlineMusicModel(part, options = {}) {
  try {
    if (part.error) throw new Error(part.error);
    const result = part.kind === "chord"
      ? parseChordSymbol(part.source, { specialChords: options.specialChords, globalSettings: options.globalSettings })
      : parseRomanSymbol(part.source, { config: options.romanConfig, tonalMode: part.tonalMode });
    const symbol = part.kind === "chord" ? chordSymbolModel(result, options.renderMode, options.preferences) : romanSymbolModel(result);
    return { ok: true, model: { tag: "span", className: `mstruct-inline mstruct-inline-${part.kind}`, attrs: { "aria-label": part.source }, children: [symbol] } };
  } catch (error) {
    return { ok: false, error, model: { tag: "span", className: "mstruct-inline-invalid", attrs: { "aria-label": part.source }, children: [part.raw ?? inlineMusicSource(part.kind, part)] } };
  }
}
