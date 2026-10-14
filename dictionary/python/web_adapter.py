# SPDX-License-Identifier: GPL-3.0-only
"""Browser resource limits around the canonical Pico dictionary converter."""
import gc
import json
from pathlib import Path
import struct
from types import SimpleNamespace
import zlib
import importer
from mdict_utils.base import readmdict
from js import report_progress

BLOCK_LIMIT = 32 * 1024 * 1024
DECOMPRESSED_LIMIT = 256 * 1024 * 1024
importer.FILE_MAX = 128 * 1024 * 1024


def bounded_decompress(data):
    stream = zlib.decompressobj()
    output = stream.decompress(data, BLOCK_LIMIT + 1)
    if len(output) > BLOCK_LIMIT or stream.unconsumed_tail:
        raise ValueError('MDX 单个解压块超过浏览器 32 MiB 限制')
    if not stream.eof or stream.unused_data:
        raise ValueError('MDX 压缩块截断或存在额外数据')
    return output


readmdict.zlib = SimpleNamespace(decompress=bounded_decompress, adler32=zlib.adler32)
original_decode = readmdict.MDict._decode_block


def bounded_decode(self, block, size):
    if not 0 <= size <= BLOCK_LIMIT:
        raise ValueError('MDX 单个解压块超过浏览器 32 MiB 限制')
    self._web_decoded = getattr(self, '_web_decoded', 0) + size
    if self._web_decoded > DECOMPRESSED_LIMIT:
        raise ValueError('MDX 累计解压超过浏览器 256 MiB 限制')
    result = original_decode(self, block, size)
    if len(result) != size:
        raise ValueError('MDX 解压块大小与索引不一致')
    return result


readmdict.MDict._decode_block = bounded_decode
original_header = readmdict.MDict._read_header


def checked_header(self):
    with open(self._fname, 'rb') as stream:
        header_size = struct.unpack('>I', stream.read(4))[0]
        if not 0 < header_size <= 1024 * 1024:
            raise ValueError('MDX 文件头无效或过大')
    header = original_header(self)
    if self._version >= 3:
        raise ValueError('暂不支持 MDX 3，请使用 MDX 1.x / 2.x 文本词库')
    if self._encrypt & 1:
        raise ValueError('暂不支持需要注册密钥的 MDX 词库')
    with open(self._fname, 'rb') as stream:
        stream.seek(self._key_block_offset)
        blocks, count = struct.unpack('>QQ' if self._version >= 2 else '>II', stream.read(self._number_width * 2))
        if not 0 < count <= 1000000 or not 0 < blocks <= count:
            raise ValueError('MDX 词条或块数量无效，最多支持 1,000,000 条')
    return header


readmdict.MDict._read_header = checked_header
original_keys = readmdict.MDict._read_keys


def checked_keys(self):
    keys = original_keys(self)
    if len(keys) != self._num_entries:
        raise ValueError('MDX 词头数量与文件头不一致')
    if any(keys[i][0] > keys[i + 1][0] for i in range(len(keys) - 1)):
        raise ValueError('MDX 释义位置顺序无效')
    return keys


readmdict.MDict._read_keys = checked_keys
original_entries = importer.source_entries


def reported_entries(path, scratch):
    for number, entry in enumerate(original_entries(path, scratch), 1):
        if number > 1000000:
            raise ValueError('浏览器最多处理 1,000,000 条源词条')
        if number % 1000 == 0:
            report_progress(f'正在整理词条… 已读取 {number:,} 条')
        yield entry
    report_progress('正在生成设备索引…')


importer.source_entries = reported_entries


def convert_web(source_name):
    try:
        stats = importer.import_dictionary(Path('/dictionary-input') / source_name,
            '/dictionary-input/dictionary.pdict', replace=True, progress=report_progress)
        return json.dumps(stats)
    except MemoryError as exc:
        raise ValueError('浏览器内存不足，请使用较小词库或电脑转换工具') from exc
    except RuntimeError as exc:
        if 'LZO' in str(exc):
            raise ValueError('暂不支持 LZO 压缩，请使用 zlib 压缩的 MDX 词库') from exc
        raise
    finally:
        gc.collect()
