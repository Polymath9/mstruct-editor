import { applyHardModulationEvent, applyModulationEvent, collectRomanWarnings, compileEventChord, compileEventRoman, validateModulationSetting } from "./mstruct-harmony.js";
import { makeError } from "./mstruct-diagnostics.js";
import { toMusicGlyphs } from "./chord-symbol.js";
import { addRational, equalRational, parseFraction, rational, rationalLabel, RationalRangeError } from "./mstruct-rational.js";
import { validateRepeatStructure } from "./mstruct-repeat.js";
import { applyControlMarker, parseControlMarker, parseEvent, parseSecondaryEvent, parseSetting, parseShorthandEvent, readDelimited } from "./mstruct-syntax.js";
import { activeTagLanes, activeTagOccurrences, applyTagToken, createTagState, finishTagState } from "./mstruct-tags.js";
import { applyCommentToken, createCommentState, finishCommentState, normalizeComments, parseCommentToken } from "./mstruct-comments.js";
import { parseFormSymbolToken } from "./mstruct-form-symbol.js";
import { applyFormTagToken, createFormState, formSnapshot, implicitForms, createFormRouteProjector } from "./mstruct-form-tags.js";
import { applyDtcTagToken, createDtcState, createDtcRouteProjector } from "./mstruct-dtc.js";
import { applyNewRiemannianToken, attachNewRiemannianTarget, finishNewRiemannianSlot, parseNewRiemannianToken } from "./mstruct-new-riemannian.js";
import { applyMetricModulationValue, parseMetricModulationValue } from "./mstruct-tempo.js";
export { addRational, equalRational, rational, rationalLabel } from "./mstruct-rational.js";


export const EXAMPLE_SOURCE =
  "{BN:1}{T=0:00}{BPM:1/4=60}{TS:4/4}{D:1/4}{TC:C}[C:C|R:I],{T=0:01}[C:Fm|R:iv],[C:G|R:V],[C:C|R:I];";

export const TASK2_EXAMPLE_SOURCE = [
  "{BN:1}{T=0:00}{BPM:1/4=60}{TS:4/4}{1/4}{TC:C}C|I,",
  "{T=0:01}Fm|iv,G|V,",
  "{1/8}C|I,C|I;",
  "C|I,C|I,C|I,C|I,C|I,C|I,C|I,C|I;",
  "{1}C|I;{LB}",
  "C|I;...",
  "{BN:39}{1/4}C|I...",
  "{BN:50}C|I,C|I,C|I,C|I;",
  "C|I,C|I,C|I,C|I;",
].join("\n");

function emptySlot(offset, state) {
  return {
    start: offset,
    offset: rational(0),
    duration: null,
    durationLabel: null,
    settings: [],
    annotations: { time: null, bpm: null, metricModulations: [], tempo: null, form: null },
    events: [],
    tags: [],
    comments: [],
    newRiemannian: null,
    commentActive: Boolean(state.commentState.active),
    activeCommentNumber: state.commentState.active?.number ?? null,
    activeTags: activeTagOccurrences(state.tagState),
    activeForms: implicitForms(state.formState),
    formBefore: formSnapshot(state),
    formCommands: [],
    activeDtc: state.dtcState.current,
    dtcBefore: state.dtcState.current,
    dtcCommands: [],
    tagTokensSeen: new Set(),
    tagOccupiedLanes: activeTagLanes(state.tagState),
    markersBefore: [],
    markersAfter: [],
    closedByControl: false,
    durationParts: [],
    tonalCenter: null,
    timeSignature: null,
  };
}

function makeState() {
  return {
    division: null,
    divisionLabel: null,
    timeSignature: null,
    timeSignatureLabel: null,
    tonalCenter: null,
    bpm: null,
    explicitBpm: null,
    bpmModulated: false,
    nextBarNumber: null,
    lastBarNumber: null,
    needsRestartDefinitions: false,
    needsTonalPrefix: false,
    romanChain: null,
    modulationOldRomanChain: null,
    modulationNewRomanChain: null,
    modulation: null,
    pendingHardModulation: null,
    nextModulationId: 1,
    tonalCenterWasDefined: false,
    hasCompletedMeasure: false,
    nextRomanChainId: 1,
    nextEventOrder: 0,
    tagState: createTagState(),
    formState: createFormState(),
    dtcState: createDtcState(),
    commentState: createCommentState(),
    previousMusicalEvent: null,
  };
}

function slotHasMusicalEvent(slot) {
  return slot.events.length > 0;
}

function slotAttachedContentRange(slot) {
  const candidates = [
    slot.newRiemannian,
    slot.annotations.form,
    ...slot.tags,
    ...slot.comments,
    ...slot.settings.filter((setting) => ["T", "BPM", "BPMHIDDEN", "MM", "TEMPO"].includes(setting.type)),
  ].filter((item) => Number.isInteger(item?.start) && Number.isInteger(item?.end));
  return candidates.sort((left, right) => left.start - right.start)[0] ?? null;
}

function slotHasAttachedContent(slot) {
  return Boolean(slotAttachedContentRange(slot));
}

function readShorthandEvent(source, index) {
  let end = index;
  let squareDepth = 0;
  let roundDepth = 0;
  while (end < source.length) {
    const character = source[end];
    if (source.startsWith("...", end) && squareDepth === 0 && roundDepth === 0) break;
    if (character === "[") squareDepth += 1;
    else if (character === "]" && squareDepth > 0) squareDepth -= 1;
    else if (character === "(") roundDepth += 1;
    else if (character === ")" && roundDepth > 0) roundDepth -= 1;
    if ([",", ";", "{", "<", "'"].includes(character) && squareDepth === 0 && roundDepth === 0) break;
    end += 1;
  }
  return { content: source.slice(index, end), start: index, end };
}

function applyEvent({ event, state, measure, slot, source, errors, romanConfig }) {
  if (slot.closedByControl) {
    makeError(errors, source, "control-marker-order", event.start, event.end);
  }
  event.order = state.nextEventOrder;
  state.nextEventOrder += 1;
  event.tonalCenter = state.tonalCenter;
  event.tonalCenterWasDefined = state.tonalCenterWasDefined;
  attachNewRiemannianTarget({ event, previousEvent: state.previousMusicalEvent, slot, source, errors });
  if (state.modulation) {
    applyModulationEvent(event, state, measure, source, errors, romanConfig);
    slot.events.push(event);
    return;
  }
  if (state.pendingHardModulation) {
    applyHardModulationEvent(event, state, measure, source, errors, romanConfig);
    slot.events.push(event);
    return;
  }
  if (event.roman && !event.romanSymbolType && !state.tonalCenter) {
    makeError(
      errors,
      source,
      state.tonalCenterWasDefined ? "roman-in-tonal-center-none" : "missing-tonal-center",
      event.start,
      event.end,
    );
  }
  if (event.roman && !event.romanSymbolType && state.tonalCenter) {
    event.tonalCenter = state.tonalCenter;
    if (state.needsTonalPrefix) {
      event.tonalPrefix = state.tonalCenter;
      state.needsTonalPrefix = false;
    }
  }
  if (event.roman && !event.romanSymbolType && state.tonalCenter && !measure.tonalCenter) measure.tonalCenter = state.tonalCenter;
  compileEventRoman(event, state, source, errors, romanConfig);
  slot.events.push(event);
}

function closeSlot({ slot, state, measure, source, errors, closeOffset, requireStableTempo = false }) {
  finishNewRiemannianSlot(slot, source, errors);
  if (state.pendingHardModulation) {
    makeError(
      errors,
      source,
      "hard-modulation-event",
      state.pendingHardModulation.start,
      state.pendingHardModulation.end,
    );
    state.pendingHardModulation = null;
  }
  if (state.modulation && !state.modulation.hasPivotEvent && state.modulation.start >= slot.start) {
    makeError(
      errors,
      source,
      "modulation-event",
      state.modulation.start,
      state.modulation.end,
    );
  }
  if (!state.division) {
    makeError(errors, source, "missing-division", slot.start, closeOffset);
    return;
  }
  const attachedContent = slotAttachedContentRange(slot);
  if (!slotHasMusicalEvent(slot) && attachedContent) {
    makeError(errors, source, "musical-event-required", attachedContent.start, attachedContent.end);
  }
  if (!slotHasMusicalEvent(slot) && (slot.markersBefore.length || slot.markersAfter.length)) {
    makeError(errors, source, "control-marker-position", slot.start, closeOffset);
  }
  if (requireStableTempo && slotHasMusicalEvent(slot) && !state.bpm) {
    makeError(
      errors,
      source,
      "missing-stable-tempo",
      slot.start,
      closeOffset,
    );
  }
  slot.duration = state.division;
  slot.durationParts.push({ settings: [...slot.settings], duration: state.division });
  slot.durationLabel = state.divisionLabel;
  measure.duration = addSlotDuration(measure.duration, state.division, slot, source, errors, closeOffset);
  if (slotHasMusicalEvent(slot)) state.previousMusicalEvent = slot.events.at(-1);
}

function addSlotDuration(left, right, slot, source, errors, end) {
  try {
    return addRational(left, right);
  } catch (error) {
    if (!(error instanceof RationalRangeError)) throw error;
    makeError(errors, source, "invalid-duration-range", slot.start, end);
    return left;
  }
}

function appendSlot(measure, slot, source, errors) {
  const previous = measure.slots.at(-1);
  if (!slotHasMusicalEvent(slot) && !slotHasAttachedContent(slot) && slot.duration && previous && slotHasMusicalEvent(previous) && previous.duration
    && !slot.markersBefore.length && !slot.markersAfter.length && !previous.markersAfter.length) {
    previous.duration = addSlotDuration(previous.duration, slot.duration, slot, source, errors, slot.end);
    previous.durationParts.push(...slot.durationParts);
    previous.durationLabel = previous.duration.denominator === 1
      ? String(previous.duration.numerator)
      : rationalLabel(previous.duration);
    return;
  }
  measure.slots.push(slot);
}

function closeModulation({ token, state, slot, source, errors }) {
  const modulation = state.modulation;
  if (!modulation) {
    makeError(errors, source, "modulation-close-without-open", token.start, token.end);
    return;
  }
  const lastEvent = slot.events.at(-1);
  if (!modulation.hasPivotEvent || lastEvent !== modulation.lastPivotEvent) {
    makeError(
      errors,
      source,
      "modulation-close-position",
      token.start,
      token.end,
    );
  } else {
    modulation.lastPivotEvent.modulationEnd = true;
  }
  for (const chainKey of ["modulationOldRomanChain", "modulationNewRomanChain"]) {
    const chain = state[chainKey];
    if (!chain) continue;
    makeError(
      errors,
      source,
      "roman-figured-chain-unfinished",
      chain.start,
      chain.end,
      { domain: "roman", romanCode: "figured-chain-unfinished" },
    );
    state[chainKey] = null;
  }
  state.tonalCenter = modulation.targetTonalCenter;
  state.needsTonalPrefix = false;
  state.modulation = null;
}

function applySetting({ setting, state, measure, slot, source, errors, romanConfig }) {
  const isMeasureStart = measure.duration.numerator === 0 && !slotHasMusicalEvent(slot);
  if (isMeasureStart) measure.startSettings.add(setting.type);
  slot.settings.push(setting);

  if (setting.type === "BN") {
    if (!isMeasureStart || measure.explicitBarNumber) {
      makeError(errors, source, "bar-number-position", setting.start, setting.end);
      return;
    }
    const declaredNumber = Number(setting.value);
    if ((declaredNumber === 0 && state.hasCompletedMeasure)
      || (state.lastBarNumber !== null && declaredNumber <= state.lastBarNumber)) {
      makeError(
        errors,
        source,
        "bar-number-backward",
        setting.start,
        setting.end,
      );
    }
    measure.barNumber = declaredNumber;
    measure.explicitBarNumber = true;
    measure.autoBarNumber = false;
    return;
  }
  if (setting.type === "D") {
    state.division = parseFraction(setting.value);
    state.divisionLabel = setting.value.replaceAll(" ", "");
    return;
  }
  if (setting.type === "TS") {
    if (measure.duration.numerator !== 0) {
      makeError(errors, source, "time-signature-position", setting.start, setting.end);
      return;
    }
    state.timeSignature = setting.value === "adlib" ? "adlib" : parseFraction(setting.value);
    state.timeSignatureLabel = setting.value;
    measure.timeSignature = state.timeSignature;
    measure.timeSignatureLabel = state.timeSignatureLabel;
    slot.timeSignature = setting.value;
    return;
  }
  if (setting.type === "TC") {
    if (slot.events.length || state.modulation || state.pendingHardModulation || state.romanChain || state.tagState.activeTonalOverrideKey) {
      makeError(errors, source, "tonal-center-position", setting.start, setting.end);
      return;
    }
    state.tonalCenter = setting.value === "None" ? null : setting.value;
    state.tonalCenterWasDefined = true;
    state.needsTonalPrefix = setting.value !== "None";
    slot.tonalCenter = state.tonalCenter;
    return;
  }
  if (["M", "MH"].includes(setting.type)) {
    if (slot.events.length) {
      makeError(errors, source, "modulation-setting-position", setting.start, setting.end, { details: { type: setting.type } });
      return;
    }
    if (state.modulation || state.pendingHardModulation) {
      makeError(errors, source, "modulation-nested", setting.start, setting.end);
      return;
    }
    if (state.tagState.activeTonalOverrideKey) {
      makeError(errors, source, "modulation-tonal-tag-overlap", setting.start, setting.end, { details: { type: setting.type } });
      return;
    }
    if (state.romanChain) {
      makeError(
        errors,
        source,
        "roman-figured-chain-unfinished",
        state.romanChain.start,
        state.romanChain.end,
        { domain: "roman", romanCode: "figured-chain-unfinished" },
      );
      state.romanChain = null;
      return;
    }
    const reference = validateModulationSetting(setting, state, source, errors, romanConfig);
    if (!reference) return;
    if (setting.type === "M") {
      state.modulationOldRomanChain = null;
      state.modulationNewRomanChain = null;
      state.modulation = {
        id: state.nextModulationId++,
        previousTonalCenter: state.tonalCenter,
        targetTonalCenter: setting.targetTonalCenter,
        relation: setting.relation,
        start: setting.start,
        end: setting.end,
        hasPivotEvent: false,
        lastPivotEvent: null,
      };
    } else {
      state.tonalCenter = setting.targetTonalCenter;
      state.needsTonalPrefix = false;
      state.pendingHardModulation = {
        targetTonalCenter: setting.targetTonalCenter,
        relation: setting.relation,
        start: setting.start,
        end: setting.end,
      };
    }
    return;
  }
  if (setting.type === "T") {
    slot.annotations.time = setting.value;
    return;
  }
  if (setting.type === "TEMPO") {
    slot.annotations.tempo = setting.value;
    return;
  }
  if (setting.type === "BPM") {
    state.bpm = setting.value;
    state.explicitBpm = setting.value;
    state.bpmModulated = false;
    slot.annotations.bpm = setting.value;
    return;
  }
  if (setting.type === "BPMHIDDEN") {
    state.bpm = setting.value;
    state.explicitBpm = setting.value;
    state.bpmModulated = false;
    return;
  }
  if (setting.type === "MM") {
    const modulation = parseMetricModulationValue(setting.value);
    const applied = applyMetricModulationValue(state.bpm, setting.value);
    setting.resultBpm = applied?.bpm ?? null;
    setting.fromBeat = modulation.fromLabel;
    setting.toBeat = modulation.toLabel;
    setting.referenceBpm = state.explicitBpm;
    state.bpm = applied?.bpm ?? null;
    state.bpmModulated = Boolean(applied);
    slot.annotations.metricModulations.push(setting);
  }
}

function validateMeasure(measure, state, source, errors) {
  if (state.deferMeterValidation) return;
  if (!measure.complete || measure.truncatedByEllipsis) return;
  if (measure.barNumber === 0 || measure.timeSignature === "adlib") return;
  if (measure.timeSignature && !equalRational(measure.duration, measure.timeSignature)) {
    makeError(
      errors,
      source,
      "meter-mismatch",
      measure.start,
      measure.end,
      { details: { actual: rationalLabel(measure.duration), expected: rationalLabel(measure.timeSignature) } },
    );
  }
  if (!measure.timeSignature && state.timeSignature && state.timeSignature !== "adlib") {
    measure.timeSignature = state.timeSignature;
    if (!equalRational(measure.duration, state.timeSignature)) {
      makeError(
        errors,
        source,
        "meter-mismatch",
        measure.start,
        measure.end,
        { details: { actual: rationalLabel(measure.duration), expected: rationalLabel(state.timeSignature) } },
      );
    }
  }
}

function advanceBarNumber(measure, state) {
  if (measure.barNumber === null && state.nextBarNumber !== null) {
    measure.barNumber = state.nextBarNumber;
    measure.autoBarNumber = true;
  }
  if (measure.barNumber !== null) {
    state.lastBarNumber = measure.barNumber;
    state.nextBarNumber = measure.barNumber + 1;
  }
}

function resetAfterEllipsis(state) {
  state.nextBarNumber = null;
  state.needsRestartDefinitions = true;
}

function completeMeasure({ measure, state, source, errors, end, truncatedByEllipsis = false }) {
  measure.complete = true;
  measure.end = end;
  measure.truncatedByEllipsis = truncatedByEllipsis;
  advanceBarNumber(measure, state);
  validateMeasure(measure, state, source, errors);
  state.hasCompletedMeasure = true;
}

function createMeasure(index, state) {
  const requiresRestartDefinitions = state.needsRestartDefinitions;
  state.needsRestartDefinitions = false;
  return {
    start: index,
    end: index + 1,
    complete: false,
    truncatedByEllipsis: false,
    finalBar: null,
    duration: rational(0),
    barNumber: state.nextBarNumber,
    explicitBarNumber: false,
    autoBarNumber: state.nextBarNumber !== null,
    timeSignature: state.timeSignature,
    timeSignatureLabel: state.timeSignatureLabel,
    tonalCenter: state.tonalCenter,
    requiresRestartDefinitions,
    startSettings: new Set(),
    slots: [],
  };
}

function validateRequiredDefinitions(measure, source, errors, firstMeasure) {
  const isSongStart = measure === firstMeasure;
  if (!isSongStart && !measure.requiresRestartDefinitions) return;
  const context = measure.requiresRestartDefinitions ? "after-ellipsis" : "song-start";
  if (!measure.startSettings.has("BN")) {
    makeError(errors, source, "missing-initial-bn", measure.start, measure.start + 1, { details: { context } });
  }
  if (isSongStart && !measure.startSettings.has("D")) {
    makeError(errors, source, "missing-initial-division", measure.start, measure.start + 1);
  }
  if (isSongStart && !measure.startSettings.has("TS")) {
    makeError(errors, source, "missing-initial-time-signature", measure.start, measure.start + 1);
  }
}

export function parseMstruct(input, options = {}) {
  const source = String(input ?? "").replace(/\r\n?/g, "\n");
  const errors = [];
  const measures = [];
  const flow = [];
  const state = makeState();
  const globalTags = options.globalTags ?? [];
  state.dtcState = createDtcState(globalTags.find(tag => tag.semanticKind === "dtc") ?? null);
  const commentDefinitions = normalizeComments(options.comments);
  state.deferMeterValidation = /\{(?:\|\|:|:\|\||\|\||\/?ENDING:)/i.test(source);
  let index = 0;
  let firstMeasure = null;

  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };

  const addEllipsis = (start) => {
    if (state.modulation || state.pendingHardModulation) {
      makeError(errors, source, "modulation-ellipsis", start, start + 3);
    }
    flow.push({
      kind: "ellipsis",
      start,
      end: start + 3,
      tagOccupiedLanes: activeTagLanes(state.tagState),
      activeTags: activeTagOccurrences(state.tagState),
      activeForms: implicitForms(state.formState),
      formBefore: formSnapshot(state),
      activeDtc: state.dtcState.current,
      dtcBefore: state.dtcState.current,
      commentActive: Boolean(state.commentState.active),
      activeCommentNumber: state.commentState.active?.number ?? null,
      bpm: state.bpm,
      timeSignatureLabel: state.timeSignatureLabel,
    });
    resetAfterEllipsis(state);
  };

  while (index < source.length) {
    skipWhitespace();
    if (index >= source.length) break;

    if (source.startsWith("...", index)) {
      addEllipsis(index);
      index += 3;
      continue;
    }

    if (source[index] === "|") {
      let followingIndex = index + 1;
      while (followingIndex < source.length && /\s/.test(source[followingIndex])) followingIndex += 1;
      if (source[followingIndex] === "{") {
        makeError(errors, source, "legacy-barline", index, followingIndex);
        index += 1;
        continue;
      }
    }

    if (source[index] === "{") {
      const token = readDelimited(source, index, "{", "}");
      if (!token.closed) {
        makeError(errors, source, "unclosed-setting", token.start, token.end);
        index = token.end;
        continue;
      }
      if (token.content.trim().toUpperCase() === "LB") {
        index = token.end;
        const previous = flow.at(-1);
        if (previous?.kind !== "measure" || !previous.measure.complete) {
          makeError(errors, source, "line-break-position", token.start, token.end);
        } else {
          flow.push({ kind: "lineBreak", start: token.start, end: token.end });
        }
        continue;
      }
    }

    if ([",", ";"].includes(source[index])) {
      makeError(errors, source, "slot-outside-measure", index, index + 1);
      index += 1;
      continue;
    }

    const measure = createMeasure(index, state);
    if (!firstMeasure) firstMeasure = measure;
    measures.push(measure);
    flow.push({ kind: "measure", measure });
    let slot = emptySlot(index, state);
    let hasUnclosedToken = false;

    while (index < source.length) {
      skipWhitespace();
      if (index >= source.length) break;
      const current = source[index];

      if (source.startsWith("...", index)) {
        const emptyEllipsisSlot = !slotHasMusicalEvent(slot)
          && !slotHasAttachedContent(slot)
          && !slot.settings.length
          && !slot.markersBefore.length
          && !slot.markersAfter.length;
        if (!emptyEllipsisSlot) {
          closeSlot({ slot, state, measure, source, errors, closeOffset: index, requireStableTempo: options.isStableTempo === true });
          appendSlot(measure, slot, source, errors);
        }
        completeMeasure({
          measure,
          state,
          source,
          errors,
          end: index,
          truncatedByEllipsis: true,
        });
        addEllipsis(index);
        index += 3;
        break;
      }

      if (current === "{") {
        const token = readDelimited(source, index, "{", "}");
        index = token.end;
        if (!token.closed) {
          makeError(errors, source, "unclosed-setting", token.start, token.end);
          hasUnclosedToken = true;
          break;
        }
        if (token.content.trim().toUpperCase() === "LB") {
          makeError(errors, source, "line-break-position", token.start, token.end);
          continue;
        }
        if (token.content.trim() === "/M") {
          closeModulation({ token, state, slot, source, errors });
          continue;
        }
        const marker = parseControlMarker(token, source, errors);
        if (marker) {
          applyControlMarker({ marker, measure, slot, state, source, errors });
          continue;
        }
        const setting = parseSetting(token, source, errors);
        if (setting) applySetting({ setting, state, measure, slot, source, errors, romanConfig: options.romanConfig });
        continue;
      }
      if (current === "[") {
        const token = readDelimited(source, index, "[", "]", true);
        index = token.end;
        if (!token.closed) {
          makeError(errors, source, "unclosed-event", token.start, token.end);
          hasUnclosedToken = true;
          break;
        }
        const comment = parseCommentToken(token, source, errors);
        if (comment) {
          applyCommentToken({
            comment,
            definitions: commentDefinitions,
            commentState: state.commentState,
            slot,
            source,
            errors,
          });
          continue;
        }
        const formSymbol = parseFormSymbolToken(token, source, errors);
        if (formSymbol) {
          if (!formSymbol.invalid) {
            if (slot.annotations.form) makeError(errors, source, "duplicate-form-symbol", token.start, token.end);
            else slot.annotations.form = formSymbol;
          }
          continue;
        }
        const newRiemannian = parseNewRiemannianToken(token, source, errors);
        if (newRiemannian) {
          applyNewRiemannianToken({ transformation: newRiemannian, slot, source, errors });
          continue;
        }
        const event = parseEvent(token, source, errors);
        if (event) {
          compileEventChord(event, source, errors, options.specialChords, options.globalSettings);
          applyEvent({ event, state, measure, slot, source, errors, romanConfig: options.romanConfig });
        }
        continue;
      }
      if (current === "<") {
        const token = readDelimited(source, index, "<", ">");
        index = token.end;
        if (!token.closed) {
          makeError(errors, source, "unclosed-tag", token.start, token.end, { domain: "tag" });
          hasUnclosedToken = true;
          break;
        }
        const tagContext = {
          token,
          formTagConfig: options.formTagConfig,
          tagConfig: options.tagConfig,
          semanticTagConfig: options.semanticTagConfig,
          romanConfig: options.romanConfig,
          tagState: state.tagState,
          state,
          slot,
          source,
          errors,
        };
        if (!applyDtcTagToken(tagContext) && !applyFormTagToken(tagContext)) applyTagToken(tagContext);
        continue;
      }
      if (current === "'") {
        const closingQuote = source.indexOf("'", index + 1);
        if (closingQuote === -1) {
          makeError(errors, source, "unclosed-secondary-event", index, source.length);
          index = source.length;
          hasUnclosedToken = true;
          break;
        }
        const token = {
          content: source.slice(index + 1, closingQuote),
          start: index,
          end: closingQuote + 1,
          closed: true,
        };
        index = closingQuote + 1;
        const event = parseSecondaryEvent(token, source, errors);
        if (event) {
          compileEventChord(event, source, errors, options.specialChords, options.globalSettings);
          applyEvent({ event, state, measure, slot, source, errors, romanConfig: options.romanConfig });
        }
        continue;
      }
      if (current === ",") {
        closeSlot({ slot, state, measure, source, errors, closeOffset: index + 1, requireStableTempo: options.isStableTempo === true });
        appendSlot(measure, slot, source, errors);
        index += 1;
        slot = emptySlot(index, state);
        continue;
      }
      if (current === ";") {
        closeSlot({ slot, state, measure, source, errors, closeOffset: index + 1, requireStableTempo: options.isStableTempo === true });
        appendSlot(measure, slot, source, errors);
        completeMeasure({ measure, state, source, errors, end: index + 1 });
        index += 1;
        break;
      }
      const token = readShorthandEvent(source, index);
      index = token.end;
      const event = parseShorthandEvent(token, source, errors);
      if (event) {
        compileEventChord(event, source, errors, options.specialChords, options.globalSettings);
        applyEvent({ event, state, measure, slot, source, errors, romanConfig: options.romanConfig });
      }
    }

    if (!measure.complete && !hasUnclosedToken) {
      measure.end = index;
      makeError(errors, source, "measure-unfinished", measure.start, index);
      if (slotHasMusicalEvent(slot) || slotHasAttachedContent(slot) || slot.settings.length) measure.slots.push(slot);
    }
    if (measure.finalBar && measure.complete) {
      const trailingOffset = source.slice(index).search(/\S/);
      if (trailingOffset >= 0) {
        makeError(errors, source, "final-bar-content", index + trailingOffset, source.length);
      }
      break;
    }
  }

  if (!firstMeasure) {
    makeError(errors, source, "empty-file", 0, 1);
  } else {
    for (const measure of measures) validateRequiredDefinitions(measure, source, errors, firstMeasure);
  }

  if (state.modulation) {
    makeError(
      errors,
      source,
      "modulation-unfinished",
      state.modulation.start,
      state.modulation.end,
    );
  }
  if (state.pendingHardModulation) {
    makeError(
      errors,
      source,
      "hard-modulation-event",
      state.pendingHardModulation.start,
      state.pendingHardModulation.end,
    );
  }
  if (state.romanChain) {
    makeError(
      errors,
      source,
      "roman-figured-chain-unfinished",
      state.romanChain.start,
      state.romanChain.end,
      { domain: "roman", romanCode: "figured-chain-unfinished" },
    );
  }
  finishTagState(state.tagState, source, errors);
  finishCommentState(state.commentState, source, errors);

  const playbackRoute = errors.length ? [] : validateRepeatStructure({
    measures,
    flow,
    source,
    errors,
    isStableTempo: options.isStableTempo === true,
  });
  const projectForms = createFormRouteProjector();
  const projectDtc = createDtcRouteProjector();
  for (const visit of playbackRoute) {
    const sourceNode = visit.slot ?? visit.marker;
    visit.formTags = projectForms(sourceNode);
    visit.dtcTag = projectDtc(sourceNode);
  }
  for (const [measureIndex, measure] of measures.entries()) {
    const previous = measures[measureIndex - 1];
    const next = measures[measureIndex + 1];
    const previousGap = previous ? source.slice(previous.end, measure.start) : "";
    const gap = next ? source.slice(measure.end, next.start) : "";
    measure.previousBoundaryMarkers = previous && !previousGap.includes("...")
      ? previous.slots.at(-1)?.markersAfter ?? [] : [];
    measure.nextBoundaryMarkers = next && !gap.includes("...") ? next.slots[0]?.markersBefore ?? [] : [];
  }

  return {
    source,
    errors,
    warnings: collectRomanWarnings(measures, source),
    measures,
    flow,
    playbackRoute,
    globalTags,
    hasContinuousBarNumberRepeats: measures.some((measure) => measure.slots.some((slot) =>
      [...slot.markersBefore, ...slot.markersAfter].some((marker) => marker.kind === "repeat-end" && marker.continueBarNumbers))),
    tagRanges: state.tagState.ranges,
    commentRanges: state.commentState.ranges,
    ok: errors.length === 0,
  };
}

export function formatAccidentals(value) {
  return toMusicGlyphs(value, { noteName: true });
}

export function tonalLabel(value) {
  return `${formatAccidentals(value)}:`;
}
