const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mstructDesktop", Object.freeze({
  kind: "mstruct-desktop",
  openUserData: () => ipcRenderer.invoke("mstruct-user-data:open"),
  clearUserData: () => ipcRenderer.invoke("mstruct-user-data:clear"),
  completeTransitionSave: (result) => ipcRenderer.invoke("mstruct:complete-transition-save", result),
  onSaveBeforeTransition: (callback) => {
    const listener = (_event, token) => { void callback(token); };
    ipcRenderer.on("mstruct:save-before-transition", listener);
    return () => ipcRenderer.removeListener("mstruct:save-before-transition", listener);
  },
  pianoInstrumentUrl: "mstruct-app://renderer/__desktop_assets__/soundfonts/acoustic_grand_piano-ogg.js",
  videoCoverFontUrl: "mstruct-app://renderer/__desktop_assets__/fonts/NotoSansCJKsc-VF.otf",
  copyVideoCover: (value) => ipcRenderer.invoke("mstruct-cover:copy", value),
  saveVideoCover: (value) => ipcRenderer.invoke("mstruct-cover:save", value),
  showVideoCoverMenu: (value) => ipcRenderer.invoke("mstruct-cover:menu", value),
  onVideoCoverAction: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("mstruct-cover:image-action", listener);
    return () => ipcRenderer.removeListener("mstruct-cover:image-action", listener);
  },
  newDocument: () => ipcRenderer.invoke("mstruct:new"),
  openDocument: () => ipcRenderer.invoke("mstruct:open"),
  openRecentDocument: (id) => ipcRenderer.invoke("mstruct:open-recent", id),
  acceptOpenedDocument: (token) => ipcRenderer.invoke("mstruct:accept-open", token),
  saveDocument: (payload) => ipcRenderer.invoke("mstruct:save", payload),
  libraryState: () => ipcRenderer.invoke("mstruct-library:state"),
  libraryChoose: () => ipcRenderer.invoke("mstruct-library:choose"),
  libraryLeave: () => ipcRenderer.invoke("mstruct-library:leave"),
  libraryScan: () => ipcRenderer.invoke("mstruct-library:scan"),
  libraryRules: () => ipcRenderer.invoke("mstruct-library:rules"),
  libraryMigrate: (value) => ipcRenderer.invoke("mstruct-library:migrate", value),
  libraryExtracted: () => ipcRenderer.invoke("mstruct-library:extracted"),
  libraryAdopt: (token) => ipcRenderer.invoke("mstruct-library:adopt", token),
  libraryCache: (value) => ipcRenderer.invoke("mstruct-library:cache", value),
  libraryOpen: (value) => ipcRenderer.invoke("mstruct-library:open", value),
  libraryFolder: (value) => ipcRenderer.invoke("mstruct-library:folder", value),
  libraryCreate: (value) => ipcRenderer.invoke("mstruct-library:create", value),
  libraryRename: (value) => ipcRenderer.invoke("mstruct-library:rename", value),
  libraryTrash: (value) => ipcRenderer.invoke("mstruct-library:trash", value),
  libraryPrepare: () => ipcRenderer.invoke("mstruct-library:prepare"),
  libraryPlan: (token) => ipcRenderer.invoke("mstruct-library:plan", token),
  libraryApply: (value) => ipcRenderer.invoke("mstruct-library:apply", value),
  libraryCancel: () => ipcRenderer.invoke("mstruct-library:cancel"),
  audioFind: (value) => ipcRenderer.invoke("mstruct-audio:find", value),
  audioChoose: (value) => ipcRenderer.invoke("mstruct-audio:choose", value),
  profileState: () => ipcRenderer.invoke("mstruct-profile:state"),
  profileGet: (identity) => ipcRenderer.invoke("mstruct-profile:get", identity),
  profilePut: (bundle) => ipcRenderer.invoke("mstruct-profile:put", bundle),
  profileConfigure: (url) => ipcRenderer.invoke("mstruct-profile:configure", url),
  profileFetch: (identity) => ipcRenderer.invoke("mstruct-profile:fetch", identity),
  profileSaveIndex: (index) => ipcRenderer.invoke("mstruct-profile:index", index),
  profileImport: () => ipcRenderer.invoke("mstruct-profile:import"),
  prepareScoreExport: (payload) => ipcRenderer.invoke("mstruct:export-prepare", payload),
  completeScoreExport: (payload) => ipcRenderer.invoke("mstruct:export-complete", payload),
  cancelScoreExport: (token) => ipcRenderer.send("mstruct:export-cancel", token),
  startVideoExport: (value) => ipcRenderer.invoke("mstruct-video:start", value),
  cancelVideoExport: () => ipcRenderer.invoke("mstruct-video:cancel"),
  onVideoProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("mstruct-video:progress", listener);
    return () => ipcRenderer.removeListener("mstruct-video:progress", listener);
  },
  loadTimelines: (fileNames) => ipcRenderer.invoke("mstructtime:list", fileNames),
  openTimeline: () => ipcRenderer.invoke("mstructtime:open"),
  createTimeline: (payload) => ipcRenderer.invoke("mstructtime:create", payload),
  saveTimeline: (payload) => ipcRenderer.invoke("mstructtime:save", payload),
  saveTimelineAs: (payload) => ipcRenderer.invoke("mstructtime:save-as", payload),
  removeTimeline: (payload) => ipcRenderer.invoke("mstructtime:remove", payload),
  setDirty: (dirty) => ipcRenderer.send("mstruct:set-dirty", Boolean(dirty)),
  setLocale: (locale) => ipcRenderer.send("mstruct:set-locale", locale === "en" ? "en" : "zh"),
  menuState: () => ipcRenderer.invoke("mstruct:menu-state"),
  menuAction: (id) => ipcRenderer.invoke("mstruct:menu-action", id),
  onMenuChanged: (callback) => {
    const listener = (_event, model) => callback(model);
    ipcRenderer.on("mstruct:menu-changed", listener);
    return () => ipcRenderer.removeListener("mstruct:menu-changed", listener);
  },
  onCommand: (callback) => {
    if (typeof callback !== "function") return;
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("mstruct:command", listener);
    return () => ipcRenderer.removeListener("mstruct:command", listener);
  },
}));
