# whiteos 网页烧录

入口：<https://446599.github.io/whiteos/flash/>。

whiteos **1.0.0** 首版固件已发布。支持 Web Serial 的电脑浏览器可使用两个按钮，页面加载时识别版本，不自动连接设备。

## 固件源

当前发布包位于本仓库的 `firmware/` 目录，包含：

- `manifest.json`
- `bootloader.bin`
- `partition-table.bin`
- `whiteos.bin`

`config.mjs` 中的 `firmwareSource` 已配置为：

```js
export const firmwareSource = {
  owner: "446599",
  repo: "whiteos",
  ref: "main",
  manifestPath: "firmware/manifest.json",
};
```

也可以使用单独的公开固件发布仓库。不要配置私有源码仓库，不要在网页中加入 GitHub token。分支或标签先解析为固定提交，再从同一提交下载清单与镜像；也可将 `ref` 固定为 40 位提交 SHA。

固件清单格式：

```json
{
  "schema": 1,
  "board": "read-pico-4.7",
  "chip": "ESP32-S3",
  "flashSize": 16777216,
  "partitionTableOffset": 32768,
  "version": "实际发布版本号",
  "parts": [
    {
      "role": "bootloader",
      "offset": 0,
      "file": "bootloader.bin",
      "size": "实际字节数，必须为整数",
      "sha256": "实际文件的64位小写SHA-256"
    },
    {
      "role": "partitions",
      "offset": 32768,
      "file": "partition-table.bin",
      "size": "实际字节数，必须为整数",
      "sha256": "实际文件的64位小写SHA-256"
    },
    {
      "role": "application",
      "offset": 65536,
      "file": "whiteos.bin",
      "size": "实际字节数，必须为整数",
      "sha256": "实际文件的64位小写SHA-256"
    }
  ]
}
```

上面是字段说明，不是可用发布清单，不能直接用于烧录。镜像地址须来自实际 ESP-IDF 构建参数，大小与 SHA-256 必须由真实文件生成；不得填入示例值或将应用镜像写到 `0x0`。

## 安全边界

- 仅用于 ESP32-S3、16 MB Flash 的小纸 Pico，筛选原生 Espressif USB 串口。
- 核对镜像大小、SHA-256、镜像头和分区布局后才进入烧录会话。
- 全新烧录不等于恢复出厂设置，不整片擦除、不清空 NVS、不操作 TF 卡或 PMU。
- 更新仅写应用。空白设备不能使用更新；不兼容旧分区不能自动迁移。
- 固定分区：NVS `0x9000 / 0x5000`、PHY `0xE000 / 0x1000`、factory `0x10000 / 0x800000`、storage `0x810000 / 0x500000`。
- 安全启动、Flash 加密或无法确认安全状态的设备停止操作。
- 写入后读回镜像校验，比较写入扇区之外的 Flash 摘要；不进行整片备份，不上传设备数据。
- 全新烧录有写入前确认。烧录时不要断开 USB 或关闭页面；中断可能需要重新烧录。
- 下载、取消、写入或校验失败不会被当作安装成功。通过写入校验也不等于设备启动与屏幕功能已经验收。

1.0.0 的编译、内部版本、镜像与分区校验已通过；该构建尚未完成真机启动与屏幕验收。此网页不提供硬件身份认证，也不保证其他 ESP32-S3 设备兼容。

驱动固定为 `esptool-js 0.7.0`，相关许可证保留在 `vendor/`。参考上游：<https://github.com/espressif/esptool-js>。
