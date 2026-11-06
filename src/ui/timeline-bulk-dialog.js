import { planMstructtimeBulkFill, validateMstructtimeBulkFields } from "../core/mstructtime-bulk-fill.js";

const fields = [
  ["startEvent", "timelineBulkStartEvent", 1],
  ["startMilliseconds", "timelineBulkStartMilliseconds", 0],
  ["endEvent", "timelineBulkEndEvent", 1],
  ["bpm", "timelineBulkBpm"],
];

function sameContext(left, right) {
  return left.analysisKey === right.analysisKey && left.document === right.document
    && left.loop === right.loop && left.main === right.main
    && left.maximumMilliseconds === right.maximumMilliseconds && left.available === right.available;
}

export function createTimelineBulkDialog({ tr, getContext, commit }) {
  const template = document.createElement("template");
  template.innerHTML = `<dialog class="settings-dialog timeline-bulk-dialog" id="timelineBulkDialog" aria-labelledby="timelineBulkTitle">
    <form class="settings-form" novalidate>
      <header class="settings-dialog-header"><h2 id="timelineBulkTitle" data-i18n="timelineBulkImport"></h2></header>
      <div class="timeline-bulk-fields">${fields.map(([name, label, minimum]) => `
        <label class="metadata-field timeline-bulk-${name}"><span class="metadata-field-label" data-i18n="${label}"></span>
          <input name="${name}" ${name === "bpm" ? 'type="text" placeholder="{BPM:1/4=120}"' : `type="number" min="${minimum}" step="1"`} required data-managed-validation aria-describedby="timelineBulkError-${name}">
          <span class="timeline-bulk-error" id="timelineBulkError-${name}" aria-live="polite"></span>
        </label>`).join("")}
        ${["start", "end"].map((endpoint) => `<div class="timeline-bulk-location timeline-bulk-${endpoint}Location" data-location="${endpoint}" aria-live="polite">
          ${["Measure", "Beat", "Pass"].map((part) => `<div><span class="metadata-field-label" data-i18n="timeline${part}"></span><output data-coordinate="${part.toLowerCase()}">—</output></div>`).join("")}
        </div>`).join("")}
      </div>
      <div class="timeline-bulk-summary" aria-live="polite"><p data-preview></p><p data-existing></p><p class="timeline-bulk-error" data-error></p></div>
      <footer class="metadata-dialog-footer"><button type="button" class="dialog-secondary" data-cancel data-i18n="cancel"></button><button type="submit" class="render-button" data-submit data-i18n="timelineBulkFill" disabled></button></footer>
    </form>
  </dialog>
  <dialog class="settings-dialog timeline-confirm-dialog" id="timelineBulkConfirmDialog" aria-labelledby="timelineBulkConfirmTitle">
    <div class="settings-form">
      <header class="settings-dialog-header"><div><h2 id="timelineBulkConfirmTitle" data-i18n="timelineBulkOverwriteTitle"></h2><p data-description></p></div></header>
      <footer class="metadata-dialog-footer"><button type="button" class="dialog-secondary" data-cancel data-i18n="cancel"></button><button type="button" class="render-button" data-overwrite data-i18n="timelineOverwrite"></button></footer>
    </div>
  </dialog>`;
  document.body.append(template.content);
  const dialog = document.querySelector("#timelineBulkDialog");
  const confirmDialog = document.querySelector("#timelineBulkConfirmDialog");
  const form = dialog.querySelector("form");
  const inputs = Object.fromEntries(fields.map(([name]) => [name, form.elements.namedItem(name)]));
  const submit = dialog.querySelector("[data-submit]");
  const error = dialog.querySelector("[data-error]");
  let context;
  let plan;
  let pending;
  let startKey;

  function translate() {
    for (const root of [dialog, confirmDialog]) {
      root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = tr(element.dataset.i18n); });
    }
  }

  function refresh({ resetStart = false } = {}) {
    const nextContext = getContext();
    const changed = context && !sameContext(context, nextContext);
    context = nextContext;
    const key = inputs.startEvent.value;
    if (resetStart || changed || key !== startKey) {
      startKey = key;
      const row = context.rows.find((candidate) => candidate.kind !== "start" && candidate.number === Number(key));
      inputs.startMilliseconds.value = row?.milliseconds ?? "";
    }
    for (const endpoint of ["start", "end"]) {
      const row = context.rows.find((candidate) => candidate.kind !== "start" && candidate.number === Number(inputs[`${endpoint}Event`].value));
      dialog.querySelectorAll(`[data-location="${endpoint}"] [data-coordinate]`).forEach((output) => {
        output.textContent = row?.[output.dataset.coordinate] ?? "—";
      });
    }
    for (const [name] of fields) {
      inputs[name].removeAttribute("aria-invalid");
      dialog.querySelector(`#timelineBulkError-${name}`).textContent = "";
    }
    error.textContent = "";
    const options = Object.fromEntries(fields.map(([name]) => [name, inputs[name].value]));
    const fieldErrors = new Map(validateMstructtimeBulkFields(options).map((issue) => [issue.field, issue]));
    if (context.available) {
      for (const [name, code] of [["startEvent", "timelineBulkStartMissing"], ["endEvent", "timelineBulkEndMissing"]]) {
        if (!fieldErrors.has(name) && !context.rows.some((row) => row.number === Number(options[name]))) {
          fieldErrors.set(name, { code });
        }
      }
      if (!fieldErrors.has("startEvent") && !fieldErrors.has("endEvent") && Number(options.endEvent) < Number(options.startEvent)) {
        fieldErrors.set("endEvent", { code: "timelineBulkReverse" });
      }
    }
    plan = context.available
      ? planMstructtimeBulkFill(context.analysis, context, { ...options, maximumMilliseconds: context.maximumMilliseconds })
      : { ok: false, code: "timelineChooseFile" };
    submit.disabled = !plan.ok;
    dialog.querySelector("[data-preview]").textContent = plan.ok ? tr("timelineBulkPreview", plan) : "";
    dialog.querySelector("[data-existing]").textContent = plan.ok && plan.existing ? tr("timelineBulkExisting", plan) : "";
    if (!plan.ok && plan.field) fieldErrors.set(plan.field, plan);
    for (const [name, issue] of fieldErrors) {
      if (!inputs[name].value.trim() && !inputs[name].validity.badInput) continue;
      inputs[name].setAttribute("aria-invalid", "true");
      dialog.querySelector(`#timelineBulkError-${name}`).textContent = tr(issue.code, issue.details);
    }
    if (!plan.ok && !plan.field && fields.every(([name]) => inputs[name].value.trim())) error.textContent = tr(plan.code, plan.details);
    return changed;
  }

  function apply() {
    if (!pending || !sameContext(pending.context, getContext())) {
      pending = null;
      confirmDialog.close();
      refresh();
      error.textContent = tr("timelineBulkChanged");
      return;
    }
    const accepted = commit(pending.plan, pending.context);
    pending = null;
    confirmDialog.close();
    if (accepted) dialog.close();
    else {
      refresh();
      error.textContent = tr("timelineBulkChanged");
    }
  }

  form.addEventListener("input", () => refresh());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (refresh()) {
      error.textContent = tr("timelineBulkChanged");
      return;
    }
    if (!plan.ok) return;
    pending = { plan, context };
    if (plan.existing) {
      confirmDialog.querySelector("[data-description]").textContent = tr("timelineBulkOverwriteDescription", plan);
      confirmDialog.showModal();
      confirmDialog.querySelector("[data-cancel]").focus();
    } else apply();
  });
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { pending = null; confirmDialog.close(); });
  confirmDialog.querySelector("[data-cancel]").addEventListener("click", () => { pending = null; confirmDialog.close(); });
  confirmDialog.addEventListener("cancel", () => { pending = null; });
  confirmDialog.querySelector("[data-overwrite]").addEventListener("click", apply);

  return {
    open() {
      form.reset();
      context = null;
      pending = null;
      translate();
      refresh({ resetStart: true });
      dialog.showModal();
      inputs.startEvent.focus();
    },
    refreshLocale() {
      translate();
      if (dialog.open) refresh();
      if (confirmDialog.open && pending) confirmDialog.querySelector("[data-description]").textContent = tr("timelineBulkOverwriteDescription", pending.plan);
    },
  };
}
