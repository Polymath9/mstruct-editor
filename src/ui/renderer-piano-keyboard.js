import { playbackEntryInformation } from "../core/mstruct-playback-info.js";
import { isPlayableMidi, pianoKeyboardRange, pianoKeyMidi, transposeMidiNotes } from "../core/transposition.js";

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function pianoKeyboardOverlaps(event, keyboard) {
  return Boolean(event && keyboard && event.left < keyboard.right && event.right > keyboard.left
    && event.top < keyboard.bottom && event.bottom > keyboard.top);
}

export function pianoKeyboardScrollTarget(event, system, keyboard, visibleTop) {
  if (!pianoKeyboardOverlaps(event, keyboard)) return null;
  return system && system.height <= keyboard.top - visibleTop ? system : event;
}

/** Shared keyboard. Hosts supply viewport geometry in iframe coordinates. */
export function createRendererPianoKeyboard({ panel, canvas, nav, player, getPreferences, getLayers, tr, isHostedViewer, requestScroll }) {
  const root = document.createElement("section");
  root.className = "renderer-piano-keyboard";
  root.hidden = true;
  const scroller = document.createElement("div");
  scroller.className = "renderer-piano-scroll";
  const keys = document.createElement("div");
  keys.className = "renderer-piano-keys";
  const status = document.createElement("div");
  status.className = "renderer-piano-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  scroller.append(keys);
  root.append(scroller, status);
  panel.append(root);
  let documentNotes = [], buttons = [], currentEntry = null, viewport = null;
  let rangeSignature = "", preferenceSignature = "", frame = null, audioFailed = false;
  let autoScroll = false, pendingHostScroll = false, attemptedScrollElement = null;
  let wasEnabled = false, destroyed = false;
  const held = new Map();

  function release(pointerId) {
    const voice = held.get(pointerId);
    if (!voice) return;
    held.delete(pointerId);
    voice.cancelled = true;
    voice.stop?.();
    voice.button.classList.toggle("is-pressed", [...held.values()].some(other => other.button === voice.button));
  }
  function releaseAll() { for (const id of held.keys()) release(id); }
  function fullscreen() {
    return Boolean(document.fullscreenElement || document.body.classList.contains("renderer-fullscreen-external")
      || document.body.classList.contains("renderer-fullscreen-desktop-preview"));
  }
  function available() { return canvas.dataset.fixedScale !== "true"; }

  function buildKeys() {
    const range = pianoKeyboardRange(transposeMidiNotes(documentNotes, getPreferences()));
    const signature = `${range.low}/${range.high}`;
    if (signature === rangeSignature) return;
    rangeSignature = signature;
    releaseAll();
    let whiteCount = 0;
    buttons = [];
    for (let midi = range.low; midi <= range.high; midi += 1) {
      const black = BLACK_KEYS.has(midi % 12);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `renderer-piano-key${black ? " is-black" : ""}`;
      button.dataset.midi = String(midi);
      const name = `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
      button.setAttribute("aria-label", name);
      button.title = name;
      button.style.setProperty("--key-position", String(black ? whiteCount - 0.32 : whiteCount));
      if (!black) whiteCount += 1;
      if (midi % 12 === 0) button.textContent = name;
      buttons.push(button);
    }
    keys.style.setProperty("--white-key-count", String(whiteCount));
    keys.replaceChildren(...buttons);
  }

  function bottomPlacement() {
    const hosted = isHostedViewer && !fullscreen();
    const bounds = canvas.getBoundingClientRect(), panelBounds = panel.getBoundingClientRect();
    const view = hosted && viewport ? viewport : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    const visibleTop = Math.max(bounds.top, view.top);
    const visibleBottom = Math.min(hosted ? panelBounds.bottom : bounds.bottom, view.bottom);
    const left = Math.max(bounds.left, view.left) + 10;
    const right = Math.min(bounds.right, view.right) - 10;
    const navBottom = hosted ? view.top : Math.max(visibleTop, nav.getBoundingClientRect().bottom);
    if (visibleBottom - navBottom < 110 || right <= left) return null;
    root.style.width = `${right - left}px`;
    const height = root.offsetHeight;
    return { left, right, top: visibleBottom - height - 10, bottom: visibleBottom - 10, height, navBottom, panelBounds };
  }

  function layout() {
    frame = null;
    const enabled = getLayers().pianoKeyboard === true && available();
    const shouldPreload = enabled && !wasEnabled && !document.body.classList.contains("video-export-mode");
    wasEnabled = enabled;
    if (shouldPreload) {
      audioFailed = false;
      void player.load({ resume: false }).then(() => {
        if (!destroyed && wasEnabled) { audioFailed = false; update(); }
      }).catch(() => {
        if (!destroyed && wasEnabled) { audioFailed = true; update(); }
      });
    }
    canvas.classList.toggle("renderer-has-piano-space", enabled);
    root.hidden = !enabled;
    if (!enabled) { releaseAll(); return; }
    const placement = bottomPlacement();
    if (!placement) { root.hidden = true; releaseAll(); return; }
    const { left, height, navBottom, panelBounds } = placement;
    canvas.style.setProperty("--piano-bottom-space", `${height + 20}px`);
    let top = placement.top;
    const active = canvas.querySelector(".is-playback-active");
    if (autoScroll && pianoKeyboardOverlaps(active?.getBoundingClientRect(), placement)
      && !pendingHostScroll && attemptedScrollElement !== active) {
      attemptedScrollElement = active;
      requestScroll(active);
    }
    if (!pendingHostScroll && pianoKeyboardOverlaps(active?.getBoundingClientRect(), placement)) top = navBottom + 10;
    root.style.left = `${left - panelBounds.left}px`;
    root.style.top = `${Math.max(navBottom + 6, top) - panelBounds.top}px`;
  }
  function scheduleLayout() {
    if (frame === null) frame = requestAnimationFrame(layout);
  }
  function update(entry = currentEntry, { scroll = false } = {}) {
    currentEntry = entry;
    const signature = JSON.stringify(getPreferences());
    if (signature !== preferenceSignature) {
      preferenceSignature = signature;
      releaseAll();
      buildKeys();
    }
    const information = playbackEntryInformation(entry, getPreferences());
    const active = new Set(information.midiNotes);
    const invalid = information.midiNotes.some(note => !isPlayableMidi(note) || !isPlayableMidi(pianoKeyMidi(note, getPreferences())));
    root.setAttribute("aria-label", tr("rendererLayerPianoKeyboard"));
    status.hidden = !invalid && !audioFailed;
    status.textContent = invalid ? tr("pianoKeyboardRangeError") : audioFailed ? tr("pianoKeyboardAudioError") : "";
    for (const button of buttons) {
      const midi = Number(button.dataset.midi);
      button.classList.toggle("is-active", active.has(midi));
      button.disabled = !isPlayableMidi(pianoKeyMidi(midi, getPreferences()));
    }
    layout();
    if (scroll && !root.hidden && active.size) {
      const selected = buttons.filter(button => active.has(Number(button.dataset.midi)));
      const first = selected[0], last = selected.at(-1);
      if (first && last) {
        const left = first.offsetLeft, right = last.offsetLeft + last.offsetWidth;
        if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
          scroller.scrollLeft = Math.max(0, (left + right - scroller.clientWidth) / 2);
        }
      }
    }
  }

  root.addEventListener("pointerdown", event => {
    const button = event.target.closest("[data-midi]");
    if (!button || button.disabled || event.button !== 0) return;
    event.preventDefault();
    release(event.pointerId);
    button.setPointerCapture(event.pointerId);
    const voice = { button, cancelled: false, stop: null };
    held.set(event.pointerId, voice);
    button.classList.add("is-pressed");
    audioFailed = false;
    void player.noteOn(pianoKeyMidi(Number(button.dataset.midi), getPreferences()), () => voice.cancelled)
      .then(stop => { if (voice.cancelled) stop(); else voice.stop = stop; })
      .catch(() => {
        if (voice.cancelled || destroyed) return;
        release(event.pointerId); audioFailed = true; update();
      });
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) root.addEventListener(type, event => release(event.pointerId));
  window.addEventListener("blur", releaseAll);
  window.addEventListener("scroll", scheduleLayout, true);
  window.addEventListener("resize", scheduleLayout);
  const observer = new ResizeObserver(scheduleLayout);
  observer.observe(canvas); observer.observe(nav);
  buildKeys();
  return {
    update(entry, state) {
      const changed = autoScroll !== state.autoScroll;
      autoScroll = state.autoScroll;
      if (changed) attemptedScrollElement = null;
      if (entry !== currentEntry || changed) update(entry, { scroll: entry !== currentEntry });
    },
    scrollObstruction(element) {
      if (root.hidden || !available()) return null;
      const placement = bottomPlacement();
      if (!placement) return null;
      const target = pianoKeyboardScrollTarget(element.getBoundingClientRect(), element.closest(".score-system")?.getBoundingClientRect(), placement, placement.navBottom);
      return target ? { target, bottomInset: placement.height + 10 } : null;
    },
    waitForHostScroll(element) { pendingHostScroll = true; attemptedScrollElement = element; },
    completeHostScroll() { pendingHostScroll = false; scheduleLayout(); },
    refresh: () => update(),
    available,
    setViewport(value) {
      if (["top", "bottom", "left", "right"].every(key => Number.isFinite(value?.[key]))) viewport = value;
      layout();
    },
    setDocument(result) {
      releaseAll();
      attemptedScrollElement = null; pendingHostScroll = false;
      documentNotes = [];
      for (const measure of result?.measures ?? []) for (const slot of measure.slots) for (const event of slot.events) {
        if (event.chordResult?.structure) documentNotes.push(...event.chordResult.structure.toMidiNotes());
      }
      rangeSignature = ""; buildKeys(); update(null);
    },
    destroy() {
      destroyed = true;
      releaseAll(); observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("scroll", scheduleLayout, true);
      window.removeEventListener("resize", scheduleLayout);
      root.remove(); canvas.classList.remove("renderer-has-piano-space"); canvas.style.removeProperty("--piano-bottom-space");
    },
  };
}
