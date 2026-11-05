import { commentText } from "./mstruct-comments.js";
import { referenceBpmValue } from "./mstruct-tempo.js";
import { transposeNoteName, transposeMidiNotes } from "./transposition.js";

function currentTags(source, formTags, dtcTag, globalTags = []) {
  const byKey = new Map();
  for (const tag of source?.activeTags ?? []) byKey.set(tag.key ?? tag.token, tag);
  for (const tag of source?.tags ?? []) {
    const key = tag.key ?? tag.token;
    if (tag.kind === "end") {
      if (!byKey.has(key)) byKey.set(key, tag);
      continue;
    }
    byKey.set(key, tag);
  }
  if (formTags) {
    for (const [key, tag] of byKey) if (tag.form) byKey.delete(key);
    for (const tag of formTags) byKey.set(tag.key ?? tag.token, tag);
  } else {
    for (const [key, tag] of byKey) if (tag.formImplicit || tag.formControl) byKey.delete(key);
    for (const tag of source?.activeForms ?? []) byKey.set(tag.key ?? tag.token, tag);
  }
  for (const [key, tag] of byKey) if (tag.semanticKind === "dtc") byKey.delete(key);
  const currentDtc = dtcTag === undefined ? source?.activeDtc : dtcTag;
  if (currentDtc) byKey.set(currentDtc.key, currentDtc);
  for (const tag of globalTags) byKey.set(tag.key ?? tag.token, tag);
  return [...byKey.values()].sort((left, right) => (left.lane ?? 0) - (right.lane ?? 0));
}

function currentCommentNumber(source) {
  const current = source?.comments?.find((comment) => ["oneshot", "start"].includes(comment.kind));
  return current?.number ?? source?.activeCommentNumber ?? null;
}

function firstAbsoluteChord(source) {
  return source?.events?.find((event) => event.chordResult?.structure) ?? null;
}

export function playbackEntryInformation(entry, {
  comments = [],
  locale = "zh",
  sharp9AsFlat10 = true,
  ...preferences
} = {}) {
  const source = entry?.source ?? null;
  const chordEvent = Object.hasOwn(entry ?? {}, "resolvedChordEvent")
    ? entry.resolvedChordEvent
    : firstAbsoluteChord(source);
  const noteNameSpecials = sharp9AsFlat10 ? ["sharp9_as_flat10"] : [];
  if (chordEvent?.chordNoteNameSpecial) noteNameSpecials.push(chordEvent.chordNoteNameSpecial);
  const noteNames = chordEvent ? chordEvent.chordResult.structure.toNoteNames(noteNameSpecials).map(note => transposeNoteName(note, preferences)) : [];
  const midiNotes = chordEvent ? transposeMidiNotes(chordEvent.chordResult.structure.toMidiNotes(), preferences) : [];
  const commentNumber = currentCommentNumber(source);
  return {
    bpm: entry?.bpm ?? null,
    bpmReference: entry?.bpmModulated ? referenceBpmValue(entry?.bpm, entry?.explicitBpm) : null,
    timeSignatureLabel: entry?.timeSignatureLabel ?? null,
    formSymbol: entry?.formSymbol ?? source?.annotations?.form ?? null,
    activeTags: currentTags(source, entry?.formTags, entry?.dtcTag, entry?.globalTags),
    comment: commentNumber === null ? null : commentText(comments, commentNumber, locale),
    chordEvent,
    noteNames,
    midiNotes,
  };
}
