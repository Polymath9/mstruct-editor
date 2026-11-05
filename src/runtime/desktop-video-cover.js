// Only the desktop shell supplies native clipboard and offline font capabilities.
export function setupDesktopVideoCover({ api, canOpen, getMetadata, getLocale }) {
  if (!api) return null;
  let dialog;
  let loading;
  let generation = 0;
  let destroyed = false;

  async function open() {
    if (destroyed || !canOpen()) return;
    const version = generation;
    try {
      loading ||= Promise.all([
        import("../ui/video-cover-dialog.js"),
        import("../ui/video-cover-renderer.js"),
        import("../ui/video-cover.css"),
      ]).catch(error => { loading = null; throw error; });
      const [{ createVideoCoverDialog }, { loadCoverAssets }] = await loading;
      if (destroyed || version !== generation || !canOpen()) return;
      dialog ||= createVideoCoverDialog({
        getMetadata, getLocale,
        loadAssets: () => loadCoverAssets({ fontUrl: api.videoCoverFontUrl }),
        copyImage: value => api.copyVideoCover(value),
        saveImage: value => api.saveVideoCover(value),
        imageMenu: value => api.showVideoCoverMenu(value),
        onImageAction: callback => api.onVideoCoverAction(callback),
      });
      dialog.open();
    } catch (error) {
      console.error("Video cover dialog could not open", error);
      if (!destroyed && version === generation && canOpen()) {
        window.alert(getLocale() === "en" ? "Could not open the video cover dialog. Please try again." : "无法打开视频封面对话框，请重试。");
      }
    }
  }
  const unsubscribe = api.onCommand(command => {
    if (command === "video-cover") void open();
    else if (["new", "open", "return-library"].includes(command) || command.startsWith("open-recent:")) {
      generation++;
      dialog?.close();
    }
  });
  return {
    refreshLocale: () => dialog?.refreshLocale(),
    destroy() {
      destroyed = true;
      generation++;
      unsubscribe?.();
      dialog?.destroy();
    },
  };
}
