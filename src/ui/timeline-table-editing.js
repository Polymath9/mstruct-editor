import { isEditableShortcutTarget } from "../core/renderer-shortcuts.js";
import { serializeMstructtimeMain } from "../core/mstructtime-route.js";

function sameRoute(left, right) {
  return left?.document === right?.document && left?.structureKey === right?.structureKey;
}

function snapshot(context) {
  return { main: context.main, entries: structuredClone(context.entries ?? []) };
}

// History belongs to one document and one expanded route. Timestamp edits are
// recorded together so undoing a clear cannot overwrite a later manual edit.
export function createTimelineHistory(limit = 100) {
  let head;
  const past = [];
  const future = [];
  function sync(context) {
    const routeChanged = !sameRoute(head, context);
    if (routeChanged || head?.main !== context.main) {
      past.length = 0;
      future.length = 0;
    }
    head = context;
    return routeChanged;
  }
  return {
    sync,
    state(context) {
      sync(context);
      return { undo: past.length > 0, redo: future.length > 0 };
    },
    record(before, after) {
      sync(before);
      if (!sameRoute(before, after)) { sync(after); return; }
      if (before.main === after.main) return;
      past.push({ before: snapshot(before), after: snapshot(after) });
      if (past.length > limit) past.shift();
      future.length = 0;
      head = after;
    },
    step(direction, context) {
      sync(context);
      const undo = direction === "undo";
      const entry = (undo ? past : future).pop();
      if (!entry) return null;
      (undo ? future : past).push(entry);
      const next = structuredClone(undo ? entry.before : entry.after);
      head = { ...context, ...next };
      return next;
    },
  };
}

export function selectTimelineRows(selected, anchor, number, { shiftKey, ctrlKey, metaKey } = {}) {
  const additive = ctrlKey || metaKey;
  const next = additive ? new Set(selected) : new Set();
  if (shiftKey && anchor !== null) {
    for (let id = Math.min(anchor, number); id <= Math.max(anchor, number); id += 1) {
      if (id > 0) next.add(id);
    }
    return { selected: next, anchor };
  }
  if (number > 0) {
    if (additive && next.has(number)) next.delete(number);
    else next.add(number);
  }
  return { selected: next, anchor: number };
}

export function createTimelineTableEditing({ getContext, restore, selectRow, tr, setStatus }) {
  const wrap = document.querySelector(".timeline-event-table-wrap");
  const body = document.querySelector("#timelineEventRows");
  const undoButton = document.querySelector("#timelineUndoButton");
  const redoButton = document.querySelector("#timelineRedoButton");
  const history = createTimelineHistory();
  let selection = { selected: new Set(), anchor: null };

  function paint() {
    body.querySelectorAll("[data-timeline-row]").forEach((row) => {
      const selected = selection.selected.has(Number(row.dataset.timelineRow));
      row.classList.toggle("is-multiselected", selected);
      row.setAttribute("aria-selected", String(selected));
    });
  }

  function sync() {
    const context = getContext();
    if (history.sync(context)) selection = { selected: new Set(), anchor: null };
    const state = history.state(context);
    undoButton.disabled = !context.available || !state.undo;
    redoButton.disabled = !context.available || !state.redo;
    paint();
  }

  function record(before) {
    history.record(before, getContext());
    sync();
  }

  function changeHistory(direction) {
    const context = getContext();
    if (!context.available) return;
    const next = history.step(direction, context);
    if (!next) { sync(); return; }
    restore(next);
    sync();
    setStatus(tr(direction === "undo" ? "timelineUndone" : "timelineRedone"), true);
  }

  function clear() {
    sync();
    const context = getContext();
    if (!context.available) return;
    let count = 0;
    const rows = context.rows.map((row) => {
      if (row.kind === "start" || !selection.selected.has(row.number) || row.milliseconds === null) return row;
      count += 1;
      return { ...row, milliseconds: null };
    });
    if (!count) return;
    const next = { main: serializeMstructtimeMain(context.analysis, rows, context.entries), entries: context.entries };
    // Record before restore triggers the controller's render/sync callbacks.
    history.record(context, { ...context, ...next });
    restore(next);
    sync();
    setStatus(tr("timelineCleared", { count }), true);
  }

  body.addEventListener("click", (event) => {
    if (isEditableShortcutTarget(event.target)) return;
    const row = event.target.closest("[data-timeline-row]");
    if (!row) return;
    sync();
    const number = Number(row.dataset.timelineRow);
    selection = selectTimelineRows(selection.selected, selection.anchor, number, event);
    wrap.focus({ preventScroll: true });
    paint();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      selectRow(number);
    }
  }, true);

  function ownsFocus(target) {
    return (wrap.contains(target) || target === undoButton || target === redoButton)
      && !isEditableShortcutTarget(target) && !document.querySelector("dialog[open]") && getContext().available;
  }

  document.addEventListener("keydown", (event) => {
    if (!ownsFocus(event.target) || event.altKey || event.repeat) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && (key === "z" || key === "y")) {
      event.preventDefault();
      event.stopPropagation();
      changeHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    } else if (!modifier && event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  });
  document.addEventListener("mstruct-edit-command", (event) => {
    if (!ownsFocus(document.activeElement)) return;
    event.preventDefault();
    changeHistory(event.detail);
  });
  undoButton.addEventListener("click", () => changeHistory("undo"));
  redoButton.addEventListener("click", () => changeHistory("redo"));
  return { capture: getContext, record, sync, paint };
}
