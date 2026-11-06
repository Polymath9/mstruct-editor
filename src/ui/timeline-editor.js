import { isAsciiRomanized } from "../core/mstruct-document.js";
import { createMetadataLinksEditor } from "./metadata-links.js";
import { createTimelineBulkDialog } from "./timeline-bulk-dialog.js";
import { createTimelineTableEditing } from "./timeline-table-editing.js";
import {
  createEmptyMstructtimeMetadata,
  createMstructtimeFileName,
  MAX_MSTRUCTTIME_PERFORMERS,
  musicLengthMilliseconds,
  normalizeMstructtimeMetadata,
  parseMstructtimeDocument,
  serializeMstructtimeDocument,
  validateMstructtimeMetadata,
} from "../core/mstructtime-document.js";
import { createMstructtimeLoopSource } from "../core/mstructtime-loop.js";
import { isEditableShortcutTarget } from "../core/renderer-shortcuts.js";
import {
  buildMstructtimeEventRows,
  resetMstructtimeRows,
  serializeMstructtimeMain,
  updateMstructtimeRows,
} from "../core/mstructtime-route.js";

const GRID_STEPS = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000];
const FALLBACK_DURATION = 10 * 60 * 1000;

function downloadText(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function timelineLabel(documentValue, fileName, locale) {
  const metadata = normalizeMstructtimeMetadata(documentValue?.metadata);
  if (locale === "en" && /[^\x00-\x7F]/.test(metadata.name) && metadata.nameRomanized) return metadata.nameRomanized;
  return metadata.name || metadata.nameRomanized || fileName;
}

function formatGridTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const fraction = milliseconds % 1000;
  return fraction ? `${minutes}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function textInput(name, label, value = "", options = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "metadata-field";
  const caption = document.createElement("span");
  caption.className = "metadata-field-label";
  caption.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  input.type = options.type ?? "text";
  if (options.required) input.required = true;
  if (options.inputMode) input.inputMode = options.inputMode;
  if (options.placeholder) input.placeholder = options.placeholder;
  wrapper.append(caption, input);
  return { wrapper, input };
}

export function setupTimelineEditor({
  tr,
  getLocale,
  getAnalysisResult,
  getParentMetadata,
  setParentTimelineFiles,
  rendererNav,
  setStatus,
  onModeChange,
  io,
}) {
  const switcher = document.querySelector("#editorToolSwitcher");
  const switcherButton = document.querySelector("#editorToolSwitcherButton");
  const title = document.querySelector("#editorToolTitle");
  const menu = document.querySelector("#editorToolMenu");
  const toolButtons = [...menu.querySelectorAll("[data-editor-tool]")];
  const analysisPanel = document.querySelector("#analysisScriptPanel");
  const workspace = document.querySelector("#timelineWorkspace");
  const loopInput = document.querySelector("#timelineLoopInput");
  const loopGutter = document.querySelector("#timelineLoopGutter");
  const importLoopButton = document.querySelector("#timelineImportLoop");
  const bulkImportButton = document.querySelector("#timelineBulkImport");
  const confirmDialog = document.querySelector("#timelineImportConfirmDialog");
  const confirmCancel = document.querySelector("#timelineImportConfirmCancel");
  const confirmOverwrite = document.querySelector("#timelineImportConfirmOverwrite");
  const eventRowsElement = document.querySelector("#timelineEventRows");
  const eventOrder = document.querySelector("#timelineEventOrder");
  const resetButton = document.querySelector("#timelineResetButton");
  const resetDialog = document.querySelector("#timelineResetDialog");
  const resetForm = document.querySelector("#timelineResetForm");
  const resetMeasure = document.querySelector("#timelineResetMeasure");
  const resetCancel = document.querySelector("#timelineResetCancel");
  const eventTableWrap = document.querySelector(".timeline-event-table-wrap");
  const scaleScroll = document.querySelector("#timelineScaleScroll");
  const scale = document.querySelector("#timelineScale");
  const scaleEmpty = document.querySelector("#timelineScaleEmpty");
  const zoomIn = document.querySelector("#timelineZoomIn");
  const zoomOut = document.querySelector("#timelineZoomOut");
  const countIn = document.querySelector("#timelineCountIn");
  const recordButton = document.querySelector("#timelineRecordButton");
  const importFileButton = document.querySelector("#timelineImportFileButton");
  const exportFileButton = document.querySelector("#timelineExportFileButton");
  const saveButton = document.querySelector("#timelineSaveButton");
  const editMetadataButton = document.querySelector("#timelineMetadataButton");
  const importInput = document.querySelector("#timelineImportInput");
  const managerDialog = document.querySelector("#timelineManagerDialog");
  const managerList = document.querySelector("#timelineManagerList");
  const managerClose = document.querySelector("#timelineManagerClose");
  const createButton = document.querySelector("#timelineCreateButton");
  const metadataDialog = document.querySelector("#timelineMetadataDialog");
  const metadataForm = document.querySelector("#timelineMetadataForm");
  const metadataFields = document.querySelector("#timelineMetadataFields");
  const metadataClose = document.querySelector("#timelineMetadataClose");
  const metadataCancel = document.querySelector("#timelineMetadataCancel");
  const countdownOverlay = document.querySelector("#timelineCountdownOverlay");

  let mode = "analysis";
  let stableTempo = false;
  let files = [];
  let selectedFileName = "";
  let current = null;
  let rows = [];
  let selectedRowNumber = 0;
  let dirty = false;
  let zoomLevel = 0;
  let playbackState = { elapsedMs: 0, durationMs: 0, mode: "stopped", playing: false };
  let pendingConfirm = null;
  let loopBeforeEdit = "";
  let handledSelectionSerial = 0;
  let metadataCreation = false;
  let metadataLinks;

  const tableEditing = createTimelineTableEditing({
    tr, setStatus, selectRow,
    getContext() {
      const analysis = getAnalysisResult();
      return {
        document: current, analysis, rows, main: current?.main ?? "", entries: current?.entries ?? [],
        structureKey: JSON.stringify([analysis.source, analysis.ok, getParentMetadata(), current?.loop]),
        available: Boolean(current) && analysis.ok && mode === "timeline" && !stableTempo,
      };
    },
    restore(snapshot) {
      current.main = snapshot.main;
      current.entries = snapshot.entries;
      markDirty();
      regenerateRows();
    },
  });

  const bulkDialog = createTimelineBulkDialog({
    tr,
    getContext() {
      const analysis = getAnalysisResult();
      return {
        analysis, analysisKey: JSON.stringify([analysis.source, analysis.ok, getParentMetadata()]),
        document: current, rows, loop: loopInput.value, main: current?.main ?? "",
        maximumMilliseconds: currentDuration(),
        available: Boolean(current) && mode === "timeline" && !stableTempo,
      };
    },
    commit(plan, context) {
      if (current !== context.document || getAnalysisResult().source !== context.analysis.source
        || loopInput.value !== context.loop || current.loop !== context.loop || current.main !== context.main) return false;
      const main = serializeMstructtimeMain(context.analysis, plan.rows, current.entries ?? []);
      const before = tableEditing.capture();
      rows = plan.rows;
      current.main = main;
      tableEditing.record(before);
      markDirty();
      renderRows();
      renderScale();
      rendererNav?.refreshTimelineDocument(current);
      setStatus(tr("timelineBulkComplete", plan), true);
      return true;
    },
  });
  bulkImportButton.addEventListener("click", () => bulkDialog.open());

  function currentRecord() {
    return files.find((item) => item.fileName === selectedFileName) ?? null;
  }

  function currentDuration() {
    return Math.max(
      musicLengthMilliseconds(current?.metadata?.musicLength) ?? 0,
      Number(playbackState.bgmDurationMs) || 0,
      rows.reduce((maximum, row) => Math.max(maximum, row.milliseconds ?? 0), 0),
    ) || FALLBACK_DURATION;
  }

  function setMenuOpen(open) {
    const nextOpen = Boolean(open) && !stableTempo;
    switcher.classList.toggle("is-open", nextOpen);
    switcherButton.setAttribute("aria-expanded", String(nextOpen));
  }

  function refreshSwitcherAvailability() {
    switcher.classList.toggle("is-unavailable", stableTempo);
    switcherButton.disabled = stableTempo;
    menu.hidden = stableTempo;
    if (stableTempo) setMenuOpen(false);
  }

  function updateGutter() {
    const lineCount = Math.max(1, loopInput.value.split("\n").length);
    loopGutter.replaceChildren(...Array.from({ length: lineCount }, (_, index) => {
      const line = document.createElement("span");
      line.textContent = String(index + 1);
      return line;
    }));
    loopGutter.scrollTop = loopInput.scrollTop;
  }

  function refreshLocale() {
    const titleKey = mode === "timeline" ? "timelineEditorTitle" : "appTitle";
    title.textContent = tr(titleKey);
    document.title = tr(titleKey);
    switcherButton.setAttribute("aria-label", tr("switchEditorTool"));
    menu.setAttribute("aria-label", tr("switchEditorTool"));
    toolButtons.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.editorTool === mode)));
    importFileButton.textContent = tr(io?.saveAs ? "timelineOpenFile" : "timelineImportFile");
    exportFileButton.textContent = tr(io?.saveAs ? "timelineSaveAs" : "timelineExportFile");
    refreshFileControls();
    renderManager();
    bulkDialog.refreshLocale();
  }

  function setMode(nextMode) {
    if (!["analysis", "timeline"].includes(nextMode) || (nextMode === "timeline" && stableTempo)) return;
    mode = nextMode;
    const timelineMode = mode === "timeline";
    document.body.classList.toggle("is-timeline-editor", timelineMode);
    analysisPanel.hidden = timelineMode;
    workspace.hidden = !timelineMode;
    rendererNav?.setTimelineEditing(timelineMode);
    setMenuOpen(false);
    refreshLocale();
    onModeChange?.(mode);
    tableEditing.sync();
    if (timelineMode && current) {
      renderScale();
      requestAnimationFrame(() => followPlayback({ force: true }));
    }
  }

  function serializeCurrent() {
    if (!current) return "";
    const result = getAnalysisResult();
    if (result?.ok) current.main = serializeMstructtimeMain(result, rows, current.entries ?? []);
    const text = serializeMstructtimeDocument(current);
    const parsed = parseMstructtimeDocument(text);
    if (parsed.ok) current.entries = parsed.entries;
    return text;
  }

  function markDirty(value = true) {
    dirty = Boolean(value);
    saveButton.disabled = !current || !dirty;
    io?.setDirty?.(dirty);
  }

  function regenerateRows({ preserveSelection = true } = {}) {
    if (!current) {
      rows = [];
      renderRows();
      renderScale();
      rendererNav?.setTimelineDocument(null);
      return;
    }
    const generated = buildMstructtimeEventRows(getAnalysisResult(), current.loop, current.main);
    rows = generated.rows;
    if (!preserveSelection || !rows.some((row) => row.number === selectedRowNumber)) selectedRowNumber = 0;
    renderRows();
    renderScale();
    rendererNav?.setTimelineDocument(current);
    if (!generated.ok) setStatus(tr("timelineDataInvalid"), false);
  }

  function refreshFileControls() {
    const localized = files.map((item) => ({ ...item, label: timelineLabel(item.document, item.fileName, getLocale?.()) }));
    rendererNav?.setTimelines(localized, selectedFileName);
    importFileButton.hidden = false;
    exportFileButton.hidden = !current;
    saveButton.disabled = !current || !dirty;
    editMetadataButton.disabled = !current;
    resetButton.disabled = !current;
    bulkImportButton.disabled = !current;
    recordButton.disabled = !current || !rows.length || !playbackState.enabled;
  }

  function selectFile(fileName, { notify = true } = {}) {
    const record = files.find((item) => item.fileName === fileName && !item.missing) ?? null;
    selectedFileName = record?.fileName ?? "";
    current = record?.document ?? null;
    selectedRowNumber = 0;
    loopInput.value = current?.loop ?? "";
    loopBeforeEdit = loopInput.value;
    updateGutter();
    markDirty(false);
    regenerateRows({ preserveSelection: false });
    refreshFileControls();
    if (notify && record) setStatus(tr("timelineSelected", { name: timelineLabel(current, record.fileName, getLocale?.()) }), true);
  }

  function setFiles(nextFiles = [], preferred = "") {
    files = nextFiles.map((item) => {
      if (item.missing) return { ...item, document: null };
      const parsed = item.document?.metadata ? item.document : parseMstructtimeDocument(item.documentText ?? "");
      return { ...item, document: parsed.ok ? parsed : null, missing: !parsed.ok };
    });
    const firstAvailable = files.find((item) => item.document)?.fileName ?? "";
    const nextSelected = files.some((item) => item.fileName === preferred && item.document) ? preferred : firstAvailable;
    selectFile(nextSelected, { notify: false });
    renderManager();
  }

  function selectRow(number, { center = true, seek = true } = {}) {
    if (!rows.some((row) => row.number === number)) return;
    selectedRowNumber = number;
    reflectSelectedRow();
    revealSelectedEventRow();
    const row = rows.find((candidate) => candidate.number === number);
    if (seek && row) rendererNav?.selectTimelineRow(row.number);
    if (center) centerRow(number, { autoZoom: true });
  }

  function reflectSelectedRow() {
    eventRowsElement.querySelectorAll("[data-timeline-row]").forEach((element) => {
      element.classList.toggle("is-selected", Number(element.dataset.timelineRow) === selectedRowNumber);
    });
    scale.querySelectorAll("[data-timeline-marker]").forEach((element) => {
      element.classList.toggle("is-selected", Number(element.dataset.timelineMarker) === selectedRowNumber);
    });
  }

  function revealSelectedEventRow() {
    const element = eventRowsElement.querySelector(`[data-timeline-row="${selectedRowNumber}"]`);
    if (!element || !eventTableWrap) return;
    const headerHeight = eventTableWrap.querySelector("thead")?.offsetHeight ?? 0;
    const visibleTop = eventTableWrap.scrollTop + headerHeight;
    const visibleBottom = eventTableWrap.scrollTop + eventTableWrap.clientHeight;
    const rowTop = element.offsetTop;
    const rowBottom = rowTop + element.offsetHeight;
    if (rowTop < visibleTop) eventTableWrap.scrollTop = Math.max(0, rowTop - headerHeight);
    else if (rowBottom > visibleBottom) eventTableWrap.scrollTop = rowBottom - eventTableWrap.clientHeight;
  }

  function renderRows() {
    tableEditing.sync();
    if (!current || !rows.length) {
      const empty = document.createElement("tr");
      empty.className = "timeline-event-empty";
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = tr(current ? "timelineDataInvalid" : "timelineChooseFile");
      empty.append(cell);
      eventRowsElement.replaceChildren(empty);
      refreshFileControls();
      return;
    }
    const displayRows = eventOrder.value === "descending" ? [...rows].reverse() : rows;
    eventRowsElement.replaceChildren(...displayRows.map((row) => {
      const trElement = document.createElement("tr");
      trElement.dataset.timelineRow = String(row.number);
      trElement.classList.toggle("is-selected", row.number === selectedRowNumber);
      if (row.kind === "start") trElement.classList.add("is-start");
      const number = document.createElement("td");
      number.textContent = String(row.number);
      if (row.kind === "ellipsis") number.title = "...";
      if (row.kind === "start") {
        const start = document.createElement("td");
        start.colSpan = 3;
        start.textContent = "START";
        const timestamp = document.createElement("td");
        timestamp.textContent = "0";
        trElement.append(number, start, timestamp);
      } else {
        trElement.append(number);
        [row.measure, row.beat, row.pass].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          trElement.append(cell);
        });
        const timestamp = document.createElement("td");
        timestamp.className = "timeline-timestamp-cell";
        timestamp.textContent = row.milliseconds ?? "";
        timestamp.title = tr("timelineEditTimestamp");
        timestamp.addEventListener("click", (event) => {
          event.stopPropagation();
          if (timestamp.querySelector("input")) return;
          selectRow(row.number);
          beginTimestampEdit(row.number, timestamp);
        });
        trElement.append(timestamp);
      }
      trElement.addEventListener("click", () => selectRow(row.number));
      return trElement;
    }));
    tableEditing.paint();
    refreshFileControls();
  }

  function timestampBounds(number) {
    const index = rows.findIndex((row) => row.number === number);
    let minimum = 0;
    let maximum = currentDuration();
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (rows[cursor].milliseconds !== null) { minimum = rows[cursor].milliseconds; break; }
    }
    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      if (rows[cursor].milliseconds !== null) { maximum = rows[cursor].milliseconds; break; }
    }
    return { minimum, maximum };
  }

  function setTimestamp(number, value) {
    const row = rows.find((candidate) => candidate.number === number);
    if (!row || row.kind === "start") return false;
    const parsed = value === null || value === "" ? null : Number(value);
    if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed < 0)) return false;
    if (parsed !== null) {
      const { minimum, maximum } = timestampBounds(number);
      if (parsed < minimum || parsed > maximum) return false;
    }
    const before = tableEditing.capture();
    rows = updateMstructtimeRows(rows, number, parsed);
    current.main = serializeMstructtimeMain(getAnalysisResult(), rows, current.entries ?? []);
    tableEditing.record(before);
    markDirty();
    rendererNav?.refreshTimelineDocument(current);
    updateTimestampPresentation(number);
    return true;
  }

  function updateTimestampPresentation(number) {
    const row = rows.find((candidate) => candidate.number === number);
    if (!row) return;
    const cell = eventRowsElement.querySelector(`[data-timeline-row="${number}"] .timeline-timestamp-cell`);
    if (cell && !cell.querySelector("input")) cell.textContent = row.milliseconds ?? "";
    let marker = scale.querySelector(`[data-timeline-marker="${number}"]`);
    if (row.milliseconds === null) {
      marker?.remove();
      return;
    }
    const pixelsPerMs = scaleHeight() / currentDuration();
    if (!marker) {
      marker = makeTimelineMarker(row, pixelsPerMs);
      scale.querySelector(".timeline-playhead")?.before(marker);
    } else {
      marker.style.bottom = `${row.milliseconds * pixelsPerMs}px`;
    }
    marker.classList.toggle("is-selected", row.number === selectedRowNumber);
  }

  function beginTimestampEdit(rowNumber, cell) {
    const row = rows.find((candidate) => candidate.number === rowNumber);
    if (!row || row.kind === "start") return;
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.value = row.milliseconds ?? "";
    cell.replaceChildren(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      if (!setTimestamp(row.number, input.value.trim())) {
        input.setCustomValidity(tr("timelineTimestampOrder"));
        input.reportValidity();
        input.focus();
      } else {
        cancelled = true;
        const updated = rows.find((candidate) => candidate.number === row.number);
        cell.textContent = updated?.milliseconds ?? "";
      }
    };
    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish();
        if (!input.isConnected) eventTableWrap.focus({ preventScroll: true });
      }
      if (event.key === "Escape") { event.preventDefault(); cancelled = true; renderRows(); }
    });
  }

  function scaleHeight() {
    const viewport = Math.max(240, scaleScroll.clientHeight || 240);
    const duration = currentDuration();
    const maximum = Math.max(1, duration / 1000) * viewport;
    return Math.min(maximum, viewport * (1.8 ** zoomLevel));
  }

  function centerRow(number, { autoZoom = false } = {}) {
    let marker = scale.querySelector(`[data-timeline-marker="${number}"]`);
    if (!marker) {
      if (number === 0) followPlayback({ force: true });
      return;
    }
    if (autoZoom && scale.scrollHeight <= scaleScroll.clientHeight + 1 && zoomLevel < 20) {
      zoomLevel += 1;
      renderScale();
      marker = scale.querySelector(`[data-timeline-marker="${number}"]`);
      if (!marker) return;
    }
    const top = marker.offsetTop - scaleScroll.clientHeight / 2;
    scaleScroll.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  }

  function positionPlayhead() {
    const playhead = scale.querySelector(".timeline-playhead");
    if (!playhead || !current) return;
    const duration = currentDuration();
    const pixelsPerMs = scaleHeight() / duration;
    playhead.style.bottom = `${Math.min(duration, playbackState.elapsedMs ?? 0) * pixelsPerMs}px`;
  }

  function followPlayback({ force = false } = {}) {
    if (!current || !scaleScroll.clientHeight || (!force && !playbackState.playing)) return;
    const playhead = scale.querySelector(".timeline-playhead");
    if (!playhead) return;
    const playheadTop = playhead.offsetTop;
    const playheadBottom = playheadTop + playhead.offsetHeight;
    const visibleTop = scaleScroll.scrollTop;
    const visibleBottom = visibleTop + scaleScroll.clientHeight;
    if (!force && playheadTop >= visibleTop && playheadBottom <= visibleBottom) return;
    const target = playheadTop < visibleTop
      ? playheadTop
      : playheadBottom - scaleScroll.clientHeight;
    scaleScroll.scrollTo({ top: target, behavior: "auto" });
  }

  function zoomTimeline(delta) {
    playbackState = rendererNav?.getPlaybackState?.() ?? playbackState;
    const playhead = scale.querySelector(".timeline-playhead");
    const viewportPosition = playhead ? playhead.offsetTop - scaleScroll.scrollTop : scaleScroll.clientHeight;
    zoomLevel = Math.max(0, Math.min(20, zoomLevel + delta));
    renderScale();
    const nextPlayhead = scale.querySelector(".timeline-playhead");
    if (!nextPlayhead) return;
    scaleScroll.scrollTop = Math.max(0, nextPlayhead.offsetTop - viewportPosition);
  }

  function makeTimelineMarker(row, pixelsPerMs) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "timeline-event-marker";
    marker.classList.toggle("is-selected", row.number === selectedRowNumber);
    marker.dataset.timelineMarker = String(row.number);
    marker.style.bottom = `${row.milliseconds * pixelsPerMs}px`;
    const label = document.createElement("span");
    label.textContent = String(row.number);
    marker.append(label);
    marker.addEventListener("click", (event) => { event.stopPropagation(); selectRow(row.number); });
    marker.addEventListener("pointerdown", (event) => beginMarkerDrag(event, row.number));
    return marker;
  }

  function renderScale() {
    scale.replaceChildren();
    scaleEmpty.hidden = Boolean(current);
    if (!current) return;
    const duration = currentDuration();
    const height = scaleHeight();
    scale.style.height = `${height}px`;
    const pixelsPerMs = height / duration;
    const gridStep = GRID_STEPS.find((step) => step * pixelsPerMs >= 34) ?? GRID_STEPS.at(-1);
    for (let milliseconds = 0; milliseconds <= duration; milliseconds += gridStep) {
      const line = document.createElement("div");
      line.className = "timeline-grid-line";
      line.style.bottom = `${milliseconds * pixelsPerMs}px`;
      line.textContent = formatGridTime(milliseconds);
      scale.append(line);
    }
    for (const row of rows) {
      if (row.kind === "start" || row.milliseconds === null) continue;
      scale.append(makeTimelineMarker(row, pixelsPerMs));
    }
    const playhead = document.createElement("button");
    playhead.type = "button";
    playhead.className = "timeline-playhead";
    playhead.style.bottom = `${Math.min(duration, playbackState.elapsedMs ?? 0) * pixelsPerMs}px`;
    playhead.setAttribute("aria-label", tr("timelinePlayhead"));
    playhead.addEventListener("pointerdown", beginPlayheadDrag);
    scale.append(playhead);
  }

  function millisecondsForPointer(event) {
    const rect = scale.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (rect.bottom - event.clientY) / rect.height));
    return Math.round(ratio * currentDuration());
  }

  function autoScrollScale(event) {
    const rect = scaleScroll.getBoundingClientRect();
    const margin = Math.min(64, rect.height / 4);
    if (event.clientY < rect.top + margin) scaleScroll.scrollBy({ top: -Math.max(8, (rect.top + margin - event.clientY) / 2) });
    if (event.clientY > rect.bottom - margin) scaleScroll.scrollBy({ top: Math.max(8, (event.clientY - (rect.bottom - margin)) / 2) });
  }

  function trackPointerDrag(move, finishDrag) {
    const onMove = (event) => {
      autoScrollScale(event);
      move(event);
    };
    const finish = (event) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      finishDrag?.(event);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function beginMarkerDrag(event, rowNumber) {
    event.preventDefault();
    document.activeElement?.blur?.();
    selectRow(rowNumber, { center: false, seek: false });
    const before = tableEditing.capture();
    const initialMilliseconds = rows.find((row) => row.number === rowNumber)?.milliseconds ?? null;
    let pendingMilliseconds = initialMilliseconds;
    const move = (moveEvent) => {
      const { minimum, maximum } = timestampBounds(rowNumber);
      const next = Math.min(maximum, Math.max(minimum, millisecondsForPointer(moveEvent)));
      if (next === pendingMilliseconds) return;
      pendingMilliseconds = next;
      rows = updateMstructtimeRows(rows, rowNumber, next);
      updateTimestampPresentation(rowNumber);
    };
    trackPointerDrag(move, () => {
      if (pendingMilliseconds === null || pendingMilliseconds === initialMilliseconds) return;
      current.main = serializeMstructtimeMain(getAnalysisResult(), rows, current.entries ?? []);
      tableEditing.record(before);
      markDirty();
      rendererNav?.refreshTimelineDocument(current);
      rendererNav?.seekPlayback(pendingMilliseconds);
    });
  }

  function beginPlayheadDrag(event) {
    event.preventDefault();
    document.activeElement?.blur?.();
    const move = (moveEvent) => rendererNav?.seekPlayback(millisecondsForPointer(moveEvent));
    move(event);
    trackPointerDrag(move);
  }

  function applyLoop(source) {
    current.loop = source;
    loopInput.value = source;
    loopBeforeEdit = source;
    updateGutter();
    markDirty();
    regenerateRows();
    setStatus(tr("timelineLoopImported"), true);
    loopInput.focus();
  }

  function confirmReplacement(callback) {
    pendingConfirm = callback;
    confirmDialog.showModal();
  }

  function requestLoopImport() {
    if (!current) return;
    const result = getAnalysisResult();
    if (!result?.ok) { setStatus(tr("timelineLoopImportInvalid"), false); return; }
    const source = createMstructtimeLoopSource(result);
    if (source === null) { setStatus(tr("timelineLoopImportContinuousBars"), false); return; }
    if (!source) { setStatus(tr("timelineLoopImportEmpty"), true); return; }
    if (loopInput.value.trim() || rows.some((row) => row.kind !== "start" && row.milliseconds !== null)) {
      confirmReplacement(() => applyLoop(source));
      return;
    }
    applyLoop(source);
  }

  function makePerformerRow(performer, index) {
    const row = document.createElement("div");
    row.className = "metadata-repeat-row";
    row.dataset.timelinePerformer = "true";
    const heading = document.createElement("p");
    heading.className = "metadata-repeat-title";
    heading.textContent = tr("timelinePerformer", { count: index + 1 });
    const pair = document.createElement("div");
    pair.className = "metadata-pair";
    pair.append(
      textInput("timelinePerformerName", tr("name"), performer.name, { required: true }).wrapper,
      textInput("timelinePerformerRomanized", `${tr("name")}${tr("romanized")}`, performer.romanized).wrapper,
    );
    row.append(heading, pair);
    if (index > 0) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "metadata-remove";
      remove.textContent = tr("remove");
      remove.addEventListener("click", () => { row.remove(); renumberPerformers(); });
      row.append(remove);
    }
    return row;
  }

  function renumberPerformers() {
    [...metadataFields.querySelectorAll("[data-timeline-performer]")].forEach((row, index) => {
      row.querySelector(".metadata-repeat-title").textContent = tr("timelinePerformer", { count: index + 1 });
    });
  }

  function readMetadataForm() {
    const value = (name) => metadataForm.elements.namedItem(name)?.value?.trim() ?? "";
    return normalizeMstructtimeMetadata({
      name: value("timelineName"),
      nameRomanized: value("timelineNameRomanized"),
      performers: [...metadataFields.querySelectorAll("[data-timeline-performer]")].map((row) => ({
        name: row.querySelector('[name="timelinePerformerName"]').value.trim(),
        romanized: row.querySelector('[name="timelinePerformerRomanized"]').value.trim(),
      })),
      recordAlbum: value("timelineRecordAlbum"),
      recordAlbumRomanized: value("timelineRecordAlbumRomanized"),
      recordYear: value("timelineRecordYear"),
      musicLength: value("timelineMusicLength"),
      ...metadataLinks.read(),
    });
  }

  function refreshMetadataFormValidity() {
    const metadata = readMetadataForm();
    for (const input of metadataFields.querySelectorAll("input")) input.setCustomValidity("");
    const validation = validateMstructtimeMetadata(metadata);
    const fieldFor = ({ code, details }) => {
      if (code.startsWith("mstructtime-name")) return metadataForm.elements.namedItem(code.includes("romanized") ? "timelineNameRomanized" : "timelineName");
      if (code.includes("performer")) {
        const performer = metadataFields.querySelectorAll("[data-timeline-performer]")[Math.max(0, Number(details?.count ?? 1) - 1)];
        return performer?.querySelector(code.includes("romanized") ? '[name="timelinePerformerRomanized"]' : '[name="timelinePerformerName"]');
      }
      if (code.includes("album")) return metadataForm.elements.namedItem("timelineRecordAlbumRomanized");
      if (code.includes("year")) return metadataForm.elements.namedItem("timelineRecordYear");
      if (code.includes("length")) return metadataForm.elements.namedItem("timelineMusicLength");
      return null;
    };
    for (const item of validation.errors) fieldFor(item)?.setCustomValidity(tr(item.code));
    for (const input of metadataFields.querySelectorAll('[name$="Romanized"]')) {
      if (!isAsciiRomanized(input.value)) input.setCustomValidity(tr("romanizedAscii"));
    }
    metadataLinks.validate();
    return validation.ok;
  }

  function validateMetadataForm() {
    refreshMetadataFormValidity();
    return metadataForm.reportValidity();
  }

  function openMetadata({ creation = false } = {}) {
    metadataCreation = creation;
    const metadata = normalizeMstructtimeMetadata(current?.metadata ?? createEmptyMstructtimeMetadata());
    metadataFields.replaceChildren();
    const basic = document.createElement("fieldset");
    basic.className = "metadata-section";
    const basicLegend = document.createElement("legend");
    basicLegend.textContent = tr("basic");
    basic.append(basicLegend);
    const namePair = document.createElement("div");
    namePair.className = "metadata-pair";
    namePair.append(
      textInput("timelineName", tr("timelineName"), metadata.name, { required: true }).wrapper,
      textInput("timelineNameRomanized", `${tr("timelineName")}${tr("romanized")}`, metadata.nameRomanized).wrapper,
    );
    basic.append(namePair);
    metadataFields.append(basic);
    const performers = document.createElement("fieldset");
    performers.className = "metadata-section";
    const legend = document.createElement("legend");
    legend.textContent = tr("timelinePerformers");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "metadata-add";
    add.textContent = tr("timelineAddPerformer");
    add.addEventListener("click", () => {
      const count = performers.querySelectorAll("[data-timeline-performer]").length;
      if (count < MAX_MSTRUCTTIME_PERFORMERS) performers.append(makePerformerRow({ name: "", romanized: "" }, count));
    });
    performers.append(legend, add);
    metadata.performers.forEach((performer, index) => performers.append(makePerformerRow(performer, index)));
    metadataFields.append(performers);
    const recording = document.createElement("fieldset");
    recording.className = "metadata-section";
    const recordingLegend = document.createElement("legend");
    recordingLegend.textContent = tr("timelineRecording");
    recording.append(recordingLegend);
    const albumPair = document.createElement("div");
    albumPair.className = "metadata-pair";
    albumPair.append(
      textInput("timelineRecordAlbum", tr("recordAlbum"), metadata.recordAlbum).wrapper,
      textInput("timelineRecordAlbumRomanized", `${tr("recordAlbum")}${tr("romanized")}`, metadata.recordAlbumRomanized).wrapper,
    );
    recording.append(
      albumPair,
      textInput("timelineRecordYear", tr("timelineRecordYear"), metadata.recordYear, { inputMode: "numeric" }).wrapper,
      textInput("timelineMusicLength", tr("timelineMusicLength"), metadata.musicLength, { required: true, inputMode: "numeric", placeholder: "4:30" }).wrapper,
    );
    metadataFields.append(recording);
    const links = document.createElement("fieldset"); links.className = "metadata-section";
    const linksLegend = document.createElement("legend"); linksLegend.textContent = tr("metadataLinks"); links.append(linksLegend);
    metadataFields.append(links);
    metadataLinks = createMetadataLinksEditor({ parent: links, metadata, tr, onChange: refreshMetadataFormValidity });
    if (!metadataDialog.open) metadataDialog.showModal();
    metadataFields.querySelector("input")?.focus();
  }

  async function createTimeline(documentValue) {
    const parentName = io?.parentFileName?.() ?? getParentMetadata()?.songNameRomanized ?? getParentMetadata()?.songName ?? "untitled.mstruct";
    const suggestedFileName = createMstructtimeFileName(parentName);
    const text = serializeMstructtimeDocument(documentValue);
    let result;
    try {
      result = await io?.create?.({ fileName: suggestedFileName, documentText: text });
    } catch (error) {
      setStatus(error?.message || tr("saveFileFailed"), false);
      return;
    }
    if (result?.cancelled) return;
    if (result?.ok === false) { setStatus(result.message || tr("saveFileFailed"), false); return; }
    const fileName = result?.fileName ?? suggestedFileName;
    const parsed = parseMstructtimeDocument(result?.documentText ?? text);
    if (!parsed.ok) { setStatus(tr("timelineFileInvalid"), false); return; }
    files.push({ fileName, document: parsed, history: Boolean(result?.history), id: result?.id });
    setParentTimelineFiles?.(files.map((item) => item.fileName));
    selectFile(fileName, { notify: false });
    renderManager();
    setStatus(tr("timelineCreated", { name: timelineLabel(parsed, fileName, getLocale?.()) }), true);
  }

  async function readImportedFile(file) {
    if (!file) return null;
    const parsed = parseMstructtimeDocument(await file.text());
    if (!parsed.ok) { setStatus(tr("timelineFileInvalid"), false); return null; }
    return parsed;
  }

  function requestImport() {
    if (io?.open) {
      void io.open().then((result) => {
        if (result?.cancelled) return;
        const parsed = parseMstructtimeDocument(result?.documentText ?? "");
        if (!parsed.ok) { setStatus(tr("timelineFileInvalid"), false); return; }
        const existing = files.find((item) => item.fileName === result.fileName);
        if (existing) {
          existing.document = parsed;
          existing.missing = false;
        } else {
          files.push({ fileName: result.fileName, document: parsed, history: false });
          setParentTimelineFiles?.(files.map((item) => item.fileName));
        }
        selectFile(result.fileName);
        renderManager();
      }).catch((error) => setStatus(error?.message || tr("openFileFailed"), false));
      return;
    }
    importInput.click();
  }

  async function saveCurrent() {
    if (!current) return false;
    const documentText = serializeCurrent(), fileName = selectedFileName;
    let result;
    try {
      result = await io?.save?.({ fileName: selectedFileName, documentText, id: currentRecord()?.id });
    } catch (error) {
      setStatus(error?.message || tr("saveFileFailed"), false);
      return false;
    }
    if (result?.cancelled || result?.ok === false) { setStatus(result?.message || tr("saveFileFailed"), false); return false; }
    if (selectedFileName !== fileName || serializeCurrent() !== documentText) return false;
    markDirty(false);
    setStatus(tr("timelineSaved", { name: selectedFileName }), true);
    return true;
  }

  async function saveCurrentAs() {
    if (!current || !io?.saveAs) return;
    const documentText = serializeCurrent();
    let result;
    try {
      result = await io.saveAs({ fileName: selectedFileName, documentText, id: currentRecord()?.id });
    } catch (error) {
      setStatus(error?.message || tr("saveFileFailed"), false);
      return;
    }
    if (result?.cancelled || result?.ok === false || !result?.fileName) return;
    const parsed = parseMstructtimeDocument(result.documentText ?? documentText);
    if (!parsed.ok) { setStatus(tr("timelineFileInvalid"), false); return; }
    const existing = files.find((item) => item.fileName === result.fileName);
    if (existing) Object.assign(existing, { document: parsed, missing: false });
    else files.push({ fileName: result.fileName, document: parsed, history: false });
    setParentTimelineFiles?.(files.map((item) => item.fileName));
    selectFile(result.fileName, { notify: false });
    renderManager();
    setStatus(tr("timelineSaved", { name: result.fileName }), true);
  }

  async function deleteTimeline(fileName) {
    const record = files.find((item) => item.fileName === fileName);
    if (!record || !window.confirm(tr("timelineDeleteConfirm", { name: timelineLabel(record.document, fileName, getLocale?.()) }))) return;
    let result;
    try {
      result = await io?.remove?.({ fileName, id: record.id });
    } catch (error) {
      setStatus(error?.message || tr("actionFailed"), false);
      return;
    }
    if (result?.cancelled || result?.ok === false) return;
    files = files.filter((item) => item.fileName !== fileName);
    setParentTimelineFiles?.(files.map((item) => item.fileName));
    selectFile(files.find((item) => item.document)?.fileName ?? "", { notify: false });
    renderManager();
  }

  function renderManager() {
    if (!managerList) return;
    if (!files.length) {
      const empty = document.createElement("p");
      empty.className = "timeline-manager-empty";
      empty.textContent = tr("timelineNoFiles");
      managerList.replaceChildren(empty);
      return;
    }
    const elements = files.map((item) => {
      const row = document.createElement("div");
      row.className = "timeline-manager-row";
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "timeline-manager-name";
      choose.textContent = item.missing ? `${item.fileName} — ${tr("timelineMissing")}` : timelineLabel(item.document, item.fileName, getLocale?.());
      choose.disabled = item.missing;
      choose.addEventListener("click", () => { selectFile(item.fileName); managerDialog.close(); });
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "dialog-secondary";
      edit.textContent = tr("timelineEditMetadata");
      edit.disabled = item.missing;
      edit.addEventListener("click", () => { selectFile(item.fileName, { notify: false }); managerDialog.close(); openMetadata(); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "metadata-remove";
      remove.textContent = tr("remove");
      remove.addEventListener("click", () => void deleteTimeline(item.fileName));
      row.append(choose, edit, remove);
      return row;
    });
    managerList.replaceChildren(...elements);
  }

  function recordNextEvent() {
    const livePlaybackState = rendererNav?.getPlaybackState?.() ?? playbackState;
    if (!current || !livePlaybackState.enabled || livePlaybackState.mode === "stopped") return;
    const selectedIndex = rows.findIndex((row) => row.number === selectedRowNumber);
    const next = rows[selectedIndex + 1];
    if (!next) return;
    const value = Math.max(0, Math.round(livePlaybackState.elapsedMs));
    if (!setTimestamp(next.number, value)) { setStatus(tr("timelineTimestampOrder"), false); return; }
    selectRow(next.number, { center: true, seek: false });
  }

  switcherButton.addEventListener("click", () => setMenuOpen(!switcher.classList.contains("is-open")));
  switcher.addEventListener("mouseenter", () => setMenuOpen(true));
  switcher.addEventListener("mouseleave", () => { if (!switcher.contains(document.activeElement)) setMenuOpen(false); });
  switcher.addEventListener("focusout", (event) => { if (!switcher.contains(event.relatedTarget)) setMenuOpen(false); });
  toolButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.editorTool)));
  loopInput.addEventListener("focus", () => { loopBeforeEdit = loopInput.value; });
  loopInput.addEventListener("input", updateGutter);
  loopInput.addEventListener("scroll", () => { loopGutter.scrollTop = loopInput.scrollTop; });
  loopInput.addEventListener("change", () => {
    if (!current || loopInput.value === loopBeforeEdit) return;
    const nextSource = loopInput.value;
    const apply = () => applyLoop(nextSource);
    if (rows.some((row) => row.kind !== "start" && row.milliseconds !== null)) confirmReplacement(apply);
    else apply();
  });
  importLoopButton.addEventListener("click", requestLoopImport);
  confirmCancel.addEventListener("click", () => { pendingConfirm = null; loopInput.value = loopBeforeEdit; updateGutter(); confirmDialog.close(); });
  confirmOverwrite.addEventListener("click", () => { const action = pendingConfirm; pendingConfirm = null; confirmDialog.close(); action?.(); });
  confirmDialog.addEventListener("cancel", () => { pendingConfirm = null; loopInput.value = loopBeforeEdit; updateGutter(); });
  eventOrder.addEventListener("change", () => { renderRows(); revealSelectedEventRow(); });
  resetButton.addEventListener("click", () => { resetMeasure.value = ""; resetDialog.showModal(); resetMeasure.focus(); });
  resetCancel.addEventListener("click", () => resetDialog.close());
  resetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const measure = Number(resetMeasure.value);
    if (!Number.isSafeInteger(measure) || measure < 0) return;
    const before = tableEditing.capture();
    rows = resetMstructtimeRows(rows, measure);
    current.entries = (current.entries ?? []).filter((entry) => entry.measure < measure);
    current.main = serializeMstructtimeMain(getAnalysisResult(), rows, current.entries);
    tableEditing.record(before);
    markDirty();
    regenerateRows();
    resetDialog.close();
  });
  zoomIn.addEventListener("click", () => zoomTimeline(1));
  zoomOut.addEventListener("click", () => zoomTimeline(-1));
  countIn.addEventListener("click", () => {
    const enabled = countIn.getAttribute("aria-pressed") !== "true";
    countIn.setAttribute("aria-pressed", String(enabled));
    rendererNav?.setCountIn?.(enabled);
  });
  recordButton.addEventListener("click", recordNextEvent);
  importFileButton.addEventListener("click", requestImport);
  exportFileButton.addEventListener("click", () => {
    if (!current) return;
    if (io?.saveAs) void saveCurrentAs();
    else io?.download?.({ fileName: selectedFileName, documentText: serializeCurrent() }) ?? downloadText(serializeCurrent(), selectedFileName);
  });
  saveButton.addEventListener("click", () => void saveCurrent());
  editMetadataButton.addEventListener("click", () => { if (current) openMetadata(); });
  managerClose.addEventListener("click", () => managerDialog.close());
  createButton.addEventListener("click", () => { managerDialog.close(); openMetadata({ creation: true }); });
  metadataClose.addEventListener("click", () => metadataDialog.close());
  metadataCancel.addEventListener("click", () => metadataDialog.close());
  metadataForm.addEventListener("input", refreshMetadataFormValidity);
  metadataForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validateMetadataForm()) return;
    const documentValue = { metadata: createEmptyMstructtimeMetadata(), loop: createMstructtimeLoopSource(getAnalysisResult()) ?? "", main: "", entries: [] };
    documentValue.metadata = readMetadataForm();
    metadataDialog.close();
    if (metadataCreation) void createTimeline(documentValue);
    else {
      current.metadata = documentValue.metadata;
      markDirty();
      refreshFileControls();
      renderManager();
      rendererNav?.setTimelineDocument(current);
    }
  });
  importInput.addEventListener("change", async () => {
    const [file] = importInput.files ?? [];
    importInput.value = "";
    const parsed = await readImportedFile(file);
    if (!parsed) return;
    await createTimeline(parsed);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && switcher.classList.contains("is-open")) setMenuOpen(false);
    const timelineShortcut = mode === "timeline" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !isEditableShortcutTarget(event.target) && !event.target.closest?.("dialog");
    if (timelineShortcut && (event.key === "+" || event.key === "-")) {
      event.preventDefault();
      event.stopPropagation();
      zoomTimeline(event.key === "+" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && timelineShortcut) {
      event.preventDefault();
      event.stopPropagation();
      recordNextEvent();
    }
  });

  updateGutter();
  setMode("analysis");

  return {
    get mode() { return mode; },
    save: saveCurrent,
    refreshLocale,
    updateDocument({ isStableTempo } = {}) {
      stableTempo = Boolean(isStableTempo);
      refreshSwitcherAvailability();
      if (stableTempo && mode === "timeline") setMode("analysis");
      else refreshLocale();
      if (current) regenerateRows();
    },
    setFiles,
    selectFile,
    openManager() { renderManager(); managerDialog.showModal(); },
    downloadCurrent() { if (current) (io?.download?.({ fileName: selectedFileName, documentText: serializeCurrent() }) ?? downloadText(serializeCurrent(), selectedFileName)); },
    openHistory() { const record = currentRecord(); if (record) io?.history?.({ fileName: record.fileName, id: record.id }); },
    handlePlaybackState(state, activeEntry) {
      const previousDuration = currentDuration();
      playbackState = state;
      const selectionSerial = Number(state.selectionSerial ?? 0);
      const shouldCenterSelection = selectionSerial > 0 && selectionSerial !== handledSelectionSerial;
      handledSelectionSerial = selectionSerial;
      countdownOverlay.hidden = !state.countdown;
      countdownOverlay.textContent = state.countdown ? String(state.countdown) : "";
      recordButton.disabled = !current || !rows.length || !state.enabled;
      if (activeEntry?.rowNumber && mode === "timeline" && activeEntry.rowNumber !== selectedRowNumber) {
        selectedRowNumber = activeEntry.rowNumber;
        reflectSelectedRow();
        revealSelectedEventRow();
      }
      if (current && mode === "timeline") {
        if (currentDuration() !== previousDuration) renderScale();
        else positionPlayhead();
        followPlayback();
      }
      if (shouldCenterSelection && activeEntry?.rowNumber && mode === "timeline") {
        centerRow(activeEntry.rowNumber, { autoZoom: true });
      }
    },
  };
}
