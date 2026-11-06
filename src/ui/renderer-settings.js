import {
  normalizeRendererShortcuts,
  readRendererShortcuts,
  shortcutFromKeyboardEvent,
  writeRendererShortcuts,
} from "../core/renderer-shortcuts.js";
import { TRANSPOSE_INTERVALS } from "../core/transposition.js";
import { getInterfaceLocale } from "../editor-i18n.js";

export function setupRendererSettings({ getPreferences, updatePreferences, getTransposition, updateTransposition, getScale, updateScale, canScale = () => true, openHostSettings, storageKey, tr }) {
  const button = document.querySelector("#rendererSettingsButton");
  const dialog = document.querySelector("#rendererSettingsDialog");
  const close = document.querySelector("#rendererSettingsClose");
  const renderMode = document.querySelector("#rendererRenderMode");
  const qualitySelects = [...document.querySelectorAll("[data-chord-quality-preference]")];
  const sharp9AsFlat10 = document.querySelector("#rendererSharp9AsFlat10");
  const accidentalBeforeNote = document.querySelector("#rendererAccidentalBeforeNote");
  const chordDegrees = document.querySelector("#rendererChordDegrees");
  const minorTonicSix = document.querySelector("#rendererMinorTonicSix");
  const durationDisplayMode = document.querySelector("#rendererDurationDisplayMode");
  const durationControl = document.querySelector("#rendererDurationControl");
  const durationStemDown = document.querySelector("#rendererDurationStemDown");
  const scale = document.querySelector("#rendererScale");
  const scaleValue = document.querySelector("#rendererScaleValue");
  const globalPlaybackOffset = document.querySelector("#rendererGlobalPlaybackOffset");
  const status = document.querySelector("#rendererSettingsStatus");
  const shortcutInputs = [...document.querySelectorAll("[data-shortcut-action]")];
  let shortcuts = readRendererShortcuts();
  const direction = document.querySelector("#rendererTransposeDirection");
  const interval = document.querySelector("#rendererTransposeInterval");
  const follows = document.querySelector("#rendererPianoFollowsTranspose");
  for (const input of [direction, interval, follows]) input.addEventListener("change", () => updateTransposition({
    transposeDirection: direction.value, transposeInterval: interval.value, pianoFollowsTranspose: follows.checked,
  }));

  function reflectPreferences() {
    const preferences = getPreferences();
    const transposition = getTransposition();
    direction.value = transposition.transposeDirection;
    interval.replaceChildren(...TRANSPOSE_INTERVALS.map(item => new Option(item[getInterfaceLocale() === "en" ? "en" : "zh"], item.id)));
    interval.value = transposition.transposeInterval;
    follows.checked = transposition.pianoFollowsTranspose;
    renderMode.value = preferences.renderMode;
    qualitySelects.forEach((select) => { select.value = preferences[select.dataset.chordQualityPreference]; });
    sharp9AsFlat10.checked = preferences.sharp9AsFlat10;
    accidentalBeforeNote.checked = preferences.accidentalBeforeNote;
    accidentalBeforeNote.disabled = preferences.chordDegrees;
    chordDegrees.checked = preferences.chordDegrees;
    minorTonicSix.checked = preferences.minorTonicSix;
    minorTonicSix.disabled = !preferences.chordDegrees;
    durationDisplayMode.checked = preferences.durationDisplayMode === "fraction";
    durationControl.dataset.mode = preferences.durationDisplayMode;
    durationStemDown.checked = preferences.durationStemDown;
    durationStemDown.disabled = preferences.durationDisplayMode !== "note";
    scale.value = String(getScale());
    scale.disabled = !canScale();
    scaleValue.value = `${getScale()}%`;
    globalPlaybackOffset.value = String(preferences.globalPlaybackOffset);
    shortcuts = normalizeRendererShortcuts(shortcuts);
    shortcutInputs.forEach((input) => {
      input.value = shortcuts[input.dataset.shortcutAction] || "";
      input.placeholder = tr("settingsShortcutUnset");
    });
  }

  function changePreferences(next) {
    updatePreferences(next);
    status.textContent = "";
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      status.textContent = tr("settingsSaveFailed");
    }
  }

  button.addEventListener("click", () => {
    if (openHostSettings?.()) return;
    reflectPreferences();
    status.textContent = "";
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => button.focus());
  renderMode.addEventListener("change", () => changePreferences({ ...getPreferences(), renderMode: renderMode.value }));
  qualitySelects.forEach((select) => select.addEventListener("change", () => changePreferences({ ...getPreferences(), [select.dataset.chordQualityPreference]: select.value })));
  sharp9AsFlat10.addEventListener("change", () => changePreferences({ ...getPreferences(), sharp9AsFlat10: sharp9AsFlat10.checked }));
  accidentalBeforeNote.addEventListener("change", () => changePreferences({ ...getPreferences(), accidentalBeforeNote: accidentalBeforeNote.checked }));
  chordDegrees.addEventListener("change", () => {
    changePreferences({ ...getPreferences(), chordDegrees: chordDegrees.checked });
    reflectPreferences();
  });
  minorTonicSix.addEventListener("change", () => changePreferences({ ...getPreferences(), minorTonicSix: minorTonicSix.checked }));
  durationDisplayMode.addEventListener("change", () => {
    const mode = durationDisplayMode.checked ? "fraction" : "note";
    durationControl.dataset.mode = mode;
    changePreferences({ ...getPreferences(), durationDisplayMode: mode });
    reflectPreferences();
  });
  durationStemDown.addEventListener("change", () => changePreferences({ ...getPreferences(), durationStemDown: durationStemDown.checked }));
  scale.addEventListener("input", () => {
    if (!canScale()) return;
    updateScale(Number(scale.value));
    scaleValue.value = `${getScale()}%`;
  });
  globalPlaybackOffset.addEventListener("change", () => {
    const source = globalPlaybackOffset.value.trim();
    const value = source === "" ? Number.NaN : Number(source);
    if (!Number.isSafeInteger(value)) {
      status.textContent = tr("settingsGlobalPlaybackOffsetInvalid");
      globalPlaybackOffset.value = String(getPreferences().globalPlaybackOffset);
      return;
    }
    changePreferences({ ...getPreferences(), globalPlaybackOffset: value });
  });
  globalPlaybackOffset.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    globalPlaybackOffset.blur();
  });
  shortcutInputs.forEach((input) => {
    input.addEventListener("focus", () => {
      input.classList.add("is-capturing");
      input.value = "";
      input.placeholder = tr("settingsShortcutCapture");
      status.textContent = "";
    });
    input.addEventListener("blur", () => {
      input.classList.remove("is-capturing");
      reflectPreferences();
    });
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        input.blur();
        return;
      }
      const action = input.dataset.shortcutAction;
      if (["Backspace", "Delete"].includes(event.key) && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        shortcuts = { ...shortcuts, [action]: "" };
      } else {
        const captured = shortcutFromKeyboardEvent(event);
        if (!captured.complete) return;
        if (captured.tooLong) {
          status.textContent = tr("settingsShortcutTooLong");
          return;
        }
        if (Object.entries(shortcuts).some(([name, binding]) => name !== action && binding === captured.binding)) {
          status.textContent = tr("settingsShortcutDuplicate");
          return;
        }
        shortcuts = { ...shortcuts, [action]: captured.binding };
      }
      try {
        shortcuts = writeRendererShortcuts(shortcuts);
        status.textContent = "";
      } catch {
        status.textContent = tr("settingsSaveFailed");
      }
      input.blur();
    });
  });
}
