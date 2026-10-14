#!/usr/bin/env python3
"""Generate public, synthetic input fixtures against the independent desktop converter."""
import gzip
import json
import os
from pathlib import Path
import struct
import sys
import zlib

reference = Path(os.environ['PICO_DICTIONARY_REFERENCE'])
sys.path.insert(0, str(reference.parent))
from import_pico_dictionary import import_dictionary
from mdict_utils.base.writemdict import MDictWriter
from mdict_utils.base.readmdict import MDX

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
cases = []


def record(name, companions=(), query='hello', definition='释义'):
    source = root / name
    output = root / (name + '.expected.pdict')
    stats = import_dictionary(source, output, replace=True)
    if name == 'long.json':
        blob = output.read_bytes()
        _, at, _, word_size, text_size = struct.unpack_from('<IIHHI', blob, 32)
        definition = blob[at + word_size:at + word_size + text_size].decode()
    cases.append(dict(name=name, files=[name, *companions], expected=output.name,
                      stats=stats, query=query, definition=definition))


for name, content in [('simple.csv', 'word,definition\nHello,释义\n'),
    ('object.json', json.dumps({'Hello': '释义'}, ensure_ascii=False)),
    ('array.json', json.dumps([{'word': 'Hello', 'definition': '释义'}])),
    ('bom.txt', '\ufeff# comment\r\nHello\t释义\r\n'),
    ('words.tsv', 'Hello\t释义\nHELLO\tduplicate\ncan\'t\tcannot\n中国\t国家\n😀词\t特殊\n'),
    ('multiline.csv', 'Hello,"第一行\n第二行，中文"\n'),
    ('long.json', json.dumps({'Hello': '中' * 3000, 'LongAlias': '@@@LINK=Hello'})),
    ('normalize.json', json.dumps({'“HELLO!”': '释义', 'hello': 'duplicate', '???': 'skip',
        'long' * 40: 'skip', 'empty': '', 'Alias': '@@@LINK=hello', '中国': '国家'}))]:
    (root / name).write_text(content, encoding='utf-8')
    record(name, definition='第一行\n第二行，中文' if name == 'multiline.csv' else '释义')

for width in (32, 64):
    for compressed in (False, True):
        stem = f'star-{width}-{compressed}'
        index, records = b'', b''
        for word, definition in [('Hello', '<b>释义</b><script>ignored()</script>'), ('World', '世界')]:
            raw = definition.encode()
            index += word.encode() + b'\0' + struct.pack('>II' if width == 32 else '>QI', len(records), len(raw))
            records += raw
        (root / (stem + '.ifo')).write_text("StarDict's dict ifo file\nversion=3.0.0\nwordcount=2\n" +
            f'idxfilesize={len(index)}\nidxoffsetbits={width}\nsametypesequence=h\nsynwordcount=1\n')
        companions = []
        for suffix, raw in [('.idx', index), ('.dict', records)]:
            name = stem + suffix + (('.gz' if suffix == '.idx' else '.dz') if compressed else '')
            (root / name).write_bytes(gzip.compress(raw) if compressed else raw)
            companions.append(name)
        name = stem + '.syn'
        (root / name).write_bytes(b'Greeting\0' + struct.pack('>I', 0))
        companions.append(name)
        record(stem + '.ifo', companions, query='greeting')

for encoding in ('utf8', 'utf16'):
    for compression in (0, 2):
        for obfuscate in (False, True):
            name = f'mdx-{encoding}-{compression}-{obfuscate}.mdx'
            writer = MDictWriter({'Hello': '<b>释义</b><style>ignored</style>', 'Greeting': '@@@LINK=Hello'},
                'Generated fixture', 'Generated fixture', encoding=encoding,
                compression_type=compression, encrypt_index=obfuscate)
            if not compression:
                writer._compression_type = 2
                writer._build_keyb_index()
                writer._compression_type = 0
            with (root / name).open('wb') as stream:
                writer.write(stream)
            record(name, query='greeting')

# Independent minimal MDX 1.2 writer: 32-bit numbers and uncompressed key metadata.
for compression in (0, 2):
    def block(raw):
        return struct.pack('<I', compression) + struct.pack('>I', zlib.adler32(raw)) + (zlib.compress(raw) if compression else raw)
    head = ('<Dictionary GeneratedByEngineVersion="1.2" Encoding="UTF-8" Encrypted="No"/>\0').encode('utf-16-le')
    first = '@@@LINK=Hello\0'.encode()
    raw_records = first + '<b>释义</b>\0'.encode()
    raw_keys = struct.pack('>I', 0) + b'Greeting\0' + struct.pack('>I', len(first)) + b'Hello\0'
    keys, records = block(raw_keys), block(raw_records)
    info = struct.pack('>IB', 2, 8) + b'Greeting' + struct.pack('>B', 5) + b'Hello' + struct.pack('>II', len(keys), len(raw_keys))
    raw = struct.pack('>I', len(head)) + head + struct.pack('<I', zlib.adler32(head))
    raw += struct.pack('>4I', 1, 2, len(info), len(keys)) + info + keys
    raw += struct.pack('>4I', 1, 2, 8, len(records)) + struct.pack('>II', len(records), len(raw_records)) + records
    name = f'mdx-v1-{compression}.mdx'
    (root / name).write_bytes(raw)
    record(name, query='greeting')

with (root / 'large.tsv').open('w') as stream:
    for i in range(100000):
        stream.write(f'key{i:06d}\t释义 {i}\n')
record('large.tsv', query='key099999', definition='释义 99999')

bad = [('bad.csv', 'hello,one,extra\n'), ('bad.json', '{oops'), ('bad.tsv', 'missing tab\n'),
    ('cycle.tsv', 'a\t@@@LINK=b\nb\t@@@LINK=a\n'), ('missing.tsv', 'a\t@@@LINK=missing\n'),
    ('control.json', json.dumps({'Hello': '\x01bad'}))]
for name, content in bad:
    (root / name).write_text(content)
broken = bytearray((root / 'mdx-utf8-2-False.mdx').read_bytes())
broken[8] ^= 0xff
(root / 'broken.mdx').write_bytes(broken)
unsupported = []
original = (root / 'mdx-utf8-2-False.mdx').read_bytes()
size = struct.unpack_from('>I', original)[0]
for name, old, new in [('v3.mdx', 'GeneratedByEngineVersion="2.0"', 'GeneratedByEngineVersion="3.0"'),
                       ('registered.mdx', 'Encrypted="0"', 'Encrypted="Yes"')]:
    header = original[4:4 + size].decode('utf-16-le')
    assert old in header
    header = header.replace(old, new).encode('utf-16-le')
    (root / name).write_bytes(struct.pack('>I', len(header)) + header + struct.pack('<I', zlib.adler32(header)) + original[8 + size:])
    unsupported.append(name)
(root / 'oversized-block.mdx').write_bytes(original)
dictionary = MDX(str(root / 'oversized-block.mdx'))
malformed = bytearray(original)
struct.pack_into('>Q', malformed, dictionary._record_block_offset + 40, 33 * 1024 * 1024)
(root / 'oversized-block.mdx').write_bytes(malformed)
unsupported.append('oversized-block.mdx')
(root / 'manifest.json').write_text(json.dumps(dict(cases=cases, bad=[n for n, _ in bad] + ['broken.mdx', *unsupported]), ensure_ascii=False))
print(f'Generated {len(cases)} valid and {len(bad) + 1 + len(unsupported)} invalid synthetic dictionaries')
