const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, shell } = require("electron");
const fs = require("node:fs/promises");
const { setupVideoCover } = require("../../desktop/video-cover.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Separate user data/session and no dependency on the production desktop entry.
app.setPath("userData", path.resolve(__dirname, "../../.test-tmp/video-cover-prototype"));
const pageUrl = pathToFileURL(path.join(__dirname, "index.html")).href;
let window;
let currentPath = null;
let locale = "zh";

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error("untrusted-sender");
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1380, height: 920, minWidth: 930, minHeight: 680,
    title: "MStruct · Video Cover Prototype", backgroundColor: "#f5f6f8",
    show: !process.argv.includes("--smoke"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: !process.argv.includes("--smoke") },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle("cover:locale", (event, value) => { trusted(event); locale = value === "en" ? "en" : "zh"; });
  ipcMain.handle("cover:open", async (event, demo) => {
    trusted(event);
    let selected;
    if (demo === true) selected = path.resolve(__dirname, "../../examples/k545.mstruct");
    else {
      const result = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: "MStruct", extensions: ["mstruct"] }] });
      if (result.canceled) return null;
      selected = result.filePaths[0];
    }
    if (path.extname(selected).toLowerCase() !== ".mstruct" || (await fs.stat(selected)).size > 8 * 1024 * 1024) throw new Error("invalid-document");
    const source = await fs.readFile(selected, "utf8");
    const { parseMstructDocument } = await import("../../src/core/mstruct-document.js");
    const parsed = parseMstructDocument(source);
    if (!parsed.ok || parsed.legacy) throw new Error("invalid-document");
    currentPath = selected;
    return { name: path.basename(selected), source };
  });
  ipcMain.handle("cover:close", event => { trusted(event); currentPath = null; });
  ipcMain.handle("cover:folder", async event => {
    trusted(event);
    if (!currentPath) throw new Error("song-required");
    const error = await shell.openPath(path.dirname(currentPath));
    if (error) throw new Error(error);
  });
  setupVideoCover({
    ipcMain, Menu, dialog, assertTrustedSender: trusted,
    getWindow: () => window, hasDocument: () => Boolean(currentPath), locale: () => locale,
  });
  await window.loadFile(path.join(__dirname, "index.html"));
  if (!process.argv.includes("--smoke")) window.show();
  if (process.argv.includes("--smoke")) {
    try {
      await require("./smoke.cjs").runSmoke({ window, clipboard, fs, path, directory: __dirname });
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  }
});
app.on("window-all-closed", () => app.quit());
