const TECHNICAL_DOCUMENTATION_URL = "https://doi.org/10.5281/zenodo.23637500";
const copy = {
  zh: {
    title: "分析编辑器", file: "文件", new: "新建", open: "打开…", save: "保存", saveAs: "另存为…", export: "导出", quit: "退出",
    recent: "最近编辑的文件", noRecent: "暂无最近文件", clearRecent: "清空最近文件记录",
    openCurrentDirectory: "在浏览器中打开当前文件夹", openDirectoryFailed: "无法打开当前文件夹",
    videoCover: "生成视频封面…",
    language: "语言",
    returnLibrary: "返回本地曲库", technicalDocumentation: "技术文档",
    recentUnavailable: "无法打开最近文件", recentUnavailableDetail: "无法读取“{name}”。文件可能已被移动、删除或无法访问。",
    recentStorage: "无法保存最近文件记录", recentStorageDetail: "请确认本机用户数据目录可写。当前文档的打开或保存结果不受影响。",
    edit: "编辑", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选",
    view: "视图", fullscreen: "切换全屏", resetZoom: "实际大小", zoomIn: "放大", zoomOut: "缩小",
    settings: "设置", applicationSettings: "软件设置", editorSettings: "编辑器设置", help: "帮助", licenses: "第三方许可", about: "关于分析编辑器", ok: "确定", cancel: "取消",
    aboutDetail: "MStruct 独立分析编辑器", unsaved: "尚未保存", unsavedMessage: "当前文档含有尚未保存的改动。",
    unsavedDetail: "是否保存这些改动并继续{action}？", saveAction: "保存并{action}", discardAction: "不保存并{action}", newAction: "新建文档", openAction: "打开其他文档",
    document: "MStruct 文档", timeline: "MStructTime 文档", text: "文本文件", profile: "MStruct 规则包",
    openDocument: "打开 MStruct 文档", saveDocument: "保存 MStruct 文档", saveDocumentAs: "另存 MStruct 文档",
    openTimeline: "打开 MStructTime 文档", saveTimelineAs: "另存 MStructTime 文档",
    invalidDocument: "所选文件不是有效的小型 MStruct 文档。", staleOpen: "打开文档凭据已经失效。", invalidSave: "待保存内容不是有效的小型 MStruct 文档。",
    invalidTimelineName: "时间轴文件名无效。", parentRequired: "请先保存或打开关联的 MStruct 文档。",
    sameDirectory: "MStructTime 文件必须与关联的 MStruct 文档位于同一文件夹。", invalidTimeline: "所选文件不是有效的小型 MStructTime 文档。", invalidTimelineSave: "待保存内容不是有效的小型 MStructTime 文档。",
    storageTitle: "无法读取用户数据", storageMessage: "请确认本机用户数据目录可写，并关闭其他运行中的实例后重试。",
    clearUserDataAction: "清除用户数据并重启", clearUserDataTitle: "清除用户数据并重启？", clearUserDataRestart: "清除并重启",
    clearUserDataDetail: "将恢复配色、语言、渲染器偏好、曲库位置、最近文件及外部音频关联等设置，并清除规则缓存。曲库中的谱面、时间轴、音频及同步记录会保留。此操作无法撤销。",
  },
  en: {
    title: "Analysis Editor", file: "File", new: "New", open: "Open…", save: "Save", saveAs: "Save As…", export: "Export", quit: "Quit",
    recent: "Recent Files", noRecent: "No Recent Files", clearRecent: "Clear Recent Files",
    openCurrentDirectory: "Open Current Folder in File Explorer", openDirectoryFailed: "Could Not Open Current Folder",
    videoCover: "Generate Video Cover…",
    language: "Language",
    returnLibrary: "Back to Local Library", technicalDocumentation: "Technical Documentation",
    recentUnavailable: "Recent File Unavailable", recentUnavailableDetail: "Could not read “{name}”. The file may have been moved, deleted, or become inaccessible.",
    recentStorage: "Could Not Save Recent Files", recentStorageDetail: "Check that the local user data folder is writable. The document was still opened or saved successfully.",
    edit: "Edit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All",
    view: "View", fullscreen: "Toggle Full Screen", resetZoom: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out",
    settings: "Settings", applicationSettings: "Application Settings", editorSettings: "Editor Settings", help: "Help", licenses: "Third-party Licenses", about: "About Analysis Editor", ok: "OK", cancel: "Cancel",
    aboutDetail: "MStruct standalone analysis editor", unsaved: "Unsaved Changes", unsavedMessage: "The current document has unsaved changes.",
    unsavedDetail: "Save these changes before continuing to {action}?", saveAction: "Save and {action}", discardAction: "Discard and {action}", newAction: "create a document", openAction: "open another document",
    document: "MStruct Document", timeline: "MStructTime Document", text: "Text Files", profile: "MStruct Rule Bundle",
    openDocument: "Open MStruct Document", saveDocument: "Save MStruct Document", saveDocumentAs: "Save MStruct Document As",
    openTimeline: "Open MStructTime Document", saveTimelineAs: "Save MStructTime Document As",
    invalidDocument: "The selected file is not a valid small MStruct document.", staleOpen: "The open-document token has expired.", invalidSave: "The content is not a valid small MStruct document.",
    invalidTimelineName: "Invalid timeline file name.", parentRequired: "Save or open the associated MStruct document first.",
    sameDirectory: "MStructTime files must be in the same folder as their associated MStruct document.", invalidTimeline: "The selected file is not a valid small MStructTime document.", invalidTimelineSave: "The content is not a valid small MStructTime document.",
    storageTitle: "User Data Unavailable", storageMessage: "Check that the local user data folder is writable, and close other running instances before retrying.",
    clearUserDataAction: "clear user data and restart", clearUserDataTitle: "Clear user data and restart?", clearUserDataRestart: "Clear and restart",
    clearUserDataDetail: "This resets colors, language, renderer preferences, library location, recent files and external audio associations, and clears cached rules. Scores, timelines, audio and sync records in your library are kept. This cannot be undone.",
  },
};

function createDesktopLocale(initial = "zh") {
  let locale = initial === "en" ? "en" : "zh";
  return {
    get() { return locale; },
    set(value) { locale = value === "en" ? "en" : "zh"; },
    tr(key, values = {}) { return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), copy[locale][key] ?? key); },
  };
}

async function openCurrentDocumentDirectory({ filePath, shell, dialog, tr }) {
  if (!filePath) return;
  try {
    const error = await shell.openPath(require("node:path").dirname(filePath));
    if (error) throw new Error(error);
  } catch (error) {
    dialog.showErrorBox(tr("openDirectoryFailed"), String(error.message || error));
  }
}

function applicationMenuTemplate({ tr, locale = "zh", sendDocumentCommand, showThirdPartyNotices, showAbout, openTechnicalDocumentation, openCurrentDirectory, recentDocuments = [], clearRecentDocuments, hasDocument = false, hasDocumentPath = false, platform = process.platform }) {
  const command = (key, action, accelerator, enabled = true) => ({ id: action, label: tr(key), enabled, ...(accelerator ? { accelerator } : {}), click: () => sendDocumentCommand(action) });
  // Native shortcuts also travel with the themed menu model.
  const accelerators = { undo: "CmdOrCtrl+Z", redo: platform === "darwin" ? "Cmd+Shift+Z" : "Ctrl+Y", cut: "CmdOrCtrl+X", copy: "CmdOrCtrl+C", paste: "CmdOrCtrl+V", selectAll: "CmdOrCtrl+A",
    togglefullscreen: platform === "darwin" ? "Ctrl+Cmd+F" : "F11", ...(platform === "darwin" ? { quit: "Cmd+Q" } : {}), resetZoom: "CmdOrCtrl+0", zoomIn: "CmdOrCtrl+Plus", zoomOut: "CmdOrCtrl+-" };
  const role = (key, value = key, enabled = true) => ({ id: `role:${value}`, label: tr(key), role: value, enabled, ...(accelerators[value] ? { accelerator: accelerators[value] } : {}) });
  const separator = () => ({ type: "separator" });
  const recent = {
    id: "recent", label: tr("recent"),
    submenu: recentDocuments.length ? [
      ...recentDocuments.map(item => ({
        id: `open-recent:${item.id}`, label: `${item.name} — ${item.directory}`.replaceAll("&", "&&"),
        click: () => sendDocumentCommand(`open-recent:${item.id}`),
      })),
      separator(), { id: "recent:clear", label: tr("clearRecent"), click: clearRecentDocuments },
    ] : [{ label: tr("noRecent"), enabled: false }],
  };
  return [
    { id: "file", label: tr("file"), submenu: [command("new", "new", "CmdOrCtrl+N", hasDocument), separator(), command("open", "open", "CmdOrCtrl+O"), recent, command("save", "save", "CmdOrCtrl+S", hasDocument), command("saveAs", "save-as", "CmdOrCtrl+Shift+S", hasDocument), separator(),
      { id: "export", label: tr("export"), enabled: hasDocument, submenu: ["pdf", "svg", "png", "jpg", "mp4"].map(format => ({ id: `export:${format}`, enabled: hasDocument, label: `${format.toUpperCase()}…`, click: () => sendDocumentCommand(`export:${format}`) })) }, separator(),
      ...(hasDocument ? [command("videoCover", "video-cover"), { id: "open-current-directory", label: tr("openCurrentDirectory"), enabled: hasDocumentPath, click: openCurrentDirectory }, separator(), command("returnLibrary", "return-library"), separator()] : []), role("quit")] },
    { id: "edit", label: tr("edit"), submenu: [role("undo", "undo", hasDocument), role("redo", "redo", hasDocument), separator(), role("cut", "cut", hasDocument), role("copy", "copy", hasDocument), role("paste", "paste", hasDocument), role("selectAll", "selectAll", hasDocument)] },
    { id: "view", label: tr("view"), submenu: [role("fullscreen", "togglefullscreen"), separator(), role("resetZoom"), role("zoomIn"), role("zoomOut")] },
    { id: "settings", label: tr("settings"), submenu: [command("applicationSettings", "application-settings"), command("editorSettings", "editor-settings")] },
    { id: "help", label: tr("help"), submenu: [{ id: "help:documentation", label: tr("technicalDocumentation"), click: openTechnicalDocumentation }, separator(), { id: "help:licenses", label: tr("licenses"), click: showThirdPartyNotices }, separator(), { id: "help:about", label: tr("about"), click: showAbout }] },
    { id: "language", label: tr("language"), submenu: [
      { id: "set-locale:zh", label: "中文", type: "radio", checked: locale === "zh", click: () => sendDocumentCommand("set-locale:zh") },
      { id: "set-locale:en", label: "English", type: "radio", checked: locale === "en", click: () => sendDocumentCommand("set-locale:en") },
    ] },
  ];
}

module.exports = { createDesktopLocale, applicationMenuTemplate, openCurrentDocumentDirectory, TECHNICAL_DOCUMENTATION_URL };
