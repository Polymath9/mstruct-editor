import { toMusicGlyphs } from "./chord-symbol.js";
import { displayChordParts } from "./note-display.js";
import { romanDisplayGlyphs } from "./roman-symbol.js";
import { CLUSTER_SYMBOLS } from "./cluster-symbol.js";

// A DOM-free description shared by the score, inline embeds and host adapters.
const element = (tag, className, children = [], attrs = {}) => ({ tag, className, children, attrs });

export function clusterSymbolModel(source, mode) {
  const cluster = CLUSTER_SYMBOLS.get(source);
  if (!cluster) return null;
  const children = ["Clus"];
  if (cluster.suffix) children.push(element("span", mode === "normal" ? "cluster-suffix" : "score-chord-sup", [cluster.suffix]));
  return element("span", "event-value cluster-symbol", children);
}

export function notationModel(text, roman = false, accidentalClass = "") {
  const glyphs = roman ? romanDisplayGlyphs(text) : toMusicGlyphs(text);
  return glyphs.split(roman ? /([♮♭♯𝄫𝄪])/u : /([♭♯𝄫𝄪])/u).filter(Boolean).map((token) =>
    /^[♮♭♯𝄫𝄪]$/u.test(token)
      ? element("span", `score-chord-accidental${roman ? " score-roman-accidental" : ""}${accidentalClass ? ` ${accidentalClass}` : ""}`, [token])
      : token);
}

export function chordSymbolModel(result, mode, preferences, center) {
  const parts = displayChordParts(result, mode, preferences, center);
  return element("span", "score-chord-symbol", parts.map((part) => {
    const role = `score-chord-${part.role}${part.role === "separator" && part.text === "on" ? " score-chord-on" : ""}`;
    const accidentalClass = part.accidentalPlacement ? `score-chord-note-accidental-${part.accidentalPlacement}` : "";
    const placementClass = part.superscriptStyle === "roman" ? "score-roman-sup" : part.superscript ? "score-chord-sup" : "score-chord-part";
    return element(part.superscript ? "sup" : "span", `${placementClass} ${role}`, part.notation ? notationModel(part.text, false, accidentalClass) : [part.text]);
  }), { "aria-label": toMusicGlyphs(parts.map(part => part.text).join("")) });
}

function figureStackModel(rows, general = false) {
  const visibleRows = rows.filter(Boolean);
  const hasAccidental = visibleRows.some((value) => /^[♮♭♯𝄫𝄪]/u.test(romanDisplayGlyphs(value)));
  const hasSus = visibleRows.some((value) => String(value).includes("sus"));
  const className = `score-roman-figures${general ? " is-general" : ""}${visibleRows.length === 1 ? " is-single" : ""}${hasAccidental ? " has-accidental" : ""}${hasSus ? " has-sus" : ""}`;
  return element("span", className, visibleRows.map((value) => {
    const notation = romanDisplayGlyphs(value);
    const parts = /^([♮♭♯𝄫𝄪]?)(\d+)$/u.exec(notation);
    const children = [];
    if (parts?.[1]) children.push(element("span", "score-chord-accidental score-roman-accidental score-roman-figure-accidental", [parts[1]]));
    children.push(element("span", "score-roman-figure-number", [parts?.[2] ?? notation]));
    return element("span", "score-roman-figure-row", children);
  }));
}

export function romanSymbolModel(result) {
  const children = [];
  const classes = ["score-roman-symbol"];
  if (result.baseText) children.push(element("span", "score-roman-base", notationModel(result.baseText, true)));
  if (result.superscriptText) children.push(element("sup", "score-roman-sup", notationModel(result.superscriptText, true)));
  if (result.figure) {
    const visibleFigures = [result.figure.upper, result.figure.lower].filter(Boolean);
    const hasSusFigure = visibleFigures.some((value) => String(value).includes("sus"));
    if (hasSusFigure) classes.push("has-sus-figure");
    if (result.superscriptText && visibleFigures.length === 1 && !hasSusFigure) classes.push("has-single-quality-figure");
    if (result.superscriptText && visibleFigures.length === 2 && !hasSusFigure) classes.push("has-stacked-quality-figure");
    children.push(figureStackModel(visibleFigures));
  }
  if (result.generalFigure) {
    const rows = result.generalFigure.figures.map((figure) => figure.text);
    if (rows.length === 3) classes.push("has-three-figure-rows");
    if (rows.length === 4) classes.push("has-four-figure-rows");
    children.push(figureStackModel(rows, true));
  }
  for (const applied of result.applied) {
    children.push(element("span", "score-roman-slash", ["/"]));
    children.push(element("span", "score-roman-applied", notationModel(applied.roman, true)));
  }
  return element("span", classes.join(" "), children, { "aria-label": result.source });
}
