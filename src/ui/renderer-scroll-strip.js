const STRIP_EDGE_SPACE = 22; // Two 10px insets and the 2px upper border.
const CONTENT_SELECTOR = '.harmony-stack, .measure-barline, .control-boundary, .time-signature, .tempo-bpm-stack, .form-symbol, .time-label, .bar-number, .duration-label, .duration-note-glyph, .duration-note-tuplet, .duration-note-dot, .duration-note-multiplier, .comment-stack, .tag-stack, .ellipsis-glyph, .repeat-count-label';
const SCROLL_CONTENT_SELECTOR = '.harmony-stack, .harmony-stack .event-value, .measure-barline, .control-boundary, .time-signature, .tempo-bpm-stack > *, .form-symbol, .time-label, .bar-number, .duration-label, .duration-note-glyph, .duration-note-tuplet, .duration-note-dot, .duration-note-multiplier, .comment-icon, .tag-label, .ellipsis-glyph, .repeat-count-label, .tonal-prefix, .modulation-prefix, .modulation-bracket';
const OVERLAY_SELECTOR = '.tag-range-segment, .tag-range-end-mark, .comment-range-segment, .comment-range-end-mark, .ending-bracket, .ending-bracket-label, .roman-voice-leading-segment, .roman-voice-leading-cut, .new-riemannian-arc, .new-riemannian-label';

/** Cache painted content in horizontal chart coordinates, relative to its harmony row. */
function measureScrollContent(chart, systems, includeOverlays = false) {
  const origin = chart.getBoundingClientRect();
  const win = chart.ownerDocument.defaultView;
  const items = [];
  function collect(elements, harmonyTop) {
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if ((!rect.width && !rect.height) || win.getComputedStyle(element).visibility === 'hidden') continue;
      const margin = element.classList.contains('new-riemannian-arc') ? 4 : 2;
      items.push({ left: rect.left - origin.left, right: rect.right - origin.left,
        top: rect.top - harmonyTop - margin, bottom: rect.bottom - harmonyTop + margin });
    }
  }
  for (const system of systems) {
    const harmonyTop = system.anchor.getBoundingClientRect().top;
    collect(system.element.querySelectorAll(SCROLL_CONTENT_SELECTOR), harmonyTop);
  }
  if (includeOverlays && systems.length) {
    collect(chart.querySelectorAll(OVERLAY_SELECTOR), systems[0].anchor.getBoundingClientRect().top);
  }
  return items;
}

/** Crop only the outer empty grid tracks, retaining complete musical content boxes. */
export function presentationContentBounds(system) {
  const win = system.ownerDocument.defaultView;
  const rectangles = [...system.querySelectorAll(CONTENT_SELECTOR)].flatMap(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && win.getComputedStyle(element).visibility !== 'hidden' ? [rect] : [];
  });
  if (!rectangles.length) return system.getBoundingClientRect();
  return { top: Math.min(...rectangles.map(rect => rect.top)) - 2, bottom: Math.max(...rectangles.map(rect => rect.bottom)) + 2 };
}

export function presentationStripGeometry({ viewportHeight, maximumLeading, maximumTrailing, current }) {
  const completeHeight = maximumLeading + maximumTrailing + STRIP_EDGE_SPACE;
  const limit = viewportHeight * .42;
  const baseline = Math.ceil(Math.min(completeHeight, limit) / 8) * 8;
  const commonLeading = completeHeight <= limit ? maximumLeading : Math.min(maximumLeading, (baseline - STRIP_EDGE_SPACE) / 2);
  const leading = Math.max(commonLeading, current?.leading ?? 0);
  const height = Math.ceil(Math.max(baseline, leading + (current?.trailing ?? 0) + STRIP_EDGE_SPACE) / 8) * 8;
  return { leading, height: Math.min(height, viewportHeight - 80) };
}

/** Only content intersecting the actual viewport contributes to scrolling height. */
export function presentationScrollGeometry({ items, offset, viewportWidth, viewportHeight }) {
  const visible = items.filter(item => item.right + offset > 0 && item.left + offset < viewportWidth);
  const leading = Math.ceil(Math.max(0, ...visible.map(item => -item.top)));
  const trailing = Math.ceil(Math.max(0, ...visible.map(item => item.bottom)));
  return { leading, height: Math.min(leading + trailing + STRIP_EDGE_SPACE, viewportHeight - 80) };
}

/** Keep video's lower music rows steady without holding departed upper annotations. */
export function presentationVideoGeometry(visible, lowerRows, viewportHeight) {
  return { leading: visible.leading,
    height: Math.min(viewportHeight - 80, Math.max(visible.height, visible.leading + lowerRows.height)) };
}

/** Merge nearby tall passages on the musical clock, including repeats and seeks. */
export function presentationHeightRanges(visits, baseline, viewportHeight) {
  const ranges = [];
  for (const visit of visits) {
    if (visit.height <= baseline.height && visit.leading <= baseline.leading) continue;
    const previous = ranges.at(-1);
    const range = previous && visit.startMs <= previous.end ? previous : { start: visit.startMs, end: visit.endMs, leading: baseline.leading, trailing: 0 };
    if (range !== previous) ranges.push(range);
    range.end = Math.max(range.end, visit.endMs + 3000);
    range.leading = Math.max(range.leading, visit.leading);
    range.trailing = Math.max(range.trailing, visit.trailing);
    range.height = Math.min(viewportHeight - 80, Math.max(baseline.height, Math.ceil((range.leading + range.trailing + STRIP_EDGE_SPACE) / 8) * 8));
  }
  return ranges;
}

export function resetPresentationBoundaries(chart) {
  for (const line of chart.querySelectorAll('.is-strip-duplicate-line, .is-strip-joined-line, .is-strip-continuation-start')) {
    line.classList.remove('is-strip-duplicate-line', 'is-strip-joined-line', 'is-strip-continuation-start');
    line.style.removeProperty('--strip-boundary-shift');
  }
}

/** Keep one ink boundary while retaining both sides' repeat dots and anchors. */
export function joinPresentationBoundaries(systems) {
  for (let index = 1; index < systems.length; index++) {
    const first = systems[index].firstElementChild;
    const last = systems[index - 1].lastElementChild;
    if (!first?.classList.contains('measure') || !last?.classList.contains('measure')) continue;
    const start = first.querySelector(':scope > .start-barline');
    if (!start) continue;
    if (first.classList.contains('is-measure-continuation')) {
      start.classList.add('is-strip-continuation-start');
      continue;
    }
    const end = last.querySelector(':scope > .end-barline');
    if (!end) continue;
    const shift = start.getBoundingClientRect().left - end.getBoundingClientRect().left;
    end.style.setProperty('--strip-boundary-shift', `${shift}px`);
    end.classList.add('is-strip-joined-line');
    const duplicate = end.classList.contains('is-double-bar') && !start.classList.contains('is-double-bar') ? start : end;
    duplicate.classList.add('is-strip-duplicate-line');
  }
}

/** Present existing score systems as one horizontal strip using the playback clock. */
export function createRendererScrollStrip({ panel, canvas, onGeometryChange, getPlaybackEntries }) {
  const focus = document.createElement("div");
  focus.className = "renderer-strip-focus";
  canvas.append(focus);
  let enabled = false, chart = null, slots = new Map(), systems = [], contentItems = [];
  let latest = null, refreshFrame = null;
  let maximumTrailing = 0, alignedLeading = null;
  let route = null, heightRanges = [], baseline = null;

  function measureRoute() {
    route = getPlaybackEntries();
    // Video keeps the lower music rows steady; upper annotations follow the viewport.
    const geometry = { viewportHeight: panel.clientHeight, maximumLeading: 0, maximumTrailing };
    baseline = presentationStripGeometry(geometry);
    const visits = route.flatMap(entry => {
      const system = slots.get(String(entry.slotId))?.system;
      return system ? [{ startMs: entry.startMs, endMs: entry.endMs, trailing: system.trailing,
        ...presentationStripGeometry({ ...geometry, current: { leading: 0, trailing: system.trailing } }) }] : [];
    });
    heightRanges = presentationHeightRanges(visits, baseline, panel.clientHeight);
  }

  function measure() {
    chart = canvas.querySelector(".chart");
    slots = new Map(); systems = []; contentItems = [];
    alignedLeading = null;
    if (!enabled || !chart) return;
    canvas.style.setProperty("--presentation-system-width", `${Math.max(360, canvas.clientWidth - 48)}px`);
    chart.style.transform = "none";
    const elements = [...chart.querySelectorAll(".score-system")];
    for (const element of elements) element.style.removeProperty("transform");
    resetPresentationBoundaries(chart);
    joinPresentationBoundaries(elements);
    const origin = chart.getBoundingClientRect();
    systems = elements.map(element => {
      const rect = element.getBoundingClientRect();
      const content = presentationContentBounds(element);
      const harmony = element.querySelector(".harmony-stack, .ellipsis-marker");
      const leading = harmony ? harmony.getBoundingClientRect().top - content.top : 0;
      const height = content.bottom - content.top;
      return { element, anchor: harmony ?? element, height, leading, trailing: height - leading, trimTop: content.top - rect.top };
    });
    maximumTrailing = Math.max(0, ...systems.map(system => system.trailing));
    contentItems = measureScrollContent(chart, systems);
    for (const system of systems) {
      for (const target of system.element.querySelectorAll(".harmony-stack, .ellipsis-marker[data-playback-slot], .time-signature")) {
        const slot = target.closest("[data-playback-slot]");
        if (!slot) continue;
        const rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const key = `${slot.dataset.playbackSlot}${target.classList.contains("time-signature") ? ":ts" : ""}`;
        slots.set(key, { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height, system });
      }
    }
    measureRoute();
    canvas.append(focus);
  }

  function update(state, entry, previousEntry) {
    latest = { state, entry, previousEntry };
    if (!enabled) return;
    if (chart !== canvas.querySelector(".chart")) measure();
    if (!chart) return;
    if (route !== getPlaybackEntries()) measureRoute();
    const current = slots.get(String(entry?.slotId)) ?? slots.get(`${canvas.querySelector(".time-signature")?.closest("[data-playback-slot]")?.dataset.playbackSlot}:ts`);
    const previous = slots.get(String(previousEntry?.slotId)) ?? current;
    const duration = Math.min(120, Math.max(1, (entry?.endMs ?? 120) - (entry?.startMs ?? 0)));
    const progress = entry ? Math.min(1, Math.max(0, (state.elapsedMs - entry.startMs) / duration)) : 1;
    const eased = 1 - (1 - progress) ** 3;
    const left = current ? previous.left + (current.left - previous.left) * eased : 0;
    const anchor = Math.min(180, canvas.clientWidth * .14);
    const passage = entry && heightRanges.find(range => range.start <= state.elapsedMs && state.elapsedMs < range.end);
    const geometry = presentationScrollGeometry({ items: contentItems, offset: anchor - 24 - left,
      viewportWidth: canvas.clientWidth, viewportHeight: panel.clientHeight });
    const { leading, height } = panel.dataset.presentationMode === "scroll" ? geometry
      : presentationVideoGeometry(geometry, passage || baseline, panel.clientHeight);
    panel.style.setProperty("--presentation-strip-height", `${height}px`);
    if (alignedLeading !== leading) {
      for (const system of systems) system.element.style.transform = `translateY(${leading - system.leading - system.trimTop}px)`;
      alignedLeading = leading;
      onGeometryChange?.();
    }
    focus.hidden = !entry || !current;
    if (!current) return;
    chart.style.transform = `translateX(${anchor - 24 - left}px)`;
    focus.style.left = `${anchor}px`;
    focus.style.top = `${12 + current.top + leading - current.system.leading - current.system.trimTop}px`;
    focus.style.width = `${previous.width + (current.width - previous.width) * eased}px`;
    focus.style.height = `${current.height}px`;
    canvas.scrollLeft = 0;
  }

  function refresh() {
    if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = null;
      measure();
      if (latest) update(latest.state, latest.entry, latest.previousEntry);
    });
  }

  return {
    update, refresh,
    refreshContent() {
      if (!enabled || !chart || chart !== canvas.querySelector('.chart') || alignedLeading === null) return;
      contentItems = measureScrollContent(chart, systems, true);
      if (latest) update(latest.state, latest.entry, latest.previousEntry);
    },
    setActive(value) {
      enabled = value;
      canvas.dataset.fixedScale = String(value);
      if (value) refresh();
      else {
        if (chart) chart.style.removeProperty("transform");
        if (chart) resetPresentationBoundaries(chart);
        for (const system of systems) system.element.style.removeProperty("transform");
        focus.hidden = true;
        canvas.style.removeProperty("--presentation-system-width");
        panel.style.removeProperty("--presentation-strip-height");
      }
    },
    destroy() {
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
      focus.remove();
    },
  };
}
