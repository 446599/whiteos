# whiteos

适用于小纸 Pico 的阅读固件介绍站与极简 USB 网页烧录界面。

- 介绍网页：<https://446599.github.io/whiteos/>
- 安装入口：<https://446599.github.io/whiteos/install/>
- 烧录界面：<https://446599.github.io/whiteos/flash/>
- 使用说明：<https://446599.github.io/whiteos/manual/>
- 每日一句句库：<https://446599.github.io/whiteos/quotes/>（适配固件待发布）
- 词典转换：<https://446599.github.io/whiteos/dictionary/>

纯静态 HTML、CSS 和 JavaScript，使用 GitHub Actions 从 `main` 构建并部署到 GitHub Pages。正式 Release 附件在部署时校验并同步为同站下载文件，无需数据库或后端。

## 内容

中文使用说明共 12 章，涵盖入门、传书、阅读、微信读书、Anki 和系统设置，支持本地搜索、手机目录及打印。介绍页、安装入口和烧录页均可直接跳转；`manual/` 随 Pages 构建一起发布。

介绍微信读书双向进度与阅读时间同步、本地 EPUB 流式阅读与 PDF、阅读菜单、已发布的双指缩放、TTF／OTF 实时解码、翻页动画和离线 Anki。功能状态以网页中的说明为准；线上同步、真机兼容性及设备性能不由网页动画证明。

2026-10-09 用户确认设备→云阅读进度与新增阅读时间上传已成功，网页同步说明已更新为验证成功。同步仍需手动确认，批注不云同步；此状态确认不隐含发布固件镜像。

书架、主页、EPUB、PDF、阅读菜单、字体与 Anki 使用 2026-10-09 采集并审核的真机帧缓冲截图，原生 684 × 1216，正文和 Anki 卡组为原创演示内容。点击阅读、字体和 Anki 图片可查看完整 PNG；PDF 整页／放大、字体及 Anki 各状态可切换对比。微信读书三张图仍为主机渲染的合成界面，并在对应区域注明来源。

翻页演示使用真实相邻页 `page-turn-before.png` 与 `page-turn-after.png`。一条全高竖向水波纹横向扫过：下一页从左向右、上一页从右向左，新内容原位覆盖，不平移。手势和翻页动画为网页示意，不证明实体屏光学波形、速度或残影。

截图记录见 `assets/screens/capture-manifest.json`，公开内容与字体许可见 `assets/screens/CONTENT_PERMISSION.md` 和 `assets/screens/licenses/`。仍待补的三张微信读书真屏素材见 [截图清单](./SCREENSHOT_CHECKLIST.md)。

## 词典转换

`dictionary/` 在浏览器后台运行已验证的 Python 转换程序，将 MDX、StarDict、CSV、JSON 和 TXT/TSV 转成 `dictionary.pdict`。用户词典只在浏览器内存中处理，没有上传或持久化。选择文件、转换、下载后，用设备 Wi-Fi 传书页的「传词典」上传，或复制到 TF 卡 `DICT/dictionary.pdict`。需要支持 `.pdict` 的词典优化固件；已有 TSV 词典仍可使用。

转换引擎和依赖全部同站托管，首次约下载 13 MB；支持进度、取消和重试。MDX 图片/发音、LZO、MDX 3 和注册密钥不支持。浏览器文件合计及输出上限 128 MiB，解压后的 StarDict 上限 256 MiB。格式、源码、固定依赖、许可和回归入口见 [词典转换说明](./dictionary/README.md)。

## 网页烧录

页面提供“全新烧录”和“固件更新”两种方式，可使用在线固件或本地完整包：

- 全新烧录写入发布包中的启动程序、分区表和应用，不整片擦除。
- 固件更新只写应用，不改写启动程序和分区表。

默认使用在线固件，页面识别版本后直接点击“固件更新”或“全新烧录”，网页自动下载并校验。本地导入默认折叠，仅作为下载失败时的备用方式。

在线下载失败时，在 [GitHub Releases](https://github.com/446599/whiteos/releases) 的 Assets 下载 `whiteos-X.Y.Z-full.bin`，回烧录页选择完整包。页面核对内嵌版本与完整性；已有 whiteos 选“固件更新”。1.1.2 及更早正式版没有完整 BIN，可继续在线烧录。

**当前已发布 whiteos 1.1.3**：翻页响应更快、连续翻页更利落，加快微信读书加载；支持选书同步与阶段进度、导入 TXT/EPUB 离线阅读和词典注音。固件通过 GitHub Release 发布；Actions 校验并同步三份镜像、清单和更新说明到 Pages。网页识别最高正式版本，在一次操作中锁定同一版本。支持的电脑浏览器会启用两个烧录按钮，页面不会自动连接设备。

- [1.1.3 Release 与下载](https://github.com/446599/whiteos/releases/tag/v1.1.3)
- [查看发布清单](./firmware/releases/v1.1.3/manifest.json)
- [后续 Release 发布格式](./RELEASE_FORMAT.md)
- [固件说明](./firmware/README.md) · [烧录说明](./flash/README.md)

应用大小为 7,800,992 字节，内部版本为 `1.1.3`。编译、镜像与分区校验已通过；程序内容与已完成底栏单次点击真机确认的修复版相同，仅更新版本与构建元数据。导入 TXT 及部分 EPUB 的云端进度同步仍在适配。网页烧录完成后，请重新插拔数据线以重启设备。

烧录需要在支持 Web Serial 的电脑浏览器中通过 HTTPS 使用。普通浏览器也可以浏览介绍网页。

网页按发布清单直接写入，不读取或比对设备原有分区表。下载仍核对 SHA-256；写入内容与写入范围外的保护区域采用设备摘要校验，逐段显示进度，单次无响应最多等待 15 秒。

2026-10-09 已在电脑 Edge 通过网页完成同一台小纸 Pico 的 1.0.0 应用更新，写入内容与全部保护区域摘要检查通过，页面显示 100% 并发送重启指令。本次只验证 USB 网页更新流程；设备重启后的屏幕与功能验收仍待确认。

## 公开边界

本仓库包含网页、公开固件镜像、发布清单及第三方许可，不包含设备数据、登录凭据、TF 文件或本地构建日志、ELF、map 文件。

介绍页不登录账号、不上传数据、不保存演示操作。微信读书与 Anki 为各自品牌，本站不是官方合作页面。

## 第三方许可

- Lucide 图标：`assets/icons/LICENSE` 和 `assets/icons/FEATHER-LICENSE`。
- 固件合成界面来源许可：`assets/screens/LICENSE`。
- 固定版本 esptool-js 及其依赖：`flash/vendor/` 内的许可证和 `versions.json`。
- 本地 MD5 计算使用固定版本 spark-md5 3.0.2，许可保存在 `flash/vendor/spark-md5.LICENSE`。

固件中的第三方组件与资源保留各自许可，见 `firmware/THIRD_PARTY_NOTICES.md` 和 `firmware/licenses/`；不将整个固件统一宣称为 Apache-2.0。

## 网页维护验证

`node --test tests/*.test.mjs` 验证完整包解析、更新写入范围、发布打包、发布白名单与 Release 校验。`node tests/flash-browser.cjs` 使用模拟设备检查导入、失败重选、异步结果覆盖、两种烧录流程及五种屏幕尺寸，不连接实物。具有 Playwright 的开发环境可运行 `node tests/navigation.cjs`，检查项目路径下的介绍、安装、烧录、说明书互相跳转及五种屏幕尺寸；`PICO_SITE_BROWSER` 可指定已有 Chromium 浏览器。测试不访问设备，测试文件不进入 Pages 发布产物。

## 外置每日一句

`quotes/` 提供独立句子包生成工具，从固定版本的一言文学/原创数据生成，或在浏览器处理用户自己的 JSON、TXT/TSV。主页的入口在烧录操作之后，不会连接串口、改变固件来源或随烧录写卡。

外置格式的固件支持尚未发布，正式版 1.1.3 不支持；页面明确显示兼容性。下载的 ZIP 解压为 `QUOTES` 文件夹，经 USB 磁盘/读卡器复制到 TF 根目录。句子包包含设备格式、可编辑来源、重建脚本和来源/许可；一言内容仍遵循原 AGPL 和原作者权利，不因外置而免除义务。工具独立代码使用 MIT，未把一言数据加入本仓库或固件镜像。格式和验证见 [句库工具说明](./quotes/README.md)。
