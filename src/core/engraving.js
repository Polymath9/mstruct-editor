import { durationDisplayWidth } from "./duration-notation.js";
import { tagDisplayParts } from "./semantic-tags.js";
import { transposeNoteName } from "./transposition.js";
import { normalizeRendererLayers, tagIsVisible } from "./renderer-layers.js";
import { normalizeRendererScale } from "./renderer-scale.js";
import { displayChordParts, projectChordDisplayFlow } from "./note-display.js";
import { hasChordQualityOverrides } from "./chord-quality-display.js";

const QUARTER_DURATION = 1 / 4;
const START_BAR_WIDTH = 26;
const ELLIPSIS_WIDTH = 48;
const TIME_SIGNATURE_LANE_WIDTH = 44;
// A modulation opening is rendered in a zero-width grid column. Reserve its
// bracket, prefix margin, and a small boundary gap in addition to the label so
// a first-slot modulation cannot touch the preceding measure line.
const MODULATION_OPENING_DECORATION_WIDTH = 28;

export function durationValue(value) {
  if (!value) return 0;
  return value.numerator / value.denominator;
}

export function durationLabel(value) {
  return `${value.numerator}/${value.denominator}`;
}

export function slotDurationLabel(slot) {
  return slot.durationLabel ?? durationLabel(slot.duration);
}

function glyphWidth(value, averageWidth) {
  return [...String(value)].length * averageWidth;
}

function renderedRomanTargetWidth(target) {
  const result = target.romanResult;
  if (!result) return glyphWidth(target.roman, 14);
  const base = glyphWidth(result.baseText, 14);
  const superscript = glyphWidth(result.superscriptText, 9);
  const standardFigures = result.figure
    ? Math.max(glyphWidth(result.figure.upper, 8), glyphWidth(result.figure.lower, 8))
    : 0;
  const generalFigures = result.generalFigure
    ? Math.max(...result.generalFigure.figures.map((figure) => glyphWidth(figure.text, 8)))
    : 0;
  const applied = result.applied.reduce((width, item) => width + 8 + glyphWidth(item.roman, 11), 0);
  const breakTail = result.generalFigure?.link === "break" ? 48 : 0;
  const annotation = target.romanAnnotation
    ? 10 + renderedRomanTargetWidth({ roman: target.romanAnnotation, romanResult: target.romanAnnotationResult })
    : 0;
  return base + superscript + Math.max(standardFigures, generalFigures) + applied + breakTail + annotation;
}

function renderedRomanWidths(event, preferences) {
  const tonal = value => transposeNoteName(value, preferences);
  const scale = event.secondary ? .78 : 1;
  if (event.romanLayers?.length === 2) {
    const valueWidth = Math.max(...event.romanLayers.map(renderedRomanTargetWidth)) * scale;
    const openingWidth = event.modulationStart
      ? Math.max(
        glyphWidth(`${tonal(event.modulationStart.previousTonalCenter)}(${event.modulationStart.previousRelation}):`, 8),
        glyphWidth(`${tonal(event.modulationStart.targetTonalCenter)}(${event.modulationStart.targetRelation}):`, 8),
      ) + MODULATION_OPENING_DECORATION_WIDTH
      : 0;
    const closingWidth = event.modulationEnd ? 18 : 0;
    return { core: valueWidth, left: openingWidth, right: closingWidth };
  }
  const valueWidth = renderedRomanTargetWidth(event) * scale;
  const prefixWidth = event.hardModulationPrefix
    ? glyphWidth(`${tonal(event.hardModulationPrefix.targetTonalCenter)}(${event.hardModulationPrefix.targetRelation}):`, 8) + 6
    : event.tonalPrefix ? glyphWidth(`${tonal(event.tonalPrefix)}:`, 8) + 6 : 0;
  return { core: valueWidth, left: prefixWidth, right: 0 };
}

function renderedChordWidth(event, preferences) {
  const text = (result, fallback) => result && (preferences?.chordDegrees || preferences?.transposeInterval && preferences.transposeInterval !== "none" || hasChordQualityOverrides(preferences))
    ? displayChordParts(result, "normal", preferences, event.chordDisplayTonalCenter).map((part) => part.text).join("") : fallback;
  const main = glyphWidth(text(event.chordResult, event.chord), 16);
  // An annotation uses the same chord font as the main symbol. Its parentheses
  // also need space before the common 14px guard on each side of the group.
  const annotation = event.chordAnnotation ? 24 + glyphWidth(text(event.chordAnnotationResult, event.chordAnnotation), 16) : 0;
  return (main + annotation) * (event.secondary ? .78 : 1);
}

function renderedTagWidth(tag, locale, preferences) {
  const label = tagDisplayParts(tag, locale).map(part => part.type === "note" ? transposeNoteName(part.value, preferences) : part.value).join("");
  const textWidth = [...label].reduce((width, character) => width + (character.codePointAt(0) > 127 ? 14 : 8), 0);
  return textWidth + 24;
}

function renderedFormWidth(form) {
  if (!form) return 0;
  const body = glyphWidth(form.body, 24);
  const scripts = Math.max(glyphWidth(form.superscript, 10), glyphWidth(form.subscript, 10));
  return body + scripts + 24;
}

function newRiemannianLeftOverflow(slot, contentWidth, chordVisualWidth) {
  return Math.max(0, ...slot.events
    .filter((event) => event.newRiemannian)
    .map((event) => {
      const value = event.newRiemannian.value;
      const labelWidth = glyphWidth(value, 7.5) + Math.max(0, [...value].length - 1) * .6;
      const targetLeftSpace = Math.max(0, (contentWidth - chordVisualWidth) / 2);
      return Math.ceil(Math.max(0, labelWidth + 6 - targetLeftSpace));
    }));
}

function slotContentWidths(slot, durationDisplayMode, locale, layers, preferences) {
  const chordEvents = slot.events.filter((event) => event.chord);
  const romanEvents = slot.events.filter((event) => event.roman);
  const standaloneText = slot.events.map((event) => event.symbol).filter(Boolean).join(" · ");
  const chordVisualWidth = chordEvents.length
    ? chordEvents.reduce((width, event) => width + renderedChordWidth(event, preferences), 0) + (chordEvents.length - 1) * 12
    : 0;
  const chordWidth = chordVisualWidth ? chordVisualWidth + 28 : 0;
  const romanWidths = romanEvents.map(event => renderedRomanWidths(event, preferences));
  const romanVisualWidth = romanWidths.length
    ? romanWidths.reduce((width, event) => width + event.core, 0) + (romanWidths.length - 1) * 12
    : 0;
  const romanCoreWidth = romanVisualWidth ? romanVisualWidth + 28 : 0;
  const standaloneWidth = standaloneText ? glyphWidth(standaloneText, 16) + 28 : 0;
  const timeWidth = slot.annotations.time ? glyphWidth(slot.annotations.time, 8) + 18 : 0;
  const bpmWidth = layers.speed && slot.annotations.bpm ? 72 : 0;
  const mmWidth = layers.speed && slot.annotations.metricModulations?.length ? 104 : 0;
  const tempoWidth = layers.speed && slot.annotations.tempo ? glyphWidth(slot.annotations.tempo, 11) + 22 : 0;
  const formWidth = layers.form ? renderedFormWidth(slot.annotations.form) : 0;
  const tagWidth = Math.max(0, ...(slot.tags ?? [])
    .filter((tag) => tagIsVisible(tag, layers) && ["start", "oneshot", "detached-end"].includes(tag.kind))
    .map((tag) => renderedTagWidth(tag, locale, preferences)));
  const durationWidth = (slot.events.some((event) => event.chord || event.symbol)
    || (slot.tags ?? []).some((tag) => tagIsVisible(tag, layers))
    || (layers.comments && (slot.comments?.length ?? 0) > 0))
    ? durationDisplayWidth(slot.duration, durationDisplayMode, slotDurationLabel(slot))
    : 0;
  const core = Math.max(48, chordWidth, romanCoreWidth, standaloneWidth, timeWidth, bpmWidth, mmWidth, tempoWidth, formWidth, durationWidth, tagWidth);
  return {
    core,
    chordVisualWidth,
    chordPrefixWidth: Math.max(0, ...chordEvents.map((event) => event.chordDegreePrefix ? glyphWidth(`${transposeNoteName(event.chordDegreePrefix, preferences)}:`, 8) + 6 : 0)),
    romanVisualWidth,
    leftPrefixWidth: Math.max(0, ...romanWidths.map((event) => event.left)),
    rightPrefixWidth: Math.max(0, ...romanWidths.map((event) => event.right)),
  };
}

/**
 * A compact adaptation of the common engraved-spacing model: the basic
 * duration is quarter-note sized, longer durations gain a fixed increment per
 * doubling, while shorter durations shrink progressively but never below the
 * readable text floor applied in slotContentWidths().
 */
export function rhythmicWidth(duration) {
  const value = durationValue(duration);
  if (value <= 0) return 48;
  const ratio = value / QUARTER_DURATION;
  if (ratio >= 1) return 76 + 22 * Math.log2(ratio);
  return Math.max(32, 76 * Math.pow(ratio, 0.62));
}

export function engraveMeasure(measure, { durationDisplayMode = "fraction", locale = "zh", layers: layerOptions, preferences } = {}) {
  const layers = normalizeRendererLayers(layerOptions);
  const slots = measure.slots.map((slot, index) => {
    const contentWidths = slotContentWidths(slot, durationDisplayMode, locale, layers, preferences);
    const beforeMarkers = [...(measure.slots[index - 1]?.markersAfter ?? []), ...(slot.markersBefore ?? [])];
    const afterMarkers = [...(slot.markersAfter ?? []), ...(measure.slots[index + 1]?.markersBefore ?? [])];
    const boundaryGuard = (markers) => markers.some((marker) => ["repeat-start", "repeat-end"].includes(marker.kind))
      ? 20 : markers.some((marker) => marker.kind === "double-bar") ? 10 : 0;
    const contentNaturalWidth = Math.ceil(Math.max(rhythmicWidth(slot.duration), contentWidths.core));
    const romanCoreInset = Math.max(0, (contentNaturalWidth - contentWidths.romanVisualWidth) / 2);
    const chordCoreInset = Math.max(0, (contentNaturalWidth - contentWidths.chordVisualWidth) / 2);
    const prefixLeftOverflow = Math.ceil(Math.max(0, contentWidths.leftPrefixWidth - romanCoreInset, contentWidths.chordPrefixWidth - chordCoreInset));
    const prefixRightOverflow = Math.ceil(Math.max(0, contentWidths.rightPrefixWidth - romanCoreInset));
    const leftOverflow = Math.max(
      prefixLeftOverflow,
      boundaryGuard(beforeMarkers),
      layers.newRiemannian ? newRiemannianLeftOverflow(slot, contentNaturalWidth, contentWidths.chordVisualWidth) : 0,
    );
    const finalBarGuard = measure.finalBar && index === measure.slots.length - 1 ? 14 : 0;
    const rightOverflow = Math.max(prefixRightOverflow, boundaryGuard(afterMarkers), finalBarGuard);
    const totalNaturalWidth = Math.ceil(contentNaturalWidth + leftOverflow + rightOverflow);
    return {
      slot,
      contentNaturalWidth,
      totalNaturalWidth,
      leadingWidth: slot.timeSignature ? TIME_SIGNATURE_LANE_WIDTH : 0,
      naturalWidth: (slot.timeSignature ? TIME_SIGNATURE_LANE_WIDTH : 0) + totalNaturalWidth,
      leftOverflow,
      rightOverflow,
      contentShift: (leftOverflow - rightOverflow) / 2,
      stretchWeight: Math.max(0.25, durationValue(slot.duration)),
    };
  });
  return {
    measure,
    slots,
    naturalWidth: slots.reduce((sum, slot) => sum + slot.naturalWidth, 0) + 2,
    stretchWeight: Math.max(0.25, durationValue(measure.duration)),
  };
}

function closeSystem(systems, system) {
  if (!system.items.length) return;
  systems.push({ ...system, naturalWidth: Math.ceil(system.naturalWidth) });
}

function makeMeasureSegment(engraving, startSlot, endSlot) {
  const slots = engraving.slots.slice(startSlot, endSlot);
  const endsMeasure = endSlot === engraving.slots.length;
  return {
    slots,
    startSlot,
    endSlot,
    startsMeasure: startSlot === 0,
    endsMeasure,
    naturalWidth: slots.reduce((sum, slot) => sum + slot.naturalWidth, 0) + (endsMeasure ? 2 : 0),
    stretchWeight: Math.max(.25, slots.reduce((sum, slot) => sum + slot.stretchWeight, 0)),
  };
}

function fittingSegmentEnd(engraving, startSlot, availableWidth) {
  let endSlot = startSlot;
  let slotWidth = 0;
  while (endSlot < engraving.slots.length) {
    const nextWidth = slotWidth + engraving.slots[endSlot].naturalWidth;
    const closesMeasure = endSlot + 1 === engraving.slots.length;
    const closingWidth = closesMeasure ? 2 : 0;
    if (nextWidth + closingWidth > availableWidth) break;
    slotWidth = nextWidth;
    endSlot += 1;
  }
  return endSlot;
}

export function layoutSystems(flow, requestedWidth, options = {}) {
  flow = projectChordDisplayFlow(flow, options.preferences);
  const scale = normalizeRendererScale(options.rendererScale) / 100;
  const targetWidth = Math.max(360, Number(requestedWidth) || 720) / scale;
  const systems = [];
  let current = { items: [], naturalWidth: 0, endsWithEllipsis: false };

  const resetCurrent = () => {
    current = { items: [], naturalWidth: 0, endsWithEllipsis: false };
  };

  const addSegment = (measure, engraving, segment) => {
    // A barline is owned by the preceding measure. Only the first complete
    // measure in a system draws an opening line; later measures (and wrapped
    // continuation fragments) begin directly after that preceding end line.
    const startsSystem = current.items.length === 0 && segment.startsMeasure;
    const startWidth = startsSystem ? START_BAR_WIDTH : 0;
    current.items.push({
      kind: "measure",
      measure,
      engraving,
      segment,
      startsSystem,
    });
    current.naturalWidth += segment.naturalWidth + startWidth;
  };

  const addMeasure = (measure) => {
    if (!measure.complete) return;
    const engraving = engraveMeasure(measure, options);
    const fullSegment = makeMeasureSegment(engraving, 0, engraving.slots.length);
    const fullRequiredWidth = fullSegment.naturalWidth + START_BAR_WIDTH;
    if (fullRequiredWidth > targetWidth) {
      let startSlot = 0;
      while (startSlot < engraving.slots.length) {
        const startsSystem = current.items.length === 0;
        const startWidth = startsSystem && startSlot === 0 ? START_BAR_WIDTH : 0;
        const availableWidth = targetWidth - current.naturalWidth - startWidth;
        let endSlot = fittingSegmentEnd(engraving, startSlot, availableWidth);
        if (endSlot === startSlot && current.items.length) {
          closeSystem(systems, current);
          resetCurrent();
          continue;
        }
        // An individual slot is never split. If it alone exceeds a narrow
        // viewport, preserving the event is preferable to data loss.
        if (endSlot === startSlot) endSlot += 1;
        const segment = makeMeasureSegment(engraving, startSlot, endSlot);
        addSegment(measure, engraving, segment);
        startSlot = endSlot;
        if (startSlot < engraving.slots.length) {
          closeSystem(systems, current);
          resetCurrent();
        }
      }
      return;
    }

    const startWidth = current.items.length === 0 ? START_BAR_WIDTH : 0;
    const requiredWidth = fullSegment.naturalWidth + startWidth;
    if (current.items.length && current.naturalWidth + requiredWidth > targetWidth) {
      closeSystem(systems, current);
      resetCurrent();
    }
    addSegment(measure, engraving, fullSegment);
  };

  for (const item of flow) {
    if (item.kind === "measure") {
      addMeasure(item.measure);
      continue;
    }
    if (item.kind === "lineBreak") {
      closeSystem(systems, current);
      resetCurrent();
      continue;
    }
    if (item.kind === "ellipsis") {
      if (current.items.length && current.naturalWidth + ELLIPSIS_WIDTH > targetWidth) {
        closeSystem(systems, current);
        resetCurrent();
      }
      current.items.push({ kind: "ellipsis", marker: item, naturalWidth: ELLIPSIS_WIDTH });
      current.naturalWidth += ELLIPSIS_WIDTH;
      current.endsWithEllipsis = true;
      closeSystem(systems, current);
      resetCurrent();
    }
  }
  closeSystem(systems, current);

  return systems.map((system, index) => ({
    ...system,
    targetWidth,
    isLast: index === systems.length - 1,
    justified: index !== systems.length - 1 && !system.endsWithEllipsis,
  }));
}
