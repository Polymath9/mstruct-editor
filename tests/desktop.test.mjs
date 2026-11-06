import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareDesktopProfile } from "../scripts/prepare-desktop-profile.mjs";
import { PROFILE_FILES } from "../src/core/profile-schema.js";
import { verifyMstructProfile } from "../src/core/profile.js";
import { compileProfileDocument, resolveMstructDocument } from "../src/core/profile-document.js";
import { parseMstructDocument } from "../src/core/mstruct-document.js";
import { loadDesktopTimelineFiles } from "../src/runtime/timeline-io.js";
import { nextDesktopVersion, desktopBuildVersion } from "../desktop/version.mjs";
import applicationUi from "../desktop/application-ui.cjs";
import macBuilderConfig from "../desktop/electron-builder.mac.cjs";
const { createDesktopLocale, applicationMenuTemplate } = applicationUi;
const rasterCaptureSource = await readFile(new URL("../desktop/raster-capture.cjs", import.meta.url), "utf8");

const [packageJson, mainSource, preloadSource, audioSource, symbolSource, editorSource, desktopAdapterSource, desktopExportSource, batchSource, soundfont, license, notices] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8"),
  readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/core/chord-audio.js", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/symbol-ui.js", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/desktop.js", import.meta.url), "utf8"),
  readFile(new URL("../src/runtime/desktop-export.js", import.meta.url), "utf8"),
  readFile(new URL("../build-mstruct-editor-exe.bat", import.meta.url)),
  readFile(new URL("../desktop/assets/soundfonts/acoustic_grand_piano-ogg.js", import.meta.url)),
  readFile(new URL("../desktop/assets/licenses/CC-BY-SA-3.0.txt", import.meta.url)),
  readFile(new URL("../desktop/assets/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8"),
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("Mac distribution builds, verifies and uploads ZIP packages", async () => {
  const [workflow, verifier] = await Promise.all([
    readFile(new URL("../.github/workflows/macos.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-mac-package.mjs", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(macBuilderConfig.mac.target, ["zip"]);
  assert.equal(macBuilderConfig.dmg, undefined);
  assert.deepEqual([...workflow.matchAll(/^\s+(release\/.+)$/gm)].map(match => match[1].trim()), [
    "release/MStruct-Analysis-Editor-*-mac-${{ matrix.arch }}.zip",
    "release/MStruct-Analysis-Editor-*-mac-${{ matrix.arch }}.sha256",
  ]);
  assert.doesNotMatch(verifier, /\bdmg\b|\bhdiutil\b/);
  assert.match(verifier, /run\("ditto"/);
  assert.match(verifier, /run\("codesign"/);
  assert.match(verifier, /--smoke-test/);
  assert.match(verifier, /createHash\("sha256"\)/);
});

test("bundled startup demo needs no external timeline and genuine missing-file warnings remain active", async () => {
  const demo = parseMstructDocument(await readFile(new URL("../examples/k545.mstruct", import.meta.url), "utf8"));
  assert.equal(demo.ok, true);
  const profile = await verifyMstructProfile(JSON.parse(await readFile(new URL("../src/config/official-profile.json", import.meta.url), "utf8")));
  const compiled = compileProfileDocument(demo, profile);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
  assert.deepEqual(compiled.warnings.filter(warning => warning.romanValidation), []);
  assert.deepEqual(demo.metadata.mstructtimeFiles, [], "The unsaved startup demo cannot resolve external timeline files.");
  const warnings = [], loaded = [];
  const options = {
    desktopApi: { loadTimelines: async names => ({ files: names.map(fileName => ({ fileName, missing: true })) }) },
    onFiles: files => loaded.push(files), onMissing: names => warnings.push(names),
  };
  await loadDesktopTimelineFiles({ ...options, fileNames: demo.metadata.mstructtimeFiles });
  assert.deepEqual(loaded, [[]]);
  assert.deepEqual(warnings, []);
  await loadDesktopTimelineFiles({ ...options, fileNames: ["recording.mstructtime"] });
  assert.deepEqual(warnings, [["recording.mstructtime"]]);
});

test("desktop packaging embeds current complete rules and updates the example for offline resolution", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mstruct-desktop-profile-"));
  const configDirectory = path.join(directory, "config"), exampleFile = path.join(directory, "startup.mstruct");
  await mkdir(configDirectory);
  await Promise.all([...PROFILE_FILES.map(({ name }) => copyFile(new URL(`../src/config/${name}`, import.meta.url), path.join(configDirectory, name))),
    copyFile(new URL("../src/config/official-profile.json", import.meta.url), path.join(configDirectory, "official-profile.json")),
    copyFile(new URL("../examples/k545.mstruct", import.meta.url), exampleFile)]);
  const tagsFile = path.join(configDirectory, "tags.csv");
  await writeFile(tagsFile, (await readFile(tagsFile, "utf8")) + "<OfflineBuildTest>,离线构建测试,Offline Build Test,1\n");
  const result = await prepareDesktopProfile({ configDirectory, exampleFile });
  assert.equal(result.files, 13);
  assert.equal(result.updated, true);
  const embedded = await verifyMstructProfile(JSON.parse(await readFile(path.join(configDirectory, "official-profile.json"), "utf8")));
  const offline = await resolveMstructDocument(await readFile(exampleFile, "utf8"), async () => embedded);
  assert.equal(offline.ok, true);
  assert.equal(embedded.manifest.bundleHash, result.bundleHash);
  assert.match(embedded.files["tags.csv"], /OfflineBuildTest/);
  assert.equal((await prepareDesktopProfile({ configDirectory, exampleFile })).updated, false);
  const snapshot = await readFile(path.join(configDirectory, "official-profile.json"), "utf8");
  await writeFile(tagsFile, "invalid CSV");
  await assert.rejects(prepareDesktopProfile({ configDirectory, exampleFile }));
  assert.equal(await readFile(path.join(configDirectory, "official-profile.json"), "utf8"), snapshot);
  assert.match(packageJson.scripts["desktop:prepare"], /^node scripts\/prepare-desktop-profile\.mjs &&/);
});

test("native menus switch entirely between English and Chinese while preserving commands", () => {
  const locale = createDesktopLocale("en"), commands = [];
  const options = { tr: locale.tr, locale: locale.get(), sendDocumentCommand: command => commands.push(command) };
  const english = applicationMenuTemplate(options);
  assert.deepEqual(english.map(menu => menu.label), ["File", "Edit", "View", "Settings", "Help", "Language"]);
  assert.doesNotMatch(JSON.stringify(english.slice(0, -1)), /\p{Script=Han}/u);
  assert.deepEqual(english.at(-1).submenu.map(item => [item.label, item.checked]), [["中文", false], ["English", true]]);
  english[3].submenu[0].click();
  english[0].submenu[0].click();
  assert.deepEqual(commands, ["application-settings", "new"]);
  locale.set("zh");
  const chinese = applicationMenuTemplate({ ...options, locale: locale.get() });
  assert.deepEqual(chinese.map(menu => menu.label), ["文件", "编辑", "视图", "设置", "帮助", "语言"]);
  assert.deepEqual(chinese.at(-1).submenu.map(item => [item.label, item.checked]), [["中文", true], ["English", false]]);
  assert.equal(locale.tr("applicationSettings"), "软件设置");
  assert.ok(packageJson.build.files.includes("desktop/application-ui.cjs"));
});

test("shared core and UI stay independent from Electron and desktop resources", async () => {
  const directories = [new URL("../src/core/", import.meta.url), new URL("../src/ui/", import.meta.url)];
  const sources = [];
  for (const directory of directories) {
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".js")) continue;
      sources.push({ name, source: await readFile(new URL(name, directory), "utf8") });
    }
  }
  for (const { name, source } of sources) {
    assert.doesNotMatch(source, /(?:from\s+|require\()["'](?:electron|node:)/, `${name} must not import platform modules`);
    assert.doesNotMatch(source, /window\.mstructDesktop|mstruct-app:\/\//, `${name} must receive desktop capabilities through injection`);
  }
});

test("desktop packaging stays an explicit unpacked-and-zip target outside normal Vite scripts", () => {
  assert.equal(packageJson.main, "desktop/main.cjs");
  assert.equal(packageJson.scripts.dev, "vite");
  assert.match(packageJson.scripts.build, /^vite build(?: && node scripts\/verify-profile-build\.mjs)?$/);
  assert.match(packageJson.scripts["desktop:dist"], /desktop:prepare/);
  assert.match(packageJson.scripts["desktop:dist"], /electron-builder --win --dir --x64/);
  assert.equal(packageJson.build.productName, "分析编辑器");
  assert.equal(packageJson.build.win.icon, "desktop/generated/icon.ico");
  assert.equal(packageJson.build.win.executableName, "mstruct editor");
  assert.equal(packageJson.build.electronDist, "node_modules/electron/dist");
  assert.deepEqual(packageJson.build.extraResources, [
    { from: "dist", to: "renderer" },
    { from: "desktop/assets", to: "desktop-assets" },
    { from: "desktop/generated/icon.ico", to: "desktop-icon.ico" },
    { from: "LICENSE", to: "LICENSE-MStruct-Editor.txt" },
    { from: "LICENSE-SCOPE.md", to: "LICENSE-SCOPE.md" },
  ]);
  assert.doesNotMatch(JSON.stringify(packageJson.build), /D1|wrangler/i);
});

test("desktop shell exposes only narrow document APIs and keeps the renderer sandboxed", () => {
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /protocol\.registerSchemesAsPrivileged/);
  assert.match(mainSource, /const body = await readFile\(resourcePath\)/);
  assert.match(mainSource, /return new Response\(responseBody/);
  assert.doesNotMatch(mainSource, /new Headers/);
  assert.match(mainSource, /headers\["content-security-policy"\] = CONTENT_SECURITY_POLICY/);
  assert.match(mainSource, /DESKTOP_ASSET_PREFIX = "\/__desktop_assets__\/"/);
  assert.match(mainSource, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(mainSource, /showOpenDialog/);
  assert.match(mainSource, /showSaveDialog/);
  assert.match(mainSource, /applicationMenuTemplate\(\{ tr: nativeTr, locale: desktopLocale\.get\(\), sendDocumentCommand/);
  assert.match(mainSource, /async function newDocument\(event\)[\s\S]*confirmDiscard\(nativeTr\("newAction"\)\)[\s\S]*currentDocumentPath = null;[\s\S]*documentDirty = false;/);
  assert.match(mainSource, /ipcMain\.handle\("mstruct:new", newDocument\)/);
  assert.match(mainSource, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(mainSource, /setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\)/);
  assert.match(mainSource, /renderer\$\{DESKTOP_ASSET_PREFIX\}THIRD_PARTY_NOTICES\.txt/);
  assert.match(mainSource, /nativeTr\("title"\).*\$\{app\.getVersion\(\)\}/);
  assert.doesNotMatch(mainSource, /Beta \$\{app\.getVersion\(\)\}/);
  assert.match(mainSource, /title: nativeTr\("about"\)/);
  assert.match(mainSource, /ipcMain\.on\("mstruct:set-locale"[\s\S]*assertTrustedSender\(event\);[\s\S]*desktopLocale\.set\(locale\);[\s\S]*installApplicationMenu\(\)/);
  assert.match(mainSource, /process\.argv\.includes\("--smoke-test"\)/);
  assert.match(mainSource, /configureUserData\(app, \{ isolatedDirectory: process\.env\.MSTRUCT_SMOKE_USER_DATA/);
  assert.match(mainSource, /Promise\.race/);
  assert.match(mainSource, /if \(SMOKE_TEST\) app\.exit\(0\)/);
  assert.match(mainSource, /\.catch\(\(error\) => \{/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\("mstruct:set-fullscreen"/);
  assert.match(mainSource, /assertTrustedSender/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\("mstructDesktop"/);
  assert.match(preloadSource, /mstruct-app:\/\/renderer\/__desktop_assets__\/soundfonts\/acoustic_grand_piano-ogg\.js/);
  assert.match(preloadSource, /newDocument: \(\) => ipcRenderer\.invoke\("mstruct:new"\)/);
  assert.doesNotMatch(preloadSource, /mstruct-app:\/\/assets\//);
  assert.doesNotMatch(preloadSource, /mstruct:set-fullscreen/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\([^)]*ipcRenderer/s);
  assert.doesNotMatch(preloadSource, /require\("node:fs/);
});

test("standalone export stays behind a narrow desktop adapter and writes vector-first PDF", async () => {
  const commands = [];
  const menus = applicationMenuTemplate({ tr: createDesktopLocale("en").tr, sendDocumentCommand: command => commands.push(command) });
  const exports = menus[0].submenu.find(item => item.label === "Export").submenu;
  exports.forEach(item => item.click());
  assert.deepEqual(commands, ["export:pdf", "export:svg", "export:png", "export:jpg", "export:mp4"]);
  assert.match(mainSource, /ipcMain\.handle\("mstruct:export-prepare", prepareScoreExport\)/);
  assert.match(mainSource, /ipcMain\.handle\("mstruct:export-complete", completeScoreExport\)/);
  assert.match(mainSource, /ipcMain\.on\("mstruct:export-cancel", cancelScoreExport\)/);
  assert.match(mainSource, /webContents\.printToPDF\(\{/);
  assert.match(mainSource, /printBackground: true/);
  assert.match(mainSource, /preferCSSPageSize: true/);
  assert.match(mainSource, /generateTaggedPDF: true/);
  assert.doesNotMatch(mainSource, /offscreen: true/);
  assert.match(mainSource, /<body class="editor-ready">/);
  assert.match(mainSource, /document\.fonts\.ready/);
  assert.match(mainSource, /hasScoreContent: Boolean\(scoreContent\)/);
  assert.doesNotMatch(mainSource, /webContents\.invalidate\(\)/);
  assert.doesNotMatch(mainSource, /webContents\.on\("paint", onPaint\)/);
  assert.doesNotMatch(mainSource, /webContents\.capturePage\(\)/);
  assert.doesNotMatch(mainSource, /webContents\.debugger/);
  assert.doesNotMatch(mainSource, /Emulation\.setDeviceMetricsOverride/);
  assert.doesNotMatch(mainSource, /Page\.captureScreenshot/);
  assert.match(mainSource, /require\("\.\/raster-capture\.cjs"\)/);
  assert.match(rasterCaptureSource, /async function captureRasterTiles/);
  assert.ok(packageJson.build.files.includes('desktop/raster-capture.cjs'));
  assert.match(mainSource, /transparent: transparentBackground/);
  assert.match(mainSource, /backgroundColor: transparentBackground \? "#00000000" : "#ffffff"/);
  assert.match(mainSource, /background-image:none!important/);
  assert.match(mainSource, /format === "png" && pngBackground === "transparent"/);
  assert.match(rasterCaptureSource, /webContents\.capturePage\([\s\S]*stayHidden: true, stayAwake: true/);
  assert.match(rasterCaptureSource, /tile\.toBitmap\(\{ scaleFactor: 1 \}\)/);
  assert.match(rasterCaptureSource, /nativeImage\.createFromBitmap\(bitmap, \{ width: size\.width, height: size\.height, scaleFactor: 1 \}\)/);
  assert.match(rasterCaptureSource, /captured an exported page tile at an unexpected size/);
  assert.doesNotMatch(mainSource, /display\?\.scaleFactor/);
  assert.match(mainSource, /RASTER_EXPORT_SECURITY_POLICY/);
  assert.match(mainSource, /pendingRasterDocuments\.delete\(documentKey\)/);
  assert.doesNotMatch(mainSource, /nativeImage\.createFromDataURL/);
  assert.match(mainSource, /image\.toPNG\(\)/);
  assert.match(mainSource, /image\.toJPEG\(EXPORT_JPEG_QUALITY\)/);
  assert.match(mainSource, /const EXPORT_JPEG_QUALITY = 92/);
  assert.match(preloadSource, /prepareScoreExport: \(payload\) => ipcRenderer\.invoke\("mstruct:export-prepare", payload\)/);
  assert.match(preloadSource, /completeScoreExport: \(payload\) => ipcRenderer\.invoke\("mstruct:export-complete", payload\)/);
  assert.match(preloadSource, /cancelScoreExport: \(token\) => ipcRenderer\.send\("mstruct:export-cancel", token\)/);
  const { createDesktopExportAdapter } = await import("../src/runtime/desktop-export.js");
  const stillFormats = [];
  createDesktopExportAdapter({ onCommand: callback => ["export:pdf", "export:mp4", "play"].forEach(callback) }).onCommand(format => stillFormats.push(format));
  assert.deepEqual(stillFormats, ["pdf"]);
  assert.doesNotMatch(desktopExportSource, /electron|node:fs/);
});

test("desktop soundfont injection remains independent of web asset hosting", () => {
  assert.match(audioSource, /this\.instrumentUrl = options\.instrumentUrl/);
  assert.match(audioSource, /pianoOptions\.instrumentUrl = this\.instrumentUrl/);
  assert.match(symbolSource, /new ChordPianoPlayer\(pianoOptions\)/);
  assert.match(desktopAdapterSource, /pianoOptions: \{ instrumentUrl: desktopApi\.pianoInstrumentUrl \}/);
  assert.match(editorSource, /desktopPreviewMode: documentAdapter\?\.kind === "desktop"/);
  assert.match(editorSource, /pianoOptions: documentAdapter\?\.pianoOptions/);
  assert.match(audioSource, /else pianoOptions\.instrument = this\.instrument/);
});

test("web piano URLs stay same-origin in dev, hosted editor and viewer and ship exact licensed bytes", async () => {
  const { webPianoOptions, WEB_PIANO_PATH } = await import("../src/runtime/web-audio.js");
  for (const base of ["http://localhost:5173/", "https://archive.example/mstruct-editor/", "https://archive.example/mstruct-editor/index.html?viewer=1"]) {
    const instrument = new URL(webPianoOptions(new URL("./", base)).instrumentUrl);
    assert.equal(instrument.origin, new URL(base).origin);
    assert.ok(instrument.pathname.endsWith(WEB_PIANO_PATH));
  }
  assert.deepEqual(await readFile(new URL(`../public/${WEB_PIANO_PATH}`, import.meta.url)), soundfont);
  assert.deepEqual(await readFile(new URL("../public/licenses/CC-BY-SA-3.0.txt", import.meta.url)), license);
});

test("vendored piano and license are exact reviewed assets", () => {
  assert.equal(sha256(soundfont), "54680c0289541f06932b77d1fbdd52e362c3518bbda8b1e2233e051d667d2767");
  assert.equal(sha256(license), "3f941b3b89cf7b8370ceb83cc76d2120d471b58735d8ca60238a751a48d7f72f");
  assert.match(soundfont.toString("utf8", 0, 160), /MIDI/);
  assert.match(notices, /Musyng Kite[\s\S]*CC BY-SA 3\.0/);
});

test("one-click Windows entry keeps CRLF and only invokes the explicit desktop build", () => {
  const text = batchSource.toString("utf8");
  assert.equal(/(^|[^\r])\n/.test(text), false, "BAT must not contain lone LF line endings.");
  assert.match(text, /npm\.cmd ci/);
  assert.match(text, /node node_modules\\electron\\install\.js/);
  assert.match(text, /ELECTRON_MIRROR=https:\/\/npmmirror\.com\/mirrors\/electron\//);
  assert.match(text, /npm\.cmd run desktop:dist/);
  assert.match(text, /npm\.cmd run desktop:version/);
  assert.match(text, /--config\.directories\.output="%BUILD_OUTPUT_REL%"/);
  assert.match(text, /desktop:version -- --prepare-build/);
  assert.match(text, /set "BUILD_OUTPUT_REL=release\\\.mstruct-build-%APP_VERSION%-%RANDOM%-%RANDOM%"/);
  assert.match(text, /set "UNPACKED_DIR=%EDITOR_DIR%\\release\\MStruct-Analysis-Editor-%APP_VERSION%-win-x64"/);
  assert.match(text, /move "%BUILDER_UNPACKED_DIR%" "%UNPACKED_DIR%"/);
  assert.match(text, /set "UNPACKED_EXE=%UNPACKED_DIR%\\mstruct editor\.exe"/);
  assert.match(text, /start "" \/wait "%UNPACKED_EXE%" --smoke-test/);
  assert.match(text, /Compress-Archive/);
  assert.match(text, /\$maxAttempts = 5/);
  assert.match(text, /Start-Sleep -Seconds 2/);
  assert.ok(
    text.indexOf("Compress-Archive") < text.indexOf('start "" /wait "%UNPACKED_EXE%" --smoke-test'),
    "The ZIP must be completed before the smoke test can temporarily lock the packaged EXE.",
  );
  assert.doesNotMatch(text, /portable/i);
  assert.match(text, /MSTRUCT_BATCH_NO_PAUSE/);
});

test("desktop versions retain the first build number and increment subsequent artifacts", () => {
  assert.equal(desktopBuildVersion("1.0.0", false), "1.0.0");
  assert.equal(desktopBuildVersion("1.0.0", true), "1.0.1");
  assert.equal(nextDesktopVersion("1.0.999"), "1.0.1000");
  assert.throws(() => nextDesktopVersion("beta-0.1"), /three numeric parts/);
});
