import { canonicalJson, isVerifiedMstructProfile } from "./profile.js";
import { parseProfileConfig, profileCompatibilityDefinitions } from "./profile-config.js";
import { isRomanAdmissionExpansion } from "./profile-diff.js";
import { MstructProfileError } from "./profile-schema.js";
import { parseMstructSearchQuery } from "./mstruct-search-query.js";

function unionValue(left, right) {
  if (right instanceof Map) {
    const result = new Map(left ?? []);
    for (const [key, value] of right) result.set(key, unionValue(result.get(key), value));
    return result;
  }
  if (Array.isArray(right)) {
    const key = (value) => typeof value === "object" && value !== null
      ? value.token ?? value.roman ?? value.sequenceType ?? value.prefix ?? JSON.stringify(value) : value;
    return [...new Map([...(left ?? []), ...right].map((value) => [key(value), unionValue(undefined, value)])).values()];
  }
  if (right && typeof right === "object") return Object.fromEntries(Object.entries(right).map(([key, value]) => [key, unionValue(left?.[key], value)]));
  return left ?? right;
}

/** Only query dictionaries are merged. A union is never a document compiler profile. */
export function createProfileSearchVocabulary(builds) {
  const families = new Map();
  const definitionsByFamily = new Map();
  for (const { profile, semanticFamily } of builds) {
    if (!isVerifiedMstructProfile(profile) || !semanticFamily) throw new MstructProfileError("profile-unverified");
    const config = parseProfileConfig(profile.files);
    const { specialChords, romanConfig, tagConfig, semanticTagConfig, formTagConfig } = config;
    const definitions = definitionsByFamily.get(semanticFamily) ?? new Map();
    for (const [table, entries] of Object.entries(profileCompatibilityDefinitions(config).semantic)) {
      for (const [token, entry] of Object.entries(entries)) {
        const key = JSON.stringify([table, token]), previous = definitions.get(key);
        if (previous && canonicalJson(previous) !== canonicalJson(entry)
          && !isRomanAdmissionExpansion(table, previous, entry) && !isRomanAdmissionExpansion(table, entry, previous)) {
          throw new MstructProfileError("profile-config-invalid", { reason: "Conflicting semantic definitions in profile family" });
        }
        definitions.set(key, unionValue(previous, entry));
      }
    }
    definitionsByFamily.set(semanticFamily, definitions);
    const previous = families.get(semanticFamily) ?? { semanticFamily, identities: [], config: {} };
    previous.identities.push([profile.manifest.profileId, profile.manifest.bundleHash]);
    const maximumLowerNotes = Math.max(previous.config.globalSettings?.polychordLowerMaxNotes ?? 0, config.globalSettings?.polychordLowerMaxNotes ?? 4);
    previous.config = unionValue(previous.config, { globalSettings: { polychordLowerMaxNotes: maximumLowerNotes }, specialChords, romanConfig, tagConfig, semanticTagConfig, ...(formTagConfig ? { formTagConfig } : {}) });
    families.set(semanticFamily, previous);
  }
  return [...families.values()];
}

/** JSON transport is data only; Maps are explicitly tagged and reconstructed. */
export function serializeSearchVocabulary(value) {
  if (value instanceof Map) return { mstructMap: [...value].map(([key, entry]) => [key, serializeSearchVocabulary(entry)]) };
  if (Array.isArray(value)) return value.map(serializeSearchVocabulary);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeSearchVocabulary(entry)]));
  return value;
}

export function deserializeSearchVocabulary(value) {
  if (Array.isArray(value)) return value.map(deserializeSearchVocabulary);
  if (value && typeof value === "object") {
    if (Array.isArray(value.mstructMap)) return new Map(value.mstructMap.map(([key, entry]) => [key, deserializeSearchVocabulary(entry)]));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deserializeSearchVocabulary(entry)]));
  }
  return value;
}

/**
 * Each incompatible family compiles independently.
 * @param {Array<{ semanticFamily: string, config: object }>} families
 */
export function parseProfileSearchQuery(source, families) {
  const results = families.map(({ semanticFamily, config }) => ({ semanticFamily, query: parseMstructSearchQuery(source, config) }));
  const queries = results.filter(({ query }) => query.ok);
  const error = queries.length ? null : results[0]?.query.errors[0] ?? null;
  return { ok: queries.length > 0, queries, errors: error ? [error] : [] };
}
