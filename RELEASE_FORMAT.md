# whiteos Release 发布格式

## 发布约定

- 仓库：`446599/whiteos`。
- 标签：`vX.Y.Z`，例如 `v1.0.1`；三个非负整数，不带前导零。
- `manifest.json` 的 `version`：`X.Y.Z`，必须与标签一致，不带 `v`。
- 标题：首版为“首版固件”；后续可使用“whiteos X.Y.Z”。
- 烧录网页只选已发布、非预发布的正式版本，按版本号选择最高版本，不依赖 GitHub 的 Latest 标记。
- 完整上传全部附件后再发布；新版本使用新标签，不覆盖旧版本 BIN。

## 附件

| 文件 | 必需 | 用途 |
| --- | --- | --- |
| `manifest.json` | 是 | 产品、芯片、版本、地址、文件大小与 SHA-256 |
| `bootloader.bin` | 是 | 启动程序，写入 `0x00000` |
| `partition-table.bin` | 是 | 分区表，写入 `0x08000` |
| `whiteos.bin` | 是 | 应用镜像，写入 `0x10000` |
| `whiteos-X.Y.Z-full.bin` | 新版本必需 | 网页本地导入完整包，包含三份镜像，空隙填充为 `0xff` |
| `whiteos-X.Y.Z.zip` | 是 | 手动下载包，包含三份镜像、完整 BIN、清单、使用说明、更新说明、第三方声明与许可证 |
| `SHA256SUMS` | 建议 | 三份镜像、清单、完整 BIN 与 ZIP 的 SHA-256 汇总，便于手动核对 |

已发布的 `v1.0.0`、`v1.0.1`、`v1.0.2`、`v1.1.0`、`v1.1.1`、`v1.1.2` 没有完整 BIN，部署保留兼容。从 `v1.1.3` 起，新正式版本缺少完整 BIN 就停止部署；若旧版补充完整 BIN，同样必须通过全部校验。ZIP 内保留各组件的许可与来源，不将整个固件宣称为单一许可证。

## 清单

下面是首版真实格式；发布新版本时必须重新计算大小与哈希，不能沿用旧数值。

```json
{
  "schema": 1,
  "board": "read-pico-4.7",
  "chip": "ESP32-S3",
  "flashSize": 16777216,
  "partitionTableOffset": 32768,
  "version": "1.0.0",
  "parts": [
    {
      "role": "bootloader",
      "offset": 0,
      "file": "bootloader.bin",
      "size": 21168,
      "sha256": "dc81efcd48276ae71dd20b889e656e21299fbc50ba4fe23e99a418c0bccc9ad1"
    },
    {
      "role": "partitions",
      "offset": 32768,
      "file": "partition-table.bin",
      "size": 3072,
      "sha256": "a54a05e03e1de446e95b40cdb7f6dd710ea0368d4c255805666548b75e0ad82c"
    },
    {
      "role": "application",
      "offset": 65536,
      "file": "whiteos.bin",
      "size": 7334144,
      "sha256": "3e17188b41ae000d304003c961a6161b0ed62954990c51b7f49f7a650324b441"
    }
  ]
}
```

`size` 和 `offset` 是整数，`sha256` 是 64 位小写十六进制字符串。三种 role 必须齐全、不能重复；文件名只允许本地 BIN 文件名，不允许 URL 或路径。新构建使用实际 ESP-IDF 生成地址；若产品布局改变，应先修改并验证发布工具和烧录网页契约，而不是只改清单。

## 发布步骤

1. 用产品配置编译，确保构建缓存里的 `PROJECT_VER` 也已更新。核对适用产品、内部版本、镜像地址、大小和 SHA-256。
   用 `node tools/prepare-release.mjs BUILD_DIR X.Y.Z EMPTY_OUTPUT_DIR RELEASE_NOTES.md` 生成七份 Release 附件，需 Node.js 22+ 和 Python 3。工具使用实际 `flasher_args.json`，拒绝额外数据分区、版本不符和非空输出目录；只纳入固定公开说明与许可证。
   只需三份 BIN、清单和完整 BIN 时，可用 `tools/prepare-firmware.mjs BUILD_DIR X.Y.Z EMPTY_OUTPUT_DIR`。
2. 创建 `vX.Y.Z` 的 Draft Release，上传全部必需附件及建议的 `SHA256SUMS`。
3. 检查 `version` 与标签一致，确认 BIN、清单与 ZIP 来自同一次构建。
4. 发布正式 Release，不勾选 Pre-release。
5. 等待 `Release firmware and deploy Pages` 工作流成功。失败时停止部署，原线上站点不被替换。
6. 打开烧录页，核对版本和 Release 来源，验证三份镜像能下载并通过 SHA-256。

命令示例，目录和版本需要替换为真实值：

```sh
gh release create v1.1.3 --repo 446599/whiteos --target main --title "whiteos 1.1.3" --notes "版本更新说明" --draft
gh release upload v1.1.3 /实际发布目录/manifest.json /实际发布目录/bootloader.bin /实际发布目录/partition-table.bin /实际发布目录/whiteos.bin /实际发布目录/whiteos-1.1.3-full.bin /实际发布目录/whiteos-1.1.3.zip /实际发布目录/SHA256SUMS --repo 446599/whiteos
gh release edit v1.1.3 --repo 446599/whiteos --draft=false
```

## 自动部署

工作流从 Release 下载清单和三份 BIN，验证版本、大小、SHA-256、镜像头与发布包布局；对完整 BIN 进一步核对内嵌版本、段校验、SHA-256、分区表摘要及空白间隙，并逐份比对拆出的三份镜像，随后生成：

```text
firmware/releases.json
firmware/releases/v1.0.0/manifest.json
firmware/releases/v1.0.0/bootloader.bin
firmware/releases/v1.0.0/partition-table.bin
firmware/releases/v1.0.0/whiteos.bin
```

这些目录属于 Pages 部署产物，不需要提交生成文件。每次部署同步全部正式版本；不应删除仍在使用的 Release。ZIP 供用户在 Release 下载并解压；新版本完整 BIN 也会进入对应 Pages 版本目录。在线烧录下载清单和三份 BIN，本地导入读取一个完整 BIN，再按烧录模式提取需要的镜像。完整 BIN 不得整段写到 `0x0`，其空白间隙不是需要擦除的数据。GitHub token 仅供 Actions 读取仓库，不进入网页。校验保证文件一致性，不等于固件签名或设备功能验收。

烧录页的版本更新说明直接同步正式 Release 正文，随对应版本写入发布索引的 `releaseNotes`。网页以纯文本显示，不执行正文中的 HTML；没有说明时显示占位文字。修改 Release 说明后需完成 Pages 部署，网页才会同步更新，无需另写一份网页说明。
当前正式版本说明默认显示，历史正式版本的说明折叠展示，并保留对应 Release 链接；烧录仍使用已锁定的最新版本。

全新烧录写三份镜像，固件更新只写应用。不检查设备原有分区表，不整片擦除，不操作 TF 卡或 PMU；保留芯片、安全状态、下载与写入校验及写入范围外的保护区域检查。
