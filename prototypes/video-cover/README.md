# 视频封面原型 / Video cover prototype

独立 Electron 调试壳，与 standalone 共用封面排版、对话框和原生复制／保存实现。双击 `launch.bat`，或在编辑器仓库运行以下命令。

An independent Electron development shell sharing cover layout, dialog, and native copy/save capabilities with standalone. Double-click `launch.bat`, or run the following command from the editor repository.

```powershell
node_modules\electron\dist\electron.exe prototypes\video-cover\main.cjs
```

- 打开 `.mstruct` 或 K.545 示例后弹出封面对话框；文件菜单入口位于“在资源管理器打开当前目录”上方，没有打开歌曲时隐藏。 / Open a `.mstruct` file or K.545 example to show the cover dialog. Its File menu entry is above Open Current Folder, hidden without a song.
- 共享解析器读取 `SONG_NAME` 和 `COMPOSER_NAME_n`，不使用罗马化字段。修改只影响封面，重新打开对话框恢复歌曲信息。 / Uses original song and composer names from the shared parser. Edits affect the cover only; reopening restores song metadata.
- 同时生成 1920×1080 和 1440×1080 PNG，按所选字号自动折行，支持手动换行。可通过按钮或右键菜单复制／保存图片。 / Generates both PNG sizes with automatic wrapping at the selected font sizes and manual line breaks. Buttons and context menus provide Copy Image and Save Image.
- 字体完整离线载入，覆盖 CJK；来源与许可见 [素材通知 / Asset notices](assets/NOTICE.md)。 / The full CJK font loads offline; see asset notices for provenance and licensing.

标题与作者各有独立滑块和数值输入。标题 24–320 px，初始 120 px。作者 16–160 px，初始 56 px。单位按两种图片共同的 1080 px 原图高度计算。文字按指定字号换行，每幅预览标明实际字号和行数，版面容量不足时提示调整并禁用该比例的复制和保存。字号在本次运行切换歌曲时保留，便于试验长短标题。

Title and author have independent sliders and numeric inputs. Title size is 24–320 px, initially 120 px. Author size is 16–160 px, initially 56 px. Sizes refer to the 1080 px-high output shared by both ratios. Text wraps at the selected size, with size and line counts below each preview. Overflow prompts an adjustment and disables copying and saving for that ratio. Sizes carry across song changes during the current session for comparing long and short titles.

`cover.js` 转发共享 Canvas 排版，`app.js` 将歌曲数据和平台能力注入共享对话框。`main.cjs`／`preload.cjs` 管理原型文件打开和目录操作，并装配 `desktop/video-cover.cjs`。字体与完整许可位于 `desktop/assets/fonts/`。临时用户数据与验收图片位于忽略的 `.test-tmp/video-cover-prototype/`。

`cover.js` forwards the shared Canvas renderer, and `app.js` injects song data and platform capabilities into the shared dialog. `main.cjs` / `preload.cjs` manage prototype file and folder operations and install `desktop/video-cover.cjs`. Fonts and full licenses live in `desktop/assets/fonts/`. Temporary data and QA images use the ignored `.test-tmp/video-cover-prototype/` directory.

```powershell
node --test prototypes/video-cover/cover.test.mjs
node_modules\electron\dist\electron.exe prototypes\video-cover\main.cjs --smoke
```

冒烟检查会将生成的测试图片写入系统剪贴板。 / The smoke check writes generated test images to the clipboard.

正式 standalone 从“文件 → 生成视频封面”读取当前歌曲及元数据草稿，入口限歌曲工作区。 / Standalone opens File → Generate Video Cover using the current song and metadata draft, with the entry available in the song workspace.
