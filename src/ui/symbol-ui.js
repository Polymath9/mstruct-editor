import { ChordPianoPlayer } from "../core/chord-audio.js";
import { toMusicGlyphs } from "../core/chord-symbol.js";
import { drawChordStaff } from "../core/chord-staff.js";
import { formatAccidentals } from "../core/mstruct.js";
import { romanDisplayGlyphs } from "../core/roman-symbol.js";
import { chordSymbolModel, clusterSymbolModel, romanSymbolModel } from "../core/symbol-render-model.js";
import { symbolModelDom } from "./symbol-dom.js";
import { displayNoteName, chordEventTonalCenter } from "../core/note-display.js";
import { tr as defaultTr } from "../editor-i18n.js";
import { transposeNoteName, transposeMidiNotes } from "../core/transposition.js";

export function createSymbolUi({ makeElement, getChordPreferences, getHostedPopoverDocument, pianoOptions = {}, chordPopover, chordPopoverSymbol, chordPopoverIntervals, chordPopoverNoteNames, chordPopoverStaff, chordPopoverStaffError, chordPopoverAudioError, chordPopoverPlay, chordPopoverPlayLabel, romanPopover, romanPopoverSymbol, romanPopoverStructure, tr = defaultTr }) {
  const musicAccidentals = new Set(["♭", "♯", "𝄫", "𝄪"]);
  const chordPianoPlayer = new ChordPianoPlayer(pianoOptions);
  let currentChordPopover = null;
  let chordStaffGeneration = 0;
  let currentRomanPopover = null;

  function appendChordNotation(parent, text, alreadyTransposed = false) {
    const preferences = { ...getChordPreferences() };
    if (alreadyTransposed) preferences.transposeInterval = "none";
    for (const token of displayNoteName(text, preferences).split(/([♭♯𝄫𝄪])/u).filter(Boolean)) {
      parent.append(musicAccidentals.has(token) ? makeElement("span", "score-chord-accidental", token) : document.createTextNode(token));
    }
  }

  function makeChordSymbol(result, center = null) {
    return symbolModelDom(chordSymbolModel(result, getChordPreferences().renderMode, getChordPreferences(), center), document);
  }

  function appendRomanNotation(parent, text) {
    for (const token of romanDisplayGlyphs(text).split(/([♮♭♯𝄫𝄪])/u).filter(Boolean)) {
      parent.append(musicAccidentals.has(token) || token === "♮"
        ? makeElement("span", "score-chord-accidental score-roman-accidental", token)
        : document.createTextNode(token));
    }
  }

  function makeRomanSymbol(result) {
    return symbolModelDom(romanSymbolModel(result), document);
  }

  function localTargetRect(target) {
    const rect = target.getBoundingClientRect();
    const frameRect = getHostedPopoverDocument() ? window.frameElement?.getBoundingClientRect() : null;
    return frameRect ? {
      left: frameRect.left + rect.left,
      right: frameRect.left + rect.right,
      top: frameRect.top + rect.top,
      bottom: frameRect.top + rect.bottom,
      width: rect.width,
      height: rect.height,
    } : rect;
  }

  function positionPopover(dialog, target) {
    if (!target?.isConnected || !dialog.open) return;
    const targetRect = localTargetRect(target);
    const dialogRect = dialog.getBoundingClientRect();
    const viewport = getHostedPopoverDocument()?.defaultView ?? window;
    const edge = 12;
    const gap = 10;
    const fullscreenTop = document.fullscreenElement
      || document.body.classList.contains("renderer-fullscreen-external")
      || document.body.classList.contains("renderer-fullscreen-desktop-preview")
      ? (document.querySelector(".renderer-nav")?.offsetHeight ?? 0)
      : 0;
    const topEdge = edge + fullscreenTop;
    const left = Math.min(
      Math.max(edge, targetRect.left + targetRect.width / 2 - dialogRect.width / 2),
      Math.max(edge, viewport.innerWidth - dialogRect.width - edge),
    );
    const preferredTop = targetRect.top - dialogRect.height - gap;
    const top = preferredTop >= topEdge
      ? preferredTop
      : Math.min(targetRect.bottom + gap, Math.max(topEdge, viewport.innerHeight - dialogRect.height - edge));
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  }

  function positionChordPopover() {
    const target = currentChordPopover?.target;
    positionPopover(chordPopover, target);
  }

  function positionRomanPopover() {
    positionPopover(romanPopover, currentRomanPopover?.target);
  }

  function closeChordPopover() {
    chordStaffGeneration += 1;
    currentChordPopover?.target?.setAttribute("aria-expanded", "false");
    currentChordPopover = null;
    if (chordPopover.open) chordPopover.close();
  }

  function closeRomanPopover() {
    currentRomanPopover?.target?.setAttribute("aria-expanded", "false");
    currentRomanPopover = null;
    if (romanPopover.open) romanPopover.close();
  }

  async function redrawChordPopoverStaff() {
    const current = currentChordPopover;
    if (!current) return;
    const generation = ++chordStaffGeneration;
    chordPopoverStaff.replaceChildren();
    chordPopoverStaffError.textContent = tr(current.pianoRangeError ? "chordPianoRangeError" : "chordStaffFailed");
    if (current.pianoRangeError) {
      chordPopoverStaff.removeAttribute("aria-busy");
      chordPopoverStaffError.hidden = false;
      return;
    }
    chordPopoverStaffError.hidden = true;
    chordPopoverStaff.setAttribute("aria-busy", "true");
    try {
      const rendered = await drawChordStaff(chordPopoverStaff, current.noteNames, current.midiNotes, {
        isCancelled: () => generation !== chordStaffGeneration || current !== currentChordPopover,
      });
      if (!rendered || generation !== chordStaffGeneration) return;
      chordPopoverStaff.removeAttribute("aria-busy");
      positionChordPopover();
    } catch {
      if (generation !== chordStaffGeneration) return;
      chordPopoverStaff.removeAttribute("aria-busy");
      chordPopoverStaffError.hidden = false;
    }
  }

  function openChordPopover(result, target, noteNameSpecial = "", center = null) {
    closeRomanPopover();
    currentChordPopover?.target?.setAttribute("aria-expanded", "false");
    const noteNameSpecials = getChordPreferences().sharp9AsFlat10 ? ["sharp9_as_flat10"] : [];
    if (noteNameSpecial) noteNameSpecials.push(noteNameSpecial);
    const preferences = getChordPreferences();
    const noteNames = result.structure.toNoteNames(noteNameSpecials).map(note => transposeNoteName(note, preferences));
    const voicing = result.structure.toPianoVoicing();
    const midiNotes = transposeMidiNotes(voicing.midiNotes, preferences);
    const audioMidiNotes = transposeMidiNotes(voicing.midiNotes, preferences, { audio: true });
    currentChordPopover = { result, target, noteNames, midiNotes, audioMidiNotes, pianoRangeError: voicing.rangeError };
    target.setAttribute("aria-expanded", "true");
    chordPopoverSymbol.replaceChildren(makeChordSymbol(result, center));
    chordPopoverIntervals.textContent = `[${result.structure.values.map(toMusicGlyphs).join(", ")}]`;
    chordPopoverNoteNames.replaceChildren(document.createTextNode("["));
    noteNames.forEach((note, index) => {
      if (index) chordPopoverNoteNames.append(document.createTextNode(", "));
      appendChordNotation(chordPopoverNoteNames, note, true);
    });
    chordPopoverNoteNames.append(document.createTextNode("]"));
    chordPopoverStaff.setAttribute("aria-label", tr("chordStaffAria", { notes: noteNames.map(toMusicGlyphs).join(", ") }));
    chordPopoverAudioError.hidden = true;
    chordPopoverPlay.disabled = voicing.rangeError;
    chordPopoverPlay.classList.remove("is-loading");
    chordPopoverPlayLabel.textContent = tr("playChord");
    if (!chordPopover.open) chordPopover.show();
    window.requestAnimationFrame(positionChordPopover);
    void redrawChordPopoverStaff();
  }

  function openRomanPopover(result, target) {
    if (!result.structure) return;
    closeChordPopover();
    currentRomanPopover?.target?.setAttribute("aria-expanded", "false");
    currentRomanPopover = { result, target };
    target.setAttribute("aria-expanded", "true");
    romanPopoverSymbol.replaceChildren(makeRomanSymbol(result));
    romanPopoverStructure.replaceChildren(document.createTextNode("["));
    for (const [index, degree] of result.structure.values.entries()) {
      if (index) romanPopoverStructure.append(document.createTextNode(", "));
      appendRomanNotation(romanPopoverStructure, degree);
    }
    romanPopoverStructure.append(document.createTextNode("]"));
    if (!romanPopover.open) romanPopover.show();
    window.requestAnimationFrame(positionRomanPopover);
  }

  function makeChordTrigger(target, noteNameSpecial = "", center = null) {
    const valueElement = makeElement("button", "event-value chord-trigger");
    valueElement.type = "button";
    valueElement.setAttribute("aria-haspopup", "dialog");
    valueElement.setAttribute("aria-controls", chordPopover.id);
    valueElement.setAttribute("aria-expanded", "false");
    const symbol = makeChordSymbol(target.chordResult, center);
    valueElement.setAttribute("aria-label", tr("chordDetailsAria", { chord: symbol.getAttribute("aria-label") }));
    valueElement.append(symbol);
    if (getChordPreferences().chordDegrees && center) valueElement.dataset.chordDegreeCenter = center;
    valueElement.addEventListener("click", () => openChordPopover(target.chordResult, valueElement, noteNameSpecial, center));
    return valueElement;
  }

  function makeRomanTrigger(target) {
    if (!target.romanResult.structure) {
      const valueElement = makeElement("span", "event-value roman-static");
      valueElement.append(makeRomanSymbol(target.romanResult));
      return valueElement;
    }
    const valueElement = makeElement("button", "event-value roman-trigger");
    valueElement.type = "button";
    valueElement.setAttribute("aria-haspopup", "dialog");
    valueElement.setAttribute("aria-controls", romanPopover.id);
    valueElement.setAttribute("aria-expanded", "false");
    valueElement.setAttribute("aria-label", tr("romanDetailsAria", { roman: target.roman }));
    valueElement.append(makeRomanSymbol(target.romanResult));
    valueElement.addEventListener("click", () => openRomanPopover(target.romanResult, valueElement));
    return valueElement;
  }

  function decorateRomanEventValue(valueElement, target, eventOrder) {
    valueElement.dataset.eventOrder = String(eventOrder);
    if (!target.romanFigureChain) return;
    valueElement.dataset.romanChainId = String(target.romanFigureChain.id);
    valueElement.dataset.romanChainIndex = String(target.romanFigureChain.index);
    valueElement.dataset.romanChainLink = target.romanFigureChain.link;
  }

  function appendAnnotation(valueElement, target, field, event) {
    const annotation = target[`${field}Annotation`];
    const annotationResult = target[`${field}AnnotationResult`];
    const cluster = field === "chord" && clusterSymbolModel(annotation, getChordPreferences().renderMode);
    if (!annotation || (!annotationResult && !cluster)) return valueElement;
    const combined = makeElement("span", "event-value-with-annotation");
    const annotationElement = makeElement("span", `event-annotation ${field}-annotation`);
    const annotationTarget = field === "chord"
      ? { chord: annotation, chordResult: annotationResult }
      : { roman: annotation, romanResult: annotationResult };
    const trigger = cluster ? symbolModelDom(cluster, document)
      : field === "chord" ? makeChordTrigger(annotationTarget, event.chordNoteNameSpecial, chordEventTonalCenter(event)) : makeRomanTrigger(annotationTarget);
    trigger.classList.add("event-annotation-trigger");
    annotationElement.append(document.createTextNode("("), trigger, document.createTextNode(")"));
    combined.append(valueElement, annotationElement);
    return combined;
  }

  function makeEventValue(target, field, event) {
    let valueElement;
    const cluster = field === "chord" && clusterSymbolModel(target.chord, getChordPreferences().renderMode);
    if (field === "chord" && target.chordResult) {
      valueElement = makeChordTrigger(target, event.chordNoteNameSpecial, chordEventTonalCenter(event));
    } else if (cluster) {
      valueElement = symbolModelDom(cluster, document);
    } else if (field === "roman" && target.romanResult) {
      valueElement = makeRomanTrigger(target);
      decorateRomanEventValue(valueElement, target, event.order);
    } else if (target[`${field}SymbolType`] === "placeholder") {
      valueElement = makeElement("span", "event-value harmony-placeholder");
      const symbol = makeElement("span", field === "chord" ? "score-chord-symbol" : "score-roman-symbol");
      if (field === "roman") symbol.append(makeElement("span", "score-roman-base", "X"));
      else symbol.textContent = "X";
      valueElement.append(symbol);
    } else {
      const symbolType = target[`${field}SymbolType`];
      const text = symbolType === "continuation" ? "—" : (field === "chord" ? formatAccidentals(target.chord) : target.roman);
      valueElement = makeElement("span", "event-value", text);
    }
    if (field === "chord") valueElement.dataset.eventOrder = String(event.order);
    const result = appendAnnotation(valueElement, target, field, event);
    if (event.secondary) result.classList.add("secondary-harmony-event");
    return result;
  }

  return { appendChordNotation, appendRomanNotation, makeRomanSymbol, makeEventValue, openChordPopover, closeChordPopover, closeRomanPopover, positionChordPopover, positionRomanPopover, getCurrentChordPopover: () => currentChordPopover, chordPianoPlayer };
}
