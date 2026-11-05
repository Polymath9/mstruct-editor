// The prototype exercises the same renderer as the standalone dialog.
export * from "../../src/ui/video-cover-renderer.js";
import { loadCoverAssets as load } from "../../src/ui/video-cover-renderer.js";
export const loadCoverAssets = () => load({
  fontUrl: new URL("../../desktop/assets/fonts/NotoSansCJKsc-VF.otf", import.meta.url).href,
});
