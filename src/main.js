import "@fontsource/crimson-pro/400.css";
import "@fontsource/crimson-pro/600.css";
import "@fontsource/crimson-pro/600-italic.css";
import "@fontsource/noto-music";
import "@fontsource/noto-serif/400.css";
import "@fontsource/noto-serif/600.css";
import "@fontsource/noto-serif/600-italic.css";
import "./style.css";
import specialChordCsv from "./config/special-chords.csv?raw";
import romanBasicCsv from "./config/roman-basic.csv?raw";
import romanAdvancedCsv from "./config/roman-advanced.csv?raw";
import romanFiguredBassCsv from "./config/roman-figured-bass.csv?raw";
import romanSpecialCsv from "./config/roman-special.csv?raw";
import toolboxMenuCsv from "./config/toolbox-menus.csv?raw";
import toolboxEventCsv from "./config/toolbox-events.csv?raw";
import tagCsv from "./config/tags.csv?raw";
import cadenceTagCsv from "./config/cadence-tags.csv?raw";
import tonalTagCsv from "./config/tonal-tags.csv?raw";
import sequenceTagCsv from "./config/sequence-tags.csv?raw";
import k545DocumentSource from "../examples/k545.mstruct?raw";
import { documentErrorMessage, getInterfaceLocale, setInterfaceLocale, syntaxErrorMessage, tr } from "./editor-i18n.js";
import { createMetadataDialog } from "./ui/metadata-dialog.js";
import { createCommentDialog } from "./ui/comment-dialog.js";
import { createCommentPopover } from "./ui/comment-popover.js";
import { renderInlineMusicText } from "./ui/inline-music.js";
import { makeDurationNotes } from "./ui/duration-label.js";
import { createTempoLabels } from "./ui/tempo-label.js";
import { createScoreRenderer } from "./ui/score-renderer.js";
import { createScoreDocumentHeader } from "./ui/score-document-header.js";
import { createScoreFeedback } from "./ui/score-feedback.js";
import { setupScoreExport } from "./ui/score-export.js";
import { setupRendererNav } from "./ui/renderer-nav.js";
import { readRendererLayers, normalizeRendererLayers, writeRendererLayers } from "./core/renderer-layers.js";
import { setupRendererDisplay, createRendererTransposition, readStandaloneChordPreferences } from "./ui/renderer-display.js";
import { createSourceEditor } from "./ui/source-editor.js";
import { createEditorLineNumbering } from "./ui/editor-line-numbering.js";
import { setupEditorWarningSettings } from "./ui/editor-warning-settings.js";
import { createEditorStartupSettings } from "./ui/editor-startup-settings.js";
import { setupRenderOnResize, setupResizableToolbox } from "./ui/resizable-toolbox.js";
import { createSymbolUi } from "./ui/symbol-ui.js";
import { createToolbox } from "./ui/toolbox.js";
import { setupTimelineEditor } from "./ui/timeline-editor.js";
import { createTimelineIo } from "./runtime/timeline-io.js";
import { readStandaloneLocale, setupLanguageSwitcher } from "./ui/language-switcher.js";
import { createDevBrowserDocumentAdapter } from "./runtime/dev-browser.js";
import { createDesktopDocumentAdapter } from "./runtime/desktop.js";
import { createDesktopExportAdapter } from "./runtime/desktop-export.js";
import { setupEditorVideoExport } from "./runtime/editor-video-export.js";
import { isVideoExportStage } from "./runtime/video-export-stage.js";
import { setupDesktopAppearance } from "./runtime/desktop-appearance.js";
import { setupDesktopWorkspace } from "./runtime/desktop-workspace.js";
import { setupDesktopVideoCover } from "./runtime/desktop-video-cover.js";
import { setupDocumentSession } from "./runtime/document-session.js";
import { bindHostedPopoverLifecycle, mountHostedPopovers } from "./runtime/hosted-popovers.js";
import { createEditorConfig } from "./runtime/editor-config.js";
import { createDocumentProfileSession } from "./runtime/document-profile.js";
import { createHostedDocumentInitializer } from "./runtime/hosted-document.js";
import { createHostedProfiles } from "./runtime/hosted-profiles.js";
import { createAnalysisDocumentLoader } from "./runtime/analysis-document-loader.js";
import { setupStandaloneProfileRuntime } from "./runtime/standalone-profile-ui.js";
import { AUTHORING_APP_VERSION } from "./runtime/authoring-version.js";
import { readProfileIdentity } from "./core/profile-schema.js";
import { parseSpecialChordCsv } from "./core/chord-symbol.js";
import { normalizeRendererPreferences } from "./core/renderer-preferences.js";
import { parseRomanConfigCsv } from "./core/roman-symbol.js";
import { parseTagConfigCsv } from "./core/tag-config.js";
import { parseGlobalTagList, parseSemanticTagConfigCsv } from "./core/semantic-tags.js";
import { parseMstruct } from "./core/mstruct.js";
import { parseFraction } from "./core/mstruct-rational.js";
import { layoutSystems } from "./core/engraving.js";
import { alignScoreBarlines } from "./ui/score-barlines.js";
import {
  createMstructFileName,
  createEmptyMetadata,
  normalizeMetadata,
  parseMstructDocument,
  serializeMstructDocument,
} from "./core/mstruct-document.js";
import { normalizeComments } from "./core/mstruct-comments.js";

const editorConfig = createEditorConfig({
  specialChordCsv,
  romanConfigCsv: {
    basicCsv: romanBasicCsv,
    advancedCsv: romanAdvancedCsv,
    figuredBassCsv: romanFiguredBassCsv,
    specialCsv: romanSpecialCsv,
  },
  tagCsv,
  semanticTagConfigCsv: { cadenceCsv: cadenceTagCsv, tonalCsv: tonalTagCsv, sequenceCsv: sequenceTagCsv },
  parseSpecialChordCsv,
  parseRomanConfigCsv,
  parseTagConfigCsv,
  parseSemanticTagConfigCsv,
});
const DEFAULT_TOOLBOX_CONFIG_CSV = { menuCsv: toolboxMenuCsv, eventCsv: toolboxEventCsv };
let rendererNav, toolboxUi, languageSwitcherUi, timelineEditorUi, documentSession, scoreExportUi, standaloneProfiles, profileManagerUi, applicationSettingsUi, desktopWorkspace, desktopVideoCover;
const hostedProfiles = createHostedProfiles();
const documentProfile = createDocumentProfileSession({
  resolveProfile: (identity) => hostedMode ? hostedProfiles.resolve(identity) : standaloneProfiles.resolve(identity),
  commit: ({ config, profile }) => {
    editorConfig.applyProfile(config);
    setToolboxConfigCsv({ menuCsv: profile.files["toolbox-menus.csv"], eventCsv: profile.files["toolbox-events.csv"] });
  },
});
let cleanupHostedPopovers = () => {};
let reportedStableTempo;
let timelineDirty = false, timelineIo, parentDocumentName = "";
function applyInterfaceLocale() {
  profileManagerUi?.updateLocale();
  applicationSettingsUi?.refreshLocale();
  desktopWorkspace?.refreshLocale();
  desktopVideoCover?.refreshLocale();
  desktopApi?.setLocale(getInterfaceLocale());
  document.documentElement.lang = getInterfaceLocale() === "en" ? "en" : "zh-CN";
  document.title = tr(timelineEditorUi?.mode === "timeline" ? "timelineEditorTitle" : "appTitle");
  chordPopover.lang = getInterfaceLocale() === "en" ? "en" : "zh-CN";
  romanPopover.lang = getInterfaceLocale() === "en" ? "en" : "zh-CN";
  commentPopover.lang = getInterfaceLocale() === "en" ? "en" : "zh-CN";
  const roots = chordPopover.ownerDocument === document ? [document] : [document, chordPopover, romanPopover, commentPopover];
  for (const root of roots) {
    for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = tr(element.dataset.i18n);
    for (const element of root.querySelectorAll("[data-i18n-aria]")) element.setAttribute("aria-label", tr(element.dataset.i18nAria));
    for (const element of root.querySelectorAll("[data-i18n-title]")) element.title = tr(element.dataset.i18nTitle);
    for (const element of root.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = tr(element.dataset.i18nPlaceholder);
  }
  if (documentAdapter?.kind === "desktop") {
    importButton.textContent = tr("openFile");
    exportButton.textContent = tr("saveFile");
  }
  rendererNav?.refreshLocale();
  scoreExportUi?.refreshLocale();
  toolboxUi?.refreshLocale();
  languageSwitcherUi?.refreshLocale();
  timelineEditorUi?.refreshLocale();
}
const sourceInput = document.querySelector("#sourceInput");
const highlightLayer = document.querySelector("#highlightLayer");
const lineGutter = document.querySelector("#lineGutter");
const lineWrapMeasure = document.querySelector("#lineWrapMeasure");
const rendererCanvas = document.querySelector("#rendererCanvas");
const renderStatus = document.querySelector("#renderStatus");
const lineCount = document.querySelector("#lineCount");
const renderButton = document.querySelector("#renderButton");
const newButton = document.querySelector("#newButton");
const importButton = document.querySelector("#importButton");
const exportButton = document.querySelector("#exportButton");
const importInput = document.querySelector("#importInput");
const metadataButton = document.querySelector("#metadataButton");
const commentsButton = document.querySelector("#commentsButton");
const editorSettingsButton = document.querySelector("#editorSettingsButton");
const timelineEditorSettingsButton = document.querySelector("#timelineEditorSettingsButton");
const saveDraftButton = document.querySelector("#saveDraftButton");
const discardDraftButton = document.querySelector("#discardDraftButton");
const submitAnalysisButton = document.querySelector("#submitAnalysisButton");
const metadataDialog = document.querySelector("#metadataDialog");
const metadataForm = document.querySelector("#metadataForm");
const metadataFields = document.querySelector("#metadataFields");
const metadataClose = document.querySelector("#metadataClose");
const metadataCancel = document.querySelector("#metadataCancel");
const initialMstructImport = document.querySelector("#initialMstructImport");
const commentDialog = document.querySelector("#commentDialog");
const commentList = document.querySelector("#commentList");
const commentDialogStatus = document.querySelector("#commentDialogStatus");
const commentAdd = document.querySelector("#commentAdd");
const commentEdit = document.querySelector("#commentEdit");
const commentDelete = document.querySelector("#commentDelete");
const commentConfirm = document.querySelector("#commentConfirm");
const commentCancel = document.querySelector("#commentCancel");
const commentDialogClose = document.querySelector("#commentDialogClose");
const commentTextDialog = document.querySelector("#commentTextDialog");
const commentTextForm = document.querySelector("#commentTextForm");
const commentTextClose = document.querySelector("#commentTextClose");
const commentTextCancel = document.querySelector("#commentTextCancel");
const commentLanguage = document.querySelector("#commentLanguage");
const commentText = document.querySelector("#commentText");
const editorSettingsDialog = document.querySelector("#editorSettingsDialog");
const scoreExportDialog = document.querySelector("#scoreExportDialog");
const lineNumberModeSwitch = document.querySelector("#lineNumberModeSwitch");
const lineNumberModeControl = document.querySelector("#lineNumberModeControl");
const autoWrapButton = document.querySelector("#autoWrapButton");
const autoWrapControl = document.querySelector("#autoWrapControl");
const resizeHandle = document.querySelector("#resizeHandle");
const toolbox = document.querySelector("#toolbox");
const codeEditor = document.querySelector("#codeEditor");
const editorLayout = codeEditor.parentElement;
const viewerContent = document.querySelector(".editor-app");
const chordPopover = document.querySelector("#chordPopover");
const chordPopoverClose = document.querySelector("#chordPopoverClose");
const chordPopoverSymbol = document.querySelector("#chordPopoverSymbol");
const chordPopoverIntervals = document.querySelector("#chordPopoverIntervals");
const chordPopoverNoteNames = document.querySelector("#chordPopoverNoteNames");
const chordPopoverStaff = document.querySelector("#chordPopoverStaff");
const chordPopoverStaffError = document.querySelector("#chordPopoverStaffError");
const chordPopoverPlay = document.querySelector("#chordPopoverPlay");
const chordPopoverPlayLabel = document.querySelector("#chordPopoverPlayLabel");
const chordPopoverAudioError = document.querySelector("#chordPopoverAudioError");
const romanPopover = document.querySelector("#romanPopover");
const romanPopoverClose = document.querySelector("#romanPopoverClose");
const romanPopoverSymbol = document.querySelector("#romanPopoverSymbol");
const romanPopoverStructure = document.querySelector("#romanPopoverStructure");
const commentPopover = document.querySelector("#commentPopover");
const commentPopoverClose = document.querySelector("#commentPopoverClose");
const commentPopoverHeading = document.querySelector("#commentPopoverHeading");
const commentPopoverLanguage = document.querySelector("#commentPopoverLanguage");
const commentPopoverBody = document.querySelector("#commentPopoverBody");

const hostParameters = new URLSearchParams(window.location.search);
const hostedMode = hostParameters.get("hosted") === "1";
const hostMode = hostParameters.get("mode") === "viewer" ? "viewer" : "editor";
const hostToken = hostParameters.get("token") ?? "";
const isHostedViewer = hostedMode && hostMode === "viewer";
const desktopApi = !hostedMode && window.mstructDesktop?.kind === "mstruct-desktop"
  ? window.mstructDesktop
  : null;
if (!hostedMode) setInterfaceLocale(readStandaloneLocale());
if (!hostedMode) {
  ({ service: standaloneProfiles, ui: profileManagerUi } = setupStandaloneProfileRuntime({ platform: desktopApi,
    button: document.querySelector("#profileManagerButton"), tr, documentErrorMessage,
    getDocumentIdentity: () => { try { return readProfileIdentity(metadata); } catch { return null; } },
    isReadOnly: () => Boolean(documentProfile.error),
    retryDocument: () => loadMstructText(serializeMstructDocument({ metadata, main: sourceInput.value, comments }), parentDocumentName),
  }));
  applicationSettingsUi = setupDesktopAppearance({ desktopApi, button: document.querySelector("#applicationSettingsButton"), tr,
    rules: standaloneProfiles, openRules: () => profileManagerUi.open(),
    openEditorSettings: () => editorSettingsDialog.showModal(),
    onLocaleChange: locale => {
      setInterfaceLocale(locale);
      applyInterfaceLocale();
      renderSource({ preserveScroll: true });
    },
    onPlaybackPreferencesChanged: next => { if (setChordPreferences(next)) renderSource({ preserveScroll: true }); },
    errorMessage: error => error.code ? documentErrorMessage(error) : tr("profileOperationFailed"),
  });
}
const documentAdapter = desktopApi
  ? createDesktopDocumentAdapter(desktopApi, () => normalizeMetadata(metadata).versionName)
  : createDevBrowserDocumentAdapter({ importInput });
const desktopExportAdapter = createDesktopExportAdapter(desktopApi);
const hostedPopoverMount = mountHostedPopovers({
  enabled: hostedMode,
  hostToken,
  chordPopover,
  romanPopover,
  commentPopover,
});
const hostedChordPopoverDocument = hostedPopoverMount?.parentDocument ?? null;

const startupSettings = createEditorStartupSettings({
  row: document.querySelector("#startupDemoRow"), button: document.querySelector("#startupDemoButton"),
  control: document.querySelector("#startupDemoControl"), status: document.querySelector("#startupDemoError"), available: !hostedMode,
});
const startupDocument = hostedMode || !startupSettings.openDemo
  ? { ok: true, main: "", metadata: createEmptyMetadata(), comments: [] } : parseMstructDocument(k545DocumentSource);
if (!startupDocument.ok) throw new Error(`Invalid K545 startup document: ${startupDocument.errors.map((error) => documentErrorMessage(error, "en")).join("; ")}`);
sourceInput.value = startupDocument.main;
let metadata = startupDocument.metadata;
let comments = normalizeComments(startupDocument.comments);
let commentDialogUi = null;
let lockedMetadata = false;
let savedDocumentSignature = "";
const lineNumbering = createEditorLineNumbering({ button: lineNumberModeSwitch, control: lineNumberModeControl,
  onChange: () => applyEditorSettings() });
const editorSettings = { get lineNumberMode() { return lineNumbering.mode; }, autoWrap: false };
const getWarningSettings = setupEditorWarningSettings(() => updateEditor());
let chordPreferences = hostedMode ? normalizeRendererPreferences(null) : readStandaloneChordPreferences();
const transpositionSession = createRendererTransposition({ getPreferences: () => chordPreferences, postToHost,
  refresh: () => { refreshScoreLayout({ force: true }); rendererNav?.refreshPreferences(); } });
const getScorePreferences = transpositionSession.getPreferences;
const setTransposition = transpositionSession.set;
const rendererDisplay = setupRendererDisplay({ canvas: rendererCanvas, hostedMode, tr, postToHost,
  getTransposition: transpositionSession.get, updateTransposition: setTransposition,
  getPreferences: () => chordPreferences,
  updatePreferences: (next) => { if (setChordPreferences(next)) renderSource({ preserveScroll: true }); },
  refreshLayout: () => refreshScoreLayout({ force: true }),
});

function documentSignature(main = sourceInput.value, documentMetadata = metadata, documentComments = comments) {
  return JSON.stringify({ main, metadata: normalizeMetadata(documentMetadata), comments: normalizeComments(documentComments) });
}

function currentDocumentSignature() {
  const dialogIsOpen = metadataDialog.open && metadataFields.childElementCount > 0;
  return documentSignature(
    sourceInput.value,
    dialogIsOpen ? currentMetadataFromForm() : metadata,
    commentDialogUi?.currentComments() ?? comments,
  );
}

function notifyDirtyState() {
  const dirty = isDocumentDirty();
  postToHost("dirty-state", { dirty: dirty || timelineDirty });
  documentAdapter?.setDirty(dirty || timelineDirty);
}
function setTimelineDirty(value) {
  timelineDirty = Boolean(value);
  notifyDirtyState();
}
function isDocumentDirty() {
  return currentDocumentSignature() !== savedDocumentSignature;
}

function markDocumentSaved(signature = documentSignature()) {
  savedDocumentSignature = signature;
  notifyDirtyState();
}
function postToHost(type, payload = {}) {
  if (!hostedMode || window.parent === window) return;
  window.parent.postMessage({ source: "mstruct-editor", type, token: hostToken, ...payload }, window.location.origin);
}
function reportHostedHeight() {
  if (!isHostedViewer || !document.body.classList.contains("host-ready")) return;
  window.requestAnimationFrame(() => {
    const naturalHeight = Math.max(
      viewerContent?.scrollHeight ?? 0,
      Math.ceil(viewerContent?.getBoundingClientRect().height ?? 0),
      rendererCanvas.scrollHeight,
    );
    postToHost("height", { height: naturalHeight });
  });
}
function isLockedMetadataField(name) {
  if (hostedMode && ["creator", "editors", "originalEditor", "coEditors"].includes(name)) return true;
  if (!lockedMetadata) return false;
  return [
    "creator",
    "songName",
    "mstructFormatVersion", "mstructProfileId", "mstructProfileHash", "authoringAppVersion",
    "songNameRomanized",
    "composerName",
    "composerRomanized",
    "composerAlias",
    "composerId",
    "originalVocalistName",
    "originalVocalistRomanized",
    "albumName",
    "albumNameRomanized",
    "groupName",
    "groupNameRomanized",
    "sourceName",
    "sourceNameRomanized",
    "tags",
  ].includes(name);
}
function metadataAfterImport(imported) {
  const next = normalizeMetadata(imported);
  if (!hostedMode) return next;
  const current = normalizeMetadata(metadata);
  const preservedKeys = ["creator", "editors", "originalEditor", "coEditors", "mstructFormatVersion", "mstructProfileId", "mstructProfileHash", "authoringAppVersion"];
  if (lockedMetadata) preservedKeys.push(
    "songName",
    "songNameRomanized",
    "composers",
    "originalVocalists",
    "albumName",
    "albumNameRomanized",
    "groupName",
    "groupNameRomanized",
    "sourceName",
    "sourceNameRomanized",
    "tags",
  );
  for (const key of preservedKeys) next[key] = current[key];
  return normalizeMetadata(next);
}

const { highlightSource, updateLineGutter } = createSourceEditor({ sourceInput, highlightLayer, lineWrapMeasure, lineGutter,
  getEditorSettings: () => ({ ...editorSettings, ...getWarningSettings() }), formatDiagnostic: syntaxErrorMessage });
toolboxUi = createToolbox({
  root: toolbox,
  sourceInput,
  getLocale: getInterfaceLocale,
  onChange: () => { updateEditor(); notifyDirtyState(); },
  tr,
  initialConfigCsv: DEFAULT_TOOLBOX_CONFIG_CSV,
});

function applyEditorSettings() {
  codeEditor.classList.toggle("is-word-wrap", editorSettings.autoWrap);
  sourceInput.wrap = editorSettings.autoWrap ? "soft" : "off";
  autoWrapButton.setAttribute("aria-checked", String(editorSettings.autoWrap));
  autoWrapControl.classList.toggle("is-on", editorSettings.autoWrap);
  updateEditor();
}

function parseMainSource(source, documentMetadata = metadata) {
  const normalizedMetadata = normalizeMetadata(documentMetadata);
  if (documentProfile.profile || documentProfile.error || normalizedMetadata.mstructProfileId || normalizedMetadata.mstructFormatVersion || normalizedMetadata.mstructProfileHash) {
    return documentProfile.compile(source, normalizedMetadata, comments);
  }
  return editorConfig.compileMain(source, normalizedMetadata, comments);
}

function updateEditor(result = parseMainSource(sourceInput.value)) {
  const lines = sourceInput.value.split("\n");
  const labels = updateLineGutter(lines, result);
  if (isHostedViewer) postToHost("source-numbering", { main: sourceInput.value, labels });
  lineCount.textContent = tr("lines", { count: lines.length });
  highlightLayer.innerHTML = highlightSource(sourceInput.value, result.errors.filter((error) => !error.metadataDomain), result.warnings);
  return result;
}

function makeElement(tagName, className, text = null) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== null) element.textContent = text;
  return element;
}

const { currentMetadataFromForm, openMetadataDialog, validateMetadataForm, resetMetadataDraft } = createMetadataDialog({
  makeElement,
  getMetadata: () => metadata,
  isMetadataLocked: () => lockedMetadata,
  isLockedMetadataField,
  metadataFields,
  metadataDialog,
  metadataForm,
  notifyDirtyState,
  parseMainSource,
  validateGlobalTags: (value) => {
    const result = parseGlobalTagList(value, { tagConfig: editorConfig.tagConfig, formTagConfig: editorConfig.formTagConfig, semanticTagConfig: editorConfig.semanticTagConfig, romanConfig: editorConfig.romanConfig });
    return result.ok ? "" : syntaxErrorMessage(result.errors[0]);
  },
  sourceInput,
});

commentDialogUi = createCommentDialog({
  dialog: commentDialog,
  list: commentList,
  status: commentDialogStatus,
  addButton: commentAdd,
  editButton: commentEdit,
  deleteButton: commentDelete,
  confirmButton: commentConfirm,
  cancelButton: commentCancel,
  closeButton: commentDialogClose,
  textDialog: commentTextDialog,
  textForm: commentTextForm,
  textClose: commentTextClose,
  textCancel: commentTextCancel,
  languageSelect: commentLanguage,
  textArea: commentText,
  getComments: () => comments,
  getLocale: getInterfaceLocale,
  onSave: (next) => {
    comments = normalizeComments(next);
    renderSource();
    notifyDirtyState();
  },
  notifyDirtyState,
  tr,
});

const { makeBpmLabel, makeMetricModulationLabel } = createTempoLabels({ makeElement, makeDurationNotes, parseFraction, tr });

function makeTimeSignature(value) {
  const signature = makeElement("span", "time-signature");
  const values = makeElement("span", "time-signature-values");
  if (value === "adlib") {
    signature.classList.add("is-adlib");
    signature.setAttribute("aria-label", tr("adlibTimeSignature"));
    values.append(makeElement("span", "time-signature-adlib", "ad lib."));
    signature.append(values);
    return signature;
  }
  const [numerator, denominator] = value.split("/");
  signature.setAttribute("aria-label", tr("timeSignatureAria", { numerator, denominator }));
  values.append(makeElement("span", "time-signature-top", numerator));
  values.append(makeElement("span", "time-signature-bottom", denominator));
  signature.append(values);
  return signature;
}

const { appendChordNotation, appendRomanNotation, makeRomanSymbol, makeEventValue, openChordPopover, closeChordPopover, closeRomanPopover, positionChordPopover, positionRomanPopover, getCurrentChordPopover, chordPianoPlayer } = createSymbolUi({
  makeElement,
  getChordPreferences: getScorePreferences,
  getHostedPopoverDocument: () => hostedChordPopoverDocument,
  pianoOptions: documentAdapter?.pianoOptions,
  chordPopover, chordPopoverSymbol, chordPopoverIntervals, chordPopoverNoteNames, chordPopoverStaff, chordPopoverStaffError, chordPopoverAudioError, chordPopoverPlay, chordPopoverPlayLabel,
  romanPopover, romanPopoverSymbol, romanPopoverStructure,
});

let rendererLayers = readRendererLayers();

const renderCommentText = (target, text) => renderInlineMusicText(target, text, {
  specialChords: editorConfig.specialChords,
  romanConfig: editorConfig.romanConfig,
  renderMode: chordPreferences.renderMode,
  preferences: getScorePreferences(),
});

const { openCommentPopover, closeCommentPopover, positionCommentPopover } = createCommentPopover({
  dialog: commentPopover,
  closeButton: commentPopoverClose,
  heading: commentPopoverHeading,
  languageLabel: commentPopoverLanguage,
  body: commentPopoverBody,
  renderCommentText,
  getComments: () => comments,
  getLocale: getInterfaceLocale,
  getHostedPopoverDocument: () => chordPopover.ownerDocument === document ? null : hostedChordPopoverDocument,
  tr,
});

cleanupHostedPopovers = bindHostedPopoverLifecycle({
  mount: hostedPopoverMount,
  closeChord: closeChordPopover,
  closeRoman: closeRomanPopover,
  closeComment: closeCommentPopover,
  positionChord: positionChordPopover,
  positionRoman: positionRomanPopover,
  positionComment: positionCommentPopover,
});

const { makeTagLabel, makeFormSymbol, renderSystem, markEndingSystems, drawEndingBrackets, drawRomanVoiceLeadingLines, drawNewRiemannianConnections, drawTagRangeLines, drawCommentRangeLines } = createScoreRenderer({
  makeElement,
  appendChordNotation,
  appendRomanNotation,
  makeRomanSymbol,
  makeEventValue,
  makeBpmLabel,
  makeMetricModulationLabel,
  makeTimeSignature,
  getChordPreferences: getScorePreferences,
  getRendererLayers: () => rendererLayers,
  getLocale: getInterfaceLocale,
  openCommentPopover,
});
let renderedScoreResult = null;
let renderedScoreTargetWidth = null;
let overlayFrame = null;

function scoreTargetWidth() {
  const style = window.getComputedStyle(rendererCanvas);
  return Math.max(360, rendererCanvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
}

function scheduleScoreOverlayLayout() {
  if (overlayFrame !== null) window.cancelAnimationFrame(overlayFrame);
  overlayFrame = window.requestAnimationFrame(() => {
    overlayFrame = null;
    const chart = rendererCanvas.querySelector(".chart");
    if (!chart?.isConnected || !renderedScoreResult) return;
    drawRomanVoiceLeadingLines(chart);
    drawNewRiemannianConnections(chart);
    drawTagRangeLines(chart);
    drawCommentRangeLines(chart);
    drawEndingBrackets(chart, renderedScoreResult);
    rendererNav?.refreshPresentationContent();
  });
}

const scoreFeedback = createScoreFeedback({ canvas: rendererCanvas, status: renderStatus, makeElement, tr, formatDiagnostic: syntaxErrorMessage });

const { renderDocumentHeader, renderGlobalTags } = createScoreDocumentHeader({
  makeElement, tr, makeTagLabel, getMetadata: () => metadata, getLayers: () => rendererLayers,
});

function renderResult(result) {
  closeChordPopover();
  closeRomanPopover();
  closeCommentPopover();
  if (scoreFeedback.renderBlank(sourceInput.value, result)) {
    renderedScoreResult = null;
    renderedScoreTargetWidth = null;
    reportHostedHeight();
    return;
  }
  if (!result.ok) {
    renderedScoreResult = null;
    renderedScoreTargetWidth = null;
    scoreFeedback.renderError(result.errors);
    return;
  }
  renderedScoreResult = result;
  rendererCanvas.replaceChildren();
  const targetWidth = scoreTargetWidth();
  renderedScoreTargetWidth = targetWidth;
  const systems = layoutSystems(result.flow, targetWidth, {
    independentMeasures: rendererCanvas.dataset.fixedScale === "true",
    rendererScale: rendererDisplay.getScale(),
    preferences: getScorePreferences(),
    durationDisplayMode: chordPreferences.durationDisplayMode,
    locale: getInterfaceLocale(),
    layers: rendererLayers,
  });

  const chart = makeElement("div", "chart");
  for (const system of systems) chart.append(renderSystem(system));
  markEndingSystems(chart, result);
  if (!chart.childElementCount) chart.append(makeElement("p", "incomplete-note", tr("incomplete")));
  const documentHeader = renderDocumentHeader();
  if (documentHeader) rendererCanvas.append(documentHeader);
  const globalTags = renderGlobalTags(result.globalTags);
  if (globalTags) rendererCanvas.append(globalTags);
  rendererCanvas.append(chart);
  alignScoreBarlines(chart);
  scheduleScoreOverlayLayout();
  renderStatus.className = "render-status is-success";
  renderStatus.textContent = tr("syntaxValid");
  reportHostedHeight();
}

function refreshScoreLayout(options = {}) {
  if (!renderedScoreResult) return;
  const nextTargetWidth = scoreTargetWidth();
  if (options?.force !== true && renderedScoreTargetWidth !== null && Math.abs(nextTargetWidth - renderedScoreTargetWidth) < 1) {
    scheduleScoreOverlayLayout();
    return;
  }
  const rendererScroll = { left: rendererCanvas.scrollLeft, top: rendererCanvas.scrollTop };
  renderResult(renderedScoreResult);
  rendererNav?.refreshRenderedScore();
  window.requestAnimationFrame(() => {
    rendererCanvas.scrollLeft = rendererScroll.left;
    rendererCanvas.scrollTop = rendererScroll.top;
  });
}

function renderSource({ preserveScroll = false } = {}) {
  const rendererScroll = preserveScroll
    ? { left: rendererCanvas.scrollLeft, top: rendererCanvas.scrollTop }
    : null;
  const isStableTempo = normalizeMetadata(metadata).isStableTempo;
  if (hostedMode && isStableTempo !== reportedStableTempo) {
    window.parent.postMessage({ source: "mstruct-editor", type: "stable-tempo", token: hostToken, isStableTempo }, window.location.origin);
    reportedStableTempo = isStableTempo;
  }
  const result = updateEditor();
  renderResult(result);
  const normalizedOffset = Number(normalizeMetadata(metadata).offset);
  rendererNav?.updateDocument({
    result,
    isStableTempo,
    globalOffset: Number.isInteger(normalizedOffset) ? normalizedOffset : 0,
    userOffset: chordPreferences.globalPlaybackOffset,
  });
  timelineEditorUi?.updateDocument({ isStableTempo });
  if (rendererScroll) {
    window.requestAnimationFrame(() => {
      rendererCanvas.scrollLeft = rendererScroll.left;
      rendererCanvas.scrollTop = rendererScroll.top;
    });
  }
  reportHostedHeight();
  return result;
}

function setHostStatus(message, ok) {
  renderStatus.className = `render-status ${ok ? "is-success" : "is-error"}`;
  renderStatus.textContent = message;
}

function sendHostedAction(action) {
  if (!hostedMode || isHostedViewer) return;
  if (action === "submit" && !renderSource().ok) return;
  postToHost("action", { action, main: sourceInput.value, metadata, comments });
  setHostStatus(action === "submit" ? tr("submitting") : tr("saving"), true);
}

function setChordPreferences(value) {
  const next = normalizeRendererPreferences(value);
  const changed = Object.keys(next).some((key) => next[key] !== chordPreferences[key]);
  chordPreferences = next;
  return changed;
}

function setToolboxConfigCsv(value) {
  return toolboxUi?.setConfigCsv(value) ?? false;
}

const initializeFromHost = createHostedDocumentInitializer({
  profileSession: documentProfile, isViewer: isHostedViewer,
  controls: { sourceInput, metadataButton, commentsButton, editorSettingsButton, newButton, importButton,
    exportButton, renderButton, saveDraftButton, discardDraftButton, submitAnalysisButton, toolbox },
  applyLocale: (value) => { setInterfaceLocale(value); applyInterfaceLocale(); },
  applyPreferences: setChordPreferences,
  applyRendererScale: rendererDisplay.setScale,
  applySearchVocabulary: editorConfig.applySearchVocabulary,
  replaceDocument: (next) => {
    setTransposition(null, { refresh: false });
    metadata = next.metadata; comments = next.comments; lockedMetadata = next.lockedMetadata;
    commentDialogUi.resetCommentDraft(); resetMetadataDraft();
  },
  render: renderSource, navigation: () => rendererNav, timelines: () => timelineEditorUi,
  markSaved: markDocumentSaved, post: postToHost, status: setHostStatus,
  openInitialMetadata: () => {
    initialMstructImport.hidden = false;
    requestAnimationFrame(() => { if (!metadataDialog.open) openMetadataDialog(); });
  },
});

async function resetToBlankDocument({ announce = true } = {}) {
  const builtin = await standaloneProfiles.recommended();
  const nextMetadata = normalizeMetadata({ ...createEmptyMetadata(), mstructFormatVersion: "1", mstructProfileId: builtin.manifest.profileId, mstructProfileHash: builtin.manifest.bundleHash, authoringAppVersion: AUTHORING_APP_VERSION });
  await documentProfile.load(nextMetadata, builtin);
  sourceInput.disabled = false;
  metadataButton.disabled = false;
  commentsButton.disabled = false;
  exportButton.disabled = false;
  document.querySelector("#toolbox").inert = false;
  scoreExportUi?.close();
  rendererNav?.handleCommand("stop");
  closeChordPopover();
  closeRomanPopover();
  closeCommentPopover();
  for (const dialog of [commentTextDialog, commentDialog, metadataDialog, editorSettingsDialog]) {
    if (dialog.open) dialog.close();
  }
  metadata = nextMetadata;
  setTransposition(null, { refresh: false });
  comments = normalizeComments([]);
  lockedMetadata = false;
  resetMetadataDraft();
  commentDialogUi.resetCommentDraft();
  sourceInput.value = "";
  parentDocumentName = "";
  timelineDirty = false;
  timelineEditorUi?.setFiles([]);
  renderSource();
  markDocumentSaved();
  if (announce) {
    renderStatus.className = "render-status is-success";
    renderStatus.textContent = tr("newDocumentCreated");
  }
  sourceInput.focus();
}

const loadMstructText = createAnalysisDocumentLoader({
  hostedMode, profileSession: documentProfile, prepareStandalone: (source) => profileManagerUi.prepareOpen(source),
  getMetadata: () => metadata, metadataAfterImport,
  setError: (error) => setHostStatus(documentErrorMessage(error), false),
  applyDocument: (documentResult, importedMetadata, name) => {
    setTransposition(null, { refresh: false });
    metadata = importedMetadata;
    sourceInput.disabled = isHostedViewer || Boolean(documentProfile.error);
    metadataButton.disabled = isHostedViewer || Boolean(documentProfile.error);
    commentsButton.disabled = isHostedViewer || Boolean(documentProfile.error);
    exportButton.disabled = !hostedMode && Boolean(documentProfile.error);
    document.querySelector("#toolbox").inert = Boolean(documentProfile.error);
    parentDocumentName = String(name || parentDocumentName);
    comments = normalizeComments(documentResult.comments);
    resetMetadataDraft();
    commentDialogUi.resetCommentDraft();
    sourceInput.value = documentResult.main;
  },
  render: (documentResult, name) => {
    const result = renderSource();
    notifyDirtyState();
    if (result.ok) setHostStatus(documentResult.legacy ? tr("mainImported") : tr("imported", { name }), true);
    return result;
  },
});

function insertAtCursor(value) {
  if (sourceInput.disabled) return;
  const start = sourceInput.selectionStart;
  const end = sourceInput.selectionEnd;
  sourceInput.setRangeText(value, start, end, "end");
  sourceInput.focus();
  updateEditor();
  notifyDirtyState();
}

sourceInput.addEventListener("input", () => { updateEditor(); notifyDirtyState(); });
sourceInput.addEventListener("scroll", () => {
  highlightLayer.style.transform = `translate(${-sourceInput.scrollLeft}px, ${-sourceInput.scrollTop}px)`;
  lineGutter.scrollTop = sourceInput.scrollTop;
});
sourceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    renderSource({ preserveScroll: true });
  }
  if (event.key === "Tab") {
    event.preventDefault();
    insertAtCursor("  ");
  }
});
renderButton.addEventListener("click", () => renderSource({ preserveScroll: true }));
scoreExportUi = setupScoreExport({
  dialog: scoreExportDialog,
  adapter: desktopExportAdapter,
  tr,
  getLocale: getInterfaceLocale,
  prepareScore: () => renderSource({ preserveScroll: true }),
  getSuggestedName: () => createMstructFileName(metadata),
  layoutScoreSystems: (result, targetWidth) => layoutSystems(result.flow, targetWidth, {
    preferences: getScorePreferences(),
    durationDisplayMode: chordPreferences.durationDisplayMode,
    locale: getInterfaceLocale(),
    layers: rendererLayers,
  }),
  renderSystem,
  markEndingSystems,
  drawEndingBrackets,
  drawRomanVoiceLeadingLines,
  drawNewRiemannianConnections,
  drawTagRangeLines,
  drawCommentRangeLines,
  renderDocumentHeader,
  renderGlobalTags,
  setEditorStatus: setHostStatus,
});
if (!isHostedViewer) {
  documentSession = setupDocumentSession({
    adapter: documentAdapter,
    newButton,
    importButton,
    exportButton,
    importInput,
    isDirty: isDocumentDirty,
    resetDocument: resetToBlankDocument,
    loadDocument: loadMstructText,
    serializeDocument: () => serializeMstructDocument({ metadata, main: sourceInput.value, comments }), captureSaveState: () => documentSignature(),
    suggestedName: () => createMstructFileName(metadata),
    markSaved: markDocumentSaved,
    markSavedAfterIo: !hostedMode,
    canSave: () => !documentProfile.error && !desktopWorkspace?.browsing,
    afterNew: () => { timelineEditorUi?.setFiles([]); desktopWorkspace?.newDocument(); },
    afterIo: result => { parentDocumentName = String(result?.name || parentDocumentName); },
    afterOpen: () => desktopWorkspace?.opened(normalizeMetadata(metadata).mstructtimeFiles),
    afterSave: () => desktopWorkspace?.saved(),
    setStatus: setHostStatus,
    tr,
  });
}
metadataButton.addEventListener("click", openMetadataDialog);
commentsButton.addEventListener("click", commentDialogUi.openCommentDialog);
editorSettingsButton.addEventListener("click", () => editorSettingsDialog.showModal());
timelineEditorSettingsButton.addEventListener("click", () => editorSettingsDialog.showModal());
rendererNav = setupRendererNav({
  tr,
  rendererCanvas,
  isHostedViewer,
  desktopPreviewMode: documentAdapter?.kind === "desktop",
  presentationEnabled: true,
  videoPresentationEnabled: documentAdapter?.kind === "desktop" || isVideoExportStage(),
  onPresentationModeChange: value => rendererDisplay.setPresentationMode(value),
  onChooseVideo: () => desktopWorkspace?.chooseAudio("video"),
  postToHost,
  closePopovers: () => {
    closeChordPopover();
    closeRomanPopover();
    closeCommentPopover();
  },
  pianoPlayer: chordPianoPlayer,
  getLocale: getInterfaceLocale,
  getComments: () => comments,
  getChordPreferences: getScorePreferences,
  renderCommentText,
  getSearchOptions: () => editorConfig.searchOptions,
  makeTagLabel,
  makeFormSymbol,
  makeBpmLabel,
  appendChordNotation,
  openChordPopover,
  setFullscreenPopovers: (active) => {
    const target = active ? rendererPanel : (hostedChordPopoverDocument?.body ?? document.body);
    target.append(chordPopover, romanPopover, commentPopover);
  },
  onFullscreenLayoutChange: refreshScoreLayout,
  onPresentationGeometryChange: scheduleScoreOverlayLayout,
  getRendererLayers: () => rendererLayers,
  onRendererLayersChange: (value) => {
    rendererLayers = writeRendererLayers(value);
    refreshScoreLayout({ force: true });
  },
  onTimelineChange: (fileName) => timelineEditorUi?.selectFile(fileName),
  onChooseBgm: desktopApi ? () => desktopWorkspace?.chooseAudio() : undefined,
  onTimelineAudioChange: () => void desktopWorkspace?.refreshAudio(),
  onTimelineManage: () => timelineEditorUi?.openManager(),
  onTimelineDownload: () => timelineEditorUi?.downloadCurrent(),
  onTimelineHistory: () => timelineEditorUi?.openHistory(),
  onPlaybackState: (state, activeEntry) => timelineEditorUi?.handlePlaybackState(state, activeEntry),
});
timelineIo = createTimelineIo({
  desktopApi,
  hostedMode,
  isHostedViewer,
  postToHost,
  setDirty: setTimelineDirty,
  getParentFileName: () => parentDocumentName,
});
timelineEditorUi = setupTimelineEditor({
  tr,
  getLocale: getInterfaceLocale,
  getAnalysisResult: () => parseMainSource(sourceInput.value),
  getParentMetadata: () => metadata,
  setParentTimelineFiles: (fileNames) => {
    metadata = normalizeMetadata({ ...metadata, mstructtimeFiles: fileNames });
    renderSource({ preserveScroll: true });
    notifyDirtyState();
  },
  rendererNav,
  setStatus: setHostStatus,
  onModeChange: () => window.requestAnimationFrame(refreshScoreLayout),
  io: timelineIo.io,
});
timelineEditorUi.updateDocument({ isStableTempo: normalizeMetadata(metadata).isStableTempo });
if (!hostedMode && !desktopApi) {
  languageSwitcherUi = setupLanguageSwitcher({
    root: document.querySelector("#standaloneLanguage"),
    button: document.querySelector("#standaloneLanguageButton"),
    getLocale: getInterfaceLocale,
    setLocale: setInterfaceLocale,
    applyLocale: () => {
      applyInterfaceLocale();
      renderSource({ preserveScroll: true });
    },
  });
}
autoWrapButton.addEventListener("click", () => {
  editorSettings.autoWrap = !editorSettings.autoWrap;
  applyEditorSettings();
});
saveDraftButton.addEventListener("click", () => sendHostedAction("save"));
discardDraftButton.addEventListener("click", () => postToHost("discard-request"));
submitAnalysisButton.addEventListener("click", () => sendHostedAction("submit"));
initialMstructImport.addEventListener("click", () => {
  resetMetadataDraft();
  metadataDialog.close();
  importInput.click();
});
metadataDialog.addEventListener("close", () => { initialMstructImport.hidden = true; });
metadataClose.addEventListener("click", () => {
  resetMetadataDraft();
  metadataDialog.close();
  notifyDirtyState();
});
metadataCancel.addEventListener("click", () => {
  resetMetadataDraft();
  metadataDialog.close();
  notifyDirtyState();
});
metadataDialog.addEventListener("cancel", () => {
  resetMetadataDraft();
  notifyDirtyState();
});
metadataForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateMetadataForm()) return;
  metadata = currentMetadataFromForm();
  resetMetadataDraft();
  metadataDialog.close();
  renderSource();
  notifyDirtyState();
});
chordPopoverClose.addEventListener("click", closeChordPopover);
romanPopoverClose.addEventListener("click", closeRomanPopover);
chordPopoverPlay.addEventListener("click", async () => {
  const current = getCurrentChordPopover();
  if (!current || chordPopoverPlay.disabled) return;
  chordPopoverPlay.disabled = true;
  chordPopoverPlay.classList.add("is-loading");
  chordPopoverPlayLabel.textContent = tr("loadingPiano");
  chordPopoverAudioError.hidden = true;
  try {
    await chordPianoPlayer.play(current.audioMidiNotes);
  } catch {
    chordPianoPlayer.dispose();
    chordPopoverAudioError.hidden = false;
  } finally {
    chordPopoverPlay.disabled = false;
    chordPopoverPlay.classList.remove("is-loading");
    chordPopoverPlayLabel.textContent = tr("playChord");
  }
});
document.addEventListener("pointerdown", (event) => {
  if (chordPopover.open && !chordPopover.contains(event.target) && !event.target.closest?.(".chord-trigger")) closeChordPopover();
  if (romanPopover.open && !romanPopover.contains(event.target) && !event.target.closest?.(".roman-trigger")) closeRomanPopover();
  if (commentPopover.open && !commentPopover.contains(event.target) && !event.target.closest?.(".comment-icon, .comment-range-segment")) closeCommentPopover();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chordPopover.open) closeChordPopover();
  if (event.key === "Escape" && romanPopover.open) closeRomanPopover();
  if (event.key === "Escape" && commentPopover.open) closeCommentPopover();
});
rendererCanvas.addEventListener("scroll", () => {
  closeChordPopover();
  closeRomanPopover();
}, { passive: true });

window.addEventListener("pagehide", () => {
  lineNumbering.destroy();
  rendererDisplay.destroy();
  if (overlayFrame !== null) window.cancelAnimationFrame(overlayFrame);
  chordPianoPlayer.dispose();
  rendererNav?.destroy();
  languageSwitcherUi?.destroy();
  documentSession?.destroy();
  scoreExportUi?.destroy();
  desktopVideoCover?.destroy();
  cleanupHostedPopovers();
});

setupResizableToolbox({ handle: resizeHandle, layout: editorLayout });

setupRenderOnResize(refreshScoreLayout);

if (hostedMode) {
  document.body.classList.add("mstruct-hosted");
  if (isHostedViewer) {
    document.body.classList.add("mstruct-viewer");
    document.documentElement.classList.add("mstruct-viewer-root");
    const viewerHeightObserver = new ResizeObserver(() => reportHostedHeight());
    if (viewerContent) viewerHeightObserver.observe(viewerContent);
    document.fonts?.ready.then(() => refreshScoreLayout({ force: true })).catch(() => undefined);
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.source !== "music-theory-db" || event.data?.token !== hostToken) return;
    if (event.data.type === "mstruct-profile") void initializeFromHost(event.data);
    if (event.data.type === "chord-preferences" && setChordPreferences(event.data.chordPreferences)) renderSource();
    if (event.data.type === "renderer-scale") rendererDisplay.setScale(event.data.rendererScale);
    if (event.data.type === "transposition") setTransposition(event.data.transposition);
    if (event.data.type === "renderer-scroll-complete") rendererNav?.completeHostScroll();
    if (event.data.type === "renderer-viewport") rendererNav?.setHostViewport(event.data.viewport);
    if (event.data.type === "playback-command") rendererNav?.handleCommand(event.data.command, event.data.value);
    timelineIo?.handleMessage(event.data);
    if (event.data.type === "timeline-files") timelineEditorUi?.setFiles(event.data.timelines ?? [], event.data.selectedTimeline ?? "");
    if (event.data.type === "action-result") {
      setHostStatus(event.data.message || (event.data.ok ? tr("complete") : tr("actionFailed")), Boolean(event.data.ok));
      if (event.data.ok) markDocumentSaved();
    }
  });
}

applyInterfaceLocale();
applyEditorSettings();
if (!hostedMode) {
  await standaloneProfiles.ready;
  if (startupSettings.openDemo) {
    await documentProfile.load(metadata);
    renderSource();
    markDocumentSaved();
  } else {
    await resetToBlankDocument({ announce: false });
  }
}
document.body.classList.add("editor-ready");
desktopWorkspace = setupDesktopWorkspace({ api: desktopApi, profiles: standaloneProfiles, locale: getInterfaceLocale, session: () => documentSession, renderer: () => rendererNav, isAnalysisDirty: isDocumentDirty, isTimelineDirty: () => timelineDirty, saveTimeline: () => timelineEditorUi.save(),
  audioContext: () => ({ stable: normalizeMetadata(metadata).isStableTempo, timeline: rendererNav?.getSelectedTimeline() }), clearDirty: () => { markDocumentSaved(); setTimelineDirty(false); },
  refreshLayout: () => requestAnimationFrame(() => refreshScoreLayout({ force: true })), onTimelines: files => timelineEditorUi?.setFiles(files),
  onMissingTimelines: missing => window.alert(tr("timelineMissingNotice", { names: missing.join(", ") })), errorMessage: syntaxErrorMessage });
await desktopWorkspace?.start();
desktopVideoCover = setupDesktopVideoCover({ api: desktopApi, canOpen: () => Boolean(desktopWorkspace && !desktopWorkspace.browsing), getLocale: getInterfaceLocale,
  getMetadata: () => metadataDialog.open && metadataFields.childElementCount > 0 ? currentMetadataFromForm() : metadata });

setupEditorVideoExport({ api: desktopApi, tr, profileSession: documentProfile, parse: parseMainSource,
  navigation: () => rendererNav, display: rendererDisplay, render: renderSource, refreshLayout: () => refreshScoreLayout({ force: true }),
  getDocument: () => ({ main: sourceInput.value, metadata, comments }), getPreferences: getScorePreferences, getLayers: () => rendererLayers,
  applySnapshot(snapshot) {
    metadata = normalizeMetadata(snapshot.metadata); comments = normalizeComments(snapshot.comments);
    setInterfaceLocale(snapshot.locale); setChordPreferences(snapshot.preferences); setTransposition(snapshot.preferences, { refresh: false }); applyInterfaceLocale();
    rendererLayers = normalizeRendererLayers(snapshot.layers); sourceInput.value = snapshot.main;
  } });
