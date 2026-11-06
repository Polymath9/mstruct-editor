import { buildMstructtimeEventRows, buildMstructtimeRoute } from "./mstructtime-route.js";
import { parseBpmValue } from "./mstruct-tempo.js";
import { addExact, durationMilliseconds, exact, roundExactMilliseconds } from "./mstruct-timing.js";

function failure(code, field = "", details = {}) {
  return { ok: false, code, field, details };
}

function wholeNumber(value, minimum) {
  if (String(value ?? "").trim() === "") return false;
  return Number.isSafeInteger(Number(value)) && Number(value) >= minimum;
}

function bpmValue(value) {
  const input = String(value ?? "").trim();
  return /^\{BPM:([^{}]+)\}$/.exec(input)?.[1] ?? input;
}

export function validateMstructtimeBulkFields(options) {
  const errors = [];
  for (const field of ["startEvent", "endEvent", "startMilliseconds"]) {
    const minimum = field === "startMilliseconds" ? 0 : 1;
    if (!wholeNumber(options[field], minimum)) errors.push(failure("timelineBulkInteger", field, { minimum }));
  }
  if (!parseBpmValue(bpmValue(options.bpm))) errors.push(failure("timelineBulkBpmInvalid", "bpm"));
  return errors;
}

export function planMstructtimeBulkFill(analysis, timeline, options) {
  const [inputError] = validateMstructtimeBulkFields(options);
  if (inputError) return inputError;
  const bpm = bpmValue(options.bpm);
  const routeResult = buildMstructtimeRoute(analysis, timeline.loop);
  const generated = buildMstructtimeEventRows(analysis, timeline.loop, timeline.main);
  if (!routeResult.ok || !generated.ok) return failure("timelineDataInvalid");
  const { route } = routeResult;
  const firstRow = generated.rows.find((row) => row.number === Number(options.startEvent));
  if (!firstRow) return failure("timelineBulkStartMissing", "startEvent");
  const lastRow = generated.rows.find((row) => row.number === Number(options.endEvent));
  if (!lastRow) return failure("timelineBulkEndMissing", "endEvent");
  if (lastRow.number < firstRow.number) return failure("timelineBulkReverse", "endEvent");
  const startIndex = firstRow.routeIndex;
  const selected = generated.rows.filter((row) => row.number >= firstRow.number && row.number <= lastRow.number);
  const byRoute = new Map(selected.map((row) => [row.routeIndex, row]));
  const timestamps = new Map();
  let elapsed = exact(BigInt(Number(options.startMilliseconds)));
  for (let index = startIndex; index <= lastRow.routeIndex; index += 1) {
    const node = route[index];
    const row = byRoute.get(index);
    if (row) {
      const milliseconds = roundExactMilliseconds(elapsed);
      if (milliseconds === null) return failure("timelineBulkOverflow");
      timestamps.set(row.number, milliseconds);
    }
    if (index === lastRow.routeIndex) break;
    if (node.kind === "ellipsis") return failure("timelineBulkUnknownDuration");
    elapsed = addExact(elapsed, durationMilliseconds(node.slot.duration, bpm));
  }
  const rows = generated.rows.map((row) => timestamps.has(row.number)
    ? { ...row, milliseconds: timestamps.get(row.number) } : row);
  let previous = rows[0];
  for (const row of rows) {
    if (row.milliseconds === null) continue;
    if (row.milliseconds < previous.milliseconds) return failure("timelineBulkOrder", "", {
      previous: previous.number, previousMs: previous.milliseconds,
      next: row.number, nextMs: row.milliseconds,
    });
    previous = row;
  }
  const lastMilliseconds = timestamps.get(lastRow.number);
  if (lastMilliseconds > options.maximumMilliseconds) return failure("timelineBulkTooLong");
  return {
    ok: true,
    rows,
    first: firstRow.number,
    last: lastRow.number,
    count: selected.length,
    existing: selected.filter((row) => row.milliseconds !== null).length,
  };
}
