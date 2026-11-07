import { tr as defaultTr } from "../editor-i18n.js";
import { tagDisplayName } from "../core/tag-config.js";
import { tagDisplayParts } from "../core/semantic-tags.js";
import { makeDurationLabel } from "./duration-label.js";
import { scoreLength } from "../core/renderer-scale.js";
import { tagIsVisible, visibleTagLaneMap } from "../core/renderer-layers.js";
import { clusterSymbolModel } from "../core/symbol-render-model.js";
import { symbolModelDom } from "./symbol-dom.js";

export function createScoreRenderer({ makeElement, appendChordNotation, appendRomanNotation, makeRomanSymbol, makeEventValue, makeBpmLabel, makeMetricModulationLabel, makeTimeSignature, getChordPreferences, getRendererLayers, getLocale, openCommentPopover, tr = defaultTr }) {
  function isHorizontalStrip(chart) {
    return ["scroll", "video"].includes(chart.closest?.(".renderer-panel")?.dataset.presentationMode);
  }

  function makeTonalLabel(tonalCenter, relation = null) {
    const label = makeElement("span", "tonal-label");
    const key = makeElement("span", "tonal-label-key");
    appendChordNotation(key, tonalCenter);
    label.append(key);
    if (relation) {
      const relationElement = makeElement("span", "tonal-label-relation");
      appendRomanNotation(relationElement, relation);
      label.append(document.createTextNode("("), relationElement, document.createTextNode(")"));
    }
    label.append(document.createTextNode(":"));
    return label;
  }

  function makeTonalPrefix(className, tonalCenter, relation = null) {
    const prefix = makeElement("span", className);
    prefix.append(makeTonalLabel(tonalCenter, relation));
    return prefix;
  }

  function renderEventGroup(events, field, className) {
    const visibleEvents = events.filter((event) => event[field] && (field !== "roman" || !event.romanLayers));
    const group = makeElement("div", className);
    if (!visibleEvents.length) {
      group.classList.add("is-empty");
      return group;
    }
    for (const [index, event] of visibleEvents.entries()) {
      const valueElement = makeEventValue(event, field, event);
      if (field === "chord" && event.newRiemannian && getRendererLayers().newRiemannian) {
        const endpoint = valueElement.dataset.eventOrder === String(event.order)
          ? valueElement
          : valueElement.querySelector(`[data-event-order="${event.order}"]`);
        if (endpoint) {
          endpoint.classList.add("new-riemannian-target");
          endpoint.dataset.newRiemannian = event.newRiemannian.value;
          endpoint.dataset.newRiemannianSourceOrder = String(event.newRiemannian.sourceEventOrder);
          endpoint.dataset.newRiemannianSourceType = event.newRiemannian.sourceType;
        }
      }
      if ((field === "roman" && (event.tonalPrefix || event.hardModulationPrefix)) || (field === "chord" && event.chordDegreePrefix)) {
        const tonalCluster = makeElement("span", "tonal-cluster");
        const label = field === "chord"
          ? makeTonalLabel(event.chordDegreePrefix)
          : event.hardModulationPrefix
          ? makeTonalLabel(event.hardModulationPrefix.targetTonalCenter, event.hardModulationPrefix.targetRelation)
          : makeTonalLabel(event.tonalPrefix);
        const prefix = makeElement("span", "tonal-prefix");
        prefix.append(label);
        tonalCluster.append(prefix, valueElement);
        group.append(tonalCluster);
      } else {
        group.append(valueElement);
      }
      if (index < visibleEvents.length - 1) group.append(makeElement("span", "event-separator", " / "));
    }
    return group;
  }

  function makeModulationOpening(start) {
    const opening = makeElement("span", "modulation-opening");
    opening.append(
      makeTonalPrefix("modulation-prefix modulation-prefix-old", start.previousTonalCenter, start.previousRelation),
      makeTonalPrefix("modulation-prefix modulation-prefix-new", start.targetTonalCenter, start.targetRelation),
      makeElement("span", "modulation-bracket modulation-bracket-open"),
    );
    return opening;
  }

  function renderModulationGroup(events) {
    const visibleEvents = events.filter((event) => event.romanLayers?.length === 2);
    const group = makeElement("div", "modulation-line");
    if (!visibleEvents.length) {
      group.classList.add("is-empty");
      return group;
    }
    for (const [index, event] of visibleEvents.entries()) {
      const pair = makeElement("span", "modulation-pair");
      pair.dataset.modulationId = String(event.modulationId);
      const values = makeElement("span", "modulation-values");
      values.append(
        makeEventValue(event.romanLayers[0], "roman", event),
        makeEventValue(event.romanLayers[1], "roman", event),
      );
      pair.append(values);
      if (event.modulationStart) pair.append(makeModulationOpening(event.modulationStart));
      if (event.modulationEnd) pair.append(makeElement("span", "modulation-bracket modulation-bracket-close"));
      group.append(pair);
      if (index < visibleEvents.length - 1) group.append(makeElement("span", "event-separator", " / "));
    }
    return group;
  }

  function renderStandaloneEventGroup(events) {
    const standaloneEvents = events.filter((event) => event.symbol);
    const group = makeElement("div", "standalone-line");
    for (const [index, event] of standaloneEvents.entries()) {
      const cluster = clusterSymbolModel(event.symbol, getChordPreferences().renderMode);
      const valueElement = cluster ? symbolModelDom(cluster, document) : makeElement("span", "event-value");
      if (!cluster) {
        valueElement.textContent = event.symbolType === "continuation" ? "—" : event.symbol;
      }
      valueElement.dataset.eventOrder = String(event.order);
      group.append(valueElement);
      if (index < standaloneEvents.length - 1) group.append(makeElement("span", "event-separator", " / "));
    }
    if (!standaloneEvents.length) group.classList.add("is-empty");
    return group;
  }

  function renderTagStack(slot, laneMap) {
    const stack = makeElement("div", "tag-stack");
    for (const [lane, row] of laneMap) {
      const guide = makeElement("span", "tag-lane-guide");
      guide.dataset.tagLane = String(lane);
      guide.style.gridRow = String(row + 1);
      guide.setAttribute("aria-hidden", "true");
      stack.append(guide);
    }
    for (const tag of slot.tags ?? []) {
      if (!tagIsVisible(tag, getRendererLayers())) continue;
      if (tag.kind === "end") {
        const anchor = makeElement("span", "tag-range-end-anchor");
        anchor.dataset.tagRangeId = String(tag.rangeId);
        anchor.dataset.tagLane = String(tag.lane);
        anchor.style.gridRow = String(laneMap.get(tag.lane) + 1);
        anchor.setAttribute("aria-hidden", "true");
        stack.append(anchor);
        continue;
      }
      const drawsRange = tag.kind === "start" && tag.visualMode !== "detached";
      const kindClass = drawsRange
        ? "tag-range-start"
        : tag.kind === "detached-end" ? "tag-detached-end" : tag.kind === "start" ? "tag-detached-start" : "tag-oneshot";
      const label = makeTagLabel(tag, `tag-label ${kindClass}`);
      label.style.gridRow = String(laneMap.get(tag.lane) + 1);
      label.dataset.tagLane = String(tag.lane);
      if (drawsRange) label.dataset.tagRangeId = String(tag.rangeId);
      stack.append(label);
    }
    return stack;
  }

  function makeTagLabel(tag, className = "tag-label") {
    const label = makeElement("span", className);
    label.setAttribute("aria-label", tagDisplayName(tag, getLocale()));
    for (const part of tagDisplayParts(tag, getLocale())) {
      if (part.type === "literal") {
        label.append(document.createTextNode(part.value));
      } else if (part.type === "note") {
        const note = makeElement("span", "tag-note-name");
        appendChordNotation(note, part.value);
        label.append(note);
      } else if (part.type === "roman") {
        const roman = makeElement("span", "tag-roman-symbol");
        if (part.result) roman.append(makeRomanSymbol(part.result));
        else appendRomanNotation(roman, part.value);
        label.append(roman);
      } else {
        const text = makeElement("span", "tag-label-text");
        text.textContent = part.value;
        label.append(text);
      }
    }
    return label;
  }

  function makeFormSymbol(form) {
    const symbol = makeElement("span", "form-symbol");
    symbol.append(makeElement("span", "form-symbol-body", form.body));
    symbol.append(makeElement("span", "form-symbol-sup", form.superscript));
    symbol.append(makeElement("span", "form-symbol-sub", form.subscript));
    return symbol;
  }

  function makeCommentIcon(comment) {
    const button = makeElement("button", "comment-icon");
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", tr("viewComment", { count: comment.number }));
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
    button.addEventListener("click", () => openCommentPopover(comment.number, button));
    return button;
  }

  function renderCommentStack(slot) {
    const stack = makeElement("div", "comment-stack");
    const guide = makeElement("span", "comment-line-guide");
    guide.setAttribute("aria-hidden", "true");
    stack.append(guide);
    for (const comment of slot.comments ?? []) {
      if (comment.kind === "end") {
        const anchor = makeElement("span", "comment-range-end-anchor");
        anchor.dataset.commentRangeId = String(comment.rangeId);
        anchor.setAttribute("aria-hidden", "true");
        stack.append(anchor);
      } else {
        const icon = makeCommentIcon(comment);
        icon.dataset.commentNumber = String(comment.number);
        if (comment.kind === "start") icon.dataset.commentRangeId = String(comment.rangeId);
        stack.append(icon);
      }
    }
    return stack;
  }

  function decorateControlBoundary(element, markers, { showForward = true, showBackward = true } = {}) {
    const forward = showForward && markers.some((marker) => marker.kind === "repeat-start");
    const backward = showBackward && markers.some((marker) => marker.kind === "repeat-end");
    const doubled = markers.some((marker) => marker.kind === "double-bar");
    if (forward || backward || doubled) {
      element.classList.add("is-double-bar");
      if (forward) element.classList.add("is-repeat-start");
      if (backward) element.classList.add("is-repeat-end");
      if (forward) element.append(makeElement("span", "repeat-dots repeat-dots-right"));
      if (backward) element.append(makeElement("span", "repeat-dots repeat-dots-left"));
    }
    const countedRepeat = showBackward
      ? markers.find((marker) => marker.kind === "repeat-end" && marker.repeatCountExplicit)
      : null;
    if (countedRepeat) element.append(makeElement("span", "repeat-count-label", `${countedRepeat.repeatCount}×`));
    for (const marker of markers) {
      if (!["ending-start", "ending-end"].includes(marker.kind)) continue;
      if (marker.kind === "ending-start" && !showForward) continue;
      if (marker.kind === "ending-end" && !showBackward) continue;
      const anchor = makeElement("span", "ending-anchor");
      anchor.dataset.controlId = String(marker.start);
      element.append(anchor);
    }
    return element;
  }

  function appendInteriorBoundary(content, markers, column, side) {
    if (!markers.length) return;
    const boundary = makeElement("span", "control-boundary");
    boundary.style.gridColumn = String(column);
    boundary.style.justifySelf = side;
    decorateControlBoundary(boundary, markers);
    content.append(boundary);
  }

  function renderMeasure(measure, engraving, startsSystem, nextMeasureNumber = null, segment = null, hasModulationRows = false, hasRomanRows = false, tagLaneMap = new Map()) {
    const layers = getRendererLayers();
    const displayedSlots = segment?.slots ?? engraving.slots;
    const hasChord = displayedSlots.some((slotLayout) => slotLayout.slot.events.some((event) => event.chord));
    const hasRoman = displayedSlots.some((slotLayout) => slotLayout.slot.events.some((event) => event.roman));
    const singleHarmonyRow = !measure.slots.some(slot => slot.events.some(event => event.romanLayers?.length === 2))
      && measure.slots.some(slot => slot.events.some(event => event.chord)) !== measure.slots.some(slot => slot.events.some(event => event.roman));
    const hasOpeningTimeSignature = Boolean(displayedSlots[0]?.slot.timeSignature);
    const rowClass = hasRomanRows ? "two-rows" : "one-row";
    const measureElement = makeElement(
      "article",
      `measure ${rowClass}${singleHarmonyRow ? " has-single-harmony-row" : ""} ${startsSystem ? "system-start" : "system-continuation"}${hasOpeningTimeSignature ? " has-opening-time-signature" : ""}${measure.truncatedByEllipsis ? " is-truncated" : ""}${segment && !segment.startsMeasure ? " is-measure-continuation" : ""}`,
    );
    measureElement.setAttribute("aria-label", `${tr("measure", { count: measure.displayBarNumber ?? measure.barNumber ?? "?" })}${segment && !segment.startsMeasure ? tr("continued") : ""}`);
    const naturalWidth = segment?.naturalWidth ?? engraving.naturalWidth;
    const stretchWeight = segment?.stretchWeight ?? engraving.stretchWeight;
    measureElement.style.setProperty("--measure-natural-width", scoreLength(naturalWidth + (startsSystem ? 26 : 0)));
    measureElement.style.setProperty("--measure-stretch", String(stretchWeight));

    if (startsSystem) {
      const startBar = makeElement("div", "measure-barline start-barline");
      if (segment?.startsMeasure ?? true) {
        decorateControlBoundary(startBar, [...(measure.previousBoundaryMarkers ?? []), ...(measure.slots[0]?.markersBefore ?? [])], { showBackward: false });
      }
      startBar.append(makeElement("span", "bar-number", String(measure.displayBarNumber ?? measure.barNumber ?? "")));
      measureElement.append(startBar);
    }

    const content = makeElement("div", "measure-content");
    const totalNaturalWidth = displayedSlots.reduce((sum, slotLayout) => sum + slotLayout.naturalWidth, 0);
    const totalStretchWeight = displayedSlots.reduce((sum, slotLayout) => sum + slotLayout.stretchWeight, 0);
    content.style.gridTemplateColumns = displayedSlots
      .map((slotLayout) => {
        const share = slotLayout.stretchWeight / totalStretchWeight;
        const fixedOffset = slotLayout.naturalWidth - share * totalNaturalWidth;
        const operator = fixedOffset < 0 ? "-" : "+";
        return `minmax(${scoreLength(slotLayout.naturalWidth)}, calc(${share * 100}% ${operator} ${scoreLength(Math.abs(fixedOffset))}))`;
      })
      .join(" ");
    if (startsSystem) {
      const endingLaneGuide = makeElement("span", "ending-lane-guide");
      endingLaneGuide.setAttribute("aria-hidden", "true");
      content.append(endingLaneGuide);
    }
    for (const [index, slotLayout] of displayedSlots.entries()) {
      const slot = slotLayout.slot;
      if (index > 0) {
        const markers = [...(displayedSlots[index - 1].slot.markersAfter ?? []), ...(slot.markersBefore ?? [])];
        appendInteriorBoundary(content, markers, index + 1, "start");
      } else if (segment && !segment.startsMeasure) {
        appendInteriorBoundary(content, slot.markersBefore ?? [], 1, "start");
      }
      const slotElement = makeElement("section", "measure-slot");
      slotElement.style.gridColumn = String(index + 1);
      slotElement.style.setProperty("--slot-content-shift", scoreLength(slotLayout.contentShift));
      slotElement.dataset.playbackSlot = String(slot.start);
      if (slot.timeSignature) slotElement.classList.add("has-time-signature");
      const annotations = makeElement("div", "slot-annotations");
      if (layers.form && slot.annotations.form) annotations.append(makeFormSymbol(slot.annotations.form));
      if (layers.speed && (slot.annotations.tempo || slot.annotations.metricModulations?.length || slot.annotations.bpm)) {
        const tempoBpmStack = makeElement("div", `tempo-bpm-stack`);
        if (slot.annotations.tempo) tempoBpmStack.append(makeElement("span", "tempo-label", slot.annotations.tempo));
        for (const modulation of slot.annotations.metricModulations ?? []) {
          tempoBpmStack.append(makeMetricModulationLabel(modulation.value));
        }
        if (slot.annotations.bpm) tempoBpmStack.append(makeBpmLabel(slot.annotations.bpm));
        annotations.append(tempoBpmStack);
      }
      if (slot.annotations.time) annotations.append(makeElement("span", "time-label", slot.annotations.time));
      slotElement.append(annotations);

      if (index === 0 && slot.timeSignature) slotElement.append(makeTimeSignature(slot.timeSignature));

      const harmony = makeElement("div", "harmony-stack");
      harmony.dataset.playbackSelectable = String(slot.events.length > 0);
      const chords = renderEventGroup(slot.events, "chord", "chord-line");
      const romans = renderEventGroup(slot.events, "roman", "roman-line");
      const modulations = renderModulationGroup(slot.events);
      const standalone = renderStandaloneEventGroup(slot.events);
      if (hasChord) harmony.append(chords);
      if (hasRoman) harmony.append(romans);
      if (hasModulationRows) harmony.append(modulations);
      if (slot.events.some((event) => event.symbol)) harmony.append(standalone);
      if (!hasChord && !hasRoman && !slot.events.some((event) => event.symbol)) harmony.append(standalone);
      slotElement.append(harmony);

      if (slot.events.some((event) => event.chord || event.symbol)
        || (slot.tags ?? []).some((tag) => tagIsVisible(tag, layers))
        || (layers.comments && (slot.comments?.length ?? 0) > 0)) {
        const preferences = getChordPreferences();
        slotElement.append(makeDurationLabel(slot, preferences.durationDisplayMode, makeElement, tr, preferences.durationStemDown));
      }
      if (layers.comments && (slot.commentActive || (slot.comments?.length ?? 0) > 0)) slotElement.append(renderCommentStack(slot));
      if (tagLaneMap.size > 0) slotElement.append(renderTagStack(slot, tagLaneMap));
      content.append(slotElement);
    }
    if (segment && !segment.endsMeasure && displayedSlots.length) {
      appendInteriorBoundary(content, displayedSlots.at(-1).slot.markersAfter ?? [], displayedSlots.length, "end");
    }
    measureElement.append(content);
    const endsMeasure = segment?.endsMeasure ?? true;
    if (endsMeasure && !measure.truncatedByEllipsis) {
      const endBar = makeElement("div", "measure-barline end-barline");
      const lastSlot = displayedSlots.at(-1)?.slot;
      const boundaryMarkers = [...(lastSlot?.markersAfter ?? []), ...(measure.nextBoundaryMarkers ?? [])];
      decorateControlBoundary(endBar, boundaryMarkers, { showForward: nextMeasureNumber !== null });
      if (measure.finalBar) endBar.classList.add("is-double-bar", "is-final-bar");
      if (nextMeasureNumber !== null) endBar.append(makeElement("span", "bar-number", String(nextMeasureNumber)));
      measureElement.append(endBar);
    }
    return measureElement;
  }

  function renderEllipsis(marker, tagLaneMap, hasComments) {
    const ellipsis = makeElement("div", "ellipsis-marker");
    ellipsis.dataset.playbackSlot = `ellipsis-${marker.start}`;
    ellipsis.dataset.playbackSelectable = "true";
    ellipsis.append(makeElement("span", "ellipsis-glyph", "⋯"));
    if (tagLaneMap.size > 0) ellipsis.append(renderTagStack({ tags: [] }, tagLaneMap));
    if (hasComments) ellipsis.append(renderCommentStack({ comments: [] }));
    ellipsis.setAttribute("aria-label", tr("elidedMeasures"));
    return ellipsis;
  }

  function renderSystem(system) {
    const layers = getRendererLayers();
    const hasSpeedAnnotations = layers.speed && system.items.some(
      (item) => item.kind === "measure" && (item.segment?.slots ?? item.engraving.slots)
        .some((slotLayout) => slotLayout.slot.annotations.bpm || slotLayout.slot.annotations.metricModulations?.length
          || slotLayout.slot.annotations.tempo),
    );
    const hasStackedTempoBpm = layers.speed && system.items.some(
      (item) => item.kind === "measure" && (item.segment?.slots ?? item.engraving.slots)
        .some((slotLayout) => [
          Boolean(slotLayout.slot.annotations.tempo),
          ...(slotLayout.slot.annotations.metricModulations ?? []).map(() => true),
          Boolean(slotLayout.slot.annotations.bpm),
        ].filter(Boolean).length > 1),
    );
    const maxSpeedRows = layers.speed ? Math.max(0, ...system.items.flatMap((item) => item.kind === "measure"
      ? (item.segment?.slots ?? item.engraving.slots).map((slotLayout) => [
          Boolean(slotLayout.slot.annotations.tempo),
          ...(slotLayout.slot.annotations.metricModulations ?? []).map(() => true),
          Boolean(slotLayout.slot.annotations.bpm),
        ].filter(Boolean).length)
      : [0])) : 0;
    const hasFormSymbols = layers.form && system.items.some(
      (item) => item.kind === "measure" && (item.segment?.slots ?? item.engraving.slots)
        .some((slotLayout) => slotLayout.slot.annotations.form),
    );
    const hasComments = layers.comments && system.items.some((item) => item.kind === "measure"
      ? (item.segment?.slots ?? item.engraving.slots).some((slotLayout) => slotLayout.slot.commentActive || slotLayout.slot.comments?.length)
      : Boolean(item.marker?.commentActive));
    const measureItems = system.items.filter((item) => item.kind === "measure");
    const hasModulationRows = measureItems.some((item) => (item.segment?.slots ?? item.engraving.slots)
      .some((slotLayout) => slotLayout.slot.events.some((event) => event.romanLayers?.length === 2)));
    const hasRomanRows = measureItems.some((item) => (item.segment?.slots ?? item.engraving.slots)
      .some((slotLayout) => slotLayout.slot.events.some((event) => event.roman || event.romanLayers?.length)));
    const tagSources = system.items.flatMap((item) => item.kind === "measure"
      ? (item.segment?.slots ?? item.engraving.slots).map((slotLayout) => slotLayout.slot)
      : [item.marker ?? {}]);
    const tagLaneMap = visibleTagLaneMap(tagSources, layers);
    const tagLaneCount = Math.max(0, ...[...tagLaneMap.values()].map(row => row + 1));
    const isSingleEventSystem = system.items.length === 1
      && measureItems.length === 1
      && measureItems[0].segment.startsMeasure
      && measureItems[0].segment.endsMeasure
      && measureItems[0].segment.slots.length === 1;
    const element = makeElement(
      "section",
      `score-system ${system.justified ? "is-justified" : "is-ragged"}${hasSpeedAnnotations ? " has-top-annotations" : ""}${hasStackedTempoBpm ? " has-stacked-tempo-bpm" : ""}${maxSpeedRows > 2 ? " has-multi-speed-rows" : ""}${hasFormSymbols ? " has-form-symbols" : ""}${hasComments ? " has-comments" : ""}${isSingleEventSystem ? " is-single-event-system" : ""}${hasModulationRows ? " has-modulation-rows" : ""}${tagLaneCount ? " has-tags" : ""}`,
    );
    if (maxSpeedRows > 2) element.style.setProperty("--speed-track-size", `${2.125 + (maxSpeedRows - 1) * 1.18}em`);
    if (system.independentMeasure) element.style.setProperty("--presentation-system-width", scoreLength(system.naturalWidth));
    element.setAttribute("aria-label", tr("scoreSystem"));
    element.style.setProperty("--tag-lane-count", String(tagLaneCount));
    element.style.setProperty("--tag-content-extra", `${tagLaneCount ? .35 + tagLaneCount * 1.75 : 0}em`);
    for (const [index, item] of system.items.entries()) {
      if (item.kind === "measure") {
        const nextItem = system.items[index + 1];
        const nextMeasureNumber = item.segment.endsMeasure && nextItem?.kind === "measure" && nextItem.segment.startsMeasure
          ? nextItem.measure.displayBarNumber ?? nextItem.measure.barNumber
          : null;
        element.append(renderMeasure(item.measure, item.engraving, item.startsSystem, nextMeasureNumber, item.segment, hasModulationRows, hasRomanRows, tagLaneMap));
      }
      if (item.kind === "ellipsis") element.append(renderEllipsis(item.marker, tagLaneMap, hasComments));
    }
    if (element.querySelector(".duration-notes")) element.classList.add("has-note-durations");
    const tallestRomanStack = Math.max(0, ...[...element.querySelectorAll(".score-roman-figures")]
      .map((stack) => stack.querySelectorAll(".score-roman-figure-row").length));
    const contentExtra = (hasModulationRows ? 1.8 : 0) + Math.max(0, tallestRomanStack - 2) * 1.05;
    if (contentExtra > 0) {
      element.style.setProperty("--system-content-extra", `${contentExtra}em`);
    }
    return element;
  }

  function endingPairs(result) {
    return result.measures.flatMap((measure) => measure.slots.flatMap((slot) =>
      slot.markersBefore.filter((marker) => marker.kind === "ending-start" && marker.pairedEnd)
        .map((marker) => ({ start: marker, end: marker.pairedEnd }))));
  }

  function endingAnchor(chart, marker) {
    return chart.querySelector(`[data-control-id="${marker.start}"]`);
  }

  function markEndingSystems(chart, result) {
    const systems = [...chart.querySelectorAll(".score-system")];
    for (const pair of endingPairs(result)) {
      const first = endingAnchor(chart, pair.start)?.closest(".score-system");
      const last = endingAnchor(chart, pair.end)?.closest(".score-system");
      const startIndex = systems.indexOf(first);
      const endIndex = systems.indexOf(last);
      if (startIndex < 0 || endIndex < startIndex) continue;
      for (let index = startIndex; index <= endIndex; index += 1) systems[index].classList.add("has-endings");
    }
  }

  function drawEndingBrackets(chart, result) {
    chart.querySelector(".ending-bracket-layer")?.remove();
    chart.querySelectorAll(".bar-number.has-ending-over-bar-number")
      .forEach((number) => {
        number.classList.remove("has-ending-over-bar-number");
        number.style.removeProperty("--ending-bar-number-shift");
      });
    const pairs = endingPairs(result);
    if (!pairs.length) return;
    const chartRect = chart.getBoundingClientRect();
    const systems = [...chart.querySelectorAll(".score-system")];
    const continuousStrip = isHorizontalStrip(chart);
    const layer = makeElement("div", "ending-bracket-layer");
    const numberShifts = new Map();
    for (const pair of pairs) {
      const firstAnchor = endingAnchor(chart, pair.start);
      const lastAnchor = endingAnchor(chart, pair.end);
      const first = firstAnchor?.closest(".score-system");
      const last = lastAnchor?.closest(".score-system");
      const startIndex = systems.indexOf(first);
      const endIndex = systems.indexOf(last);
      if (startIndex < 0 || endIndex < startIndex) continue;
      for (let index = startIndex; index <= endIndex; index += 1) {
        const system = systems[index];
        const systemRect = system.getBoundingClientRect();
        const startRect = firstAnchor.getBoundingClientRect();
        const endRect = lastAnchor.getBoundingClientRect();
        const firstBar = system.querySelector(".start-barline, .measure-barline, .control-boundary");
        const musicTop = firstBar?.getBoundingClientRect().top ?? systemRect.top + 50;
        const fontSize = Number.parseFloat(getComputedStyle(system).fontSize) || 16;
        const edgeGap = continuousStrip ? 0 : fontSize * .12;
        const left = index === startIndex ? startRect.left : systemRect.left + edgeGap;
        const right = index === endIndex ? endRect.left : systemRect.right - edgeGap;
        if (right - left < 3) continue;
        for (const number of system.querySelectorAll(".bar-number")) {
          const barline = number.closest(".measure-barline");
          const barlineX = barline?.getBoundingClientRect().left;
          if (barlineX !== undefined && barlineX >= left - 2 && barlineX <= right + 2) {
            number.classList.add("has-ending-over-bar-number");
          }
        }
        const regularBarNumberTop = system.querySelector(".bar-number")?.getBoundingClientRect().top;
        const guideTop = system.querySelector(".ending-lane-guide")?.getBoundingClientRect().top;
        const bracketTop = regularBarNumberTop ?? guideTop ?? musicTop - fontSize * 1.08;
        const bracket = makeElement("div", `ending-bracket${index === startIndex ? " has-start" : ""}${index === endIndex ? " has-end" : ""}`);
        bracket.style.left = `${left - chartRect.left}px`;
        bracket.style.top = `${bracketTop - chartRect.top}px`;
        bracket.style.width = `${right - left}px`;
        if (index === startIndex) {
          const numbers = pair.start.numbers ?? [pair.start.number];
          bracket.append(makeElement("span", "ending-bracket-label", numbers.map((number) => `${number}.`).join("")));
        }
        layer.append(bracket);
        for (const number of system.querySelectorAll(".bar-number.has-ending-over-bar-number")) {
          const numberRect = number.getBoundingClientRect();
          const maximumBottom = bracketTop - fontSize * .22;
          if (numberRect.bottom > maximumBottom) {
            numberShifts.set(number, Math.min(numberShifts.get(number) ?? 0, maximumBottom - numberRect.bottom));
          }
        }
      }
    }
    for (const [number, shift] of numberShifts) {
      number.style.setProperty("--ending-bar-number-shift", `${shift}px`);
    }
    chart.append(layer);
  }

  function appendVoiceLeadingSegment(layer, chartRect, left, right, top) {
    if (right - left < 3) return;
    const segment = makeElement("span", "roman-voice-leading-segment");
    segment.style.left = `${left - chartRect.left}px`;
    segment.style.top = `${top - chartRect.top}px`;
    segment.style.width = `${right - left}px`;
    layer.append(segment);
  }

  function appendVoiceLeadingRange(layer, chartRect, system, left, right, top, barlineGap) {
    if (!system || right <= left) return;
    const cuts = [...system.querySelectorAll(".measure-barline")]
      .map((barline) => barline.getBoundingClientRect().left)
      .filter((value) => value > left && value < right)
      .sort((a, b) => a - b);
    let cursor = left;
    for (const cut of cuts) {
      appendVoiceLeadingSegment(layer, chartRect, cursor, cut - barlineGap, top);
      cursor = cut + barlineGap;
    }
    appendVoiceLeadingSegment(layer, chartRect, cursor, right, top);
  }

  function nextRenderedEvent(chart, order) {
    const candidates = [...chart.querySelectorAll("[data-event-order]")]
      .map((element) => ({ element, order: Number(element.dataset.eventOrder) }))
      .filter((entry) => entry.order > order);
    if (!candidates.length) return null;
    const nextOrder = Math.min(...candidates.map((entry) => entry.order));
    return candidates
      .filter((entry) => entry.order === nextOrder)
      .sort((left, right) => left.element.getBoundingClientRect().left - right.element.getBoundingClientRect().left)[0]?.element ?? null;
  }

  function drawRomanVoiceLeadingLines(chart) {
    chart.querySelector(".roman-voice-leading-layer")?.remove();
    const sources = [...chart.querySelectorAll('.roman-trigger[data-roman-chain-link="continue"], .roman-trigger[data-roman-chain-link="break"]')];
    if (!sources.length) return;
    const layer = makeElement("div", "roman-voice-leading-layer");
    layer.setAttribute("aria-hidden", "true");
    chart.append(layer);
    const chartRect = chart.getBoundingClientRect();
    const scoreFontSize = Number.parseFloat(getComputedStyle(chart).fontSize) || 16;
    const eventGap = scoreFontSize * .7;
    const barlineGap = scoreFontSize * .6;
    const systemEdgeGap = scoreFontSize * .85;
    const continuousStrip = isHorizontalStrip(chart);

    for (const source of sources) {
      const link = source.dataset.romanChainLink;
      const chainId = source.dataset.romanChainId;
      const chainIndex = Number(source.dataset.romanChainIndex);
      const eventOrder = Number(source.dataset.eventOrder);
      const target = link === "continue"
        ? chart.querySelector(`.roman-trigger[data-roman-chain-id="${CSS.escape(chainId)}"][data-roman-chain-index="${chainIndex + 1}"]`)
        : nextRenderedEvent(chart, eventOrder);
      const sourceRows = [...source.querySelectorAll(".score-roman-figures.is-general .score-roman-figure-row")];
      if (!sourceRows.length) continue;
      const sourceRect = (source.closest(".event-value-with-annotation") ?? source).getBoundingClientRect();
      const sourceSystem = source.closest(".score-system");
      const sourceMeasure = source.closest(".measure");
      const targetMeasure = target?.closest(".measure");
      const targetSystem = link === "break" ? sourceSystem : (target?.closest(".score-system") ?? sourceSystem);
      const sourceSystemRect = sourceSystem.getBoundingClientRect();
      const sourceMeasureRect = sourceMeasure?.getBoundingClientRect() ?? sourceSystemRect;
      const sourceEndBar = sourceMeasure?.querySelector(".end-barline")?.getBoundingClientRect();
      const breakLimit = (sourceEndBar?.left ?? sourceMeasureRect.right) - systemEdgeGap;
      const nextRect = target?.getBoundingClientRect();
      const targetRect = link === "break"
        ? { left: Math.min(targetMeasure === sourceMeasure ? (nextRect?.left ?? breakLimit) - eventGap : breakLimit, breakLimit) }
        : nextRect ?? {
        left: sourceSystemRect.right - 4,
        right: sourceSystemRect.right - 4,
        top: sourceRect.top,
        bottom: sourceRect.bottom,
        width: 0,
        height: sourceRect.height,
        };
      const targetRows = link === "continue" && target
        ? [...target.querySelectorAll(".score-roman-figures.is-general .score-roman-figure-row")]
        : [];

      sourceRows.forEach((row, rowIndex) => {
        const rowRect = row.getBoundingClientRect();
        const top = rowRect.top + rowRect.height / 2;
        const left = sourceRect.right + eventGap;
        const targetRowRect = targetRows[rowIndex]?.getBoundingClientRect();
        const right = link === "break" ? targetRect.left : (link === "continue" && targetRowRect ? targetRowRect.left - eventGap : targetRect.left - eventGap);
        const lineRight = link === "break" ? right - scoreFontSize * .3 : right;
        if (sourceSystem === targetSystem || continuousStrip) {
          appendVoiceLeadingRange(layer, chartRect, continuousStrip ? chart : sourceSystem, left, lineRight, top, barlineGap);
        } else {
          appendVoiceLeadingRange(layer, chartRect, sourceSystem, left, sourceSystemRect.right - systemEdgeGap, top, barlineGap);
          if (target) {
            const targetSystemRect = targetSystem.getBoundingClientRect();
            const targetTop = targetRowRect ? targetRowRect.top + targetRowRect.height / 2 : top;
            appendVoiceLeadingRange(layer, chartRect, targetSystem, targetSystemRect.left + systemEdgeGap, right, targetTop, barlineGap);
          }
        }
        if (link === "break") {
          const cut = makeElement("span", "roman-voice-leading-cut", "×");
          cut.style.left = `${right - chartRect.left}px`;
          cut.style.top = `${top - chartRect.top}px`;
          layer.append(cut);
        }
      });
    }
  }

  function makeNewRiemannianSvgElement(name, className) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (className) element.setAttribute("class", className);
    return element;
  }

  function appendNewRiemannianArc(layer, chartRect, left, leftTop, right, rightTop, controlTop, arrowMarkerId = null) {
    if (right - left < 4) return null;
    const controlX = (left + right) / 2;
    const path = makeNewRiemannianSvgElement("path", "new-riemannian-arc");
    path.setAttribute(
      "d",
      `M ${left - chartRect.left} ${leftTop - chartRect.top} Q ${controlX - chartRect.left} ${controlTop - chartRect.top} ${right - chartRect.left} ${rightTop - chartRect.top}`,
    );
    if (arrowMarkerId) path.setAttribute("marker-end", `url(#${arrowMarkerId})`);
    layer.append(path);
    return {
      x: controlX,
      y: (leftTop + 2 * controlTop + rightTop) / 4,
    };
  }

  function appendNewRiemannianArrowMarker(layer, markerId) {
    const definitions = makeNewRiemannianSvgElement("defs");
    const marker = makeNewRiemannianSvgElement("marker");
    marker.id = markerId;
    marker.setAttribute("viewBox", "0 0 7 7");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("refX", "6");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    const arrow = makeNewRiemannianSvgElement("path", "new-riemannian-arrow");
    arrow.setAttribute("d", "M 0 0 L 7 3.5 L 0 7 Z");
    marker.append(arrow);
    definitions.append(marker);
    layer.append(definitions);
  }

  function adjustedNewRiemannianLabelX(system, desiredX, targetLeft, value, fontSize) {
    const halfWidth = Math.max(fontSize * .45, [...value].length * fontSize * .3);
    const gap = fontSize * .28;
    let labelX = desiredX;
    const barlines = [...system.querySelectorAll(".measure-barline, .control-boundary")]
      .map((barline) => barline.getBoundingClientRect().left)
      .filter((x) => x < targetLeft && x > system.getBoundingClientRect().left);
    for (const barlineX of barlines) {
      if (Math.abs(labelX - barlineX) <= halfWidth + gap) labelX = barlineX + halfWidth + gap;
    }
    return Math.min(labelX, targetLeft - halfWidth - gap);
  }

  function appendNewRiemannianLabel(layer, chartRect, system, point, targetRect, value, fontSize) {
    const label = makeNewRiemannianSvgElement("text", "new-riemannian-label");
    const labelX = adjustedNewRiemannianLabelX(system, point.x, targetRect.left, value, fontSize);
    label.setAttribute("x", String(labelX - chartRect.left));
    label.setAttribute("y", String(point.y - chartRect.top + fontSize * 1.02));
    label.setAttribute("text-anchor", "middle");
    label.textContent = value;
    layer.append(label);
  }

  function drawNewRiemannianConnections(chart) {
    chart.querySelector(".new-riemannian-layer")?.remove();
    if (!getRendererLayers().newRiemannian) return;
    const targets = [...chart.querySelectorAll(".new-riemannian-target[data-new-riemannian]")];
    if (!targets.length) return;
    const chartRect = chart.getBoundingClientRect();
    const fontSize = Number.parseFloat(getComputedStyle(chart).fontSize) || 16;
    const edgeGap = fontSize * .65;
    const curveHeight = fontSize * 1.45;
    const layer = makeNewRiemannianSvgElement("svg", "new-riemannian-layer");
    const arrowMarkerId = `new-riemannian-arrow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    layer.setAttribute("width", String(chartRect.width));
    layer.setAttribute("height", String(chartRect.height));
    layer.setAttribute("aria-hidden", "true");
    appendNewRiemannianArrowMarker(layer, arrowMarkerId);
    chart.append(layer);

    for (const target of targets) {
      const sourceOrder = CSS.escape(target.dataset.newRiemannianSourceOrder ?? "");
      const sourceSelector = target.dataset.newRiemannianSourceType === "continuation"
        ? `.standalone-line [data-event-order="${sourceOrder}"]`
        : `.chord-line [data-event-order="${sourceOrder}"]`;
      const source = chart.querySelector(sourceSelector);
      const sourceSystem = source?.closest(".score-system");
      const targetSystem = target.closest(".score-system");
      if (!source || !sourceSystem || !targetSystem) continue;

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const sourceTop = sourceRect.top + fontSize * .05;
      const targetTop = targetRect.top + fontSize * .05;
      let labelPoint;
      if (sourceSystem === targetSystem || isHorizontalStrip(chart)) {
        labelPoint = appendNewRiemannianArc(
          layer,
          chartRect,
          sourceRect.right,
          sourceTop,
          targetRect.left,
          targetTop,
          Math.min(sourceTop, targetTop) - curveHeight,
          arrowMarkerId,
        );
      } else {
        const sourceSystemRect = sourceSystem.getBoundingClientRect();
        const targetSystemRect = targetSystem.getBoundingClientRect();
        const sourcePeak = sourceTop - curveHeight * .5;
        const targetPeak = targetTop - curveHeight * .5;
        const targetArcRight = targetRect.left - fontSize * .5;
        const targetArcLeft = Math.max(
          targetSystemRect.left + edgeGap,
          targetArcRight - fontSize * 3.25,
        );
        appendNewRiemannianArc(
          layer,
          chartRect,
          sourceRect.right,
          sourceTop,
          sourceSystemRect.right - edgeGap,
          sourcePeak,
          sourcePeak,
          arrowMarkerId,
        );
        labelPoint = appendNewRiemannianArc(
          layer,
          chartRect,
          targetArcLeft,
          targetPeak,
          targetArcRight,
          targetTop,
          targetPeak,
          arrowMarkerId,
        );
      }
      if (labelPoint) {
        appendNewRiemannianLabel(
          layer,
          chartRect,
          targetSystem,
          labelPoint,
          targetRect,
          target.dataset.newRiemannian,
          fontSize,
        );
      }
    }
  }

  function appendTagRangeSegment(layer, chartRect, left, right, top) {
    if (right - left < 1) return;
    const segment = makeElement("span", "tag-range-segment");
    segment.style.left = `${left - chartRect.left}px`;
    segment.style.top = `${top - chartRect.top}px`;
    segment.style.width = `${right - left}px`;
    layer.append(segment);
  }

  function tagLaneCenter(system, lane) {
    const guide = system?.querySelector(`.tag-lane-guide[data-tag-lane="${lane}"]`);
    const rect = guide?.getBoundingClientRect();
    return rect ? rect.top + rect.height / 2 : null;
  }

  function drawTagRangeLines(chart) {
    chart.querySelector(".tag-range-layer")?.remove();
    if (!getRendererLayers().tags && !getRendererLayers().form) return;
    const sources = [...chart.querySelectorAll(".tag-range-start[data-tag-range-id]")];
    if (!sources.length) return;
    const layer = makeElement("div", "tag-range-layer");
    layer.setAttribute("aria-hidden", "true");
    chart.append(layer);
    const chartRect = chart.getBoundingClientRect();
    const systems = [...chart.querySelectorAll(".score-system")];
    const fontSize = Number.parseFloat(getComputedStyle(chart).fontSize) || 16;
    const edgeGap = isHorizontalStrip(chart) ? 0 : fontSize * .4;

    for (const source of sources) {
      const rangeId = source.dataset.tagRangeId;
      const lane = Number(source.dataset.tagLane);
      const target = chart.querySelector(`.tag-range-end-anchor[data-tag-range-id="${rangeId}"]`);
      if (!target) continue;
      const sourceSystem = source.closest(".score-system");
      const targetSystem = target.closest(".score-system");
      const startIndex = systems.indexOf(sourceSystem);
      const endIndex = systems.indexOf(targetSystem);
      if (startIndex < 0 || endIndex < startIndex) continue;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      for (let index = startIndex; index <= endIndex; index += 1) {
        const system = systems[index];
        const systemRect = system.getBoundingClientRect();
        const top = index === startIndex
          ? sourceRect.top + sourceRect.height / 2
          : index === endIndex
            ? targetRect.top + targetRect.height / 2
            : tagLaneCenter(system, lane);
        if (top === null) continue;
        const left = index === startIndex ? sourceRect.right : systemRect.left + edgeGap;
        const right = index === endIndex ? targetRect.left : systemRect.right - edgeGap;
        appendTagRangeSegment(layer, chartRect, left, right, top);
      }
      const endMark = makeElement("span", "tag-range-end-mark");
      endMark.style.left = `${targetRect.left - chartRect.left}px`;
      endMark.style.top = `${targetRect.top + targetRect.height / 2 - chartRect.top}px`;
      layer.append(endMark);
    }
  }

  function commentRowCenter(system) {
    const guide = system?.querySelector(".comment-line-guide");
    const rect = guide?.getBoundingClientRect();
    return rect ? rect.top + rect.height / 2 : null;
  }

  function appendCommentRangeSegment(layer, chartRect, left, right, top, number) {
    if (right - left < 1) return;
    const segment = makeElement("button", "comment-range-segment");
    segment.type = "button";
    segment.style.left = `${left - chartRect.left}px`;
    segment.style.top = `${top - chartRect.top}px`;
    segment.style.width = `${right - left}px`;
    segment.setAttribute("aria-label", tr("viewComment", { count: number }));
    segment.addEventListener("click", () => openCommentPopover(number, segment));
    layer.append(segment);
  }

  function drawCommentRangeLines(chart) {
    chart.querySelector(".comment-range-layer")?.remove();
    if (!getRendererLayers().comments) return;
    const sources = [...chart.querySelectorAll(".comment-icon[data-comment-range-id]")];
    if (!sources.length) return;
    const layer = makeElement("div", "comment-range-layer");
    chart.append(layer);
    const chartRect = chart.getBoundingClientRect();
    const systems = [...chart.querySelectorAll(".score-system")];
    const fontSize = Number.parseFloat(getComputedStyle(chart).fontSize) || 16;
    const edgeGap = isHorizontalStrip(chart) ? 0 : fontSize * .4;
    for (const source of sources) {
      const rangeId = source.dataset.commentRangeId;
      const number = Number(source.dataset.commentNumber);
      const target = chart.querySelector(`.comment-range-end-anchor[data-comment-range-id="${rangeId}"]`);
      if (!target) continue;
      const sourceSystem = source.closest(".score-system");
      const targetSystem = target.closest(".score-system");
      const startIndex = systems.indexOf(sourceSystem);
      const endIndex = systems.indexOf(targetSystem);
      if (startIndex < 0 || endIndex < startIndex) continue;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      let finalRight = targetRect.left;
      for (let index = startIndex; index <= endIndex; index += 1) {
        const system = systems[index];
        const systemRect = system.getBoundingClientRect();
        const top = index === startIndex
          ? sourceRect.top + sourceRect.height / 2
          : index === endIndex ? targetRect.top + targetRect.height / 2 : commentRowCenter(system);
        if (top === null) continue;
        const nextIcon = index === endIndex ? target.closest(".comment-stack")?.querySelector(".comment-icon") : null;
        const left = index === startIndex ? sourceRect.right + fontSize * .12 : systemRect.left + edgeGap;
        const right = index === endIndex
          ? (nextIcon ? nextIcon.getBoundingClientRect().left - fontSize * .16 : targetRect.left)
          : systemRect.right - edgeGap;
        finalRight = right;
        appendCommentRangeSegment(layer, chartRect, left, right, top, number);
      }
      const endMark = makeElement("span", "comment-range-end-mark");
      endMark.style.left = `${finalRight - chartRect.left}px`;
      endMark.style.top = `${targetRect.top + targetRect.height / 2 - chartRect.top}px`;
      layer.append(endMark);
    }
  }

  return { makeTagLabel, makeFormSymbol, renderSystem, markEndingSystems, drawEndingBrackets, drawRomanVoiceLeadingLines, drawNewRiemannianConnections, drawTagRangeLines, drawCommentRangeLines };
}
