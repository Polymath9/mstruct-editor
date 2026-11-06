export const PROFILE_MANIFEST_VERSION = 3;
export const MSTRUCT_FORMAT_VERSION = 1;
export const OFFICIAL_PROFILE_NAMESPACE = "org.mstruct.official";
export const INITIAL_PROFILE_ID = `${OFFICIAL_PROFILE_NAMESPACE}/rulesets/1.0.0`;

/** Historical manifests retain their exact file order and hash framing. */
export const PROFILE_FILES_V1 = Object.freeze([
  "special-chords.csv", "roman-basic.csv", "roman-advanced.csv",
  "roman-figured-bass.csv", "roman-special.csv", "tags.csv",
  "cadence-tags.csv", "tonal-tags.csv", "sequence-tags.csv",
  "toolbox-menus.csv", "toolbox-events.csv",
].map((name, index) => Object.freeze({ name, layer: index < 9 ? "semantic" : "authoring" })));

export const PROFILE_FILES_V2 = Object.freeze([
  ...PROFILE_FILES_V1.slice(0, 9), Object.freeze({ name: "form-tags.csv", layer: "semantic" }), ...PROFILE_FILES_V1.slice(9),
]);

export const PROFILE_FILES = Object.freeze([
  ...PROFILE_FILES_V2.slice(0, 10), Object.freeze({ name: "global_settings.csv", layer: "semantic" }), ...PROFILE_FILES_V2.slice(10),
]);

export function profileFilesForManifest(version) {
  if (version === 1) return PROFILE_FILES_V1;
  if (version === 2) return PROFILE_FILES_V2;
  if (version === PROFILE_MANIFEST_VERSION) return PROFILE_FILES;
  throw new MstructProfileError("profile-manifest-unsupported");
}

export const PROFILE_METADATA_FIELDS = Object.freeze({
  MSTRUCT_FORMAT_VERSION: "mstructFormatVersion",
  MSTRUCT_PROFILE_ID: "mstructProfileId",
  MSTRUCT_PROFILE_HASH: "mstructProfileHash",
  AUTHORING_APP_VERSION: "authoringAppVersion",
});

export class MstructProfileError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "MstructProfileError";
    this.code = code;
    this.details = details;
  }
}

export function parseProfileId(profileId) {
  const match = typeof profileId === "string"
    ? profileId.match(/^([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+)\/rulesets\/((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/) : null;
  if (!match || match[2].split(".").some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new MstructProfileError("profile-id-invalid", { profileId: String(profileId ?? "") });
  }
  return { namespace: match[1], version: match[2] };
}

export function isProfileHash(hash) {
  return typeof hash === "string" && /^sha256:[0-9a-f]{64}$/.test(hash);
}

/** Absence is pre-v1, never an implicit assignment to the recommended profile. */
export function readProfileIdentity(metadata) {
  const version = String(metadata?.mstructFormatVersion ?? "");
  const profileId = String(metadata?.mstructProfileId ?? "");
  const bundleHash = String(metadata?.mstructProfileHash ?? "");
  if (!version && !profileId && !bundleHash) return null;
  if (!version || !profileId || !bundleHash) throw new MstructProfileError("profile-fields-incomplete");
  if (version !== String(MSTRUCT_FORMAT_VERSION)) {
    throw new MstructProfileError("format-version-unsupported", { version });
  }
  parseProfileId(profileId);
  if (!isProfileHash(bundleHash)) throw new MstructProfileError("profile-hash-invalid");
  return { formatVersion: Number(version), profileId, bundleHash };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
