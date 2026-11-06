import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, stat } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import encoding from "../desktop/video-encoding.cjs";

assert.equal(process.platform, "darwin", "Run package verification on macOS.");
const root = fileURLToPath(new URL("../", import.meta.url));
const release = path.join(root, "release");
const { version, build: { productName } } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const name = `MStruct-Analysis-Editor-${version}-mac-${process.arch}`;
const scratch = await mkdtemp(path.join(release, "mac-verification-"));
const run = promisify(execFile);
// Launch the app extracted from the distribution ZIP.
await run("ditto", ["-x", "-k", path.join(release, `${name}.zip`), scratch], { timeout: 60000 });
const bundle = path.join(scratch, `${productName}.app`);
await run("codesign", ["--verify", "--deep", "--strict", bundle], { timeout: 60000 });
const executableName = (await run("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(bundle, "Contents/Info.plist")])).stdout.trim();
const executable = path.join(bundle, "Contents/MacOS", executableName);
const machoArch = process.arch === "x64" ? "x86_64" : "arm64";
assert.equal((await run("lipo", ["-archs", executable])).stdout.trim(), machoArch);
const distributed = await import(pathToFileURL(path.join(bundle, "Contents/Resources/renderer/profile.js")).href);
const expectedProfile = JSON.parse(await readFile(path.join(root, "src/config/official-profile.json"), "utf8"));
const packagedProfile = await distributed.getEmbeddedMstructProfile();
assert.deepEqual(packagedProfile, expectedProfile, "Packaged rule tables differ from the released source snapshot.");
assert.ok(packagedProfile.files["global_settings.csv"], "Packaged global settings are missing.");
console.log(`Packaged rules verified: ${packagedProfile.manifest.files.length} tables, ${packagedProfile.manifest.bundleHash}.`);
await run(executable, ["--smoke-test"], { timeout: 60000, env: { ...process.env,
  MSTRUCT_SMOKE_USER_DATA: path.join(scratch, "user-data"), MSTRUCT_SMOKE_LOG: path.join(scratch, "smoke.log") } });
const ffmpeg = path.join(bundle, "Contents/Resources/desktop-assets/video-encoder/bin/ffmpeg");
assert.equal((await run("lipo", ["-archs", ffmpeg])).stdout.trim(), machoArch);
const pcm = path.join(scratch, "piano.f32");
await writeFile(pcm, Buffer.alloc(encoding.SAMPLE_RATE * 2 * 4));
for (const fps of [30, 60]) {
  const output = path.join(scratch, `smoke-${fps}.mp4`);
  const args = encoding.videoEncodingArguments({ frameCount: 2, fps, pianoPath: pcm, output });
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
    let errorText = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(Error("Packaged video encoder timed out.")); }, 30000);
    child.stderr.on("data", chunk => { errorText += chunk; });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(errorText || `FFmpeg exited ${code}`)); });
    child.stdin.on("error", () => {}); // Process exit reports the encoder's actual error.
    child.stdin.end(Buffer.alloc(encoding.WIDTH * encoding.HEIGHT * 4 * 2));
  });
  assert.ok((await stat(output)).size > 1000);
  // Require both video and audio streams to decode, including a software fallback on runners.
  await run(ffmpeg, ["-v", "error", "-i", output, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { timeout: 30000 });
}
const file = `${name}.zip`;
const hash = createHash("sha256").update(await readFile(path.join(release, file))).digest("hex");
await writeFile(path.join(release, `${name}.sha256`), `${hash}  ${file}\n`);
console.log(`Verified ${name}: redistributed app startup, signatures, native architecture, 30/60 fps H.264 + AAC.`);
