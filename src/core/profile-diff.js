import { parseProfileConfig, profileCompatibilityDefinitions } from "./profile-config.js";
import { canonicalJson, verifyMstructProfile } from "./profile.js";
import { deepFreeze, PROFILE_FILES } from "./profile-schema.js";

const LEVELS = ["none", "patch", "minor", "major"];
function maximum(...levels) { return LEVELS[Math.max(...levels.map((level) => LEVELS.indexOf(level)))]; }

export function isRomanAdmissionExpansion(name, before, after) {
  const field = name === "roman-basic.csv" ? "allowedAdvanced"
    : name === "roman-advanced.csv" ? "allowedFiguredBass" : name === "global_settings.csv" ? "values" : null;
  if (!field || !Array.isArray(before[field]) || !Array.isArray(after[field])) return false;
  const { [field]: previousValues, ...previousDefinition } = before;
  const { [field]: nextValues, ...nextDefinition } = after;
  return previousValues.every(value => nextValues.includes(value))
    && canonicalJson(previousDefinition) === canonicalJson(nextDefinition);
}

function tableDiff(name, before, after, contentChanged) {
  const removed = Object.keys(before).filter((key) => !Object.hasOwn(after, key));
  const added = Object.keys(after).filter((key) => !Object.hasOwn(before, key));
  const changed = Object.keys(before).filter((key) => Object.hasOwn(after, key)
    && canonicalJson(before[key]) !== canonicalJson(after[key]));
  const redefined = changed.filter(key => !isRomanAdmissionExpansion(name, before[key], after[key]));
  const level = removed.length || redefined.length ? "major" : added.length || changed.length ? "minor" : contentChanged ? "patch" : "none";
  return { level, added, removed, changed, displayOnly: contentChanged && level === "patch" };
}

export function nextProfileVersion(version, level) {
  // Patch/minor classify internal changes; the visible version names a
  // compatibility series. Only an incompatible change starts a new series.
  if (level !== "major") return version;
  return `${Number(version.split(".")[0]) + 1}.0.0`;
}

/** Layer-specific decisions let an authoring major retain a semantic search family. */
export async function compareMstructProfiles(beforeInput, afterInput) {
  const [before, after] = await Promise.all([verifyMstructProfile(beforeInput), verifyMstructProfile(afterInput)]);
  const previous = profileCompatibilityDefinitions(parseProfileConfig(before.files));
  const next = profileCompatibilityDefinitions(parseProfileConfig(after.files));
  // Historical bundles used the compiler's four-note limit before this setting
  // became an explicit CSV row. Compatibility compares that effective value.
  for (const definitions of [previous, next]) definitions.semantic["global_settings.csv"] ??= { polychord_lower_max_notes: { values: [3, 4] } };
  const tables = PROFILE_FILES.map(({ name, layer }) => ({ name, layer,
    ...tableDiff(name, previous[layer][name] ?? {}, next[layer][name] ?? {}, before.files[name] !== after.files[name]),
  }));
  const semanticLevel = maximum(...tables.filter((table) => table.layer === "semantic").map((table) => table.level));
  const authoringLevel = maximum(...tables.filter((table) => table.layer === "authoring").map((table) => table.level));
  const level = maximum(semanticLevel, authoringLevel);
  return deepFreeze({ level, semanticLevel, authoringLevel, tables,
    semanticCompatible: semanticLevel !== "major", authoringCompatible: authoringLevel !== "major",
    suggestedVersion: nextProfileVersion(before.manifest.version, level),
    before: { profileId: before.manifest.profileId, bundleHash: before.manifest.bundleHash },
    after: { profileId: after.manifest.profileId, bundleHash: after.manifest.bundleHash },
  });
}
