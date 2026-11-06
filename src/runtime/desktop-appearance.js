import { APPLICATION_COLOR_SCHEME_STORAGE_KEY, normalizeApplicationColorScheme } from "../core/application-theme.js";
import { createApplicationSettings } from "../ui/application-settings.js";
import { normalizeRendererPreferences, RENDERER_PREFERENCES_STORAGE_KEY } from "../core/renderer-preferences.js";
import { createDesktopMenu } from "../ui/desktop-menu.js";
import { setupDesktopScoreScale } from "./desktop-score-scale.js";
import { persistStandaloneLocale } from "../ui/language-switcher.js";
import "../ui/application-colors.css";
import "../ui/application-settings.css";
import "./desktop-appearance.css";

export function setupDesktopAppearance({ desktopApi, button, tr, rules, openRules, errorMessage, onPlaybackPreferencesChanged, openEditorSettings, onLocaleChange }) {
  if (!desktopApi || !button) return null;
  const shell = document.querySelector(".editor-app");
  let colorScheme;
  try { colorScheme = normalizeApplicationColorScheme(localStorage.getItem(APPLICATION_COLOR_SCHEME_STORAGE_KEY)); }
  catch { colorScheme = normalizeApplicationColorScheme(null); }
  shell.dataset.appColorScheme = colorScheme;
  const readPreferences = () => { try { return normalizeRendererPreferences(JSON.parse(localStorage.getItem(RENDERER_PREFERENCES_STORAGE_KEY) ?? "null")); } catch { return normalizeRendererPreferences(null); } };
  const ui = createApplicationSettings({ button, tr, rules, openRules, errorMessage, userData: { open: () => desktopApi.openUserData(), clear: () => desktopApi.clearUserData() }, getPlaybackOffset: () => readPreferences().globalPlaybackOffset,
    setPlaybackOffset(value) { const next = { ...readPreferences(), globalPlaybackOffset: value }; localStorage.setItem(RENDERER_PREFERENCES_STORAGE_KEY, JSON.stringify(next)); onPlaybackPreferencesChanged(next); },
    getColorScheme: () => colorScheme, setColorScheme: next => {
    const normalized = normalizeApplicationColorScheme(next);
    localStorage.setItem(APPLICATION_COLOR_SCHEME_STORAGE_KEY, normalized);
    colorScheme = normalized;
    shell.dataset.appColorScheme = colorScheme;
  } });
  shell.dataset.desktopShell = "true";
  setupDesktopScoreScale({ target: document.querySelector("#rendererCanvas") });
  createDesktopMenu({ api: desktopApi, label: () => tr("desktopMenuBar") });
  document.querySelector(".header-actions").append(document.querySelector("#renderButton"));
  desktopApi.onCommand(command => {
    if (command === "edit:undo" || command === "edit:redo") {
      const action = command.slice("edit:".length);
      const event = new CustomEvent("mstruct-edit-command", { detail: action, cancelable: true });
      if (document.dispatchEvent(event)) document.execCommand(action);
    }
    if (command === "application-settings") ui.open();
    if (command === "editor-settings") openEditorSettings();
    if (command === "set-locale:zh" || command === "set-locale:en") {
      const locale = command.slice("set-locale:".length);
      persistStandaloneLocale(locale);
      onLocaleChange(locale);
    }
  });
  return ui;
}
