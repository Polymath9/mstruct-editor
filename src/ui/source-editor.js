function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function highlightSourceSyntax(value) {
  const tokenPattern = /\{[^\r\n{}]*\}|\[[^\r\n[\]]*\]/g;
  let cursor = 0;
  let html = "";
  for (const match of String(value).matchAll(tokenPattern)) {
    html += escapeHtml(value.slice(cursor, match.index));
    const className = match[0].startsWith("{") ? "syntax-setting" : "syntax-event";
    html += `<span class="${className}">${escapeHtml(match[0])}</span>`;
    cursor = match.index + match[0].length;
  }
  html += escapeHtml(value.slice(cursor));
  return html;
}

export function createSourceEditor({ sourceInput, highlightLayer, lineWrapMeasure, lineGutter, getEditorSettings,
  formatDiagnostic = (diagnostic) => diagnostic.message ?? diagnostic.code }) {
  let tooltip = null;
  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }
  if (sourceInput && highlightLayer) {
    sourceInput.addEventListener("pointermove", (event) => {
      if (event.buttons) { hideTooltip(); return; }
      const mark = [...highlightLayer.querySelectorAll(".syntax-warning")].find((element) =>
        [...element.getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom));
      if (!mark) { hideTooltip(); return; }
      if (!tooltip) {
        tooltip = sourceInput.ownerDocument.createElement("div");
        tooltip.className = "source-warning-tooltip";
        tooltip.setAttribute("role", "tooltip");
        sourceInput.ownerDocument.body.append(tooltip);
      }
      tooltip.textContent = mark.dataset.warningMessage;
      tooltip.hidden = false;
      const view = sourceInput.ownerDocument.defaultView;
      tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 12, view.innerWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 18, view.innerHeight - tooltip.offsetHeight - 8))}px`;
    });
    for (const type of ["pointerleave", "scroll", "input", "blur", "keydown"]) sourceInput.addEventListener(type, hideTooltip);
  }
  function highlightSource(source, errors = [], warnings = []) {
    hideTooltip();
    const errorRanges = [...errors]
      .map((error) => ({ start: error.start, end: Math.max(error.end, error.start + 1) }))
      .sort((left, right) => left.start - right.start || right.end - left.end)
      .reduce((all, current) => {
        const previous = all.at(-1);
        if (previous && current.start <= previous.end) previous.end = Math.max(previous.end, current.end);
        else all.push(current);
        return all;
      }, []);
    const settings = getEditorSettings?.() ?? {};
    const warningRanges = warnings
      .filter(warning => warning.romanValidation ? settings.validateRomanBass !== false : settings.showRomanWarnings !== false)
      .filter((warning) => !errorRanges.some((error) => warning.start < error.end && warning.end > error.start))
      .map((warning) => ({ start: warning.start, end: warning.end, hint: formatDiagnostic(warning) }))
      .sort((left, right) => left.start - right.start || right.end - left.end)
      .reduce((all, range) => {
        const previous = all.at(-1);
        if (previous && range.start < previous.end) {
          previous.end = Math.max(previous.end, range.end);
          previous.hint += `\n${range.hint}`;
        } else all.push(range);
        return all;
      }, []);
    const ranges = [...errorRanges, ...warningRanges].sort((left, right) => left.start - right.start);

    let cursor = 0;
    let html = "";
    for (const range of ranges) {
      html += highlightSourceSyntax(source.slice(cursor, range.start));
      const attributes = range.hint
        ? `class="syntax-warning" data-warning-message="${escapeHtml(range.hint)}"`
        : 'class="syntax-error"';
      html += `<mark ${attributes}>${escapeHtml(source.slice(range.start, range.end)) || " "}</mark>`;
      cursor = range.end;
    }
    html += highlightSourceSyntax(source.slice(cursor));
    return html || " ";
  }

  function measureLabelsByLine(source, result, lineCount) {
    const labels = Array(lineCount).fill("");
    for (const measure of result.measures) {
      const events = measure.slots.flatMap((slot) => slot.events);
      const firstEvent = events[0];
      for (const event of events) {
        const line = source.slice(0, event.start).split("\n").length - 1;
        if (line < 0 || line >= labels.length || labels[line] !== "") continue;
        if (event === firstEvent && measure.barNumber !== null) labels[line] = String(measure.displayBarNumber ?? measure.barNumber);
        else labels[line] = " ";
      }
    }
    return labels;
  }

  function wrappedLineCounts(lines) {
    if (!getEditorSettings().autoWrap || !lineWrapMeasure) return lines.map(() => 1);
    lineWrapMeasure.replaceChildren(...lines.map((line) => {
      const segment = document.createElement("span");
      segment.textContent = line || "\u200b";
      return segment;
    }));
    const lineHeight = Number.parseFloat(getComputedStyle(sourceInput).lineHeight) || 1;
    return [...lineWrapMeasure.children].map((segment) => Math.max(1, Math.round(segment.getBoundingClientRect().height / lineHeight)));
  }

  function updateLineGutter(lines, result) {
    const labels = getEditorSettings().lineNumberMode === "measure"
      ? measureLabelsByLine(sourceInput.value, result, lines.length)
      : lines.map((_, index) => String(index + 1));
    const visualLineCounts = wrappedLineCounts(lines);
    lineGutter.innerHTML = labels
      .map((label, index) => `<span style="height:${visualLineCounts[index] * 1.7}em">${label}</span>`)
      .join("");
    lineGutter.scrollTop = sourceInput.scrollTop;
    return labels;
  }

  return { highlightSource, updateLineGutter };
}
