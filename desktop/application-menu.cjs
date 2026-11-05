/** Native accelerators and trusted actions share one template with the themed menu bar. */
function createApplicationMenu({ Menu, ipcMain, assertTrustedSender, getWindow, createTemplate, quit, platform = process.platform }) {
  let model = [], actions = new Map(), fingerprint = "", revision = 0;
  const snapshot = () => ({ revision, menus: model });
  function refresh() {
    const template = createTemplate(), nextActions = new Map();
    function serialize(items, parentEnabled = true) {
      return items.map(item => {
        if (item.type === "separator") return { type: "separator" };
        const enabled = parentEnabled && item.enabled !== false;
        if (!item.submenu && item.id) nextActions.set(item.id, { ...item, enabled });
        return { id: item.id, label: item.label.replaceAll("&&", "&"), enabled, accelerator: item.accelerator ?? "",
          ...(item.type === "radio" ? { type: "radio", checked: item.checked === true } : {}),
          ...(item.submenu ? { submenu: serialize(item.submenu, enabled) } : {}) };
      });
    }
    const next = serialize(template), signature = JSON.stringify(next);
    if (signature === fingerprint) return;
    fingerprint = signature; model = next; actions = nextActions; revision++;
    // macOS reserves the first native menu for the application. Keep File intact.
    const nativeTemplate = platform === "darwin" ? [{ label: "MStruct", submenu: [
      { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" },
      { role: "unhide" }, { type: "separator" }, { role: "quit" },
    ] }, ...template] : template;
    Menu.setApplicationMenu(Menu.buildFromTemplate(nativeTemplate));
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.setMenuBarVisibility(false);
      window.webContents.send("mstruct:menu-changed", snapshot());
    }
  }
  function invoke(id) {
    const item = actions.get(id), window = getWindow();
    if (!item?.enabled || !window || window.isDestroyed()) return false;
    if (item.role) {
      const contents = window.webContents;
      switch (item.role) {
        case "undo": case "redo": case "cut": case "copy": case "paste": case "selectAll": contents[item.role](); break;
        case "togglefullscreen": window.setFullScreen(!window.isFullScreen()); break;
        case "resetZoom": contents.setZoomLevel(0); break;
        case "zoomIn": contents.setZoomLevel(contents.getZoomLevel() + .5); break;
        case "zoomOut": contents.setZoomLevel(contents.getZoomLevel() - .5); break;
        case "quit": quit(); break;
        default: return false;
      }
    } else item.click?.();
    return true;
  }
  ipcMain.handle("mstruct:menu-state", event => { assertTrustedSender(event); return snapshot(); });
  ipcMain.handle("mstruct:menu-action", (event, id) => { assertTrustedSender(event); return typeof id === "string" && invoke(id); });
  return { refresh, invoke, snapshot };
}
module.exports = { createApplicationMenu };
