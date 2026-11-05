const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const { appendFileSync } = require("node:fs");
const { readFile, rename, stat, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { createProfileStore, MAX_BYTES: MAX_PROFILE_BYTES } = require("./profile-store.cjs");
const { configureUserData } = require("./user-data.cjs");
const { setupUserDataIpc } = require("./user-data-ipc.cjs");
const { createRecentDocuments } = require("./recent-documents.cjs");
const { setupLibraryIpc } = require("./library-ipc.cjs");
const { setupDesktopAudio } = require("./library-audio.cjs");
const { createDesktopLocale, applicationMenuTemplate, openCurrentDocumentDirectory, TECHNICAL_DOCUMENTATION_URL } = require("./application-ui.cjs");
const { createApplicationMenu } = require("./application-menu.cjs");
const { createDocumentTransition } = require("./document-transition.cjs");
const { setupVideoExport } = require("./video-export.cjs");
const { setupVideoCover } = require("./video-cover.cjs");
const { captureRasterTiles, TILE_WIDTH: EXPORT_RASTER_TILE_WIDTH, TILE_HEIGHT: EXPORT_RASTER_TILE_HEIGHT } = require("./raster-capture.cjs");
const desktopLocale = createDesktopLocale();
const nativeTr = desktopLocale.tr;

const APP_SCHEME = "mstruct-app";
const DESKTOP_ASSET_PREFIX = "/__desktop_assets__/";
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_EXPORT_PAGES = 500;
const MAX_EXPORT_PAGE_BYTES = 64 * 1024 * 1024;
const MAX_EXPORT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_EXPORT_RASTER_DIMENSION = 32767;
const MAX_EXPORT_RASTER_PIXELS = 32_000_000;
const EXPORT_JPEG_QUALITY = 92;
const EXPORT_FORMATS = new Set(["pdf", "svg", "png", "jpg"]);
const SMOKE_TEST = process.argv.includes("--smoke-test");
// Automated and interactive verification share an explicitly isolated store.
try {
  if (!configureUserData(app, { isolatedDirectory: process.env.MSTRUCT_SMOKE_USER_DATA, claimDirectory: () => app.requestSingleInstanceLock() })) app.exit(0);
} catch (error) {
  dialog.showErrorBox(nativeTr("storageTitle"), nativeTr("storageMessage"));
  console.error(error);
  app.exit(1);
}
const documentFilters = () => [{ name: nativeTr("document"), extensions: ["mstruct"] }, { name: nativeTr("text"), extensions: ["txt"] }];
const recentDocuments = createRecentDocuments(app.getPath("userData"));
const timelineFilters = () => [{ name: nativeTr("timeline"), extensions: ["mstructtime"] }];
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' mstruct-app:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' mstruct-app:",
  "connect-src 'self' mstruct-app:",
  "media-src 'self' blob:",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
const RASTER_EXPORT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "img-src data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mstruct", "text/plain; charset=utf-8"],
  [".mstructtime", "text/plain; charset=utf-8"],
  [".otf", "font/otf"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

let mainWindow = null;
app.on("second-instance", () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
let noticesWindow = null;
let currentDocumentPath = null;
let documentActive = false;
let pendingOpen = null;
let documentDirty = false;
let closeConfirmed = false;
let closePromptActive = false;
const pendingScoreExports = new Map();
const pendingRasterDocuments = new Map();

function reportSmokeFailure(error) {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(message);
  if (!SMOKE_TEST || !process.env.MSTRUCT_SMOKE_LOG) return;
  try {
    appendFileSync(process.env.MSTRUCT_SMOKE_LOG, `${message}\n`, "utf8");
  } catch {
    // The exit code still reports the failed smoke test if its diagnostic file cannot be written.
  }
}

function reportSmokeTrace(message) {
  if (!SMOKE_TEST || !process.env.MSTRUCT_SMOKE_LOG) return;
  try {
    appendFileSync(process.env.MSTRUCT_SMOKE_LOG, `[trace] ${message}\n`, "utf8");
  } catch {
    // Trace output is diagnostic only.
  }
}

function rendererRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer")
    : path.resolve(__dirname, "..", "dist");
}

function desktopAssetsRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "desktop-assets")
    : path.resolve(__dirname, "assets");
}

function desktopIconPath() {
  if (process.platform === "darwin") return app.isPackaged
    ? path.join(process.resourcesPath, "desktop-icon.png")
    : path.resolve(__dirname, "generated", "icon.png");
  return app.isPackaged
    ? path.join(process.resourcesPath, "desktop-icon.ico")
    : path.resolve(__dirname, "generated", "icon.ico");
}

function safeResourcePath(root, pathname, fallback = "") {
  const relativeUrlPath = decodeURIComponent(pathname).replace(/^\/+/, "") || fallback;
  if (!relativeUrlPath) return null;
  const resolved = path.resolve(root, relativeUrlPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

async function handleAppRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.host === "renderer" && url.pathname.startsWith("/__local_audio__/")) return desktopAudio.response(url.pathname.slice("/__local_audio__/".length));
    if (url.host === "renderer" && url.pathname.startsWith("/__video_media__/")) return videoExport.response(url.pathname.slice("/__video_media__/".length));
    if (url.host === "export") {
      const key = url.pathname.replace(/^\/+/, "");
      const document = pendingRasterDocuments.get(key);
      if (!document) return new Response("Not found", { status: 404 });
      return new Response(document, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": RASTER_EXPORT_SECURITY_POLICY,
        },
      });
    }
    const isDesktopAsset = url.host === "renderer" && url.pathname.startsWith(DESKTOP_ASSET_PREFIX);
    const root = url.host === "renderer" ? (isDesktopAsset ? desktopAssetsRoot() : rendererRoot()) : null;
    if (!root) return new Response("Not found", { status: 404 });
    const resourceUrlPath = isDesktopAsset ? url.pathname.slice(DESKTOP_ASSET_PREFIX.length) : url.pathname;
    const resourcePath = safeResourcePath(root, resourceUrlPath, isDesktopAsset ? "" : "index.html");
    reportSmokeTrace(`${request.url} -> ${resourcePath || "invalid path"}`);
    if (!resourcePath) return new Response("Invalid path", { status: 400 });
    const body = await readFile(resourcePath);
    reportSmokeTrace(`read ${body.length} bytes from ${resourcePath}`);
    const extension = path.extname(resourcePath).toLowerCase();
    const responseBody = [".css", ".csv", ".html", ".js", ".json", ".mstruct", ".txt"].includes(extension)
      ? body.toString("utf8")
      : Uint8Array.from(body);
    const headers = { "content-type": CONTENT_TYPES.get(extension) || "application/octet-stream" };
    if (!isDesktopAsset && extension === ".html") headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
    if (url.host === "renderer" && url.pathname === "/index.html" && url.search === "?video-export")
      headers["content-security-policy"] = CONTENT_SECURITY_POLICY.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    return new Response(responseBody, {
      status: 200,
      headers,
    });
  } catch (error) {
    reportSmokeFailure(`Protocol request failed for ${request.url}: ${error instanceof Error ? (error.stack || error.message) : String(error)}`);
    return new Response("Not found", { status: 404 });
  }
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Untrusted desktop IPC sender.");
}

function displayName() {
  return currentDocumentPath ? path.basename(currentDocumentPath) : "";
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const name = displayName();
  mainWindow.setTitle(`${nativeTr("title")}${name ? ` — ${name}` : ""}${documentDirty ? " *" : ""}`);
}

async function confirmDiscard(actionLabel) {
  return documentTransition.confirm(actionLabel);
}

function normalizeSuggestedName(value) {
  const name = path.basename(String(value || "untitled.mstruct")).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return /\.mstruct$/i.test(name) ? name : `${name}.mstruct`;
}

function setCurrentDocumentPath(filePath) {
  currentDocumentPath = filePath;
  documentActive = Boolean(filePath);
  documentDirty = false;
  if (filePath) {
    app.addRecentDocument(filePath);
    updateRecentDocuments(() => recentDocuments.record(filePath));
  }
  updateWindowTitle();
  installApplicationMenu();
}

function updateRecentDocuments(operation) {
  try {
    operation();
    installApplicationMenu();
  } catch (error) {
    console.error("Could not save recent documents:", error.message);
    dialog.showErrorBox(nativeTr("recentStorage"), nativeTr("recentStorageDetail"));
  }
}

async function newDocument(event) {
  assertTrustedSender(event);
  if (!documentActive) return { cancelled: true };
  if (!await confirmDiscard(nativeTr("newAction"))) return { cancelled: true };
  currentDocumentPath = null;
  documentActive = true;
  pendingOpen = null;
  documentDirty = false;
  updateWindowTitle();
  return { cancelled: false };
}

async function openDocument(event) {
  assertTrustedSender(event);
  if (!await confirmDiscard(nativeTr("openAction"))) return { cancelled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: nativeTr("openDocument"),
    filters: documentFilters(),
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  return prepareOpenedDocument(result.filePaths[0]);
}

async function prepareOpenedDocument(filePath) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size > MAX_DOCUMENT_BYTES) throw new Error(nativeTr("invalidDocument"));
  const text = await readFile(filePath, "utf8");
  const token = randomUUID();
  pendingOpen = { token, filePath };
  return { cancelled: false, token, name: path.basename(filePath), text };
}

async function openRecentDocument(event, id) {
  assertTrustedSender(event);
  const filePath = recentDocuments.get(id);
  if (!filePath) return { cancelled: true };
  if (!await confirmDiscard(nativeTr("openAction"))) return { cancelled: true };
  try {
    return await prepareOpenedDocument(filePath);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) updateRecentDocuments(() => recentDocuments.remove(id));
    dialog.showErrorBox(nativeTr("recentUnavailable"), nativeTr("recentUnavailableDetail", { name: path.basename(filePath) }));
    return { cancelled: true };
  }
}

function acceptOpenedDocument(event, token) {
  assertTrustedSender(event);
  if (!pendingOpen || pendingOpen.token !== token) throw new Error(nativeTr("staleOpen"));
  setCurrentDocumentPath(pendingOpen.filePath);
  pendingOpen = null;
  return { name: displayName() };
}

async function saveDocument(event, payload) {
  assertTrustedSender(event);
  if (!documentActive) return { cancelled: true };
  const text = payload?.text;
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error(nativeTr("invalidSave"));
  }
  const saveAs = Boolean(payload?.saveAs);
  let filePath = saveAs ? null : currentDocumentPath;
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: nativeTr(saveAs ? "saveDocumentAs" : "saveDocument"),
      defaultPath: currentDocumentPath || normalizeSuggestedName(payload?.suggestedName),
      filters: documentFilters().slice(0, 1),
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    filePath = /\.mstruct$/i.test(result.filePath) ? result.filePath : `${result.filePath}.mstruct`;
  }
  const managed = await libraryIpc.saveManaged(filePath, text, payload.analysisName, saveAs);
  if (managed) { await desktopAudio.relocate(filePath, managed); filePath = managed; }
  else await writeFile(filePath, text, "utf8");
  setCurrentDocumentPath(filePath);
  return { cancelled: false, name: displayName() };
}

function exportCopy(locale, zh, en) {
  return locale === "en" ? en : zh;
}

function normalizeExportName(value, format) {
  const fallback = `untitled.${format}`;
  const name = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  const stem = name.replace(/\.[^.]+$/, "") || "untitled";
  return `${stem}.${format}`;
}

function exportTargets(basePath, format, pageCount) {
  if (format === "pdf" || pageCount === 1) return [basePath];
  const parsed = path.parse(basePath);
  return Array.from({ length: pageCount }, (_, index) => path.join(parsed.dir, `${parsed.name}-p${String(index + 1).padStart(3, "0")}${parsed.ext}`));
}

async function existingFile(filePath) {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error(`Export target is not a file: ${filePath}`);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function prepareScoreExport(event, payload) {
  assertTrustedSender(event);
  if (!documentActive) return { cancelled: true };
  const format = String(payload?.format ?? "").toLowerCase();
  const pageCount = Math.floor(Number(payload?.pageCount));
  const locale = payload?.locale === "en" ? "en" : "zh";
  if (!EXPORT_FORMATS.has(format)) throw new Error("Unsupported score export format.");
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_EXPORT_PAGES) throw new Error("Invalid score export page count.");
  let rasterSize = null;
  const pngBackground = format === "png" && payload?.pngBackground === "transparent" ? "transparent" : "white";
  if (format === "png" || format === "jpg") {
    const width = Number(payload?.rasterWidthPx);
    const height = Number(payload?.rasterHeightPx);
    const pageWidth = Number(payload?.pageWidthPx);
    const pageHeight = Number(payload?.pageHeightPx);
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1
      || width > MAX_EXPORT_RASTER_DIMENSION || height > MAX_EXPORT_RASTER_DIMENSION
      || width * height > MAX_EXPORT_RASTER_PIXELS) {
      throw new Error("Invalid raster export dimensions.");
    }
    if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
      throw new Error("Invalid score export page geometry.");
    }
    rasterSize = { width, height, pageWidth, pageHeight };
  }
  const defaultName = normalizeExportName(payload?.suggestedName, format);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: exportCopy(locale, `导出 ${format.toUpperCase()} 乐谱`, `Export ${format.toUpperCase()} Score`),
    defaultPath: defaultName,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  const selectedPath = path.join(path.dirname(result.filePath), normalizeExportName(path.basename(result.filePath), format));
  const targets = exportTargets(selectedPath, format, pageCount);
  const collisions = [];
  for (const target of targets) if (await existingFile(target)) collisions.push(target);
  if (collisions.length) {
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: exportCopy(locale, "覆盖已有导出文件？", "Replace Existing Export Files?"),
      message: exportCopy(locale, `已有 ${collisions.length} 个目标文件。`, `${collisions.length} export target(s) already exist.`),
      detail: `${collisions.slice(0, 6).map((target) => path.basename(target)).join("\n")}${collisions.length > 6 ? "\n…" : ""}`,
      buttons: [exportCopy(locale, "覆盖", "Replace"), exportCopy(locale, "取消", "Cancel")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return { cancelled: true };
  }
  const token = randomUUID();
  pendingScoreExports.set(token, { format, targets, rasterSize, pngBackground });
  return { cancelled: false, token, names: targets.map((target) => path.basename(target)) };
}

function exportSvgPageBuffer(value) {
  if (typeof value !== "string" || !/^\s*<svg[\s>]/.test(value)) throw new Error("Invalid SVG export page.");
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength > MAX_EXPORT_PAGE_BYTES) throw new Error("An exported page is too large.");
  return buffer;
}

function exportRasterMarkup(value) {
  if (typeof value !== "string" || !/^\s*<section[\s>]/.test(value)) throw new Error("Invalid raster export page.");
  if (Buffer.byteLength(value, "utf8") > MAX_EXPORT_PAGE_BYTES) throw new Error("An exported page is too large.");
  return value;
}

function scoreExportRasterDocument(markup, cssText, size, transparentBackground) {
  const scaleX = size.width / size.pageWidth;
  const scaleY = size.height / size.pageHeight;
  const background = transparentBackground ? "transparent" : "#fff";
  const safeCss = cssText.replaceAll("</style", "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${background}!important}#scoreExportRasterStage{position:fixed;left:0;top:0;width:${size.width}px;height:${size.height}px;transform:translate(0,0)}#scoreExportRasterStage>.score-export-page{display:block!important;margin:0!important;background:${background}!important;background-image:none!important;box-shadow:none!important;transform-origin:top left!important;transform:scale(${scaleX},${scaleY})!important}</style></head><body class="editor-ready"><div id="scoreExportRasterStage">${markup}</div></body></html>`;
}

async function rasterizeScoreExportPage(value, cssText, format, size, pngBackground) {
  const markup = exportRasterMarkup(value);
  const transparentBackground = format === "png" && pngBackground === "transparent";
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const viewport = {
    width: Math.min(EXPORT_RASTER_TILE_WIDTH, size.width),
    height: Math.min(EXPORT_RASTER_TILE_HEIGHT, size.height),
  };
  const windowWidth = Math.min(viewport.width, display.workAreaSize?.width ?? display.bounds.width);
  const windowHeight = Math.min(viewport.height, display.workAreaSize?.height ?? display.bounds.height);
  const documentKey = randomUUID();
  const rasterWindow = new BrowserWindow({
    show: false,
    x: display.bounds.x,
    y: display.bounds.y,
    width: Math.max(1, windowWidth),
    height: Math.max(1, windowHeight),
    useContentSize: true,
    transparent: transparentBackground,
    backgroundColor: transparentBackground ? "#00000000" : "#ffffff",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  rasterWindow.setMenuBarVisibility(false);
  rasterWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  rasterWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== `${APP_SCHEME}://export/${documentKey}`) event.preventDefault();
  });
  pendingRasterDocuments.set(documentKey, scoreExportRasterDocument(markup, cssText, size, transparentBackground));
  try {
    await rasterWindow.loadURL(`${APP_SCHEME}://export/${documentKey}`);
    const rasterState = await rasterWindow.webContents.executeJavaScript(`document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const page = document.querySelector(".score-export-page");
      const scoreContent = page?.querySelector(".score-system, .score-document-header, .score-global-tags, .incomplete-note");
      const rect = page?.getBoundingClientRect();
      resolve({
        bodyVisibility: getComputedStyle(document.body).visibility,
        pageVisibility: page ? getComputedStyle(page).visibility : "missing",
        hasScoreContent: Boolean(scoreContent),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      });
    }))))`, true);
    if (rasterState.bodyVisibility === "hidden"
      || rasterState.pageVisibility === "hidden"
      || !rasterState.hasScoreContent
      || rasterState.width <= 0
      || rasterState.height <= 0) {
      throw new Error("Electron raster export page did not become visible.");
    }
    if (!Number.isFinite(rasterState.innerWidth) || rasterState.innerWidth < 1
      || !Number.isFinite(rasterState.innerHeight) || rasterState.innerHeight < 1
      || Math.abs(rasterState.width - size.width) > 1
      || Math.abs(rasterState.height - size.height) > 1) {
      throw new Error("Electron could not establish the raster export page geometry.");
    }
    const image = await captureRasterTiles(rasterWindow.webContents, size, {
      width: rasterState.innerWidth,
      height: rasterState.innerHeight,
    }, transparentBackground);
    return format === "png" ? image.toPNG() : image.toJPEG(EXPORT_JPEG_QUALITY);
  } finally {
    pendingRasterDocuments.delete(documentKey);
    if (!rasterWindow.isDestroyed()) rasterWindow.destroy();
  }
}

async function removeIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeExportTransaction(targets, buffers, token) {
  const temps = targets.map((target, index) => path.join(path.dirname(target), `.${path.basename(target)}.${token}.${index}.tmp`));
  const backups = targets.map((target, index) => path.join(path.dirname(target), `.${path.basename(target)}.${token}.${index}.bak`));
  const backedUp = [];
  const committed = [];
  try {
    for (let index = 0; index < temps.length; index += 1) await writeFile(temps[index], buffers[index], { flag: "wx" });
    for (let index = 0; index < targets.length; index += 1) {
      if (!await existingFile(targets[index])) continue;
      await rename(targets[index], backups[index]);
      backedUp.push(index);
    }
    for (let index = 0; index < targets.length; index += 1) {
      await rename(temps[index], targets[index]);
      committed.push(index);
    }
  } catch (error) {
    for (const index of committed.reverse()) await removeIfPresent(targets[index]).catch(() => undefined);
    for (const index of backedUp.reverse()) {
      try {
        await rename(backups[index], targets[index]);
      } catch {
        // Keep the backup beside the requested path if restoration itself fails.
      }
    }
    throw error;
  } finally {
    for (const filePath of temps) await removeIfPresent(filePath).catch(() => undefined);
  }
  for (const index of backedUp) await removeIfPresent(backups[index]).catch(() => undefined);
}

async function completeScoreExport(event, payload) {
  assertTrustedSender(event);
  const token = String(payload?.token ?? "");
  const job = pendingScoreExports.get(token);
  if (!job) throw new Error("Score export token has expired.");
  pendingScoreExports.delete(token);
  let buffers;
  if (job.format === "pdf") {
    const pdf = await mainWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      margins: { marginType: "none" },
    });
    buffers = [pdf];
  } else {
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    if (pages.length !== job.targets.length) throw new Error("Score export page count changed before writing.");
    if (job.format === "svg") {
      buffers = pages.map(exportSvgPageBuffer);
    } else {
      const cssText = payload?.cssText;
      if (typeof cssText !== "string" || Buffer.byteLength(cssText, "utf8") > MAX_EXPORT_PAGE_BYTES) {
        throw new Error("Invalid raster export stylesheet.");
      }
      buffers = [];
      for (const page of pages) buffers.push(await rasterizeScoreExportPage(page, cssText, job.format, job.rasterSize, job.pngBackground));
    }
  }
  let totalBytes = 0;
  for (const buffer of buffers) {
    if (job.format !== "pdf" && buffer.byteLength > MAX_EXPORT_PAGE_BYTES) throw new Error("An exported page is too large.");
    totalBytes += buffer.byteLength;
  }
  if (totalBytes > MAX_EXPORT_TOTAL_BYTES) throw new Error("The score export is too large.");
  await writeExportTransaction(job.targets, buffers, token);
  return { ok: true, names: job.targets.map((target) => path.basename(target)) };
}

function cancelScoreExport(event, token) {
  assertTrustedSender(event);
  pendingScoreExports.delete(String(token ?? ""));
}

function currentDocumentDirectory() {
  return currentDocumentPath ? path.dirname(currentDocumentPath) : null;
}

function safeTimelineName(value) {
  const fileName = path.basename(String(value ?? ""));
  if (!fileName || fileName !== String(value) || !/\.mstructtime$/i.test(fileName)) throw new Error(nativeTr("invalidTimelineName"));
  return fileName;
}

function timelinePath(fileName) {
  const directory = currentDocumentDirectory();
  if (!directory) throw new Error(nativeTr("parentRequired"));
  return path.join(directory, safeTimelineName(fileName));
}

async function loadTimelines(event, fileNames) {
  assertTrustedSender(event);
  const names = Array.isArray(fileNames) ? fileNames.slice(0, 100) : [];
  if (!currentDocumentDirectory()) return { files: names.map((fileName) => ({ fileName, missing: true })) };
  const files = await Promise.all(names.map(async (value) => {
    try {
      const fileName = safeTimelineName(value);
      const filePath = timelinePath(fileName);
      const fileStats = await stat(filePath);
      if (!fileStats.isFile() || fileStats.size > MAX_DOCUMENT_BYTES) return { fileName, missing: true };
      return { fileName, documentText: await readFile(filePath, "utf8"), history: false };
    } catch {
      return { fileName: path.basename(String(value ?? "")), missing: true };
    }
  }));
  return { files };
}

async function openTimeline(event) {
  assertTrustedSender(event);
  const directory = currentDocumentDirectory();
  if (!directory) throw new Error(nativeTr("parentRequired"));
  const result = await dialog.showOpenDialog(mainWindow, {
    title: nativeTr("openTimeline"),
    defaultPath: directory,
    filters: timelineFilters(),
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  const filePath = result.filePaths[0];
  if (path.dirname(filePath).toLocaleLowerCase() !== directory.toLocaleLowerCase()) {
    throw new Error(nativeTr("sameDirectory"));
  }
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size > MAX_DOCUMENT_BYTES) throw new Error(nativeTr("invalidTimeline"));
  return { cancelled: false, fileName: path.basename(filePath), documentText: await readFile(filePath, "utf8") };
}

async function createTimeline(event, payload) {
  assertTrustedSender(event);
  const documentText = payload?.documentText;
  if (typeof documentText !== "string" || Buffer.byteLength(documentText, "utf8") > MAX_DOCUMENT_BYTES) throw new Error(nativeTr("invalidTimelineSave"));
  const fileName = safeTimelineName(payload?.fileName);
  const filePath = timelinePath(fileName);
  await writeFile(filePath, documentText, { encoding: "utf8", flag: "wx" });
  return { ok: true, fileName, documentText, history: false };
}

async function saveTimeline(event, payload) {
  assertTrustedSender(event);
  const documentText = payload?.documentText;
  if (typeof documentText !== "string" || Buffer.byteLength(documentText, "utf8") > MAX_DOCUMENT_BYTES) throw new Error(nativeTr("invalidTimelineSave"));
  const fileName = safeTimelineName(payload?.fileName);
  await writeFile(timelinePath(fileName), documentText, "utf8");
  return { ok: true, fileName };
}

async function saveTimelineAs(event, payload) {
  assertTrustedSender(event);
  const directory = currentDocumentDirectory();
  if (!directory) throw new Error(nativeTr("parentRequired"));
  const documentText = payload?.documentText;
  if (typeof documentText !== "string" || Buffer.byteLength(documentText, "utf8") > MAX_DOCUMENT_BYTES) throw new Error(nativeTr("invalidTimelineSave"));
  const suggestedName = safeTimelineName(payload?.fileName);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: nativeTr("saveTimelineAs"),
    defaultPath: path.join(directory, suggestedName),
    filters: timelineFilters(),
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  const filePath = /\.mstructtime$/i.test(result.filePath) ? result.filePath : `${result.filePath}.mstructtime`;
  if (path.dirname(filePath).toLocaleLowerCase() !== directory.toLocaleLowerCase()) throw new Error(nativeTr("sameDirectory"));
  const fileName = safeTimelineName(path.basename(filePath));
  await writeFile(filePath, documentText, "utf8");
  return { ok: true, fileName, documentText, history: false };
}

async function removeTimeline(event, payload) {
  assertTrustedSender(event);
  const fileName = safeTimelineName(payload?.fileName);
  const filePath = timelinePath(fileName);
  try {
    await stat(filePath);
    await shell.trashItem(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ok: true, fileName };
}

function sendDocumentCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("mstruct:command", command);
}

function showThirdPartyNotices() {
  if (noticesWindow && !noticesWindow.isDestroyed()) {
    noticesWindow.focus();
    return;
  }
  noticesWindow = new BrowserWindow({
    parent: mainWindow,
    width: 820,
    height: 700,
    title: nativeTr("licenses"),
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  noticesWindow.setMenu(null);
  noticesWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  noticesWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  void noticesWindow.loadURL(`${APP_SCHEME}://renderer${DESKTOP_ASSET_PREFIX}THIRD_PARTY_NOTICES.txt`);
  noticesWindow.on("closed", () => { noticesWindow = null; });
}

function showAbout() {
  void dialog.showMessageBox(mainWindow, {
    type: "info",
    title: nativeTr("about"),
    message: `${nativeTr("title")} ${app.getVersion()}`,
    detail: nativeTr("aboutDetail"),
    buttons: [nativeTr("ok")],
    defaultId: 0,
    noLink: true,
  });
}

const applicationMenu = createApplicationMenu({ Menu, ipcMain, assertTrustedSender, getWindow: () => mainWindow, quit: () => app.quit(),
  createTemplate: () => applicationMenuTemplate({ tr: nativeTr, locale: desktopLocale.get(), sendDocumentCommand, showThirdPartyNotices, showAbout, hasDocument: documentActive, hasDocumentPath: Boolean(currentDocumentPath),
    openCurrentDirectory: () => { void openCurrentDocumentDirectory({ filePath: currentDocumentPath, shell, dialog, tr: nativeTr }); },
    openTechnicalDocumentation: () => { void shell.openExternal(TECHNICAL_DOCUMENTATION_URL).catch(error => console.error(error)); },
    recentDocuments: recentDocuments.list(),
    clearRecentDocuments: () => updateRecentDocuments(() => { recentDocuments.clear(); app.clearRecentDocuments(); }),
  }),
});
function installApplicationMenu() { applicationMenu.refresh(); }

const documentTransition = createDocumentTransition({ ipcMain, assertTrustedSender, getWindow: () => mainWindow, isDirty: () => documentDirty, dialog, tr: nativeTr });

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    title: nativeTr("title"),
    backgroundColor: "#f3f5fa",
    show: !SMOKE_TEST,
    icon: desktopIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://renderer/`)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.once("did-fail-load", (_event, code, description, url) => {
    reportSmokeFailure(`Desktop renderer failed to load (${code} ${description}): ${url}`);
  });
  mainWindow.on("close", (event) => {
    if (closeConfirmed) return;
    if (closePromptActive) { event.preventDefault(); return; }
    if (!documentDirty) return;
    event.preventDefault();
    closePromptActive = true;
    void confirmDiscard(nativeTr("quit")).then((confirmed) => {
      closePromptActive = false;
      if (!confirmed || !mainWindow) return;
      closeConfirmed = true;
      mainWindow.close();
    });
  });
  mainWindow.on("closed", () => { videoExport.cancel(); mainWindow = null; pendingScoreExports.clear(); pendingRasterDocuments.clear(); });
  const load = mainWindow.loadURL(`${APP_SCHEME}://renderer/index.html`);
  if (SMOKE_TEST) {
    await Promise.race([
      load,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Desktop smoke test timed out before the renderer finished loading.")), 15000)),
    ]);
  } else {
    void load.catch((error) => console.error("Desktop renderer failed to load.", error));
  }
  updateWindowTitle();
}

const libraryIpc = setupLibraryIpc({ ipcMain, dialog, shell, userData: app.getPath("userData"), window: () => mainWindow,
  assertTrustedSender, confirmDiscard, prepareOpen: prepareOpenedDocument, currentPath: () => currentDocumentPath,
  setPath: setCurrentDocumentPath, locale: () => desktopLocale.get(), relocateAudio: (original, next) => desktopAudio.relocate(original, next) });
const desktopAudio = setupDesktopAudio({ ipcMain, dialog, userData: app.getPath("userData"), window: () => mainWindow,
  locale: () => desktopLocale.get(), assertTrustedSender, currentPath: () => currentDocumentPath, library: libraryIpc });
const videoExport = setupVideoExport({ ipcMain, BrowserWindow, dialog, app, getWindow: () => mainWindow, assertTrustedSender, assetsRoot: desktopAssetsRoot, captureTiles: captureRasterTiles });
setupVideoCover({ ipcMain, Menu, dialog, assertTrustedSender, getWindow: () => mainWindow, hasDocument: () => documentActive, locale: () => desktopLocale.get() });
setupUserDataIpc({ app, ipcMain, shell, dialog, getWindow: () => mainWindow, assertTrustedSender,
  confirmDiscard: () => confirmDiscard(nativeTr("clearUserDataAction")), beforeRestart: () => { closeConfirmed = true; }, tr: nativeTr });
ipcMain.handle("mstruct:new", newDocument);
ipcMain.on("mstruct:set-locale", (event, locale) => {
  assertTrustedSender(event);
  if (desktopLocale.get() === locale) return;
  desktopLocale.set(locale);
  installApplicationMenu();
  updateWindowTitle();
});
ipcMain.handle("mstruct:open", openDocument);
ipcMain.handle("mstruct:open-recent", openRecentDocument);
ipcMain.handle("mstruct:accept-open", acceptOpenedDocument);
ipcMain.handle("mstruct:save", saveDocument);
ipcMain.handle("mstruct:export-prepare", prepareScoreExport);
ipcMain.handle("mstruct:export-complete", completeScoreExport);
ipcMain.on("mstruct:export-cancel", cancelScoreExport);
ipcMain.handle("mstructtime:list", loadTimelines);
ipcMain.handle("mstructtime:open", openTimeline);
ipcMain.handle("mstructtime:create", createTimeline);
ipcMain.handle("mstructtime:save", saveTimeline);
ipcMain.handle("mstructtime:save-as", saveTimelineAs);
ipcMain.handle("mstructtime:remove", removeTimeline);
let profileStore;
for (const [command, operation] of Object.entries({
  state: (store) => store.state(), get: (store, value) => store.get(value),
  put: (store, value) => store.put(value), configure: (store, value) => store.configure(value),
  fetch: (store, value) => store.fetch(value), index: (store, value) => store.saveIndex(value),
  import: async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: nativeTr("profile"), extensions: ["json"] }] });
    if (selected.canceled) return null;
    const bytes = await readFile(selected.filePaths[0]);
    if (bytes.length > MAX_PROFILE_BYTES) throw Error("Profile data exceeds size limit");
    return JSON.parse(bytes.toString("utf8"));
  },
})) ipcMain.handle(`mstruct-profile:${command}`, (event, value) => {
  assertTrustedSender(event);
  profileStore ??= createProfileStore(app.getPath("userData"));
  return operation(profileStore, value);
});
ipcMain.on("mstruct:set-dirty", (event, value) => {
  assertTrustedSender(event);
  documentDirty = Boolean(value);
  updateWindowTitle();
});

app.whenReady().then(async () => {
  await protocol.handle(APP_SCHEME, handleAppRequest);
  installApplicationMenu();
  await createMainWindow();
  if (SMOKE_TEST) app.exit(0);
}).catch((error) => {
  reportSmokeFailure(error);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
