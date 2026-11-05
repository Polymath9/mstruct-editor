const STORAGE_KEY = "mstruct-editor-line-number-mode";

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function createEditorLineNumbering({ button, control, onChange, storage = browserStorage(), view = globalThis.window }) {
  function read() {
    try { return storage?.getItem(STORAGE_KEY) === "line" ? "line" : "measure"; }
    catch { return "measure"; }
  }
  let mode = read();
  function reflect() {
    button.setAttribute("aria-checked", String(mode === "measure"));
    control.classList.toggle("is-on", mode === "measure");
  }
  function toggle() {
    mode = mode === "measure" ? "line" : "measure";
    try { storage?.setItem(STORAGE_KEY, mode); } catch { /* Keep the session choice. */ }
    reflect();
    onChange();
  }
  function storageChanged(event) {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    mode = read();
    reflect();
    onChange();
  }
  button.addEventListener("click", toggle);
  view?.addEventListener("storage", storageChanged);
  reflect();
  return {
    get mode() { return mode; },
    destroy() {
      button.removeEventListener("click", toggle);
      view?.removeEventListener("storage", storageChanged);
    },
  };
}
