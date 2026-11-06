import { parseTagCsvRows } from "./tag-config.js";

export const DEFAULT_GLOBAL_SETTINGS = Object.freeze({ polychordLowerMaxNotes: 4 });
export const GLOBAL_SETTING_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "polychord_lower_max_notes", property: "polychordLowerMaxNotes", values: [3, 4], defaultValue: 4 }),
]);

/** Rule-bundle settings are validated before any compiler consumes them. */
export function parseGlobalSettingsCsv(csv) {
  const [header, ...rows] = parseTagCsvRows(csv);
  if (header?.join(",") !== "key,value") throw new Error("Global settings CSV header must be key,value.");
  const settings = { ...DEFAULT_GLOBAL_SETTINGS };
  const seen = new Set();
  for (const row of rows) {
    const definition = GLOBAL_SETTING_DEFINITIONS.find(entry => entry.key === row[0]);
    if (row.length !== 2 || !definition || seen.has(row[0]) || !definition.values.some(value => String(value) === row[1])) {
      throw new Error(`Invalid global setting: ${row[0] ?? ""}`);
    }
    seen.add(row[0]);
    settings[definition.property] = Number(row[1]);
  }
  if (seen.size !== GLOBAL_SETTING_DEFINITIONS.length) throw new Error("Missing required global settings.");
  return settings;
}
