import assert from "node:assert/strict";
import test from "node:test";
import applicationUi from "../desktop/application-ui.cjs";
import applicationMenuModule from "../desktop/application-menu.cjs";

function fixture() {
  let active = false, hasPath = false, builds = 0, installed = 0, quit = 0;
  const handlers = new Map(), commands = [], roles = [], changes = [], locale = applicationUi.createDesktopLocale("zh");
  const contents = { send: (channel, model) => changes.push({ channel, model }), getZoomLevel: () => 1, setZoomLevel: level => roles.push(["zoom", level]) };
  for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) contents[role] = () => roles.push(role);
  const window = { webContents: contents, isDestroyed: () => false, setMenuBarVisibility: visible => roles.push(["nativeMenu", visible]), isFullScreen: () => false, setFullScreen: value => roles.push(["fullscreen", value]) };
  const controller = applicationMenuModule.createApplicationMenu({
    Menu: { buildFromTemplate(template) { builds++; return template; }, setApplicationMenu() { installed++; } },
    ipcMain: { handle: (channel, action) => handlers.set(channel, action) }, assertTrustedSender: event => { if (!event?.trusted) throw Error("Untrusted sender"); },
    getWindow: () => window, quit: () => quit++, createTemplate: () => applicationUi.applicationMenuTemplate({ tr: locale.tr, locale: locale.get(), hasDocument: active, hasDocumentPath: hasPath, openCurrentDirectory: () => commands.push("folder"), sendDocumentCommand: command => commands.push(command), showAbout: () => commands.push("about"), openTechnicalDocumentation: () => commands.push(applicationUi.TECHNICAL_DOCUMENTATION_URL) }),
  });
  return { controller, commands, roles, changes, handlers, locale, active(value, saved = false) { active = value; hasPath = saved; controller.refresh(); }, counts: () => ({ builds, installed, quit }) };
}
test("library settings remain available while document actions follow the open document", () => {
  const f = fixture(); f.controller.refresh();
  const menus = f.controller.snapshot().menus, file = menus.find(menu => menu.id === "file"), edit = menus.find(menu => menu.id === "edit");
  for (const id of ["new", "save", "save-as", "export"]) assert.equal(file.submenu.find(item => item.id === id).enabled, false, id);
  assert.ok(edit.submenu.filter(item => item.type !== "separator").every(item => !item.enabled));
  assert.equal(file.submenu.find(item => item.id === "open").enabled, true);
  const settings = menus.find(menu => menu.id === "settings");
  assert.deepEqual(settings.submenu.map(item => [item.id, item.enabled]), [["application-settings", true], ["editor-settings", true]]);
  for (const id of ["new", "save", "save-as", "export:pdf", "role:copy"]) assert.equal(f.controller.invoke(id), false);
  assert.equal(f.controller.invoke("editor-settings"), true);
  assert.deepEqual(f.commands.splice(0), ["editor-settings"]);
  f.active(true);
  for (const id of ["new", "save", "save-as", "export:pdf", "editor-settings"]) assert.equal(f.controller.invoke(id), true);
  assert.deepEqual(f.commands, ["new", "save", "save-as", "export:pdf", "editor-settings"]);
  assert.equal(f.controller.invoke("role:copy"), true); assert.ok(f.roles.includes("copy"));
  f.active(false); assert.equal(f.controller.invoke("save"), false); assert.equal(f.controller.invoke("role:copy"), false);
});
test("repeated unchanged menu refreshes do not rebuild native menus or emit state, and labels switch together", () => {
  const f = fixture(); f.controller.refresh();
  for (let i = 0; i < 100; i++) f.controller.refresh();
  assert.deepEqual(f.counts(), { builds: 1, installed: 1, quit: 0 }); assert.equal(f.changes.length, 1);
  f.locale.set("en"); f.controller.refresh();
  assert.deepEqual(f.controller.snapshot().menus.map(menu => menu.label), ["File", "Edit", "View", "Settings", "Help", "Language"]);
  const language = f.controller.snapshot().menus.at(-1);
  assert.equal(language.id, "language");
  assert.deepEqual(language.submenu.map(item => [item.label, item.type, item.checked]), [["中文", "radio", false], ["English", "radio", true]]);
  assert.equal(f.controller.invoke("set-locale:zh"), true);
  assert.deepEqual(f.commands, ["set-locale:zh"]);
  assert.equal(f.controller.snapshot().revision, 2); assert.equal(f.counts().builds, 2);
});

test("themed and native templates expose editing and view shortcuts, including while disabled", () => {
  const f = fixture(); f.controller.refresh();
  const shortcuts = () => new Map(f.controller.snapshot().menus.flatMap(menu => menu.submenu).map(item => [item.id, item.accelerator]));
  const expected = { "role:undo": "CmdOrCtrl+Z", "role:redo": "Ctrl+Y", "role:cut": "CmdOrCtrl+X", "role:copy": "CmdOrCtrl+C", "role:paste": "CmdOrCtrl+V", "role:selectAll": "CmdOrCtrl+A",
    "role:togglefullscreen": process.platform === "darwin" ? "Ctrl+Cmd+F" : "F11", "role:resetZoom": "CmdOrCtrl+0", "role:zoomIn": "CmdOrCtrl+Plus", "role:zoomOut": "CmdOrCtrl+-" };
  if (process.platform === "darwin") expected["role:redo"] = "Cmd+Shift+Z";
  for (const [id, shortcut] of Object.entries(expected)) assert.equal(shortcuts().get(id), shortcut, id);
  f.active(true); f.locale.set("en"); f.controller.refresh();
  for (const [id, shortcut] of Object.entries(expected)) assert.equal(shortcuts().get(id), shortcut, id);
});
test("macOS reserves a native application menu and keeps File and platform accelerators accessible", () => {
  const locale = applicationUi.createDesktopLocale("en");
  let installed;
  const template = applicationUi.applicationMenuTemplate({ tr: locale.tr, platform: "darwin" });
  const controller = applicationMenuModule.createApplicationMenu({ platform: "darwin",
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { installed = value; } },
    ipcMain: { handle() {} }, getWindow: () => null, createTemplate: () => template });
  controller.refresh();
  assert.equal(installed[0].label, "MStruct");
  assert.equal(installed[1].id, "file");
  assert.equal(controller.snapshot().menus[0].id, "file");
  const shortcuts = new Map(template.flatMap(menu => menu.submenu).map(item => [item.id, item.accelerator]));
  assert.equal(shortcuts.get("role:redo"), "Cmd+Shift+Z");
  assert.equal(shortcuts.get("role:togglefullscreen"), "Ctrl+Cmd+F");
  assert.equal(shortcuts.get("role:quit"), "Cmd+Q");
});
test("menu IPC accepts only trusted senders and known enabled actions; native editing and view roles remain bounded", () => {
  const f = fixture(); f.controller.refresh();
  const action = f.handlers.get("mstruct:menu-action"), state = f.handlers.get("mstruct:menu-state");
  assert.throws(() => action({}, "open"), /Untrusted/); assert.throws(() => state({}), /Untrusted/);
  assert.equal(action({ trusted: true }, "unknown-command"), false); assert.equal(action({ trusted: true }, { id: "open" }), false);
  assert.equal(action({ trusted: true }, "open"), true); assert.deepEqual(f.commands, ["open"]);
  assert.equal(action({ trusted: true }, "role:zoomIn"), true); assert.ok(f.roles.some(item => item[0] === "zoom" && item[1] === 1.5));
  assert.equal(action({ trusted: true }, "role:quit"), true); assert.equal(f.counts().quit, 1);
});

test("Return to Local Library appears only in an editor; documentation is available in either state and locale", () => {
  const f = fixture(); f.controller.refresh();
  const file = () => f.controller.snapshot().menus.find(menu => menu.id === "file").submenu;
  assert.ok(!file().some(item => item.id === "return-library")); assert.equal(f.controller.invoke("return-library"), false);
  for (const locale of ["zh", "en"]) {
    f.locale.set(locale); f.active(true);
    assert.equal(file().find(item => item.id === "return-library").label, locale === "zh" ? "返回本地曲库" : "Back to Local Library");
    assert.equal(f.controller.invoke("return-library"), true);
    const help = f.controller.snapshot().menus.find(menu => menu.id === "help").submenu;
    assert.equal(help[0].label, locale === "zh" ? "技术文档" : "Technical Documentation");
    assert.equal(f.controller.invoke("help:documentation"), true);
    f.active(false); assert.equal(f.controller.invoke("help:documentation"), true);
  }
  assert.equal(applicationUi.TECHNICAL_DOCUMENTATION_URL, "https://doi.org/10.5281/zenodo.23637500");
  assert.equal(f.commands.filter(command => command === "return-library").length, 2);
  assert.equal(f.commands.filter(command => command === applicationUi.TECHNICAL_DOCUMENTATION_URL).length, 4);
});

test("current folder is isolated above Return and disabled until saved", () => {
  const f = fixture(); f.controller.refresh();
  const file = () => f.controller.snapshot().menus.find(menu => menu.id === "file").submenu;
  assert.equal(f.controller.invoke("open-current-directory"), false);
  f.active(true); assert.equal(f.controller.invoke("open-current-directory"), false);
  for (const locale of ["zh", "en"]) {
    f.locale.set(locale); f.active(true, true);
    const items = file(), index = items.findIndex(item => item.id === "open-current-directory");
    assert.equal(items[index - 1].id, "video-cover");
    assert.equal(items[index - 2].type, "separator");
    assert.equal(items[index + 1].type, "separator");
    assert.equal(items[index + 2].id, "return-library");
    assert.equal(items[index].label, locale === "zh" ? "在浏览器中打开当前文件夹" : "Open Current Folder in File Explorer");
    assert.throws(() => f.handlers.get("mstruct:menu-action")({}, "open-current-directory"), /Untrusted/);
    assert.equal(f.controller.invoke("open-current-directory"), true);
  }
  assert.deepEqual(f.commands, ["folder", "folder"]);
  f.active(false); assert.equal(f.controller.invoke("open-current-directory"), false);
});

test("open folder resolves the native document path and reports native failures", async () => {
  const path = await import("node:path"), opened = [], errors = [];
  const args = { shell: { openPath: async value => { opened.push(value); return ""; } }, dialog: { showErrorBox: (...values) => errors.push(values) }, tr: applicationUi.createDesktopLocale("en").tr };
  await applicationUi.openCurrentDocumentDirectory({ ...args, filePath: null });
  const filePath = path.resolve("test library", "Analysis.mstruct");
  await applicationUi.openCurrentDocumentDirectory({ ...args, filePath });
  assert.deepEqual(opened, [path.dirname(filePath)]);
  args.shell.openPath = async () => "Folder unavailable";
  await applicationUi.openCurrentDocumentDirectory({ ...args, filePath });
  args.shell.openPath = async () => { throw Error("Access denied"); };
  await applicationUi.openCurrentDocumentDirectory({ ...args, filePath });
  assert.deepEqual(errors, [["Could Not Open Current Folder", "Folder unavailable"], ["Could Not Open Current Folder", "Access denied"]]);
});
