# 第三方通知 / Third-party notices

第三方材料适用其各自许可，不因本项目原创代码采用 MIT 而改变。 / Third-party materials retain their own licenses independently of the project's MIT code license.

| 内容 / Material | 来源与许可 / Source and license | 仓库内完整通知 / Included full notices |
| --- | --- | --- |
| Electron | [Electron](https://github.com/electron/electron), MIT；Chromium 另有汇总通知 / separate Chromium notices | [Electron MIT](desktop/assets/licenses/ELECTRON-MIT.txt)；Electron 成品还保留自身的 Chromium 通知 / packaged Electron retains Chromium notices |
| VexFlow | [VexFlow](https://github.com/0xfe/vexflow), MIT | [VexFlow MIT](desktop/assets/licenses/VEXFLOW-MIT.txt) |
| smplr | [smplr](https://github.com/danigb/smplr), MIT | [smplr MIT](desktop/assets/licenses/SMPLR-MIT.txt) |
| Musyng Kite acoustic grand piano | [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), CC BY-SA 3.0；Benjamin Gleitzman 与贡献者转换，原采样未修改 / converted by Benjamin Gleitzman and contributors, sample payload unmodified | [采样通知 / Sample notices](desktop/assets/THIRD_PARTY_NOTICES.txt), [CC BY-SA 3.0](desktop/assets/licenses/CC-BY-SA-3.0.txt) |
| Academico, Bravura | Steinberg Media Technologies GmbH, SIL OFL 1.1 | [Academico](public/fonts/OFL-Academico.txt), [Bravura](public/fonts/OFL-Bravura.txt) |
| Crimson Pro, Noto Serif, Noto Music | 各字体原作者 / respective font authors, SIL OFL 1.1 | [Crimson Pro](public/fonts/OFL-CrimsonPro.txt), [Noto Serif](desktop/assets/licenses/OFL-Noto-Serif.txt), [Noto Music](desktop/assets/licenses/OFL-Noto-Music.txt) |
| MStruct Text Accidentals | Noto Music 派生子集 / derived Noto Music subset, SIL OFL 1.1 | [完整许可与修改说明 / Full license and changes](public/fonts/OFL-MStructTextAccidentals.txt) |
| Noto Sans CJK SC 2.004（桌面视频封面 / desktop video covers） | Adobe, SIL OFL 1.1; unmodified variable OTF | [来源与版权 / Provenance and copyright](desktop/assets/fonts/NOTICE.md), [OFL](desktop/assets/fonts/OFL-NotoSansCJK.txt) |
| Lucide inline icons | [Lucide](https://github.com/lucide-icons/lucide), ISC | [Lucide ISC](public/icons/LUCIDE-LICENSE.txt) |

实际桌面分发的通知入口为 [`desktop/assets/THIRD_PARTY_NOTICES.txt`](desktop/assets/THIRD_PARTY_NOTICES.txt)，其中保留固定采样哈希。网页资源同样保留 `public/fonts/`、`public/icons/`、`public/licenses/` 的完整许可。构建工具和传递依赖的许可还保留在安装包自身及锁文件对应的 npm 包中；不随应用分发整套开发依赖。

The desktop notice entry is [`desktop/assets/THIRD_PARTY_NOTICES.txt`](desktop/assets/THIRD_PARTY_NOTICES.txt), including the fixed sample hash. Browser resources retain full notices under `public/fonts/`, `public/icons/` and `public/licenses/`. Build tooling and transitive dependency licenses remain in their installed packages at the lockfile versions; the application does not ship the full development dependency tree.
