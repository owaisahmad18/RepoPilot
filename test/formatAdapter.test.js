const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { acceptedFormats, adaptInputFile } = require("../src/core/formatAdapter");

test("advertises compatible formats by data category", () => {
  assert.equal(acceptedFormats({ original: "demo.png", loader: "io.imread" }), "image/*");
  assert.equal(acceptedFormats({ original: "records.csv", loader: "pd.read_csv" }), ".csv,.tsv,.txt,.json");
  assert.equal(acceptedFormats({ original: "notes.txt", loader: "open" }), ".txt,.md,.log,.csv,.json");
});

test("converts TSV input to the CSV format expected by a notebook", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "repo-gui-format-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "measurements.tsv");
  await fsp.writeFile(source, "sample\tvalue\nA\t12\nB\t18\n");
  const result = adaptInputFile({ original: "data.csv", loader: "pd.read_csv" }, source, root, "measurements");
  assert.equal(result.adapted, true);
  assert.equal(path.extname(result.path), ".csv");
  assert.equal(fs.readFileSync(result.path, "utf8"), "sample,value\nA,12\nB,18");
});

test("converts JSON records to a delimited table", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "repo-gui-json-format-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "records.json");
  await fsp.writeFile(source, JSON.stringify([{ sample: "A", value: 12 }, { sample: "B", value: 18 }]));
  const result = adaptInputFile({ original: "data.csv", loader: "pd.read_csv" }, source, root, "records");
  assert.equal(fs.readFileSync(result.path, "utf8"), "sample,value\nA,12\nB,18");
});
