const STORAGE_KEY = "mstruct-editor-roman-warnings";

export function setupEditorWarningSettings(onChange) {
  const recommendations = createEditorWarningSettings({ button: document.querySelector("#romanWarningsButton"),
    control: document.querySelector("#romanWarningsControl"), onChange });
  const validation = createEditorWarningSettings({ button: document.querySelector("#romanBassValidationButton"),
    control: document.querySelector("#romanBassValidationControl"), storageKey: "mstruct-editor-roman-bass-validation", onChange });
  return () => ({ showRomanWarnings: recommendations.enabled, validateRomanBass: validation.enabled });
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

/** This personal display preference never changes the document or compiler options. */
export function createEditorWarningSettings({ button, control, onChange, storage = browserStorage(), storageKey = STORAGE_KEY }) {
  let enabled = true;
  try { enabled = storage?.getItem(storageKey) !== "false"; } catch { /* Keep the default. */ }
  function reflect() {
    button.setAttribute("aria-checked", String(enabled));
    control.classList.toggle("is-on", enabled);
  }
  button.addEventListener("click", () => {
    enabled = !enabled;
    try { storage?.setItem(storageKey, String(enabled)); } catch { /* The session preference still works. */ }
    reflect();
    onChange();
  });
  reflect();
  return { get enabled() { return enabled; } };
}
