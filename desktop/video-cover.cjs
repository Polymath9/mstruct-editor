const { clipboard, ClipboardItem, nativeImage } = require("electron");
const { writeFile } = require("node:fs/promises");

const SIZES = Object.freeze({ "16:9": [1920, 1080], "4:3": [1440, 1080] });

function decodeCover({ dataUrl, ratio } = {}) {
  const size = Object.hasOwn(SIZES, ratio) && SIZES[ratio];
  if (!size || typeof dataUrl !== "string" || dataUrl.length > 16 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) {
    throw new Error("invalid-cover-image");
  }
  const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  // Bound dimensions before the native decoder allocates the pixel buffer.
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== size[0] || bytes.readUInt32BE(20) !== size[1]) {
    throw new Error("invalid-cover-size");
  }
  const image = nativeImage.createFromBuffer(bytes);
  const actual = image.getSize();
  if (image.isEmpty() || actual.width !== size[0] || actual.height !== size[1]) throw new Error("invalid-cover-size");
  return image.toPNG();
}

function setupVideoCover({ ipcMain, Menu, dialog, assertTrustedSender, getWindow, hasDocument, locale }) {
  let saving = false;
  function requireSong(event) {
    assertTrustedSender(event);
    const window = getWindow();
    if (event.senderFrame !== window.webContents.mainFrame) throw new Error("untrusted-cover-sender");
    if (!hasDocument()) throw new Error("song-required");
    return window;
  }
  ipcMain.handle("mstruct-cover:copy", async (event, value) => {
    requireSong(event);
    const png = decodeCover(value);
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
    return true;
  });
  ipcMain.handle("mstruct-cover:save", async (event, value) => {
    const window = requireSong(event);
    if (saving) throw new Error("cover-save-in-progress");
    const png = decodeCover(value);
    const title = Array.from(String(value.title || "MStruct"))
      .slice(0, 100).join("").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || "MStruct";
    saving = true;
    try {
      const result = await dialog.showSaveDialog(window, {
        title: locale() === "en" ? "Save Image" : "保存图片",
        defaultPath: `${title} - ${value.ratio.replace(":", "x")}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      await writeFile(result.filePath, png);
      return { cancelled: false };
    } finally {
      saving = false;
    }
  });
  ipcMain.handle("mstruct-cover:menu", (event, request = {}) => {
    const window = requireSong(event);
    const { ratio, revision } = request;
    if (!Object.hasOwn(SIZES, ratio) || !Number.isSafeInteger(revision) || revision < 0) throw new Error("invalid-cover-menu");
    const items = [
      { action: "copy", label: locale() === "en" ? "Copy Image" : "复制图片" },
      { action: "save", label: locale() === "en" ? "Save Image" : "保存图片", enabled: !saving },
    ];
    Menu.buildFromTemplate(items.map(({ action, label, enabled }) => ({
      label, enabled,
      click: () => {
        if (!window.isDestroyed() && hasDocument()) window.webContents.send("mstruct-cover:image-action", { action, ratio, revision });
      },
    }))).popup({ window });
  });
}

module.exports = { setupVideoCover };
