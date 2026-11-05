const { contextBridge, ipcRenderer } = require("electron");
function coverRatio(dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length !== 2 || dimensions[1] !== 1080) return null;
  if (dimensions[0] === 1920) return "16:9";
  if (dimensions[0] === 1440) return "4:3";
  return null;
}
contextBridge.exposeInMainWorld("coverPrototype", {
  setLocale: value => ipcRenderer.invoke("cover:locale", value),
  openSong: demo => ipcRenderer.invoke("cover:open", demo === true),
  closeSong: () => ipcRenderer.invoke("cover:close"),
  openFolder: () => ipcRenderer.invoke("cover:folder"),
  copyImage: (dataUrl, dimensions) => ipcRenderer.invoke("mstruct-cover:copy", { dataUrl, ratio: coverRatio(dimensions) }),
  saveImage: value => ipcRenderer.invoke("mstruct-cover:save", value),
  imageMenu: request => ipcRenderer.invoke("mstruct-cover:menu", request),
  onImageAction: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("mstruct-cover:image-action", listener);
    return () => ipcRenderer.removeListener("mstruct-cover:image-action", listener);
  },
});
