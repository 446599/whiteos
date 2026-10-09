# whiteos

适用于小纸 Pico 的阅读固件介绍站与极简 USB 网页烧录界面。

- 介绍网页：<https://446599.github.io/whiteos/>
- 烧录界面：<https://446599.github.io/whiteos/flash/>

纯静态 HTML、CSS 和 JavaScript，使用 GitHub Pages 从 `main` 分支根目录部署。无需数据库、后端或运行时 CDN。

## 内容

介绍微信读书、本地 EPUB 与 PDF、TTF／OTF 即时字体、翻页动画和离线 Anki。功能状态以网页中的说明为准；线上同步、真机兼容性及设备性能不由网页动画证明。

当前书架与微信读书图片是固件主机渲染的合成界面，不是真机截图；其他交互是网页示意。真实截图准备要求见 [截图清单](./SCREENSHOT_CHECKLIST.md)。

## 网页烧录

页面仅保留“全新烧录”和“固件更新”两个按钮：

- 全新烧录写入启动程序、兼容分区表和应用，不整片擦除。
- 固件更新只写应用，不改写启动程序和分区表。

目前只部署网页，**尚未发布固件镜像**。烧录按钮保持禁用，不会自动连接设备。公开固件发布后再配置 `flash/config.mjs`，详见 [烧录说明](./flash/README.md)。

烧录需要在支持 Web Serial 的电脑浏览器中通过 HTTPS 使用。普通浏览器也可以浏览介绍网页。

## 公开边界

本仓库只包含网页资源、说明与第三方驱动，不包含固件源码、设备数据、登录凭据、TF 文件或本地开发资料。

介绍页不登录账号、不上传数据、不保存演示操作。微信读书与 Anki 为各自品牌，本站不是官方合作页面。

## 第三方许可

- Lucide 图标：`assets/icons/LICENSE` 和 `assets/icons/FEATHER-LICENSE`。
- 固件合成界面来源许可：`assets/screens/LICENSE`。
- 固定版本 esptool-js 及其依赖：`flash/vendor/` 内的许可证和 `versions.json`。

保留原有第三方版权与许可说明，不在本仓库打包字体、阅读引擎或屏幕波形数据。
