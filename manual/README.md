# whiteos 使用说明书

面向小纸 Pico 用户的中文网页说明书，按 whiteos 1.1.x 产品功能整理。纯静态 HTML / CSS / JavaScript，无依赖、无构建步骤、无外部字体/CDN、无账号或后端。文件可直接双击打开。

提供 12 章操作说明、TF 目录速查、按键与手势说明、本地全文搜索、可折叠手机目录、常见问题与打印样式。关闭 JavaScript 时正文、目录和问答仍可使用；打印可使用浏览器自身功能。

## 加到现有 GitHub Pages 站点

1. 将整个 `manual/` 文件夹放到现有公开网页仓库的根目录。
2. 首页添加指向 `./manual/` 的链接。本项目 `website/index.html` 已有入口。
3. 提交并推送到已经配置 Pages 的发布分支。
4. 部署后访问 `https://你的用户名.github.io/仓库名/manual/`。现有 whiteos 站点对应 `/whiteos/manual/`。

whiteos 公开站点使用 GitHub Actions 构建。`manual/` 需保留在 `tools/release-site.mjs` 的公开文件复制列表中；介绍、安装和烧录页提供说明书链接，说明书顶端可以返回介绍页和烧录页。

## 作为独立说明书站点

1. 新建公开仓库，把本目录的**内容**放在仓库根目录，保留 `.nojekyll`、`index.html`、`manual.css`、`manual.js` 和 `assets/`。
2. 在 **Settings → Pages → Build and deployment** 选择 **Deploy from a branch**。
3. 选择 **main / (root)**，点击 Save。
4. 等部署完成，以 Pages 设置页显示的网址为准。

独立托管时，将说明书顶端的 `../` 和 `../flash/` 快捷链接改为 whiteos 主站的完整地址。

发布来源允许仓库根目录或 `docs/`，不能直接把任意 `website/` 子目录选作分支发布源。不要为了说明书把私有固件仓库公开；部署包仅包含网页及已审核素材。

参考：[GitHub 官方 Pages 发布来源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 维护内容

正文在 `index.html`，章节索引由 `manual.js` 从正文读取，章节 `data-keywords` 提供别名（例如 WiFi / Wi-Fi）。不需要另外维护搜索数据库。图片、脚本、样式均使用相对路径，兼容项目网址前缀及离线打开。

更新说明时先核对产品源码 `main/pico/` 和版本说明。原厂 demo 与旧根项目 README 不能替代当前产品实现。尤其注意：

- 1.1.1 起本地书架取消固定 128 本上限；容量仍受内存限制。
- 当前 Wi-Fi 文件管理根目录为 TF 卡根目录，包含书籍、字体、壁纸、词典快捷入口。
- 1.1.1 起壁纸支持 9:16 裁剪；屏幕物理灰阶仍为 16 级。
- 微信读书需要显式确认同步，不保证每本书映射或报告成功，个人批注不云同步。
- Anki 为独立离线学习记录，不迁移原复习历史，不连接 AnkiWeb。
- BLE 翻页器尚无实物配对验收；不得用主机测试宣称所有设备兼容。

## 内容与素材依据

内容核对：产品工作区的 `main/pico/pico_shell.c`、`pico_input.c`、`pico_live_controller.inc`、`pico_tasks_ui.c`；`docs/CHANGELOG.md` 的 1.1.0–1.1.2 记录，以及 `PICO_UI_SHELL.md`、`PICO_TRANSFER.md`、`PICO_PDF.md`、`PICO_WEREAD.md`、`PICO_ANKI.md`、`PICO_TEXT_SELECTION.md`、`PICO_DICTIONARY.md`、`PICO_MEMO.md`、`PICO_SYSTEM_SETTINGS.md`、`PICO_WALLPAPER.md`、`PICO_BLE_PAGER.md`、`PICO_SOUND.md`、`PICO_WEATHER.md` 和 `ALARMS.md`。冲突处以较新版本说明及实际源码为准。

阅读内核仍为 EegoRead 固定基线 `32341ecbefe74a11df3fa53ba92e9d7c6894cf6e`。没有以其他阅读项目替代，也没有改动固件或硬件配置。

配图取自站点已有的 2026-10-09 已审核设备帧缓冲截图，均为完整 684 × 1216 图像，无遮盖、裁切或内容编辑。不是光学屏幕摄影，不能证明刷新速度。截图当时的菜单可能与 1.1.x 不同，正文优先按较新行为解释。

所用素材列表与 SHA-256 在 `assets/sources.json`，图像内容授权在 `assets/CONTENT_PERMISSION.md`，固件截图 Apache-2.0 许可与字体许可证保留于 `assets/LICENSE` 和 `assets/licenses/`。`assets/book.svg` 是本说明书新绘制的简单矢量图标。
