const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { INTERNAL, digest, safePath, readOptional } = require("./library-paths.cjs");
const { assertMatchingRuleFile } = require("./library-rules.cjs");

/** Validate filesystem writes and retain originals. Music validation belongs to the shared core. */
async function migrationWrites(root, payload) {
  if (payload?.root !== root) throw Error("library-stale");
  const { changes, profile } = payload;
  if (!Array.isArray(changes) || !changes.length || changes.length > 60000
    || !/^sha256:[a-f0-9]{64}$/.test(profile?.manifest?.bundleHash)
    || !profile.files || JSON.stringify(profile).length > 4 * 1024 * 1024) throw Error("library-rules");
  const backup = `${INTERNAL}/migrations/${randomUUID()}`;
  const writes = [], originals = [], seen = new Set();
  let bytes = 0;
  for (const change of changes) {
    if (typeof change.path !== "string" || !/\.mstruct$/i.test(change.path)
      || typeof change.text !== "string" || !/^[a-f0-9]{64}$/.test(change.expected)) throw Error("library-path");
    if (seen.has(change.path.toLowerCase())) throw Error("library-duplicate-target");
    seen.add(change.path.toLowerCase());
    const old = await fs.readFile(await safePath(root, change.path));
    const size = Buffer.byteLength(change.text);
    bytes += size + old.length;
    if (size > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024) throw Error("library-size");
    if (digest(old) !== change.expected) throw Error("library-stale");
    writes.push({ path: `${backup}/files/${change.path}`, data: old, expected: null });
    writes.push({ path: change.path, data: change.text, expected: change.expected });
    originals.push({ path: change.path, before: change.expected, after: digest(change.text) });
  }
  const directory = `.rules/${profile.manifest.bundleHash.slice(7)}`;
  for (const [name, text] of Object.entries({ ...profile.files, "manifest.json": JSON.stringify(profile.manifest) })) {
    if (!/^(?:[a-z][a-z0-9_-]*\.csv|manifest\.json)$/.test(name) || typeof text !== "string") throw Error("library-rules");
    const relative = `${directory}/${name}`;
    const old = await readOptional(await safePath(root, relative, { internal: true }));
    assertMatchingRuleFile(name, old, text);
    if (!old) writes.push({ path: relative, data: text, expected: null });
  }
  writes.push({ path: `${backup}/manifest.json`, data: JSON.stringify({ version: 1, createdAt: new Date().toISOString(), target: profile.manifest, files: originals }), expected: null });
  return { writes, backup };
}
module.exports = { migrationWrites };
