import { parseProfileConfig, profileCompatibilityDefinitions } from "./profile-config.js";
import { deepFreeze, MstructProfileError, MSTRUCT_FORMAT_VERSION, parseProfileId,
  profileFilesForManifest, PROFILE_MANIFEST_VERSION } from "./profile-schema.js";

const verifiedProfiles = new WeakSet();
export function isVerifiedMstructProfile(profile) { return verifiedProfiles.has(profile); }

export function normalizeProfileCsv(value) {
  if (typeof value !== "string") throw new MstructProfileError("profile-file-invalid");
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
}

/** Sorted JSON objects and explicitly framed arrays avoid ambiguous delimiters. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeFiles(input, descriptors) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).length !== descriptors.length
    || descriptors.some(({ name }) => !Object.hasOwn(input, name))) {
    throw new MstructProfileError("profile-files-incomplete");
  }
  return Object.fromEntries(descriptors.map(({ name }) => [name, normalizeProfileCsv(input[name])]));
}

/**
 * @typedef {{ manifestVersion: number, formatVersion: number, namespace: string,
 * profileId: string, version: string, files: Array<{name: string, layer: string,
 * size: number, hash: string}>, bundleHash: string, semanticCompatibilityHash: string,
 * authoringCompatibilityHash: string }} ProfileManifest
 * @typedef {{ manifest: ProfileManifest, files: Record<string, string> }} MstructProfile
 */

/** Content manifest is immutable. Release notes, lifecycle and defaults live outside it. */
export async function createMstructProfile({ profileId, files: input, formatVersion = MSTRUCT_FORMAT_VERSION, manifestVersion = Object.hasOwn(input ?? {}, "global_settings.csv") ? PROFILE_MANIFEST_VERSION : 2 }) {
  const { namespace, version } = parseProfileId(profileId);
  if (formatVersion !== MSTRUCT_FORMAT_VERSION) {
    throw new MstructProfileError("format-version-unsupported", { version: String(formatVersion) });
  }
  const descriptors = profileFilesForManifest(manifestVersion);
  const files = normalizeFiles(input, descriptors);
  const definitions = profileCompatibilityDefinitions(parseProfileConfig(files));
  const encoder = new TextEncoder();
  const manifestFiles = await Promise.all(descriptors.map(async ({ name, layer }) => ({
    name, layer, size: encoder.encode(files[name]).byteLength, hash: await sha256(files[name]),
  })));
  // Profile ID intentionally does not salt the content identity: the same
  // tables can be published by another registry or under another line.
  const frame = { manifestVersion, formatVersion,
    files: manifestFiles.map((file) => ({ ...file, content: files[file.name] })) };
  const [bundleHash, semanticCompatibilityHash, authoringCompatibilityHash] = await Promise.all([
    sha256(canonicalJson(frame)),
    sha256(canonicalJson({ manifestVersion, formatVersion, definitions: definitions.semantic })),
    sha256(canonicalJson({ manifestVersion, formatVersion, definitions: definitions.authoring })),
  ]);
  const profile = deepFreeze({ manifest: { manifestVersion, formatVersion,
    namespace, profileId, version, files: manifestFiles, bundleHash,
    semanticCompatibilityHash, authoringCompatibilityHash }, files });
  verifiedProfiles.add(profile);
  return profile;
}

/** Never trust claimed file hashes, omitted toolbox tables or a registry's current pointer.
 * @param {any} input
 * @param {{profileId: string, bundleHash: string, formatVersion?: number} | null} identity
 */
export async function verifyMstructProfile(input, identity = null) {
  const manifest = input?.manifest;
  if (!manifest || ![1, 2, PROFILE_MANIFEST_VERSION].includes(manifest.manifestVersion)) {
    throw new MstructProfileError("profile-manifest-unsupported");
  }
  const profile = await createMstructProfile({
    profileId: manifest.profileId, files: input.files, formatVersion: manifest.formatVersion, manifestVersion: manifest.manifestVersion,
  });
  if (canonicalJson(manifest) !== canonicalJson(profile.manifest)) {
    throw new MstructProfileError("profile-hash-mismatch", { profileId: manifest.profileId, bundleHash: manifest.bundleHash });
  }
  if (identity && (identity.profileId !== manifest.profileId || identity.bundleHash !== manifest.bundleHash
    || identity.formatVersion !== manifest.formatVersion)) {
    throw new MstructProfileError("profile-identity-mismatch", identity);
  }
  return profile;
}
