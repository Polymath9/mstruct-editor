import { makeError } from "./mstruct-diagnostics.js";
import { resolveSemanticTagToken } from "./semantic-tags.js";

export function createTagState() {
  return { active: new Map(), ranges: [], nextRangeId: 1, activeTonalOverrideKey: null, activeModeKey: null };
}

export function activeTagLanes(tagState) {
  return new Set([...tagState.active.values()]
    .filter((range) => range.visualMode !== "detached")
    .map((range) => range.lane));
}

export function activeTagOccurrences(tagState) {
  return [...tagState.active.values()].map((range) => occurrence(
    "active",
    range.definition,
    range.lane,
    { start: range.start, end: range.end ?? range.start },
    range.id,
    range.visualMode,
  ));
}

function reserveLane(slot, preferredLane = null) {
  if (preferredLane !== null) {
    slot.tagOccupiedLanes.add(preferredLane);
    return preferredLane;
  }
  let lane = 0;
  while (slot.tagOccupiedLanes.has(lane)) lane += 1;
  slot.tagOccupiedLanes.add(lane);
  return lane;
}

function occurrence(kind, definition, lane, token, rangeId = null, visualMode = "line") {
  const detachedEnd = kind === "detached-end";
  return {
    kind,
    rangeId,
    lane,
    visualMode,
    token: definition.token,
    key: definition.key ?? definition.token,
    zhName: `${definition.zhName}${detachedEnd ? "结束" : ""}`,
    enName: `${definition.enName}${detachedEnd ? " End" : ""}`,
    durationMode: definition.durationMode,
    zhParts: detachedEnd && definition.zhParts?.length
      ? [...definition.zhParts, { type: "literal", value: "结束" }] : definition.zhParts,
    enParts: detachedEnd && definition.enParts?.length
      ? [...definition.enParts, { type: "literal", value: " End" }] : definition.enParts,
    semanticKind: definition.semanticKind ?? null,
    ...(definition.form ? { form: true, group: definition.group, replacePrevious: definition.replacePrevious,
      ...(definition.allowGlobal !== undefined ? { allowGlobal: definition.allowGlobal } : {}) } : {}),
    start: token.start,
    end: token.end,
  };
}

function usesDetachedEnd(source, from, definition) {
  const inner = definition.token.slice(1, -1);
  const detachedToken = definition.detachedClosingToken ?? `<*/${inner}>`;
  const detachedIndex = source.indexOf(detachedToken, from);
  if (detachedIndex === -1) return false;
  const ordinaryIndex = source.indexOf(definition.closingToken ?? `</${inner}>`, from);
  return ordinaryIndex === -1 || detachedIndex < ordinaryIndex;
}

function reportInvalidTag(errors, source, token) {
  makeError(errors, source, "invalid-tag-parameter", token.start, token.end, {
    domain: "tag",
    details: { token: source.slice(token.start, token.end) },
  });
}

function canChangeTonalCenter({ definition, tagState, state, slot, source, token, errors, openingRange }) {
  if (definition.semanticKind === "mode" && tagState.activeModeKey) {
    makeError(errors, source, "mode-tag-overlap", token.start, token.end, { domain: "tag", details: { token: definition.token } });
    return false;
  }
  if (!definition.affectsTonalCenter) return true;
  if (slot.events.length || state.modulation || state.pendingHardModulation || state.romanChain) {
    makeError(errors, source, "tonal-tag-position", token.start, token.end, { domain: "tag", details: { token: definition.token } });
    return false;
  }
  if (tagState.activeTonalOverrideKey) {
    makeError(errors, source, "tonal-tag-overlap", token.start, token.end, { domain: "tag", details: { token: definition.token } });
    return false;
  }
  state.tonalCenter = definition.tonalCenter;
  state.tonalCenterWasDefined = true;
  state.needsTonalPrefix = true;
  slot.tonalCenter = definition.tonalCenter;
  if (openingRange) tagState.activeTonalOverrideKey = definition.key;
  return true;
}

export function applyTagToken({ token, tagConfig, semanticTagConfig, romanConfig, tagState, state, slot, source, errors }) {
  if (slot.closedByControl) makeError(errors, source, "control-marker-order", token.start, token.end);
  const detachedClosing = token.content.startsWith("*/");
  const closing = detachedClosing || token.content.startsWith("/");
  const openingToken = closing ? `<${token.content.slice(detachedClosing ? 2 : 1)}>` : `<${token.content}>`;
  const configuredDefinition = tagConfig?.byToken?.get(openingToken);
  const semantic = configuredDefinition ? null : resolveSemanticTagToken(token.content, { semanticTagConfig, romanConfig });
  if (!configuredDefinition && semantic?.kind === "invalid") {
    reportInvalidTag(errors, source, token);
    return;
  }
  if (!configuredDefinition && !semantic) {
    makeError(errors, source, "unknown-tag", token.start, token.end, { domain: "tag", details: { token: source.slice(token.start, token.end) } });
    return;
  }
  if (semantic?.kind === "close") {
    if (!closing) {
      reportInvalidTag(errors, source, token);
      return;
    }
    const activeRange = tagState.active.get(semantic.key);
    if (!activeRange) {
      makeError(errors, source, "tag-close-without-open", token.start, token.end, { domain: "tag", details: { token: semantic.token } });
      return;
    }
    const lane = detachedClosing ? reserveLane(slot) : reserveLane(slot, activeRange.lane);
    activeRange.end = token.end;
    slot.tags.push(occurrence(detachedClosing ? "detached-end" : "end", activeRange.definition, lane, token, activeRange.id, detachedClosing ? "detached" : activeRange.visualMode));
    tagState.active.delete(semantic.key);
    if (tagState.activeTonalOverrideKey === semantic.key) tagState.activeTonalOverrideKey = null;
    if (tagState.activeModeKey === semantic.key) tagState.activeModeKey = null;
    return;
  }
  const definition = configuredDefinition ?? semantic.definition;
  const definitionKey = definition.key ?? definition.token;
  slot.tagTokensSeen ??= new Set();
  if (slot.tagTokensSeen.has(definitionKey)) {
    makeError(errors, source, "duplicate-tag", token.start, token.end, { domain: "tag", details: { token: definition.token } });
    return;
  }
  slot.tagTokensSeen.add(definitionKey);

  const active = tagState.active.get(definitionKey);
  if (!closing) {
    if (definition.durationMode === 1) {
      makeError(errors, source, "tag-start-not-allowed", token.start, token.end, { domain: "tag", details: { token: definition.token } });
      return;
    }
    if (active) {
      makeError(errors, source, "tag-already-open", token.start, token.end, { domain: "tag", details: { token: definition.token } });
      return;
    }
    if (!canChangeTonalCenter({ definition, tagState, state, slot, source, token, errors, openingRange: true })) return;
    const lane = reserveLane(slot);
    const visualMode = usesDetachedEnd(source, token.end, definition) ? "detached" : "line";
    const range = {
      id: tagState.nextRangeId,
      token: definition.token,
      key: definitionKey,
      definition,
      lane,
      visualMode,
      start: token.start,
      end: null,
    };
    tagState.nextRangeId += 1;
    tagState.ranges.push(range);
    tagState.active.set(definitionKey, range);
    if (definition.semanticKind === "mode") tagState.activeModeKey = definitionKey;
    slot.tags.push(occurrence("start", definition, lane, token, range.id, visualMode));
    return;
  }

  if (active && (semantic?.canCloseActive ?? true)) {
    const lane = detachedClosing ? reserveLane(slot) : reserveLane(slot, active.lane);
    active.end = token.end;
    slot.tags.push(occurrence(
      detachedClosing ? "detached-end" : "end",
      active.definition ?? definition,
      lane,
      token,
      active.id,
      detachedClosing ? "detached" : active.visualMode,
    ));
    tagState.active.delete(definitionKey);
    if (tagState.activeTonalOverrideKey === definitionKey) tagState.activeTonalOverrideKey = null;
    if (tagState.activeModeKey === definitionKey) tagState.activeModeKey = null;
    return;
  }
  if (detachedClosing) {
    makeError(errors, source, "tag-close-without-open", token.start, token.end, { domain: "tag", details: { token: definition.token } });
    return;
  }
  if (definition.durationMode === 3) {
    makeError(errors, source, "tag-close-without-open", token.start, token.end, { domain: "tag", details: { token: definition.token } });
    return;
  }
  if (!canChangeTonalCenter({ definition, tagState, state, slot, source, token, errors, openingRange: false })) return;
  const lane = reserveLane(slot);
  slot.tags.push(occurrence("oneshot", definition, lane, token));
}

export function finishTagState(tagState, source, errors) {
  for (const range of tagState.active.values()) {
    makeError(errors, source, "tag-unfinished", range.start, range.start + range.token.length, {
      domain: "tag",
      details: { token: range.token },
    });
  }
}
