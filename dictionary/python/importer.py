#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# 中文：电脑端词库导入，规范化文本并原子生成设备二分索引；不修改源文件。
# English: Computer-side dictionary import, normalized text and atomic device indexes; sources remain untouched.
import argparse
import csv
import gzip
import json
import os
from pathlib import Path
import re
import sqlite3
import struct
import tempfile
from html.parser import HTMLParser

MAGIC = b'PICODIC1'
HEADER = struct.Struct('<8s6I')
ENTRY = struct.Struct('<IIHHI')
WORD_MAX = 127
DEFINITION_MAX = 4095
FILE_MAX = 512 * 1024 * 1024
RECORD_MAX = 8 * 1024 * 1024


def edge(cp):
    return (chr(cp).isspace() or cp == 0x1680 or
            any(lo <= cp <= hi for lo, hi in ((0x21, 0x2f), (0x3a, 0x40), (0x5b, 0x60),
                (0x7b, 0x7e), (0x2010, 0x2027), (0x2030, 0x205e), (0x3001, 0x3003),
                (0x3008, 0x301f), (0xff01, 0xff0f), (0xff1a, 0xff20), (0xff3b, 0xff40), (0xff5b, 0xff65))))


def normalize(word):
    if any(ord(c) < 32 and c not in '\t\n\r\v\f' or 0x7f <= ord(c) <= 0x9f for c in word):
        raise ValueError('词头含控制字符')
    start, end = 0, len(word)
    while start < end and edge(ord(word[start])):
        start += 1
    while end > start and edge(ord(word[end - 1])):
        end -= 1
    return ''.join(chr(ord(c) + 32) if 'A' <= c <= 'Z' else c for c in word[start:end])


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if not self.skip and tag in ('br', 'p', 'div', 'li', 'tr', 'hr'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1
        elif not self.skip and tag in ('p', 'div', 'li', 'tr'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def definition_text(value, html=False):
    if not isinstance(value, str):
        raise ValueError('释义必须是文本')
    if len(value.encode('utf-8')) > RECORD_MAX:
        raise ValueError('单条释义超过电脑端 8 MiB 限制')
    if html:
        parser = PlainText()
        parser.feed(value)
        parser.close()
        value = ''.join(parser.parts)
    value = value.replace('\r\n', '\n').replace('\r', '\n').replace('\t', ' ')
    value = re.sub(r'[ \u00a0]+', ' ', value)
    value = re.sub(r'\n[ \n]+', '\n', value).strip()
    if any(ord(c) < 32 and c != '\n' or 0x7f <= ord(c) <= 0x9f for c in value):
        raise ValueError('释义含不支持的控制字符')
    return value


def text_entries(path):
    suffix = path.suffix.lower()
    if suffix == '.json':
        with path.open(encoding='utf-8-sig') as stream:
            data = json.load(stream)
        if isinstance(data, dict):
            yield from data.items()
        elif isinstance(data, list):
            for row in data:
                if not isinstance(row, dict) or set(row) != {'word', 'definition'}:
                    raise ValueError('JSON 数组每项需包含 word 和 definition')
                yield row['word'], row['definition']
        else:
            raise ValueError('JSON 需为词头到释义的对象，或 word/definition 数组')
        return
    with path.open(encoding='utf-8-sig', newline='') as stream:
        if suffix == '.csv':
            rows = csv.reader(stream, strict=True)
            for number, row in enumerate(rows, 1):
                if not row:
                    continue
                if len(row) != 2:
                    raise ValueError(f'CSV 第 {number} 行需要两列：词头、释义')
                if number == 1 and row in (['word', 'definition'], ['词头', '释义']):
                    continue
                yield tuple(row)
        else:
            for number, line in enumerate(stream, 1):
                line = line.rstrip('\r\n')
                if not line or line.startswith('#'):
                    continue
                row = line.split('\t')
                if len(row) != 2:
                    raise ValueError(f'第 {number} 行需要词头、Tab、释义')
                yield tuple(row)


def companion(base, suffix):
    plain = base.with_suffix(suffix)
    compressed = base.with_suffix(suffix + ('.dz' if suffix == '.dict' else '.gz'))
    if plain.is_file():
        return plain
    if compressed.is_file():
        return compressed
    raise ValueError(f'缺少配套文件 {plain.name}')


def stardict_entries(path, scratch):
    # gzip/DICTZIP仅在电脑上解压到临时文件，设备从不整库解压。
    # Expand gzip/DICTZIP into temporary computer files, never on the device.
    metadata = path.read_text(encoding='utf-8-sig').splitlines()
    if not metadata or metadata[0] != "StarDict's dict ifo file":
        raise ValueError('不是 StarDict IFO 文件')
    fields = dict(line.split('=', 1) for line in metadata[1:] if '=' in line)
    if fields.get('version') not in ('2.4.2', '3.0.0'):
        raise ValueError('仅支持 StarDict 2.4.2 / 3.0.0')
    sequence = fields.get('sametypesequence', '')
    if sequence not in ('m', 'h', 'x', ''):
        raise ValueError('StarDict 当前支持 m/h/x 文本释义，未导入声音或二进制字段')
    width = int(fields.get('idxoffsetbits', '32'))
    if width not in (32, 64):
        raise ValueError('StarDict 索引宽度无效')
    def expand(source, label):
        if source.suffix not in ('.gz', '.dz'):
            return source
        target = scratch / label
        total = 0
        with gzip.open(source, 'rb') as reader, target.open('wb') as writer:
            while block := reader.read(65536):
                total += len(block)
                if total > 256 * 1024 * 1024:
                    raise ValueError('解压后的词库超过浏览器 256 MiB 限制')
                writer.write(block)
        return target
    idx = expand(companion(path, '.idx'), 'index')
    data = expand(companion(path, '.dict'), 'records')
    if idx.stat().st_size != int(fields['idxfilesize']):
        raise ValueError('StarDict 索引大小与 IFO 不一致')
    words = []
    offset_format = struct.Struct('>II' if width == 32 else '>QI')
    with idx.open('rb') as index, data.open('rb') as records:
        for _ in range(int(fields['wordcount'])):
            word = bytearray()
            while (char := index.read(1)) != b'\0':
                if not char or len(word) >= 4096:
                    raise ValueError('StarDict 词头截断或过长')
                word.extend(char)
            pointer = index.read(offset_format.size)
            if len(pointer) != offset_format.size:
                raise ValueError('StarDict 索引截断')
            offset, length = offset_format.unpack(pointer)
            if length > RECORD_MAX or offset + length > data.stat().st_size:
                raise ValueError('StarDict 释义范围无效')
            records.seek(offset)
            raw = records.read(length)
            if len(raw) != length:
                raise ValueError('StarDict 释义截断')
            if not sequence:
                if raw[:1] not in (b'm', b'h', b'x') or not raw.endswith(b'\0') or b'\0' in raw[1:-1]:
                    raise ValueError('StarDict 混合字段仅支持单个 m/h/x 文本字段')
                tag, raw = chr(raw[0]), raw[1:-1]
            else:
                tag = sequence
            name = word.decode('utf-8')
            words.append(name)
            yield name, definition_text(raw.decode('utf-8'), tag in ('h', 'x'))
        if index.read(1):
            raise ValueError('StarDict 索引有额外记录')
    synonyms = path.with_suffix('.syn')
    if synonyms.exists():
        with synonyms.open('rb') as stream:
            count = 0
            while char := stream.read(1):
                word = bytearray()
                while char != b'\0':
                    if not char or len(word) >= 4096:
                        raise ValueError('StarDict 同义词截断或过长')
                    word.extend(char)
                    char = stream.read(1)
                pointer = stream.read(4)
                if len(pointer) != 4 or (index := struct.unpack('>I', pointer)[0]) >= len(words):
                    raise ValueError('StarDict 同义词索引无效')
                yield word.decode('utf-8'), '@@@LINK=' + words[index]
                count += 1
            if count != int(fields.get('synwordcount', count)):
                raise ValueError('StarDict 同义词数量不一致')


def source_entries(path, scratch):
    suffix = path.suffix.lower()
    if suffix == '.ifo':
        yield from stardict_entries(path, scratch)
    elif suffix == '.mdx':
        try:
            from mdict_utils.base.readmdict import MDX
        except ImportError as exc:
            raise ValueError('MDX 导入需安装：python3 -m pip install mdict-utils==1.3.14') from exc
        try:
            for word, value in MDX(str(path)).items():
                yield word.decode('utf-8'), definition_text(value.decode('utf-8'), html=True)
        except AssertionError as exc:
            raise ValueError('MDX 结构或校验无效，或解码器不支持此版本/压缩方式') from exc
    elif suffix in ('.csv', '.json', '.txt', '.tsv'):
        yield from text_entries(path)
    else:
        raise ValueError('支持 .mdx、.ifo、.csv、.json、.txt、.tsv；.mdd 是资源文件')


def import_dictionary(source, output, replace=False, progress=None):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.suffix.lower() != '.pdict':
        raise ValueError('输出需为独立的 .pdict 文件')
    if output.exists() and not replace:
        raise ValueError('输出文件已存在；确认替换时使用 --replace')
    stats = dict(entries=0, duplicates=0, skipped=0, excerpts=0, bytes=0)
    with tempfile.TemporaryDirectory(prefix='pico-dict-import-') as directory:
        scratch = Path(directory)
        db = sqlite3.connect(scratch / 'entries.sqlite')
        try:
            db.execute('CREATE TABLE entries (key BLOB PRIMARY KEY, word BLOB NOT NULL, definition TEXT NOT NULL)')
            for word, value in source_entries(source, scratch):
                if not isinstance(word, str):
                    raise ValueError('词头必须是文本')
                key = normalize(word).encode('utf-8')
                raw_word = word.encode('utf-8')
                value = definition_text(value)
                if not key or len(key) > WORD_MAX or len(raw_word) > WORD_MAX or not value:
                    stats['skipped'] += 1
                    continue
                if any(ord(c) < 32 or 0x7f <= ord(c) <= 0x9f for c in word):
                    raise ValueError('词头不能包含控制字符')
                cursor = db.execute('INSERT OR IGNORE INTO entries VALUES (?, ?, ?)', (key, raw_word, value))
                stats['duplicates'] += not cursor.rowcount
            db.commit()
            count = db.execute('SELECT COUNT(*) FROM entries').fetchone()[0]
            if not count or count > 1000000:
                raise ValueError('词条数量需在 1 到 1,000,000 之间')
            # 提交前解析重定向，坏链接/环不生成看似成功的文件。
            # Resolve aliases before publication; broken links/cycles never produce a success artifact.
            for key, value in db.execute("SELECT key, definition FROM entries WHERE definition LIKE '@@@LINK=%'").fetchall():
                seen = {key}
                while value.startswith('@@@LINK='):
                    target = normalize(value[8:].strip()).encode('utf-8')
                    if target in seen or len(seen) > 64:
                        raise ValueError('词库包含循环或过长的跳转')
                    seen.add(target)
                    row = db.execute('SELECT definition FROM entries WHERE key=?', (target,)).fetchone()
                    if not row:
                        raise ValueError('词库跳转指向缺失词条')
                    value = row[0]
                db.execute('UPDATE entries SET definition=? WHERE key=?', (value, key))
            db.commit()
            output.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(prefix='.' + output.name + '-', dir=output.parent, delete=False) as writer:
                    temporary = Path(writer.name)
                    offset = HEADER.size + ENTRY.size * count
                    writer.truncate(offset)
                    for number, (key, word, definition) in enumerate(db.execute('SELECT key, word, definition FROM entries ORDER BY key')):
                        if progress and number % 1000 == 0:
                            progress('正在生成设备索引…', number, count)
                        definition = definition.encode('utf-8')
                        if len(definition) > DEFINITION_MAX:
                            suffix = '\n…（释义较长，以上为节选）'.encode('utf-8')
                            definition = definition[:DEFINITION_MAX - len(suffix)].decode('utf-8', errors='ignore').encode('utf-8') + suffix
                            stats['excerpts'] += 1
                        end = offset + len(key) + len(word) + len(definition)
                        if end > FILE_MAX:
                            raise ValueError('转换后词库超过设备 512 MiB 上限')
                        writer.seek(HEADER.size + ENTRY.size * number)
                        writer.write(ENTRY.pack(offset, offset + len(key), len(key), len(word), len(definition)))
                        writer.seek(offset)
                        writer.write(key + word + definition)
                        offset = end
                    writer.seek(0)
                    writer.write(HEADER.pack(MAGIC, count, HEADER.size, HEADER.size + ENTRY.size * count, offset, 0, 0))
                    writer.flush()
                    os.fsync(writer.fileno())
                if replace:
                    os.replace(temporary, output)
                else:
                    # 原子创建，不覆写转换途中出现的文件。
                    # Publish without overwriting a file that appeared during conversion.
                    os.link(temporary, output)
                    temporary.unlink()
                temporary = None
                stats.update(entries=count, bytes=offset)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        finally:
            db.close()
    return stats


def main():
    parser = argparse.ArgumentParser(description='将 MDX / StarDict / CSV / JSON / Tab 文本导入小纸 Pico')
    parser.add_argument('source', type=Path)
    parser.add_argument('-o', '--output', type=Path, default=Path('dictionary.pdict'))
    parser.add_argument('--replace', action='store_true')
    args = parser.parse_args()
    try:
        stats = import_dictionary(args.source, args.output, args.replace)
    except (ValueError, OSError, KeyError, UnicodeError, csv.Error, struct.error, AssertionError) as exc:
        parser.exit(1, f'导入失败：{exc}\n')
    print(json.dumps(stats, ensure_ascii=False))
    print(f'已生成 {args.output}，在 Wi-Fi 传书网页点“传词典”上传，或复制到 TF 卡 DICT 文件夹。')


if __name__ == '__main__':
    main()
