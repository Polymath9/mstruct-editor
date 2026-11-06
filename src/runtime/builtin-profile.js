import specialChords from "../config/special-chords.csv?raw";
import romanBasic from "../config/roman-basic.csv?raw";
import romanAdvanced from "../config/roman-advanced.csv?raw";
import romanFiguredBass from "../config/roman-figured-bass.csv?raw";
import romanSpecial from "../config/roman-special.csv?raw";
import tags from "../config/tags.csv?raw";
import formTags from "../config/form-tags.csv?raw";
import globalSettings from "../config/global_settings.csv?raw";
import cadenceTags from "../config/cadence-tags.csv?raw";
import tonalTags from "../config/tonal-tags.csv?raw";
import sequenceTags from "../config/sequence-tags.csv?raw";
import toolboxMenus from "../config/toolbox-menus.csv?raw";
import toolboxEvents from "../config/toolbox-events.csv?raw";
import { createMstructProfile } from "../core/profile.js";
import { INITIAL_PROFILE_ID } from "../core/profile-schema.js";

export const BUILTIN_PROFILE_FILES = Object.freeze({
  "global_settings.csv": globalSettings,
  "special-chords.csv": specialChords, "roman-basic.csv": romanBasic,
  "roman-advanced.csv": romanAdvanced, "roman-figured-bass.csv": romanFiguredBass,
  "roman-special.csv": romanSpecial, "tags.csv": tags, "cadence-tags.csv": cadenceTags,
  "tonal-tags.csv": tonalTags, "sequence-tags.csv": sequenceTags, "form-tags.csv": formTags,
  "toolbox-menus.csv": toolboxMenus, "toolbox-events.csv": toolboxEvents,
});

let builtinProfile;
/** Source candidate; publishing and locking remain explicit registry operations. */
export function getBuiltinMstructProfile() {
  builtinProfile ??= createMstructProfile({ profileId: INITIAL_PROFILE_ID, files: BUILTIN_PROFILE_FILES });
  return builtinProfile;
}

export async function resolveBuiltinMstructProfile(identity) {
  const profile = await getBuiltinMstructProfile();
  return profile.manifest.profileId === identity.profileId && profile.manifest.bundleHash === identity.bundleHash ? profile : null;
}
