import { tonalPitchClass } from "./mstruct-harmony.js";
import { parseBpmValue } from "./mstruct-tempo.js";
import { romanFigureSearchViews } from "./mstruct-search-roman.js";
import { CLUSTER_SYMBOLS } from "./cluster-symbol.js";

export const MSTRUCT_SEARCH_INDEX_FORMAT_VERSION = 12;

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function normalizeTag(tag) {
  return {
    token: tag.token,
    key: tag.key ?? tag.token,
    semanticKind: tag.semanticKind ?? null,
    ...(tag.form ? { form: true } : {}),
  };
}

function slotTags(slot) {
  const byIdentity = new Map();
  for (const tag of [...(slot.activeTags ?? []), ...(slot.tags ?? []), ...(slot.activeForms ?? [])]) {
    if (tag.semanticKind === "dtc") continue;
    if (tag.formControl || tag.formImplicit && !(slot.activeForms ?? []).includes(tag)) continue;
    const normalized = normalizeTag(tag);
    byIdentity.set(`${normalized.key}\u0000${normalized.token}`, normalized);
  }
  if (slot.activeDtc && !slot.activeDtc.global) byIdentity.set("semantic:dtc", normalizeTag(slot.activeDtc));
  return [...byIdentity.values()];
}

/** Whole-song tags are active at every search event without duplicating the serialized payload. */
export function activeMstructSearchTags(event, globalTags = []) {
  if (!globalTags.length) return event.tags ?? [];
  const byIdentity = new Map();
  for (const tag of [...(event.tags ?? []), ...globalTags]) {
    const normalized = normalizeTag(tag);
    byIdentity.set(`${normalized.key}\u0000${normalized.token}`, normalized);
  }
  return [...byIdentity.values()];
}

function chordAlternative(source, result) {
  if (CLUSTER_SYMBOLS.has(source)) return { source, atoms: [source] };
  if (!source || !result) return null;
  const atoms = result.searchAtoms ?? result.atoms ?? [source];
  const root = result.search?.notes?.[0]?.token
    ?? (atoms[0] && /^[A-G](?:bb|b|#|x)?$/.test(atoms[0]) ? atoms[0] : null);
  const structureRoot = result.structure?.root ?? null;
  return {
    source,
    atoms: [...atoms],
    root,
    rootPitchClass: root ? tonalPitchClass(root) : null,
    pitchSet: structureRoot
      ? [structureRoot, tonalPitchClass(structureRoot), result.structure.toPitchClassMask()]
      : null,
    notes: (result.search?.notes ?? []).map((note) => ({ ...note })),
    lists: (result.search?.lists ?? []).map((list) => ({ kind: list.kind, items: [...list.items] })),
  };
}

function romanAlternative(source, result, tonalCenter = null, chain = null, heads = null) {
  if (!source || !result) return null;
  const figureViews = romanFigureSearchViews(source, result, chain, heads);
  return {
    source,
    atoms: [...(result.atoms ?? [source])],
    tonalCenter,
    ...(figureViews.length ? { romanFigureViews: figureViews } : {}),
  };
}

function chordField(event) {
  if (event.chordSymbolType && !CLUSTER_SYMBOLS.has(event.chord)) return { type: event.chordSymbolType, alternatives: [] };
  const alternatives = [
    chordAlternative(event.chord, event.chordResult),
    chordAlternative(event.chordAnnotation, event.chordAnnotationResult),
  ].filter(Boolean);
  return { type: alternatives.length ? "normal" : "missing", alternatives };
}

function romanField(event, heads) {
  if (event.romanSymbolType) return { type: event.romanSymbolType, alternatives: [] };
  const targets = event.romanLayers?.length ? event.romanLayers : [event];
  const alternatives = targets.flatMap((target) => [
    romanAlternative(target.roman, target.romanResult, target.tonalCenter ?? event.tonalCenter, target.romanFigureChain, heads),
    romanAlternative(target.romanAnnotation, target.romanAnnotationResult, target.tonalCenter ?? event.tonalCenter),
  ]).filter(Boolean);
  return { type: alternatives.length ? "normal" : "missing", alternatives };
}

function eventKind(event) {
  return event.symbolType ?? "harmony";
}

function modulationContext(event, modulationById) {
  if (event.hardModulationPrefix) {
    return {
      type: "MH",
      target: event.hardModulationPrefix.targetTonalCenter,
      relation: event.hardModulationPrefix.targetRelation,
    };
  }
  if (!event.modulationId) return null;
  const context = modulationById.get(event.modulationId);
  if (!context) return { type: "M", target: null, relation: null };
  return { type: "M", target: context.targetTonalCenter, relation: context.targetRelation };
}

function effectiveTonalCenters(event, modulation) {
  if (event.romanLayers?.length) return unique(event.romanLayers.map((layer) => layer.tonalCenter));
  if (modulation?.type === "M") {
    const start = event.modulationStart;
    return unique([event.tonalCenter, start?.previousTonalCenter, start?.targetTonalCenter, modulation.target]);
  }
  return unique([event.tonalCenter, modulation?.target]);
}

function makeProjectedEvent({ event, slot, measure, measureIndex, slotIndex, segment, position, modulationById, romanHeads }) {
  const modulation = modulationContext(event, modulationById);
  const chord = chordField(event);
  const roman = romanField(event, romanHeads);
  const kind = eventKind(event);
  const continuation = kind === "continuation" || chord.type === "continuation" || roman.type === "continuation";
  return {
    id: `event:${event.order}`,
    order: event.order,
    position,
    segment,
    kind,
    secondary: event.secondary === true,
    continuation,
    chord,
    roman,
    tags: slotTags(slot),
    tonalCenters: effectiveTonalCenters(event, modulation),
    ...(event.tonalCenterWasDefined && event.tonalCenter === null && !modulation ? { tonalCenterNone: true } : {}),
    timeSignature: measure.timeSignatureLabel ?? null,
    modulation,
    metricModulations: (slot.settings ?? []).filter((setting) => setting.type === "MM").map((setting) => ({
      from: String(setting.value).split("=")[0]?.replaceAll(" ", "") ?? null,
      to: String(setting.value).split("=")[1]?.replaceAll(" ", "") ?? null,
    })),
    bpms: (slot.settings ?? []).filter((setting) => ["BPM", "BPMHIDDEN"].includes(setting.type)).map((setting) => {
      const parsed = parseBpmValue(setting.value);
      return parsed ? { beat: parsed.beatLabel, tempo: Number(parsed.tempo), hidden: setting.type === "BPMHIDDEN" } : null;
    }).filter(Boolean),
    newRiemannian: event.newRiemannian?.value ?? null,
    source: {
      start: event.start,
      end: event.end,
      measureIndex,
      slotIndex,
      slotId: String(slot.start),
      barNumber: measure.displayBarNumber ?? measure.barNumber,
    },
  };
}

/**
 * @param {any} parsed
 * @param {{globalTags?: any[]}} [options]
 * @returns {any}
 */
export function projectMstructSearchEvents(parsed, { globalTags = parsed?.globalTags ?? [] } = {}) {
  if (!parsed?.ok) throw new TypeError("Search projection requires a successfully parsed MStruct result.");
  const events = [];
  const structuralSegments = [[]];
  const modulationById = new Map();
  const romanHeads = new Map();
  let segment = 0;

  for (const item of parsed.flow ?? []) {
    if (item.kind === "ellipsis") {
      segment += 1;
      structuralSegments[segment] = [];
      continue;
    }
    if (item.kind !== "measure") continue;
    const measure = item.measure;
    const measureIndex = parsed.measures.indexOf(measure);
    for (const [slotIndex, slot] of measure.slots.entries()) {
      for (const event of slot.events) {
        if (event.modulationStart && event.modulationId) modulationById.set(event.modulationId, event.modulationStart);
        const projected = makeProjectedEvent({
          event,
          slot,
          measure,
          measureIndex,
          slotIndex,
          segment,
          position: events.length,
          modulationById,
          romanHeads,
        });
        events.push(projected);
        structuralSegments[segment].push(projected.position);
      }
    }
  }

  const positionByOrder = new Map(events.map((event) => [event.order, event.position]));
  const performedSegments = [[]];
  const variants = new Map();
  const signatureOf = (tags) => JSON.stringify([...tags].sort((a, b) => a.key.localeCompare(b.key)));
  let performedSegment = 0;
  for (const entry of parsed.playbackRoute ?? []) {
    if (entry.kind === "ellipsis") {
      performedSegment += 1;
      performedSegments[performedSegment] = [];
      continue;
    }
    for (const event of entry.slot?.events ?? []) {
      const sourcePosition = positionByOrder.get(event.order);
      if (sourcePosition === undefined) continue;
      const original = events[sourcePosition];
      const tags = [...original.tags.filter((tag) => !tag.form && tag.semanticKind !== "dtc"),
        ...(entry.formTags ?? []).map(normalizeTag), ...(entry.dtcTag && !entry.dtcTag.global ? [normalizeTag(entry.dtcTag)] : [])];
      const signature = signatureOf(tags);
      const variantKey = `${sourcePosition}:${signature}`;
      let position = variants.get(variantKey);
      if (position === undefined) {
        if (signatureOf(original.tags) === signature) position = sourcePosition;
        else {
          position = events.length;
          events.push({ ...original, position, tags });
        }
        variants.set(variantKey, position);
      }
      performedSegments[performedSegment].push(position);
    }
  }

  return {
    formatVersion: MSTRUCT_SEARCH_INDEX_FORMAT_VERSION,
    events,
    segments: (parsed.playbackRoute?.length ?? 0) > 0 ? performedSegments : structuralSegments,
    globalTags: globalTags.map(normalizeTag),
  };
}
