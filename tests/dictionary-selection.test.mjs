import test from "node:test";
import assert from "node:assert/strict";
import { INPUT_LIMIT, selectDictionary } from "../dictionary/selection.mjs";
const file = (name, size = 10) => ({ name, size });

test("recognizes single text formats and MDX with ignored MDD", () => {
  for (const extension of ["MDX", "csv", "json", "txt", "tsv"]) {
    const selection = selectDictionary([file(`test.${extension}`)]);
    assert.equal(selection.source, `test.${extension}`);
  }
  assert.equal(selectDictionary([file("test.mdx"), file("test.mdd")]).files.length, 1);
});

test("requires exact StarDict companions and recognizes compressed alternatives", () => {
  for (const suffixes of [[".idx", ".dict"], [".idx.gz", ".dict.dz"]]) {
    const files = [".ifo", ...suffixes, ".syn"].map(suffix => file("test" + suffix));
    assert.equal(selectDictionary(files).files.length, 4);
  }
  assert.throws(() => selectDictionary([file("test.ifo"), file("other.idx"), file("test.dict")]));
  assert.throws(() => selectDictionary([file("test.ifo"), file("test.idx"), file("test.idx.gz"), file("test.dict")]));
});

test("rejects ambiguous selections, malformed names and resource overflow", () => {
  for (const files of [[], [file("test.mdd")], [file("a.tsv"), file("b.csv")], [file("a.mdx"), file("a.idx")],
    [file("a.tsv"), file("A.TSV")], [file("../a.tsv")], [file("bad\0.tsv")], [file("a.tsv", INPUT_LIMIT + 1)],
    [file("a.tsv", NaN)], [file("a.tsv", -1)], Array.from({ length: 33 }, (_, i) => file(`${i}.mdd`))]) {
    assert.throws(() => selectDictionary(files));
  }
  assert.equal(selectDictionary([file("a.tsv", INPUT_LIMIT)]).source, "a.tsv");
});
