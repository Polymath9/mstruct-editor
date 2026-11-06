import { deserializeSearchVocabulary } from "../core/profile-search.js";
import { parseMstruct } from "../core/mstruct.js";
import { parseGlobalTagList } from "../core/semantic-tags.js";

export function createEditorConfig({
  specialChordCsv,
  romanConfigCsv,
  tagCsv,
  semanticTagConfigCsv,
  parseSpecialChordCsv,
  parseRomanConfigCsv,
  parseTagConfigCsv,
  parseSemanticTagConfigCsv,
}) {
  let specialChords = parseSpecialChordCsv(specialChordCsv);
  let currentRomanCsv = { ...romanConfigCsv };
  let romanConfig = parseRomanConfigCsv(currentRomanCsv);
  let tagConfig = parseTagConfigCsv(tagCsv);
  let formTagConfig = null;
  let globalSettings;
  let currentSemanticCsv = { ...semanticTagConfigCsv };
  let semanticTagConfig = parseSemanticTagConfigCsv(currentSemanticCsv, { romanConfig });
  let searchVocabulary = null;

  return {
    compileMain(source, metadata, comments) {
      const config = { specialChords, romanConfig, tagConfig, semanticTagConfig, formTagConfig, globalSettings };
      const global = parseGlobalTagList(metadata.globalTags, config);
      const result = parseMstruct(source, { ...config, isStableTempo: metadata.isStableTempo, comments, globalTags: global.tags });
      return { ...result, ok: result.ok && global.ok,
        errors: [...global.errors.map((error) => ({ ...error, metadataDomain: true })), ...result.errors], globalTags: global.tags };
    },
    applyProfile(config) {
      searchVocabulary = null;
      globalSettings = config.globalSettings;
      specialChords = config.specialChords;
      romanConfig = config.romanConfig;
      tagConfig = config.tagConfig;
      formTagConfig = config.formTagConfig ?? null;
      semanticTagConfig = config.semanticTagConfig;
    },
    applySearchVocabulary(serialized, identity) {
      const families = deserializeSearchVocabulary(serialized);
      const family = families?.find((item) => item.identities.some(([id, hash]) => id === identity?.mstructProfileId && hash === identity?.mstructProfileHash));
      searchVocabulary = family?.config ?? null;
    },
    get searchOptions() { return searchVocabulary ?? { specialChords, romanConfig, tagConfig, semanticTagConfig, formTagConfig, globalSettings }; },
    get specialChords() { return specialChords; },
    get globalSettings() { return globalSettings; },
    get romanConfig() { return romanConfig; },
    get tagConfig() { return tagConfig; },
    get formTagConfig() { return formTagConfig; },
    get semanticTagConfig() { return semanticTagConfig; },
    setSpecialChordCsv(value) {
      if (typeof value !== "string") return false;
      try {
        specialChords = parseSpecialChordCsv(value);
        return true;
      } catch {
        return false;
      }
    },
    setRomanConfigCsv(value) {
      if (!value || typeof value !== "object") return false;
      try {
        const nextCsv = {
          basicCsv: String(value.basicCsv ?? ""),
          advancedCsv: String(value.advancedCsv ?? ""),
          figuredBassCsv: String(value.figuredBassCsv ?? ""),
          specialCsv: String(value.specialCsv ?? ""),
        };
        const nextRomanConfig = parseRomanConfigCsv(nextCsv);
        const nextSemanticConfig = parseSemanticTagConfigCsv(currentSemanticCsv, { romanConfig: nextRomanConfig });
        currentRomanCsv = nextCsv;
        romanConfig = nextRomanConfig;
        semanticTagConfig = nextSemanticConfig;
        return true;
      } catch {
        return false;
      }
    },
    setTagConfigCsv(value) {
      if (typeof value !== "string") return false;
      try {
        tagConfig = parseTagConfigCsv(value);
        return true;
      } catch {
        return false;
      }
    },
    setSemanticTagConfigCsv(value) {
      if (!value || typeof value !== "object") return false;
      try {
        const nextCsv = {
          cadenceCsv: String(value.cadenceCsv ?? ""),
          tonalCsv: String(value.tonalCsv ?? ""),
          sequenceCsv: String(value.sequenceCsv ?? ""),
        };
        const nextConfig = parseSemanticTagConfigCsv(nextCsv, { romanConfig });
        currentSemanticCsv = nextCsv;
        semanticTagConfig = nextConfig;
        return true;
      } catch {
        return false;
      }
    },
  };
}
