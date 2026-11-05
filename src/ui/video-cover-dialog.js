import { TITLE_FONT_SIZE, AUTHOR_FONT_SIZE, coverFields, renderCover } from "./video-cover-renderer.js";
import { copy } from "./video-cover-copy.js";

// Platform capabilities are injected; this UI never imports Electron or reads files.
export function createVideoCoverDialog({ getMetadata, getLocale, loadAssets, copyImage: writeImage, saveImage: writeFile, imageMenu, onImageAction }) {
  const host = document.createElement("template");
  host.innerHTML = `<dialog id="cover-dialog" class="video-cover-dialog" aria-labelledby="cover-dialog-heading">
    <div class="dialog-heading"><div><h2 id="cover-dialog-heading" data-text="dialogTitle"></h2><p data-text="dialogHint"></p></div><button id="cover-close" class="close" aria-label="关闭 / Close">×</button></div>
    <div class="dialog-body"><aside>
      <label for="cover-title" data-text="title"></label><textarea id="cover-title" maxlength="240" rows="3" spellcheck="false"></textarea><small data-text="titleHint"></small>
      <label for="title-size" data-text="titleSize"></label>
      <div class="font-size-control"><input id="title-size-range" type="range" aria-label="标题字号 / Title size"><input id="title-size" type="number" inputmode="numeric" aria-describedby="title-size-hint"><span>px</span></div>
      <small id="title-size-hint" data-text="titleSizeHint"></small>
      <label for="cover-author" data-text="author"></label><textarea id="cover-author" maxlength="240" rows="2" spellcheck="false"></textarea><small data-text="authorHint"></small>
      <label for="author-size" data-text="authorSize"></label>
      <div class="font-size-control"><input id="author-size-range" type="range" aria-label="作者字号 / Author size"><input id="author-size" type="number" inputmode="numeric" aria-describedby="author-size-hint"><span>px</span></div>
      <small id="author-size-hint" data-text="authorSizeHint"></small>
      <button id="cover-reset" data-text="reset"></button><p class="note" data-text="readonly"></p>
    </aside><section class="previews" aria-label="封面预览 / Cover previews">
      <figure><figcaption><strong>16:9</strong><span>1920 × 1080</span></figcaption><img id="cover-wide" alt="16:9 封面 / Cover" tabindex="0"><p id="layout-wide" class="layout-info" aria-live="polite"></p><div class="image-actions"><button id="copy-wide" data-text="copy" disabled></button><button id="save-wide" data-text="save" disabled></button></div></figure>
      <figure><figcaption><strong>4:3</strong><span>1440 × 1080</span></figcaption><img id="cover-standard" alt="4:3 封面 / Cover" tabindex="0"><p id="layout-standard" class="layout-info" aria-live="polite"></p><div class="image-actions"><button id="copy-standard" data-text="copy" disabled></button><button id="save-standard" data-text="save" disabled></button></div></figure>
    </section></div>
    <div class="dialog-footer"><div><p data-text="imageHint"></p><output id="cover-status" role="status" aria-live="polite"></output></div><button id="cover-done" class="primary" data-text="close"></button></div>
  </dialog>`;
  const dialog = host.content.firstElementChild;
  document.body.append(dialog);
  const $ = id => dialog.querySelector(`#${id}`);
  let assetsPromise;
  let revision = 0;
  let timer;
  let destroyed = false;
  let saving = false;
  let locale = "zh";
  const images = [
    ["16:9", $("cover-wide"), $("copy-wide"), $("layout-wide"), $("save-wide")],
    ["4:3", $("cover-standard"), $("copy-standard"), $("layout-standard"), $("save-standard")],
  ];
  const tr = key => copy[locale][key];

  function translate() {
    locale = getLocale() === "en" ? "en" : "zh";
    dialog.lang = locale === "zh" ? "zh-CN" : "en";
    dialog.querySelectorAll("[data-text]").forEach(node => { node.textContent = tr(node.dataset.text); });
  }

  function status(key, failed = false) {
    $("cover-status").textContent = tr(key);
    $("cover-status").classList.toggle("error", failed);
  }

  function invalidateImages() {
    revision++;
    for (const [, image, button, details, saveButton] of images) {
      image.removeAttribute("src");
      delete image.dataset.titleSize;
      delete image.dataset.titleLines;
      delete image.dataset.authorSize;
      button.disabled = true;
      saveButton.disabled = true;
      details.textContent = "";
      details.classList.remove("error");
    }
  }

  async function updatePreviews() {
    clearTimeout(timer);
    invalidateImages();
    const version = revision;
    const fields = {
      title: $("cover-title").value.trim(),
      author: $("cover-author").value.trim(),
      titleSize: $("title-size").valueAsNumber,
      authorSize: $("author-size").valueAsNumber,
    };
    if (!fields.title) { status("required", true); return; }
    if (!$("title-size").checkValidity() || !Number.isInteger(fields.titleSize) || !$("author-size").checkValidity() || !Number.isInteger(fields.authorSize)) {
      status("sizeInvalid", true);
      return;
    }
    status("loading");
    let assets;
    try {
      assetsPromise ||= loadAssets().catch(error => { assetsPromise = null; throw error; });
      assets = await assetsPromise;
    } catch { if (version === revision) status("fontError", true); return; }
    if (version !== revision || !dialog.open) return;
    let failed = false;
    for (const [ratio, image, button, details, saveButton] of images) {
      try {
        const canvas = document.createElement("canvas");
        const layout = renderCover(canvas, { ...fields, ratio }, assets);
        image.src = canvas.toDataURL("image/png");
        image.dataset.titleSize = String(layout.title.size);
        image.dataset.titleLines = String(layout.title.lines.length);
        image.dataset.authorSize = String(layout.author.size);
        details.textContent = tr("layoutDetails")
          .replace("{size}", layout.title.size)
          .replace("{lines}", layout.title.lines.length)
          .replace("{authorSize}", layout.author.size)
          .replace("{authorLines}", layout.author.lines.length);
        button.disabled = false;
        saveButton.disabled = saving;
      } catch (error) {
        failed = true;
        details.textContent = tr(error instanceof RangeError ? "sizeOverflow" : "error");
        details.classList.add("error");
      }
    }
    status(failed ? "adjustSize" : "ready", failed);
  }


  function restore() {
    const fields = coverFields(getMetadata());
    $("cover-title").value = fields.title;
    $("cover-author").value = fields.author;
    void updatePreviews();
  }

  async function copyImage(image, ratio) {
    if (!dialog.open || !image.hasAttribute("src")) return;
    const version = revision;
    try {
      await writeImage({ dataUrl: image.src, ratio });
      if (version === revision) status("copied");
    } catch { if (version === revision) status("copyError", true); }
  }

  async function saveImage(image, ratio) {
    if (saving || !dialog.open || !image.hasAttribute("src")) return;
    const version = revision;
    const payload = { dataUrl: image.src, ratio, title: $("cover-title").value.trim() };
    saving = true;
    for (const entry of images) entry[4].disabled = true;
    status("saving");
    try {
      const result = await writeFile(payload);
      if (version === revision) status(result.cancelled ? "ready" : "saved");
    } catch {
      if (version === revision) status("saveError", true);
    } finally {
      saving = false;
      for (const [, preview, , , saveButton] of images) saveButton.disabled = !preview.hasAttribute("src");
    }
  }

  for (const [ratio, image, button, , saveButton] of images) {
    button.addEventListener("click", () => void copyImage(image, ratio));
    saveButton.addEventListener("click", () => void saveImage(image, ratio));
    image.addEventListener("contextmenu", event => {
      event.preventDefault();
      if (image.hasAttribute("src")) {
        const version = revision;
        Promise.resolve(imageMenu({ ratio, revision: version })).catch(() => {
          if (version === revision) status("copyError", true);
        });
      }
    });
    image.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyImage(image, ratio);
      }
    });
  }
  const unsubscribe = onImageAction(({ action, ratio, revision: version }) => {
    const entry = images.find(item => item[0] === ratio);
    if (!entry || version !== revision) return;
    if (action === "copy") void copyImage(entry[1], ratio);
    if (action === "save") void saveImage(entry[1], ratio);
  });
  $("cover-reset").onclick = restore;
  for (const id of ["cover-done", "cover-close"]) $(id).onclick = () => dialog.close();
  dialog.addEventListener("close", () => { clearTimeout(timer); invalidateImages(); });
  dialog.addEventListener("keydown", event => event.stopPropagation());
  function schedulePreview() {
    clearTimeout(timer);
    invalidateImages();
    status("loading");
    timer = setTimeout(updatePreviews, 120);
  }
  for (const id of ["cover-title", "cover-author"]) $(id).addEventListener("input", schedulePreview);
  for (const [name, settings] of [["title", TITLE_FONT_SIZE], ["author", AUTHOR_FONT_SIZE]]) {
    const number = $(`${name}-size`);
    const range = $(`${name}-size-range`);
    for (const input of [number, range]) {
      input.min = String(settings.minimum);
      input.max = String(settings.maximum);
      input.step = "1";
      input.value = String(settings.initial);
    }
    range.addEventListener("input", () => {
      number.value = range.value;
      schedulePreview();
    });
    number.addEventListener("input", () => {
      if (number.checkValidity() && number.value) range.value = number.value;
      schedulePreview();
    });
  }
  return {
    open() {
      if (destroyed) return;
      translate();
      if (dialog.open) { $("cover-title").focus(); return; }
      dialog.showModal();
      restore();
    },
    close() {
      clearTimeout(timer);
      invalidateImages();
      if (dialog.open) dialog.close();
    },
    refreshLocale() {
      translate();
      if (dialog.open) void updatePreviews();
    },
    destroy() {
      destroyed = true;
      this.close();
      unsubscribe?.();
      dialog.remove();
    },
  };
}
