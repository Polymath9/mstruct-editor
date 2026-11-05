import { ChordSyntaxError, parseChordSymbol } from "./chord-symbol.js";
import { makeError } from "./mstruct-diagnostics.js";
import { parseRomanBasicReference, RomanSyntaxError, parseRomanSymbol } from "./roman-symbol.js";
import { STANDALONE_EVENT_TYPES, splitAnnotationField, splitTopLevel, trimFieldPart } from "./mstruct-syntax.js";
import { tonalReferenceMode as tonalMode, tonalReferencePitchClass } from "./tonal-reference.js";
import { collectRomanValidationWarnings } from "./roman-validation.js";

export function tonalPitchClass(value) {
  return tonalReferencePitchClass(value);
}

function romanReferenceMode(value) {
  const letters = String(value ?? "").match(/[IViv]+/u)?.[0] ?? "";
  return letters && letters === letters.toLowerCase() ? "m" : "M";
}

function reportRomanError(error, value, absoluteStart, source, errors) {
  const relativeStart = error instanceof RomanSyntaxError ? error.start : 0;
  const relativeEnd = error instanceof RomanSyntaxError ? error.end : value.length;
  const romanCode = error instanceof RomanSyntaxError ? error.code : "generic";
  const details = error instanceof RomanSyntaxError ? error.details : {};
  const startOffset = Math.min(Math.max(0, relativeStart), Math.max(0, value.length - 1));
  const endOffset = Math.min(value.length, Math.max(startOffset + 1, relativeEnd));
  makeError(
    errors,
    source,
    `roman-${romanCode}`,
    absoluteStart + startOffset,
    absoluteStart + endOffset,
    { domain: "roman", romanCode, details },
  );
}

/** Recommendations are separate from errors and never interrupt compilation or playback. */
export function collectRomanWarnings(measures, source) {
  const warnings = collectRomanValidationWarnings(measures, source);
  for (const measure of measures) for (const slot of measure.slots) for (const event of slot.events) {
    for (const target of event.romanLayers ?? [event]) {
      for (const [resultKey, startKey] of [["romanResult", "romanStart"], ["romanAnnotationResult", "romanAnnotationStart"]]) {
        for (const warning of target[resultKey]?.warnings ?? []) {
          const offset = target[startKey] ?? target.start;
          makeError(warnings, source, `roman-${warning.code}`, offset + warning.start, offset + warning.end,
            { severity: "warning", domain: "roman", romanCode: warning.code, details: warning.details });
        }
      }
    }
  }
  return warnings.sort((left, right) => left.start - right.start || left.end - right.end);
}

function interruptRomanChain(target, state, chainKey, source, errors) {
  const activeChain = state[chainKey];
  if (!activeChain) return;
  if (!target.chord && target.symbolType !== "continuation") {
    makeError(
      errors,
      source,
      "roman-figured-chain-interruption",
      target.start,
      target.end,
      { domain: "roman", romanCode: "figured-chain-interruption" },
    );
    state[chainKey] = null;
  }
}

function compileRomanTarget(target, state, source, errors, romanConfig, tonalCenter, chainKey) {
  if (target.romanSymbolType) {
    if (target.romanSymbolType === "placeholder" && state[chainKey]) {
      makeError(
        errors,
        source,
        "roman-figured-chain-interruption",
        target.romanStart ?? target.start,
        target.romanEnd ?? target.end,
        { domain: "roman", romanCode: "figured-chain-interruption" },
      );
      state[chainKey] = null;
    }
    return;
  }
  if (!target.roman) {
    interruptRomanChain(target, state, chainKey, source, errors);
    return;
  }
  const field = splitAnnotationField(target.roman, target.romanStart ?? target.start, source, errors, "roman");
  if (!field) {
    state[chainKey] = null;
    return;
  }
  target.roman = field.main.content;
  target.romanStart = field.main.start;
  target.romanEnd = field.main.end;
  if (field.annotation) {
    target.romanAnnotation = field.annotation.content;
    target.romanAnnotationStart = field.annotation.start;
    target.romanAnnotationEnd = field.annotation.end;
  }
  if (!romanConfig || !tonalCenter) return;

  const activeChain = state[chainKey];
  const isPureFigure = target.roman.startsWith("[");
  if (activeChain && !isPureFigure) {
    makeError(
      errors,
      source,
      "roman-figured-chain-interruption",
      target.romanStart,
      target.romanEnd,
      { domain: "roman", romanCode: "figured-chain-interruption" },
    );
    state[chainKey] = null;
  }

  try {
    const chainContext = activeChain && isPureFigure ? {
      rootDegree: activeChain.rootDegree,
      figureCount: activeChain.figureCount,
      applied: activeChain.applied,
    } : null;
    target.romanResult = parseRomanSymbol(target.roman, {
      config: romanConfig,
      tonalMode: tonalMode(tonalCenter),
      chainContext,
    });
    const figure = target.romanResult.generalFigure;
    if (figure) {
      const chainId = activeChain && isPureFigure ? activeChain.id : state.nextRomanChainId++;
      const chainIndex = activeChain && isPureFigure ? activeChain.nextIndex : 0;
      target.romanFigureChain = {
        id: chainId,
        index: chainIndex,
        count: figure.figures.length,
        link: figure.link,
        pure: figure.pure,
      };
      if (figure.link === "continue") {
        state[chainKey] = {
          id: chainId,
          nextIndex: chainIndex + 1,
          rootDegree: target.romanResult.baseDegree,
          figureCount: figure.figures.length,
          applied: target.romanResult.applied.map((entry) => entry.roman),
          start: target.romanStart,
          end: target.romanEnd,
        };
      } else state[chainKey] = null;
    }
  } catch (error) {
    reportRomanError(error, target.roman, target.romanStart, source, errors);
    if (isPureFigure || activeChain) state[chainKey] = null;
    return;
  }

  if (!target.romanAnnotation) return;
  try {
    target.romanAnnotationResult = parseRomanSymbol(target.romanAnnotation, {
      config: romanConfig,
      tonalMode: tonalMode(tonalCenter),
    });
    if (target.romanAnnotationResult.generalFigure?.link === "continue") {
      makeError(
        errors,
        source,
        "roman-figured-chain-unfinished",
        target.romanAnnotationStart,
        target.romanAnnotationEnd,
        { domain: "roman", romanCode: "figured-chain-unfinished" },
      );
    }
  } catch (error) {
    reportRomanError(error, target.romanAnnotation, target.romanAnnotationStart, source, errors);
  }
}

export function compileEventRoman(event, state, source, errors, romanConfig) {
  compileRomanTarget(event, state, source, errors, romanConfig, state.tonalCenter, "romanChain");
  event.chordNoteNameSpecial = event.romanResult?.noteNameSpecial || "";
}

export function validateModulationSetting(setting, state, source, errors, romanConfig) {
  if (!state.tonalCenter) {
    makeError(
      errors,
      source,
      state.tonalCenterWasDefined ? "modulation-in-tonal-center-none" : "modulation-missing-tonal-center",
      setting.start,
      setting.end,
    );
    return null;
  }
  if (tonalMode(setting.targetTonalCenter) !== romanReferenceMode(setting.relation)) {
    makeError(
      errors,
      source,
      "modulation-mode-case",
      setting.targetStart,
      setting.relationEnd,
    );
    return null;
  }
  if (!romanConfig) return { pitchOffset: null };
  let reference;
  try {
    reference = parseRomanBasicReference(setting.relation, {
      config: romanConfig,
      tonalMode: tonalMode(state.tonalCenter),
    });
  } catch (error) {
    reportRomanError(error, setting.relation, setting.relationStart, source, errors);
    return null;
  }
  const currentPitch = tonalPitchClass(state.tonalCenter);
  const targetPitch = tonalPitchClass(setting.targetTonalCenter);
  if (currentPitch !== null && targetPitch !== null && (currentPitch + reference.pitchOffset) % 12 !== targetPitch) {
    makeError(
      errors,
      source,
      "modulation-pitch",
      setting.targetStart,
      setting.relationEnd,
      { tonalCenter: state.tonalCenter, target: setting.targetTonalCenter, relation: setting.relation },
    );
    return null;
  }
  return reference;
}

function makeRomanLayer(part, event) {
  const field = trimFieldPart(part.content, (event.romanStart ?? event.start) + part.start);
  return {
    roman: field.content,
    romanResult: null,
    romanStart: field.start,
    romanEnd: field.end,
    romanAnnotation: null,
    romanAnnotationResult: null,
    romanFigureChain: null,
    start: event.start,
    end: event.end,
    chord: event.chord,
    symbolType: null,
  };
}

export function applyModulationEvent(event, state, measure, source, errors, romanConfig) {
  const modulation = state.modulation;
  if (event.symbol) {
    if (![...STANDALONE_EVENT_TYPES.values()].includes(event.symbolType) || !modulation.hasPivotEvent) {
      makeError(
        errors,
        source,
        "modulation-event",
        event.start,
        event.end,
      );
      return;
    }
    event.modulationId = modulation.id;
    interruptRomanChain(event, state, "modulationOldRomanChain", source, errors);
    interruptRomanChain(event, state, "modulationNewRomanChain", source, errors);
    return;
  }
  if (!event.chord || !event.roman || event.chordSymbolType || event.romanSymbolType) {
    makeError(
      errors,
      source,
      "modulation-event",
      event.start,
      event.end,
    );
    return;
  }
  const parts = splitTopLevel(event.roman, "&");
  if (parts.length !== 2 || parts.some((part) => !part.content.trim())) {
    makeError(
      errors,
      source,
      "modulation-roman-rows",
      event.romanStart ?? event.start,
      event.romanEnd ?? event.end,
    );
    return;
  }
  const layers = parts.map((part) => makeRomanLayer(part, event));
  layers[0].tonalCenter = modulation.previousTonalCenter;
  layers[1].tonalCenter = modulation.targetTonalCenter;
  compileRomanTarget(layers[0], state, source, errors, romanConfig, layers[0].tonalCenter, "modulationOldRomanChain");
  compileRomanTarget(layers[1], state, source, errors, romanConfig, layers[1].tonalCenter, "modulationNewRomanChain");
  event.romanLayers = layers;
  event.modulationId = modulation.id;
  event.tonalCenter = modulation.previousTonalCenter;
  event.chordNoteNameSpecial = layers[0].romanResult?.noteNameSpecial || layers[1].romanResult?.noteNameSpecial || "";
  if (!modulation.hasPivotEvent) {
    event.modulationStart = {
      previousTonalCenter: modulation.previousTonalCenter,
      previousRelation: tonalMode(modulation.previousTonalCenter) === "m" ? "i" : "I",
      targetTonalCenter: modulation.targetTonalCenter,
      targetRelation: modulation.relation,
    };
    modulation.hasPivotEvent = true;
    state.needsTonalPrefix = false;
  }
  modulation.lastPivotEvent = event;
  if (!measure.tonalCenter) measure.tonalCenter = modulation.previousTonalCenter;
}

export function applyHardModulationEvent(event, state, measure, source, errors, romanConfig) {
  const hard = state.pendingHardModulation;
  if (event.symbol || !event.chord || !event.roman || event.chordSymbolType || event.romanSymbolType || splitTopLevel(event.roman, "&").length !== 1) {
    makeError(
      errors,
      source,
      "hard-modulation-event",
      event.start,
      event.end,
    );
    state.pendingHardModulation = null;
    return;
  }
  event.hardModulationPrefix = {
    targetTonalCenter: hard.targetTonalCenter,
    targetRelation: hard.relation,
  };
  event.tonalCenter = state.tonalCenter;
  state.needsTonalPrefix = false;
  compileEventRoman(event, state, source, errors, romanConfig);
  event.chordNoteNameSpecial = event.romanResult?.noteNameSpecial || "";
  state.pendingHardModulation = null;
  if (!measure.tonalCenter) measure.tonalCenter = state.tonalCenter;
}

function compileChordValue(value, start, source, errors, specialChords) {
  try {
    return parseChordSymbol(value, { specialChords });
  } catch (error) {
    const relativeStart = error instanceof ChordSyntaxError ? error.start : 0;
    const relativeEnd = error instanceof ChordSyntaxError ? error.end : value.length;
    const chordCode = error instanceof ChordSyntaxError ? error.code : "generic";
    const details = error instanceof ChordSyntaxError ? error.details : {};
    const startOffset = Math.min(Math.max(0, relativeStart), Math.max(0, value.length - 1));
    const endOffset = Math.min(value.length, Math.max(startOffset + 1, relativeEnd));
    makeError(
      errors,
      source,
      `chord-${chordCode}`,
      start + startOffset,
      start + endOffset,
      { domain: "chord", chordCode, details },
    );
    return null;
  }
}

export function compileEventChord(event, source, errors, specialChords) {
  if (!event.chord || event.chordSymbolType) return;
  const field = splitAnnotationField(event.chord, event.chordStart ?? event.start, source, errors, "chord");
  if (!field) return;
  event.chord = field.main.content;
  event.chordStart = field.main.start;
  event.chordEnd = field.main.end;
  event.chordResult = compileChordValue(event.chord, event.chordStart, source, errors, specialChords);
  if (!field.annotation) return;
  event.chordAnnotation = field.annotation.content;
  event.chordAnnotationStart = field.annotation.start;
  event.chordAnnotationEnd = field.annotation.end;
  event.chordAnnotationResult = compileChordValue(
    event.chordAnnotation,
    event.chordAnnotationStart,
    source,
    errors,
    specialChords,
  );
}
