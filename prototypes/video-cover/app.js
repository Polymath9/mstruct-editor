import { parseMstructDocument } from "../../src/core/mstruct-document.js";
import { createVideoCoverDialog } from "../../src/ui/video-cover-dialog.js";
import { coverFields, COVER_SIZES, loadCoverAssets } from "./cover.js";
import { copy } from "./copy.js";

const $ = id => document.getElementById(id);
const api = window.coverPrototype;
let locale = "zh";
let current = null;
const tr = key => copy[locale][key];
const cover = createVideoCoverDialog({
  getMetadata: () => current?.metadata,
  getLocale: () => locale,
  loadAssets: loadCoverAssets,
  copyImage: ({ dataUrl, ratio }) => api.copyImage(dataUrl, COVER_SIZES[ratio]),
  saveImage: value => api.saveImage(value),
  imageMenu: request => api.imageMenu(request),
  onImageAction: callback => api.onImageAction(callback),
});

function translate() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.title = tr("app");
  document.querySelectorAll("[data-text]").forEach(node => {
    if (!node.closest(".video-cover-dialog")) node.textContent = tr(node.dataset.text);
  });
  api.setLocale(locale);
  cover.refreshLocale();
}
function openCover() {
  if (!current) return;
  $("file-menu").open = false;
  cover.open();
}
function displaySong() {
  $("empty").hidden = Boolean(current);
  $("song").hidden = !current;
  for (const id of ["generate-menu", "folder-menu", "back-menu"]) $(id).hidden = !current;
  $("song-title").textContent = current?.metadata.songName || "";
  $("song-author").textContent = current ? coverFields(current.metadata).author : "";
  $("song-file").textContent = current?.name || "";
}

async function openSong(demo = false) {
  $("file-menu").open = false;
  try {
    const file = await api.openSong(demo);
    if (!file) return;
    const parsed = parseMstructDocument(file.source);
    if (!parsed.ok || parsed.legacy) throw new Error("invalid");
    current = { metadata: parsed.metadata, name: file.name };
    $("app-status").textContent = "";
    displaySong();
    openCover();
  } catch (error) { $("app-status").textContent = tr(error.message === "invalid" ? "invalid" : "loadError"); }
}


$("open").onclick = () => openSong();
$("open-menu").onclick = () => openSong();
$("demo").onclick = () => openSong(true);
$("generate").onclick = openCover;
$("generate-menu").onclick = openCover;
$("folder-menu").onclick = async () => { $("file-menu").open = false; try { await api.openFolder(); } catch { $("app-status").textContent = tr("loadError"); } };
$("back-menu").onclick = () => { cover.close(); current = null; api.closeSong(); $("file-menu").open = false; displaySong(); };
$("language").onclick = () => { locale = locale === "zh" ? "en" : "zh"; translate(); };
document.addEventListener("pointerdown", event => { if (!$("file-menu").contains(event.target)) $("file-menu").open = false; });
window.addEventListener("pagehide", () => cover.destroy());
translate();
displaySong();
