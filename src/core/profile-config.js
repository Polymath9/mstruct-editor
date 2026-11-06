import { parseSpecialChordCsv } from "./chord-symbol.js";
import { parseRomanConfigCsv } from "./roman-symbol.js";
import { parseTagConfigCsv } from "./tag-config.js";
import { parseFormTagConfigCsv } from "./form-tag-config.js";
import { parseSemanticTagConfigCsv, resolveSemanticTagToken } from "./semantic-tags.js";
import { parseToolboxConfigCsv } from "./toolbox-config.js";
import { MstructProfileError } from "./profile-schema.js";
import { validateProfileToolbox } from "./profile-toolbox.js";
import { parseGlobalSettingsCsv } from "./global-settings.js";

/** Each caller receives its own compiler Maps; none are stored in the bundle. */
export function parseProfileConfig(files) {
  try {
    const specialChords = parseSpecialChordCsv(files["special-chords.csv"]);
    const romanConfig = parseRomanConfigCsv({
      basicCsv: files["roman-basic.csv"], advancedCsv: files["roman-advanced.csv"],
      figuredBassCsv: files["roman-figured-bass.csv"], specialCsv: files["roman-special.csv"],
    });
    const tagConfig = parseTagConfigCsv(files["tags.csv"]);
    const formTagConfig = files["form-tags.csv"] === undefined ? null : parseFormTagConfigCsv(files["form-tags.csv"]);
    const semanticTagConfig = parseSemanticTagConfigCsv({
      cadenceCsv: files["cadence-tags.csv"], tonalCsv: files["tonal-tags.csv"],
      sequenceCsv: files["sequence-tags.csv"],
    }, { romanConfig });
    const toolboxConfig = parseToolboxConfigCsv({
      menuCsv: files["toolbox-menus.csv"], eventCsv: files["toolbox-events.csv"],
    });
    const globalSettings = files["global_settings.csv"] === undefined ? null : parseGlobalSettingsCsv(files["global_settings.csv"]);
    const config = { specialChords, romanConfig, tagConfig, semanticTagConfig, toolboxConfig, ...(globalSettings ? { globalSettings } : {}), ...(formTagConfig ? { formTagConfig } : {}) };
    for (const tag of [...tagConfig.tags, ...(formTagConfig?.tags ?? [])]) {
      const inner = tag.token.slice(1, -1);
      if ((formTagConfig?.byToken.has(tag.token) && tagConfig.byToken.has(tag.token))
        || (formTagConfig && /^FORM_END(?::|$)/.test(inner))
        || resolveSemanticTagToken(inner, config) || /^(?:Mode_|Scale_|Centricity(?::|$)|DTC(?::|$)|pedal(?::|$)|Seq(?:Inv)?(?::|$))/.test(inner)) {
        throw new MstructProfileError("profile-tag-conflict", { token: tag.token });
      }
    }
    validateProfileToolbox(config);
    return config;
  } catch (error) {
    if (error instanceof MstructProfileError) throw error;
    throw new MstructProfileError("profile-config-invalid", { reason: error.message });
  }
}

const DISPLAY_FIELDS = new Set([
  "id", "displayName", "zhName", "enName", "renderUpper", "renderLower",
  "baseText", "superscriptText", "figureUpper", "figureLower",
  "modeZhName", "modeEnName", "scaleZhName", "scaleEnName",
]);
const SET_FIELDS = new Set(["allowedAdvanced", "allowedFiguredBass", "allowedRomans", "derivedTypes", "values"]);

function semanticDefinition(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !DISPLAY_FIELDS.has(key))
    .map(([key, value]) => [key, SET_FIELDS.has(key) ? [...value].sort() : value]));
}

function definitions(entries, key, makeDefinition = semanticDefinition) {
  return Object.fromEntries([...entries].map((entry) => [String(entry[key]), makeDefinition(entry)])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

/** Display strings and row order are excluded, but available tonal variants are not. */
export function profileCompatibilityDefinitions(config) {
  const { romanConfig: roman, semanticTagConfig: semantic, toolboxConfig: toolbox } = config;
  const semanticTables = {
    ...(config.globalSettings ? { "global_settings.csv": { polychord_lower_max_notes: { values: Array.from({ length: config.globalSettings.polychordLowerMaxNotes - 2 }, (_, index) => index + 3) } } } : {}),
    "special-chords.csv": definitions(config.specialChords.values(), "compilerName"),
    "roman-basic.csv": definitions(roman.basics.values(), "roman"),
    "roman-advanced.csv": definitions(roman.advanced.values(), "token"),
    "roman-figured-bass.csv": definitions(roman.figuredBass.values(), "token"),
    "roman-special.csv": definitions(roman.specials.values(), "token"),
    "tags.csv": definitions(config.tagConfig.tags, "token"),
    "cadence-tags.csv": definitions(semantic.cadences.entries, "token"),
    "tonal-tags.csv": definitions(semantic.tonal.entries, "token", (entry) => ({
      token: entry.token, base: entry.base, mode: Boolean(entry.modeEnName), scale: Boolean(entry.scaleEnName),
    })),
    "sequence-tags.csv": definitions(semantic.sequences.entries, "sequenceType"),
    ...(config.formTagConfig ? { "form-tags.csv": definitions(config.formTagConfig.tags, "token") } : {}),
  };
  const menus = [];
  for (const primary of toolbox.primaryMenus) {
    menus.push({ key: JSON.stringify([primary.id, ""]), primaryId: primary.id, secondaryId: "" });
    for (const secondary of primary.secondaryMenus) {
      menus.push({ key: JSON.stringify([primary.id, secondary.id]), primaryId: primary.id, secondaryId: secondary.id });
    }
  }
  // The existing six-column event schema has no ID. A changed template or
  // parent is conservatively a removal plus addition, hence major, never minor.
  const events = toolbox.events.map((event) => ({
    key: JSON.stringify([event.primaryId, event.secondaryId, event.insertion]),
    primaryId: event.primaryId, secondaryId: event.secondaryId,
    insertion: event.insertion, cursorOffset: event.cursorOffset,
  }));
  if (new Set(events.map((event) => event.key)).size !== events.length) {
    throw new MstructProfileError("profile-toolbox-duplicate");
  }
  return { semantic: semanticTables, authoring: {
    "toolbox-menus.csv": definitions(menus, "key"),
    "toolbox-events.csv": definitions(events, "key"),
  } };
}
