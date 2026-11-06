# MStruct Editor / MStruct 编辑器

MStruct Editor 是用于编辑、制谱、搜索和播放 `.mstruct` 音乐分析的共享实现，并提供 Windows Electron standalone 应用。解析器、音乐理论、制谱器和 UI 在桌面应用、hosted editor 与 viewer 中共用一份源码。

MStruct Editor edits, engraves, searches and plays `.mstruct` music analyses. The Windows standalone application uses Electron. The desktop application, hosted editor and viewer share the same parser, music theory, engraving engine and UI.

MStruct Archive 主站独立维护并保持私有。此仓库不包含其账号、数据库、审核、服务端或部署源码。编辑器可离线使用内置规则、字体与钢琴采样；在线规则目录是可选能力，主站访问限制不会阻止离线编辑。

MStruct Archive is a separately maintained private website. Its accounts, database, moderation, server and deployment source are outside this repository. Bundled rules, fonts and piano samples support offline editing. The online rules registry is optional; website access restrictions do not prevent offline use.

## 开发 / Development

使用 Node.js 22.13.0 或更高版本，以及 npm。首次安装使用锁文件；无需主站或数据库。

Use Node.js 22.13.0 or later and npm. Install from the lockfile; no website checkout or database is required.

```powershell
npm.cmd ci
npm.cmd run dev
```

Vite 页面通常位于 `http://localhost:5173/`，用于开发调试。正式用户入口为 Electron standalone 和主站 hosted editor / viewer。

The Vite page normally runs at `http://localhost:5173/` and serves as a development shell. Product entry points are Electron standalone and the hosted editor / viewer.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run desktop:run
```

构建输出在 `dist/`，同时提供页面和固定的 `profile.js` 数据接口。`examples/` 只保留启动示例 [`k545.mstruct`](examples/k545.mstruct)，同时用作回归验证。

The build outputs the editor page and the stable `profile.js` data entry in `dist/`. The only file in `examples/` is the startup and regression example [`k545.mstruct`](examples/k545.mstruct).

## Windows 打包 / Windows packaging

在 Windows x64 上运行仓库内的 BAT。它会检查依赖、构建图标与网页资源、生成绿色目录和 ZIP，并运行成品冒烟检查。正式版从 1.0.0 开始；当前版本尚无产物时使用当前版本，已有同版产物时仅递增最后一段，旧版产物保留。

On Windows x64, run the repository's BAT. It checks dependencies, builds icons and renderer assets, creates an unpacked application and ZIP, and runs a packaged smoke test. Stable releases start at 1.0.0. The first build uses the current version; an existing artifact for that version advances only the final component. Previous artifacts are preserved.

```powershell
.\build-mstruct-editor-exe.bat
```

只验证当前版本时，可以先设置 `$env:MSTRUCT_BUILD_KEEP_VERSION = '1'`。产物位于 `release/`；分发时提供整个 ZIP，用户完整解压后运行 `mstruct editor.exe`。设置、曲库位置、最近文件、音频关联和规则缓存统一保存到当前 Windows 账户的 `%LOCALAPPDATA%\MStruct\Analysis Editor`，各版本沿用同一目录，不纳入源码或发行包。用户数据初始化只访问这个固定目录，不查找旧版、不扫描程序周边目录，也不自动迁移其他位置的数据。软件设置提供打开用户数据文件夹与清除后重启；清除不删除曲库中的谱面、时间轴、音频或同步记录。

To verify the current version without incrementing it, first set `$env:MSTRUCT_BUILD_KEEP_VERSION = '1'`. Artifacts are written to `release/`. Distribute the complete ZIP; extract it fully before running `mstruct editor.exe`. Settings, the library location, recent files, audio associations and rule caches share `%LOCALAPPDATA%\MStruct\Analysis Editor` for the current Windows account across versions. Keep user data out of source control and release archives. User data initialization accesses only this fixed folder, without searching for old versions, scanning adjacent folders or automatically migrating data from other locations. Application Settings can open the user data folder or clear it and restart; clearing preserves scores, timelines, audio and sync records in the library.

编辑器设置中的“启动时打开 DEMO 文件”默认开启；关闭后，下次启动进入空白文档。该偏好保存在同一用户目录，切换时不改变当前文档。空白 MAIN（含仅空格／换行）渲染为白页。

“Open DEMO File on Startup” in Editor Settings is enabled by default. Turn it off to start with a blank document next time. The preference uses the same user directory and leaves the current document unchanged. A blank MAIN, including whitespace only, renders an empty white page.

构建脚本默认使用 npmmirror 获取 Electron 和 electron-builder 二进制；可在调用前设置 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR` 覆盖。镜像只用于构建下载，应用运行不依赖它。

The build script defaults to npmmirror for Electron and electron-builder binary downloads. Set `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` before invoking it to override these mirrors. They are build download sources, not application runtime services.

## macOS 自动构建 / macOS automated builds

在编辑器仓库的 GitHub Actions 中手动运行 **macOS standalone**。流程分别使用 Apple 芯片与 Intel runner，生成带架构名的 ZIP 和 SHA-256 文件。解压 ZIP 后，将「分析编辑器.app」放到「应用程序」或自选目录即可使用。版本沿用 `package.json`，由维护者单独管理版本递增和 Release 发布。需要 macOS 13 或更高版本。私有仓库的运行计入账号 Actions 额度。

Manually run **macOS standalone** in this editor repository's GitHub Actions. Native Apple Silicon and Intel runners produce architecture-labelled ZIP and SHA-256 files. Extract the ZIP and place the app in Applications or a directory of your choice. The version comes from `package.json`, with version increments and Release publication managed separately by the maintainer. macOS 13 or later is required. Private-repository runs use the account's Actions allowance.

默认同时构建两个架构，也可用 `architecture` 选择只构建 arm64 或 x64。Apple 芯片使用 `macos-26`，Intel 使用 `macos-15-intel`；最低运行系统仍为 macOS 13，两个构建环境的编码器缓存独立。

Both architectures are built by default; use `architecture` to build only arm64 or x64. Apple Silicon uses `macos-26`, while Intel uses `macos-15-intel`. The minimum supported runtime remains macOS 13, and encoder caches are separate for each build environment.

FFmpeg 按 macOS 构建环境、CPU 架构及编译脚本指纹缓存；指纹覆盖固定源码提交和编译参数。缓存命中后仍校验来源、架构、参数和全部文件摘要，通过后直接复用。首次构建、脚本／源码变化、缓存缺失或校验失败时才编译；验证完成即保存编码器缓存，不依赖后续应用测试是否通过。

FFmpeg is cached by macOS build environment, CPU architecture and build-script fingerprint, which includes the pinned source revision and compiler options. Cache hits are reused only after checking provenance, architecture, configuration and all file hashes. Compilation is needed only on the first build, changed scripts/source, a missing cache or failed validation. The verified encoder cache is saved before subsequent application tests.

每个架构都运行完整测试，解压实际分发 ZIP 检查签名与应用启动，并用随包编码器生成、解码 30／60 fps H.264＋AAC 样片；全部通过后才上传构建附件，保留 14 天。首次云端成功前，此流程属于待验证构建支持。拿到包后还需在真实 Mac 上验收编辑、保存、播放和视频导出。

Each architecture runs the full suite, extracts the distribution ZIP to verify signatures and application startup, and encodes/decodes 30/60 fps H.264 + AAC samples with the bundled encoder. Artifacts are uploaded only after these checks pass and retained for 14 days. Until the first successful cloud run, this is unverified build support. Editing, saving, playback and video export still require hands-on acceptance on a Mac.

当前采用 ad-hoc 签名，未做 Apple Developer ID 签名／公证，首次打开可能被 macOS 拦截。对外正式分发前如需常规安装体验，应配置维护者的 Apple 签名与公证凭据；不要把证书或密钥提交到仓库。macOS 设置保存在 `~/Library/Application Support/MStruct/Analysis Editor`，与版本无关。FFmpeg 从与 Windows 包相同的固定提交原生编译，完整源码、构建说明与 LGPL 许可随包提供。

The current build uses ad-hoc signing without Apple Developer ID signing or notarization; macOS may block the first launch. For a normal public installation experience, configure the maintainer's Apple signing and notarization credentials before distribution; never commit certificates or secrets. Settings live in `~/Library/Application Support/MStruct/Analysis Editor` across versions. FFmpeg is built natively from the same pinned revision as the Windows bundle, with complete source, build instructions and LGPL license included.

在 Mac 本机也可使用以下命令。Windows 继续使用原 BAT 和 `desktop:dist`；Mac 配置独立保存，不替换 Windows 配置。

These commands also work on a native Mac. Windows continues to use its existing BAT and `desktop:dist`; the Mac configuration is separate.

```sh
npm ci
npm run desktop:dist:mac
node scripts/verify-mac-package.mjs
```

## 源码边界 / Source boundaries

| 路径 / Path | 职责 / Responsibility |
| --- | --- |
| `src/core/` | 共享格式、规则、音乐理论、搜索、播放模型与制谱 / Shared format, rules, music theory, search, playback model and engraving |
| `src/ui/` | 共享 UI 与乐谱 DOM / Shared UI and score DOM |
| `src/runtime/` | dev、desktop 与 hosted 能力适配 / Development, desktop and hosted capability adapters |
| `src/config/` | 版本化配置和正式内置规则快照 / Versioned configuration and the formal embedded rules snapshot |
| `desktop/` | Electron 主进程、preload、文件和离线资源 / Electron main process, preload, files and offline resources |
| `public/` | 字体、样式、采样与随附许可 / Fonts, styles, samples and their licenses |
| `tests/`, `examples/` | 回归验证与示例 / Regression coverage and examples |

宿主通过适配层注入文件、偏好和消息能力；共享核心不依赖 Electron、主站组件或数据库。主站可将此仓库作为固定提交的子模块，在构建时生成并同步 `dist/`，不维护另一份编辑器实现。共享修改交付时需要覆盖 standalone、hosted editor 和 viewer。

Hosts inject file, preference and messaging capabilities through adapters. The shared core does not depend on Electron, website components or a database. A host may consume a pinned submodule revision and build/sync `dist/`, keeping one editor implementation. Shared changes require verification in standalone, hosted editor and viewer.

## 元数据与主站接入 / Metadata and website integration

`.mstruct` 与 `.mstructtime` 分别保存自己的乐谱链接、六个平台链接（含 Apple Music）及最多九条附加链接；主站分别展示分析链接和当前选中时间轴的录音链接。链接模型和编辑控件共用 `src/core/metadata-links.js` 与 `src/ui/metadata-links.js`。宿主通过现有文档、时间轴保存／下载／历史接口透传完整文件，使用共享解析器读取；更新此包后须重新构建并同步宿主的编辑器产物。

Each `.mstruct` and `.mstructtime` stores its own score links, six platform links (including Apple Music), and up to nine additional links. The website shows analysis links separately from the selected timeline's recording links. Both formats and dialogs share `src/core/metadata-links.js` and `src/ui/metadata-links.js`. Hosts pass complete files through the existing document and timeline save/download/history interfaces and read them with the shared parsers. Rebuild and sync the host's editor assets after updating this package.

Standalone 顶部或原生“设置 → 软件设置”中可修改“规则下载 URL”，并进入“管理规则版本”；默认地址为 `https://mstruct-archive.com/api/mstruct-profiles`，留空仅使用本地规则。地址和规则管理共用同一持久化设置。封闭主站可能返回 401，离线内置规则与已安装包仍可使用。软件设置、原生菜单及文件对话框随当前界面语言切换。

In standalone, open Application Settings from the toolbar or Settings menu to edit Rules Download URL or open Manage Rule Versions. The default is `https://mstruct-archive.com/api/mstruct-profiles`; an empty URL uses local rules only. Application Settings and Rule Versions share the same saved address. A closed website may return 401; bundled and installed rules remain available offline. Settings, native menus and file dialogs follow the selected interface language.

## 许可 / Licensing

项目原创软件源码采用 [MIT License](LICENSE)。项目原创说明文档和示例分析采用 CC BY 4.0；第三方软件、字体、图标和采样保留各自许可。名称、Logo 和官方兼容标识不随软件许可授权。编辑器不会取得你创建或打开的文件的版权。

Project-authored software source is licensed under the [MIT License](LICENSE). Project-authored documentation and example analyses use CC BY 4.0. Third-party software, fonts, icons and samples retain their own licenses. Names, logos and official compatibility marks are not licensed by the software license. The editor does not acquire rights in files you create or open.

详细范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，第三方来源与完整许可入口见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

See [LICENSE-SCOPE.md](LICENSE-SCOPE.md) for scope and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party sources and full license locations.
