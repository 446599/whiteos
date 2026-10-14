# whiteos 网页词典转换

入口：https://446599.github.io/whiteos/dictionary/

选择文件 → 开始转换 → 下载 `dictionary.pdict` → 在设备 Wi-Fi 传书网页点「传词典」上传，或复制到 TF 卡 `DICT/dictionary.pdict`。生成的 PICODIC1 索引需要支持 `.pdict` 的词典优化固件；旧固件可继续使用原来的 UTF-8 TSV。

## 格式与限制

- MDX：1.x / 2.x、未压缩 / zlib、UTF-8 / UTF-16 等 Python 编码；2.x 索引混淆支持。HTML 只提取文字，解析词条重定向。暂不支持 MDD 图片/发音、LZO、MDX 3、注册密钥。
- StarDict：同名 `.ifo`、`.idx` / `.idx.gz`、`.dict` / `.dict.dz`，可选 `.syn`；2.4.2 / 3.0.0、32 / 64 位索引，m/h/x 单一文本字段。
- CSV：UTF-8 两列；可选 `word,definition` / `词头,释义` 表头，支持带引号的逗号和换行。
- JSON：词头到释义的对象，或严格含 `word`、`definition` 的对象数组。
- TXT / TSV：UTF-8，每行词头、真实 Tab、释义；支持 BOM、空行及以 `#` 开头的注释。

英文按 ASCII 转小写，去掉两端常见标点，中文精确匹配。重复规范化词头保留第一条；词头或规范化键超过 127 UTF-8 字节、空释义会跳过。释义超过 4095 UTF-8 字节时生成带标记的节选。坏重定向、环、损坏文件不生成成功下载。

浏览器每次最多 32 个文件、文件总计 128 MiB、输出 128 MiB、源词条 1,000,000 条；StarDict 单个文件解压上限 256 MiB、MDX 累计解压上限 256 MiB、MDX 单块解压上限 32 MiB、单条原始释义上限 8 MiB。浏览器内存不足时可取消，改用电脑工具。手机上使用较小词库。

## 本地处理与维护

所有引擎、Python 源码和依赖都从本站下载，用户文件仅送到浏览器 Web Worker，在内存文件系统中转换；没有上传接口、远程脚本、追踪或持久存储。完成后清理本次输入、输出及临时数据库；取消会终止 Worker 并释放运行环境。关闭页面会中止转换。

首次按需下载约 13 MB 引擎；之后由浏览器 HTTP 缓存复用。Python 转换器来自已通过固件生产 C 查询回归的电脑转换器，网页副本增加浏览器资源上限及进度回调。独立页面和 Worker 保持主页面可操作。

用 HTTP 服务器预览站点，直接双击 HTML 无法加载 Worker。Pages 构建的白名单包含整个 `dictionary/`；测试、开发工具和本机文件不进入发布目录。

测试入口：`node --test tests/dictionary-selection.test.mjs`、`node --test tests/release-site.test.mjs`。浏览器回归运行 `node tests/dictionary-browser.cjs`；需要 Playwright、可选 `PICO_SITE_BROWSER` 和生成的测试夹具 `PICO_DICTIONARY_FIXTURES`。`PICO_DICTIONARY_URL` 可指定线上转换页。测试只使用合成词库，将下载结果与电脑转换器逐字节比较，并由固件生产 C 查询器验证。

## 源码与许可

词典转换应用作为组合程序按 **GPL-3.0-only** 分发，完整可编辑源码就在此目录。它的许可不改变本站其他页面和固件组件的许可。许可证正文见 [GPL-3.0.txt](./GPL-3.0.txt)。

- `python/importer.py` 保留原始 Apache-2.0 声明与 [Apache 许可证](./APACHE-2.0.txt)，网页适配程序和界面采用 GPL-3.0-only，二者兼容。
- MDX 解码器固定自 **mdict-utils 1.3.14** 的 `readmdict.py`、`ripemd128.py`、`pureSalsa20.py`。保留源文件的版权声明。`readmdict.py` 明确采用 GPLv3；软件包的 MIT 元数据不替代这个声明。包级 MIT 许可见 `python/mdict_utils/LICENSE-MIT`，RIPEMD128 / Salsa20 的上游 MIT 许可见 `python/mdict_utils/LICENSE-writemdict`。上游项目：https://github.com/liuyug/mdict-utils 和 https://github.com/zhansliu/writemdict 。
- Pyodide **0.29.3**：`vendor/pyodide/` 内保留 MPL-2.0 正文和 CPython 3.13.2 许可证。未修改运行时；对应源码：https://github.com/pyodide/pyodide/tree/0.29.3 。固定版本的 SQLite 扩展来自同版 Pyodide 发行文件，SQLite 为公有领域。依赖文件与 SHA-256 见 `vendor/versions.json`。
- 字典图标复用本站 Lucide 图标，许可见 `../assets/icons/LICENSE`。

MDict / StarDict 输入词库不随本站分发；请使用你有权使用的词库。转换不会改变输入词库的许可。
