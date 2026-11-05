import { drawChordStaff } from "../core/chord-staff.js";
import { toMusicGlyphs } from "../core/chord-symbol.js";
import { playbackEntryInformation } from "../core/mstruct-playback-info.js";
import { chordEventTonalCenter } from "../core/note-display.js";

const EMPTY_VALUE = "—";
const MIN_INLINE_FONT_SIZE = 12;

function makeStaticClone(source) {
  if (!source) return null;
  const clone = source.cloneNode(true);
  const buttons = clone.matches?.("button") ? [clone, ...clone.querySelectorAll("button")] : [...clone.querySelectorAll("button")];
  for (const button of buttons) {
    button.tabIndex = -1;
    button.removeAttribute("aria-haspopup");
    button.removeAttribute("aria-controls");
    button.removeAttribute("aria-expanded");
  }
  return clone;
}

function replaceWithClone(target, source) {
  if (!source || source.classList.contains("is-empty") || !source.textContent.trim()) {
    target.textContent = EMPTY_VALUE;
    return;
  }
  const clone = makeStaticClone(source);
  target.replaceChildren(clone);
}

function restoreRomanChainContexts(canvas, clone) {
  const chainValues = [
    ...(clone.matches?.("[data-roman-chain-id]") ? [clone] : []),
    ...clone.querySelectorAll("[data-roman-chain-id]"),
  ];
  for (const value of chainValues) {
    if (value.dataset.romanChainIndex === "0") continue;
    const targetSymbol = value.matches?.(".score-roman-symbol") ? value : value.querySelector?.(".score-roman-symbol");
    if (!targetSymbol || targetSymbol.querySelector(".score-roman-base")) continue;
    const chainId = CSS.escape(String(value.dataset.romanChainId));
    const source = canvas.querySelector(`[data-roman-chain-id="${chainId}"][data-roman-chain-index="0"]`);
    const sourceSymbol = source?.matches?.(".score-roman-symbol") ? source : source?.querySelector?.(".score-roman-symbol");
    if (!sourceSymbol) continue;
    const context = [...sourceSymbol.children]
      .filter((element) => element.matches(".score-roman-base, .score-roman-sup"))
      .map((element) => makeStaticClone(element));
    targetSymbol.prepend(...context);
  }
}

function restoreRomanTonalContext(clone, item, appendChordNotation) {
  const tonalCenter = item.event?.tonalCenter;
  if (!clone || !tonalCenter) return clone;
  const selector = ".modulation-pair, .tonal-prefix, .modulation-prefix, .tonal-cluster";
  if (clone.matches?.(selector) || clone.querySelector?.(".modulation-pair, .tonal-prefix, .modulation-prefix")) return clone;

  const key = document.createElement("span");
  key.className = "tonal-label-key";
  appendChordNotation(key, tonalCenter);
  const label = document.createElement("span");
  label.className = "tonal-label";
  label.append(key);
  label.append(document.createTextNode(":"));
  const prefix = document.createElement("span");
  prefix.className = "tonal-prefix";
  prefix.append(label);
  const cluster = document.createElement("span");
  cluster.className = "tonal-cluster";
  cluster.append(prefix, clone);
  return cluster;
}

function harmonyItemNode(canvas, item, field, appendChordNotation) {
  const slot = canvas.querySelector(`[data-playback-slot="${CSS.escape(String(item.slotId))}"]`);
  if (!slot) return null;
  const lineSelector = item.kind === "standalone"
    ? ".standalone-line"
    : field === "chord" ? ".chord-line" : ".roman-line, .modulation-line";
  const valueSelector = `[data-event-order="${CSS.escape(String(item.eventOrder))}"]`;
  const line = [...slot.querySelectorAll(lineSelector)]
    .find((candidate) => candidate.querySelector(valueSelector));
  const value = line?.querySelector(valueSelector);
  if (!line || !value) return null;
  const wrapper = field === "roman"
    ? value.closest(".modulation-pair")
      ?? value.closest(".tonal-cluster")
      ?? value.closest(".event-value-with-annotation")
    : value.closest(".tonal-cluster") ?? value.closest(".event-value-with-annotation");
  const clone = makeStaticClone(wrapper && line.contains(wrapper) ? wrapper : value);
  if (field !== "roman" || !clone) {
    const center = value.dataset.chordDegreeCenter;
    return center ? restoreRomanTonalContext(clone, { event: { tonalCenter: center } }, appendChordNotation) : clone;
  }

  const modulationPair = clone.matches?.(".modulation-pair") ? clone : clone.querySelector?.(".modulation-pair");
  if (modulationPair && !modulationPair.querySelector(".modulation-opening") && item.event?.modulationId !== undefined) {
    const modulationId = CSS.escape(String(item.event.modulationId));
    const opening = canvas.querySelector(`.modulation-pair[data-modulation-id="${modulationId}"] .modulation-opening`);
    if (opening) modulationPair.append(makeStaticClone(opening));
  }

  restoreRomanChainContexts(canvas, clone);
  return restoreRomanTonalContext(clone, item, appendChordNotation);
}

function replaceWithHarmonyItems(target, canvas, items, field, fallback, appendChordNotation) {
  if (!Array.isArray(items)) {
    replaceWithClone(target, fallback);
    return [];
  }
  const group = document.createElement("div");
  const rendered = [];
  group.className = field === "chord" && items.some((item) => item.kind === "standalone")
    ? "standalone-line"
    : `${field}-line`;
  for (const item of items) {
    const node = harmonyItemNode(canvas, item, field, appendChordNotation);
    if (!node) continue;
    if (group.childNodes.length) {
      const separator = document.createElement("span");
      separator.className = "event-separator";
      separator.textContent = " / ";
      group.append(separator);
    }
    group.append(node);
    rendered.push({ item, node });
  }
  if (!group.childNodes.length) target.textContent = EMPTY_VALUE;
  else target.replaceChildren(group);
  return rendered;
}

export function renderFullscreenBpm(target, information, makeBpmLabel) {
  const ownerDocument = target.ownerDocument;
  target.replaceChildren();
  if (!information.bpm) {
    target.textContent = EMPTY_VALUE;
    return;
  }
  const makeParenthesis = (value = "") => {
    const parenthesis = ownerDocument.createElement("span");
    parenthesis.className = "bpm-parenthesis";
    parenthesis.textContent = value;
    return parenthesis;
  };
  const primary = ownerDocument.createElement("span");
  primary.className = "bpm-line bpm-primary";
  primary.append(makeParenthesis(), makeBpmLabel(information.bpm), makeParenthesis());
  target.append(primary);
  if (!information.bpmReference) return;
  const comparison = ownerDocument.createElement("span");
  comparison.className = "bpm-line bpm-comparison";
  comparison.append(
    makeParenthesis("("),
    makeBpmLabel(information.bpmReference),
    makeParenthesis(")"),
  );
  target.append(comparison);
}

export function createRendererFullscreen({
  rendererPanel,
  canvas,
  button,
  infoPanel,
  tr,
  getLocale,
  getComments,
  renderCommentText,
  getChordPreferences,
  makeTagLabel,
  makeFormSymbol,
  makeBpmLabel,
  appendChordNotation,
  openChordPopover,
  setFullscreenPopovers,
  onLayoutChange,
  onActiveChange,
  desktopPreviewMode = false,
  postToHost,
}) {
  const timestamp = infoPanel.querySelector("#rendererFullscreenTimestamp");
  const measure = infoPanel.querySelector("#rendererFullscreenMeasure");
  const timeSignature = infoPanel.querySelector("#rendererFullscreenTimeSignature");
  const bpm = infoPanel.querySelector("#rendererFullscreenBpm");
  const chord = infoPanel.querySelector("#rendererFullscreenChord");
  const noteNames = infoPanel.querySelector("#rendererFullscreenNoteNames");
  const staff = infoPanel.querySelector("#rendererFullscreenStaff");
  const roman = infoPanel.querySelector("#rendererFullscreenRoman");
  const form = infoPanel.querySelector("#rendererFullscreenForm");
  const tags = infoPanel.querySelector("#rendererFullscreenTags");
  const comment = infoPanel.querySelector("#rendererFullscreenComment");
  let externalFullscreen = false;
  let desktopPreview = false;
  let staffReady = Promise.resolve();
  let readyEntry = null;
  let latestState = null;
  let latestEntry = null;
  let renderedEntry = null;
  let staffGeneration = 0;
  let scrollbarTimer = null;
  let fitFrame = null;
  let layoutFrame = null;

  function active() {
    return externalFullscreen || desktopPreview || document.fullscreenElement === rendererPanel;
  }

  function notifyLayoutChange() {
    if (!onLayoutChange) return;
    if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame);
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = null;
        onLayoutChange();
      });
    });
  }

  function reflectButton() {
    const isActive = active();
    onActiveChange?.(isActive);
    const label = tr(isActive ? "rendererExitFullscreen" : "rendererFullscreen");
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  function fitInlineField(target) {
    target.style.removeProperty("font-size");
    const available = target.clientWidth;
    if (available <= 0 || target.scrollWidth <= available + 1) return;
    const preferred = Number.parseFloat(window.getComputedStyle(target).fontSize);
    if (!Number.isFinite(preferred)) return;
    let size = Math.max(MIN_INLINE_FONT_SIZE, preferred * available / target.scrollWidth);
    target.style.fontSize = `${size}px`;
    while (size > MIN_INLINE_FONT_SIZE && target.scrollWidth > available + 1) {
      size = Math.max(MIN_INLINE_FONT_SIZE, size - .5);
      target.style.fontSize = `${size}px`;
    }
  }

  function fitInformation() {
    if (!active()) return;
    if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
    fitFrame = window.requestAnimationFrame(() => {
      fitFrame = null;
      fitInlineField(chord);
      fitInlineField(noteNames);
      const available = comment.clientHeight;
      if (available <= 0) return;
      const preferred = Math.max(20, Math.min(32, window.innerHeight * .034));
      let size = preferred;
      comment.style.fontSize = `${size}px`;
      comment.style.overflowY = "hidden";
      while (size > 12 && comment.scrollHeight > available + 1) {
        size -= 1;
        comment.style.fontSize = `${size}px`;
      }
      comment.style.overflowY = comment.scrollHeight > available + 1 ? "auto" : "hidden";
    });
  }

  function clearEntry() {
    renderedEntry = null;
    staffGeneration += 1;
    chord.classList.remove("is-chord-interactive");
    for (const target of [timeSignature, bpm, chord, noteNames, roman, form, tags, comment]) target.textContent = EMPTY_VALUE;
    chord.style.removeProperty("font-size");
    noteNames.style.removeProperty("font-size");
    staff.replaceChildren();
    staff.removeAttribute("aria-label");
    fitInformation();
  }

  async function drawStaff(information) {
    const generation = ++staffGeneration;
    staff.replaceChildren();
    if (!information.noteNames.length || !information.midiNotes.length) return;
    staff.setAttribute("aria-label", tr("chordStaffAria", {
      notes: information.noteNames.map(toMusicGlyphs).join(", "),
    }));
    try {
      await drawChordStaff(staff, information.noteNames, information.midiNotes, {
        isCancelled: () => generation !== staffGeneration,
      });
    } catch {
      if (generation === staffGeneration) staff.textContent = tr("chordStaffFailed");
    }
  }

  function renderNoteNames(information) {
    noteNames.replaceChildren();
    if (!information.noteNames.length) {
      noteNames.textContent = EMPTY_VALUE;
      return;
    }
    noteNames.append(document.createTextNode("["));
    for (const [index, name] of information.noteNames.entries()) {
      if (index) noteNames.append(document.createTextNode(", "));
      appendChordNotation(noteNames, name, true);
    }
    noteNames.append(document.createTextNode("]"));
  }

  function makeChordInteractive(renderedItems) {
    if (latestState?.selecting || !openChordPopover) return false;
    let interactive = false;
    for (const { item, node } of renderedItems) {
      if (item.kind !== "chord" || !item.event?.chordResult?.structure) continue;
      const trigger = node.matches?.(".chord-trigger") ? node : node.querySelector(".chord-trigger");
      if (!trigger) continue;
      trigger.tabIndex = 0;
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", () => openChordPopover(
        item.event.chordResult,
        trigger,
        item.event.chordNoteNameSpecial,
        chordEventTonalCenter(item.event),
      ));
      interactive = true;
    }
    return interactive;
  }

  function renderEntry(entry) {
    renderedEntry = entry;
    if (!entry) {
      clearEntry();
      return;
    }
    const information = playbackEntryInformation(entry, {
      ...getChordPreferences(),
      comments: getComments(),
      locale: getLocale(),
      sharp9AsFlat10: getChordPreferences().sharp9AsFlat10,
    });
    timeSignature.textContent = information.timeSignatureLabel || EMPTY_VALUE;
    renderFullscreenBpm(bpm, information, makeBpmLabel);
    const slotElement = canvas.querySelector(`[data-playback-slot="${CSS.escape(String(entry.slotId))}"]`);
    const harmony = slotElement?.querySelector(".harmony-stack");
    const renderedChordItems = replaceWithHarmonyItems(
      chord,
      canvas,
      entry.chordDisplayItems,
      "chord",
      harmony?.querySelector(".chord-line:not(.is-empty), .standalone-line:not(.is-empty)"),
      appendChordNotation,
    );
    chord.classList.toggle("is-chord-interactive", makeChordInteractive(renderedChordItems));
    const romanLine = harmony?.querySelector(".roman-line:not(.is-empty), .modulation-line:not(.is-empty)");
    replaceWithHarmonyItems(roman, canvas, entry.romanDisplayItems, "roman", romanLine, appendChordNotation);
    form.replaceChildren();
    if (information.formSymbol) form.append(makeFormSymbol(information.formSymbol));
    else form.textContent = EMPTY_VALUE;
    renderNoteNames(information);
    tags.replaceChildren();
    if (information.activeTags.length) {
      for (const tag of information.activeTags) tags.append(makeTagLabel(tag, "tag-label renderer-fullscreen-tag"));
    } else {
      tags.textContent = EMPTY_VALUE;
    }
    renderCommentText(comment, information.comment?.text || EMPTY_VALUE);
    staffReady = drawStaff(information);
    fitInformation();
  }

  function update(state, entry) {
    const selectingChanged = latestState?.selecting !== state?.selecting;
    latestState = state;
    latestEntry = entry;
    timestamp.textContent = state?.timestamp ?? "00:00.000";
    measure.textContent = state?.position ?? EMPTY_VALUE;
    if (entry !== renderedEntry || selectingChanged) renderEntry(entry);
  }

  async function toggle() {
    if (externalFullscreen) {
      postToHost("fullscreen-exit-request");
      return;
    }
    if (desktopPreviewMode) {
      setDesktopPreview(!desktopPreview);
      return;
    }
    try {
      if (document.fullscreenElement === rendererPanel) await document.exitFullscreen();
      else await rendererPanel.requestFullscreen();
    } catch {
      document.body.classList.remove("renderer-fullscreen-internal");
      reflectButton();
    }
  }

  function clearScrollbar() {
    if (scrollbarTimer !== null) window.clearTimeout(scrollbarTimer);
    scrollbarTimer = null;
    canvas.classList.remove("is-scrollbar-active");
  }

  function revealScrollbar() {
    if (!active()) return;
    canvas.classList.add("is-scrollbar-active");
    if (scrollbarTimer !== null) window.clearTimeout(scrollbarTimer);
    scrollbarTimer = window.setTimeout(clearScrollbar, 800);
  }

  function handleFullscreenChange() {
    document.body.classList.toggle("renderer-fullscreen-internal", document.fullscreenElement === rendererPanel);
    setFullscreenPopovers?.(active());
    if (!active()) clearScrollbar();
    reflectButton();
    if (active()) renderEntry(latestEntry);
    notifyLayoutChange();
  }

  function setExternalFullscreen(value) {
    externalFullscreen = Boolean(value);
    document.body.classList.toggle("renderer-fullscreen-external", externalFullscreen);
    document.documentElement.classList.toggle("renderer-fullscreen-external-root", externalFullscreen);
    setFullscreenPopovers?.(externalFullscreen);
    if (!externalFullscreen) clearScrollbar();
    reflectButton();
    if (externalFullscreen) renderEntry(latestEntry);
    notifyLayoutChange();
  }

  function setDesktopPreview(value) {
    desktopPreview = Boolean(value);
    document.body.classList.toggle("renderer-fullscreen-desktop-preview", desktopPreview);
    setFullscreenPopovers?.(active());
    if (!desktopPreview) clearScrollbar();
    reflectButton();
    if (desktopPreview) renderEntry(latestEntry);
    notifyLayoutChange();
  }

  function handlePreviewKeydown(event) {
    if (!desktopPreview || event.key !== "Escape") return;
    event.preventDefault();
    setDesktopPreview(false);
  }

  function refresh() {
    reflectButton();
    renderedEntry = null;
    update(latestState, latestEntry);
  }

  button.addEventListener("click", toggle);
  canvas.addEventListener("scroll", revealScrollbar, { passive: true });
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  window.addEventListener("keydown", handlePreviewKeydown);
  const resizeObserver = new ResizeObserver(() => {
    fitInformation();
    if (active()) notifyLayoutChange();
  });
  resizeObserver.observe(infoPanel);
  reflectButton();
  clearEntry();

  return {
    update,
    enter() { if (!active()) return toggle(); },
    async whenReady() {
      await staffReady;
      if (readyEntry === renderedEntry) return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      readyEntry = renderedEntry;
    },
    refresh,
    setExternalFullscreen,
    setDesktopPreview,
    destroy() {
      resizeObserver.disconnect();
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame);
      clearScrollbar();
      button.removeEventListener("click", toggle);
      canvas.removeEventListener("scroll", revealScrollbar);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handlePreviewKeydown);
      setDesktopPreview(false);
    },
  };
}
