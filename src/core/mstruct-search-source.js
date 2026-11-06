import { parseChordSymbol } from "./chord-symbol.js";
import { validateRomanSearchSource } from "./roman-symbol.js";
import { romanFigureValidationSource } from "./mstruct-search-roman.js";
import { CLUSTER_SYMBOLS } from "./cluster-symbol.js";

/** A placeholder is used only to check special-chord syntax, never as a semantic result. */
export function validateExactHarmonySearchSource(domain, source) {
  if (domain === "roman") {
    validateRomanSearchSource(romanFigureValidationSource(source));
    return source;
  }
  if (CLUSTER_SYMBOLS.has(source)) return source;
  const specials = new Map();
  for (const match of source.matchAll(/\[sp:([a-z][a-z0-9_-]*)\]/gi)) {
    specials.set(match[1], { compilerName: match[1], displayName: match[1], intervals: ["1", "3", "5"] });
  }
  parseChordSymbol(source, { specialChords: specials });
  return source;
}
