export const INTERFACE_LOCALE_STORAGE_KEY = "mstruct-interface-locale";

export function readStandaloneLocale(storageKey = INTERFACE_LOCALE_STORAGE_KEY) {
  try {
    return window.localStorage.getItem(storageKey) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function persistStandaloneLocale(locale, storageKey = INTERFACE_LOCALE_STORAGE_KEY) {
  try {
    window.localStorage.setItem(storageKey, locale);
  } catch {
    // The language still applies for the current page when storage is unavailable.
  }
}

export function setupLanguageSwitcher({ root, button, getLocale, setLocale, applyLocale, storageKey = INTERFACE_LOCALE_STORAGE_KEY }) {
  if (!root || !button) return null;
  const options = [...root.querySelectorAll("[data-locale]")];

  function close() {
    root.removeAttribute("data-open");
    button.setAttribute("aria-expanded", "false");
  }

  function reflect() {
    const locale = getLocale();
    for (const option of options) {
      const current = option.dataset.locale === locale;
      option.classList.toggle("is-current", current);
      option.setAttribute("aria-checked", String(current));
    }
  }

  function select(locale) {
    setLocale(locale);
    persistStandaloneLocale(locale, storageKey);
    close();
    applyLocale();
    reflect();
  }

  function handleButtonClick() {
    const open = root.dataset.open !== "true";
    if (open) root.dataset.open = "true";
    else root.removeAttribute("data-open");
    button.setAttribute("aria-expanded", String(open));
  }

  function handleDocumentPointer(event) {
    if (!root.contains(event.target)) close();
  }

  function handleDocumentKeydown(event) {
    if (event.key !== "Escape" || root.dataset.open !== "true") return;
    close();
    button.focus();
  }

  button.addEventListener("click", handleButtonClick);
  for (const option of options) option.addEventListener("click", () => select(option.dataset.locale));
  document.addEventListener("pointerdown", handleDocumentPointer);
  document.addEventListener("keydown", handleDocumentKeydown);
  reflect();

  return {
    refreshLocale: reflect,
    destroy() {
      button.removeEventListener("click", handleButtonClick);
      document.removeEventListener("pointerdown", handleDocumentPointer);
      document.removeEventListener("keydown", handleDocumentKeydown);
    },
  };
}
