import { createFormRouteProjector } from "./mstruct-form-tags.js";
import { createDtcRouteProjector } from "./mstruct-dtc.js";
import { addExact, durationMilliseconds, exact, exactToNumber } from "./mstruct-timing.js";

function numberGcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function numberLcm(left, right) {
  return Math.abs((left / numberGcd(left, right)) * right) || 1;
}

function numericTimeSignatureDenominator(measure) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(measure.timeSignatureLabel ?? ""));
  if (match) return Number(match[2]);
  if (!measure.timeSignature || measure.timeSignature === "adlib") return 1;
  return measure.timeSignature.denominator;
}

function playbackPositionDenominators(result) {
  const denominators = new Map();
  for (const measure of result?.measures ?? []) {
    let denominator = numericTimeSignatureDenominator(measure);
    for (const slot of measure.slots ?? []) {
      for (const part of slot.durationParts ?? []) denominator = numberLcm(denominator, part.duration.denominator);
    }
    denominators.set(measure, denominator);
  }
  for (const visit of result?.playbackRoute ?? []) {
    if (visit.kind === "ellipsis") continue;
    const current = denominators.get(visit.measure) ?? 1;
    denominators.set(visit.measure, numberLcm(current, visit.measurePosition.denominator));
  }
  return denominators;
}

function positionLabel(visit, denominator) {
  const scaled = visit.measurePosition.numerator * (denominator / visit.measurePosition.denominator);
  return `${visit.displayBarNumber ?? visit.measure.displayBarNumber ?? visit.measure.barNumber ?? "?"} ${scaled + 1}/${denominator}`;
}

function firstTimeSignatureSlotId(result) {
  for (const measure of result?.measures ?? []) {
    const slot = measure.slots?.find((candidate) => candidate.timeSignature);
    if (slot) return String(slot.start);
  }
  return null;
}

function playbackMidiNotes(slot) {
  const event = slot?.events?.find((candidate) => candidate.chordResult?.structure);
  if (!event) return null;
  try {
    const { midiNotes } = event.chordResult.structure.toPianoVoicing();
    return midiNotes.length ? midiNotes : null;
  } catch {
    return null;
  }
}

function isPianoContinuation(slot) {
  return slot?.events?.some(event => event.symbolType === "continuation" || event.chordSymbolType === "continuation") ?? false;
}

/** Keep visual entries separate while giving a sustained chord one audio attack. */
function connectPianoContinuations(entries) {
  let sustained = [];
  function finish() {
    const endMs = sustained.at(-1)?.endMs;
    for (const entry of sustained) entry.pianoEndMs = endMs;
    sustained = [];
  }
  for (const entry of entries) {
    const previous = sustained.at(-1);
    const continues = !entry.midiNotes?.length && entry.kind === "event" && !entry.pianoBreakBefore
      && isPianoContinuation(entry.source) && previous && previous.endMs === entry.startMs;
    if (!continues) finish();
    entry.pianoAttackRouteIndex = continues ? previous.pianoAttackRouteIndex : entry.routeIndex;
    entry.pianoEndMs = entry.endMs;
    if (continues) entry.midiNotes = previous.midiNotes;
    if (entry.midiNotes?.length) sustained.push(entry);
  }
  finish();
  return entries;
}

function fieldDisplayItems(slot, field, previousItems) {
  const items = [];
  let mentioned = false;
  for (const event of slot?.events ?? []) {
    if (!event?.[field]) continue;
    mentioned = true;
    if (event[`${field}SymbolType`] === "continuation") {
      items.push(...previousItems);
      continue;
    }
    items.push({
      kind: field,
      slotId: String(slot.start),
      eventOrder: event.order,
      event,
    });
  }
  return { items, mentioned };
}

function playbackHarmony(slot, previousChordItems, previousRomanItems) {
  const standaloneContinuation = slot?.events?.some((event) => event.symbolType === "continuation") ?? false;
  const chord = fieldDisplayItems(slot, "chord", previousChordItems);
  const roman = fieldDisplayItems(slot, "roman", previousRomanItems);
  if (!chord.mentioned && standaloneContinuation) chord.items = [...previousChordItems];
  if (!roman.mentioned && standaloneContinuation) roman.items = [...previousRomanItems];

  const standaloneItems = !chord.mentioned && !standaloneContinuation
    ? (slot?.events ?? []).filter((event) => event.symbol).map((event) => ({
        kind: "standalone",
        slotId: String(slot.start),
        eventOrder: event.order,
        event,
      }))
    : [];

  return {
    chordDisplayItems: chord.mentioned || standaloneContinuation ? chord.items : standaloneItems,
    romanDisplayItems: roman.items,
    nextChordItems: chord.mentioned || standaloneContinuation ? chord.items : previousChordItems,
    nextRomanItems: roman.mentioned || standaloneContinuation ? roman.items : previousRomanItems,
    resolvedChordEvent: chord.items.find((item) => item.event?.chordResult?.structure)?.event ?? null,
  };
}

export function parsePlaybackOffset(value) {
  const source = String(value ?? "").trim();
  if (!/^-?\d+$/.test(source)) return null;
  const parsed = Number(source);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function buildPlaybackPlan(result, offsetMs = 0) {
  const normalizedOffset = parsePlaybackOffset(offsetMs) ?? 0;
  const positionDenominators = playbackPositionDenominators(result);
  const entries = [];
  let elapsed = exact(0n);
  let ready = Boolean(result?.ok && result.playbackRoute?.length);
  let pendingEllipsis = null;
  let previousChordItems = [];
  let previousRomanItems = [];
  let formSymbol = null;

  for (const [routeIndex, visit] of (result?.playbackRoute ?? []).entries()) {
    const source = visit.kind === "ellipsis" ? visit.marker : visit.slot;
    formSymbol = source?.annotations?.form ?? formSymbol;
    if (visit.kind === "ellipsis") {
      const startMs = exactToNumber(elapsed) + normalizedOffset;
      const entry = {
        kind: "ellipsis",
        routeIndex,
        slotId: `ellipsis-${visit.marker.start}`,
        startMs,
        endMs: startMs,
        position: "…",
        midiNotes: null,
        bpm: visit.bpm ?? visit.marker.bpm ?? null,
        explicitBpm: visit.explicitBpm ?? null,
        bpmModulated: visit.bpmModulated ?? false,
        timeSignatureLabel: visit.marker.timeSignatureLabel ?? null,
        formSymbol,
        source: visit.marker,
        formTags: visit.formTags,
        dtcTag: visit.dtcTag,
        globalTags: result.globalTags,
      };
      entries.push(entry);
      pendingEllipsis = entry;
      continue;
    }
    const start = elapsed;
    if (pendingEllipsis) {
      pendingEllipsis.endMs = exactToNumber(start) + normalizedOffset;
      pendingEllipsis = null;
    }
    for (const part of visit.parts) {
      const milliseconds = durationMilliseconds(part.duration, part.bpm);
      if (!milliseconds) {
        ready = false;
        continue;
      }
      elapsed = addExact(elapsed, milliseconds);
    }
    if (!visit.slot.events?.length) continue;
    const harmony = playbackHarmony(visit.slot, previousChordItems, previousRomanItems);
    previousChordItems = harmony.nextChordItems;
    previousRomanItems = harmony.nextRomanItems;
    const denominator = positionDenominators.get(visit.measure) ?? 1;
    entries.push({
      kind: "event",
      routeIndex,
      slotId: String(visit.slot.start),
      startMs: exactToNumber(start) + normalizedOffset,
      endMs: exactToNumber(elapsed) + normalizedOffset,
      position: positionLabel(visit, denominator),
      midiNotes: playbackMidiNotes(visit.slot),
      bpm: visit.parts.at(-1)?.bpm ?? null,
      explicitBpm: visit.parts.at(-1)?.explicitBpm ?? null,
      bpmModulated: visit.parts.at(-1)?.bpmModulated ?? false,
      timeSignatureLabel: visit.measure.timeSignatureLabel ?? null,
      formSymbol,
      chordDisplayItems: harmony.chordDisplayItems,
      romanDisplayItems: harmony.romanDisplayItems,
      resolvedChordEvent: harmony.resolvedChordEvent,
      source: visit.slot,
      formTags: visit.formTags,
      dtcTag: visit.dtcTag,
      globalTags: result.globalTags,
    });
  }

  const musicalDurationMs = exactToNumber(elapsed);
  if (pendingEllipsis) pendingEllipsis.endMs = musicalDurationMs + normalizedOffset;
  return {
    ready: ready && entries.length > 0,
    entries: connectPianoContinuations(entries),
    firstTimeSignatureSlotId: firstTimeSignatureSlotId(result),
    offsetMs: normalizedOffset,
    preRollEndMs: Math.max(0, normalizedOffset),
    durationMs: Math.max(0, musicalDurationMs + normalizedOffset),
  };
}

export function buildMstructtimePlaybackPlan(result, timelineDocument, temporaryOffset = 0) {
  const generated = buildMstructtimeEventRows(result, timelineDocument?.loop ?? "", timelineDocument?.main ?? "");
  const offset = parsePlaybackOffset(temporaryOffset) ?? 0;
  const assigned = [];
  const projectForms = createFormRouteProjector();
  const projectDtc = createDtcRouteProjector();
  let previousChordItems = [];
  let previousRomanItems = [];
  let pianoBreakBefore = false;
  let formSymbol = null;

  for (const row of generated.rows ?? []) {
    if (row.kind === "start") continue;
    formSymbol = row.source?.annotations?.form ?? formSymbol;
    row.formSymbol = formSymbol;
    const formTags = projectForms(row.source);
    const dtcTag = projectDtc(row.source);
    let harmony = {
      chordDisplayItems: [],
      romanDisplayItems: [],
      resolvedChordEvent: null,
      nextChordItems: previousChordItems,
      nextRomanItems: previousRomanItems,
    };
    if (row.kind === "event") {
      harmony = playbackHarmony(row.source, previousChordItems, previousRomanItems);
      previousChordItems = harmony.nextChordItems;
      previousRomanItems = harmony.nextRomanItems;
    }
    if (row.milliseconds === null) {
      if (row.kind !== "event" || !isPianoContinuation(row.source) || playbackMidiNotes(row.source)?.length) pianoBreakBefore = true;
      continue;
    }
    assigned.push({
      kind: row.kind,
      routeIndex: row.routeIndex,
      rowNumber: row.number,
      pass: row.pass,
      slotId: row.slotId,
      startMs: Math.max(0, row.milliseconds + offset),
      endMs: Math.max(0, row.milliseconds + offset),
      position: `${row.measure} ${row.beat}`,
      midiNotes: row.kind === "event" ? playbackMidiNotes(row.source) : null,
      pianoBreakBefore,
      bpm: null,
      timeSignatureLabel: row.timeSignatureLabel ?? row.source?.timeSignatureLabel ?? row.source?.timeSignature ?? null,
      formSymbol,
      chordDisplayItems: harmony.chordDisplayItems,
      romanDisplayItems: harmony.romanDisplayItems,
      resolvedChordEvent: harmony.resolvedChordEvent,
      source: row.source,
      formTags,
      dtcTag,
      globalTags: result.globalTags,
    });
    pianoBreakBefore = false;
  }
  const declaredDuration = musicLengthMilliseconds(timelineDocument?.metadata?.musicLength) ?? 0;
  const durationMs = Math.max(declaredDuration, assigned.at(-1)?.startMs ?? 0);
  assigned.forEach((entry, index) => {
    entry.endMs = assigned[index + 1]?.startMs ?? durationMs;
  });
  return {
    ready: Boolean(result?.ok && generated.ok && declaredDuration > 0),
    entries: connectPianoContinuations(assigned),
    rows: generated.rows,
    errors: generated.errors,
    firstTimeSignatureSlotId: firstTimeSignatureSlotId(result),
    offsetMs: offset,
    preRollEndMs: Math.max(0, assigned[0]?.startMs ?? durationMs),
    durationMs,
  };
}

export function playbackEntryAt(plan, elapsedMs) {
  if (!plan?.entries?.length) return null;
  const time = Number(elapsedMs);
  for (const entry of plan.entries) {
    if (entry.startMs <= time && time < entry.endMs) return entry;
  }
  return null;
}

export function firstPlaybackEntryForSlot(plan, slotId) {
  return playbackEntriesForSlot(plan, slotId)[0] ?? null;
}

export function playbackEntriesForSlot(plan, slotId) {
  return plan?.entries?.filter((entry) => entry.slotId === String(slotId)) ?? [];
}

export function formatPlaybackTimestamp(elapsedMs) {
  const total = Math.max(0, Math.floor(Number(elapsedMs) || 0));
  const milliseconds = total % 1000;
  const totalSeconds = Math.floor(total / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
import { musicLengthMilliseconds } from "./mstructtime-document.js";
import { buildMstructtimeEventRows } from "./mstructtime-route.js";
