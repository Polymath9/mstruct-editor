const { build } = require("../package.json");
// Keep the Windows package.json configuration and BAT entry point unchanged.
// Use the Electron runtime installed natively on this macOS runner.
const { win, electronDist, ...shared } = build;
module.exports = {
  ...shared,
  extends: null,
  extraResources: build.extraResources.map(resource => resource.to === "desktop-icon.ico"
    ? { from: "desktop/generated/icon.png", to: "desktop-icon.png" } : resource),
  artifactName: "MStruct-Analysis-Editor-${version}-mac-${arch}.${ext}",
  mac: {
    target: ["zip"],
    icon: "desktop/generated/icon.png",
    category: "public.app-category.music",
    minimumSystemVersion: "13.0",
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
  },
};
