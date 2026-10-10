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
| `whiteos-X.Y.Z.zip` | 是 | 手动下载包，包含上述文件、使用说明、第三方声明与许可证 |
| `SHA256SUMS` | 建议 | 上述五份附件的 SHA-256 汇总，便于手动核对 |

首版附件已沿用 1.0.0 原始构建，未重新编译。ZIP 内许可与来源记录保留原样。

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

1. 编译并核对适用产品、内部版本、镜像地址、大小和 SHA-256，整理完整许可包。
2. 创建 `vX.Y.Z` 的 Draft Release，上传全部必需附件及建议的 `SHA256SUMS`。
3. 检查 `version` 与标签一致，确认 BIN、清单与 ZIP 来自同一次构建。
4. 发布正式 Release，不勾选 Pre-release。
5. 等待 `Release firmware and deploy Pages` 工作流成功。失败时停止部署，原线上站点不被替换。
6. 打开烧录页，核对版本和 Release 来源，验证三份镜像能下载并通过 SHA-256。

命令示例，目录和版本需要替换为真实值：

```sh
gh release create v1.0.1 --repo 446599/whiteos --target main --title "whiteos 1.0.1" --notes "版本更新说明" --draft
gh release upload v1.0.1 /实际发布目录/manifest.json /实际发布目录/bootloader.bin /实际发布目录/partition-table.bin /实际发布目录/whiteos.bin /实际发布目录/whiteos-1.0.1.zip /实际发布目录/SHA256SUMS --repo 446599/whiteos
gh release edit v1.0.1 --repo 446599/whiteos --draft=false
```

## 自动部署

工作流从 Release 下载清单和三份 BIN，验证版本、大小、SHA-256、镜像头与发布包布局，随后生成：

```text
firmware/releases.json
firmware/releases/v1.0.0/manifest.json
firmware/releases/v1.0.0/bootloader.bin
firmware/releases/v1.0.0/partition-table.bin
firmware/releases/v1.0.0/whiteos.bin
```

这些目录属于 Pages 部署产物，不需要提交生成文件。每次部署同步全部正式版本；不应删除仍在使用的 Release。ZIP 供用户在 Release 下载，网页烧录只下载清单和 BIN。GitHub token 仅供 Actions 读取仓库，不进入网页。校验保证文件一致性，不等于固件签名或设备功能验收。

全新烧录写三份镜像，固件更新只写应用。不检查设备原有分区表，不整片擦除，不操作 TF 卡或 PMU；保留芯片、安全状态、下载与写入校验及写入范围外的保护区域检查。
