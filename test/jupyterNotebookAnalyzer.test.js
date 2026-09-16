const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { analyzeJupyterNotebooks } = require("../src/core/jupyterNotebookAnalyzer");
const { profileRepository } = require("../src/core/repositoryProfiler");
const { prepareNotebookExecution } = require("../src/core/executor");

function notebook(cells) {
  return JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 });
}

test("recognizes a notebook-only repository and converts hard-coded inputs into pickers", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-notebook-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "analysis.ipynb"), notebook([
    { cell_type: "markdown", source: ["# Cell image analysis\n", "Measure structures in microscope images."] },
    { cell_type: "code", source: ["image_path = '/old/data/cell.tif'\n", "image = io.imread(image_path)\n", "model = load_model('./weights.h5')\n"] },
  ]));

  const result = await analyzeJupyterNotebooks(root, { repo: "science-notebook" });
  assert.equal(result.detected, true);
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].runtime, "jupyter-notebook");
  assert.equal(result.commands[0].displayName, "Cell image analysis");
  assert.deepEqual(result.commands[0].args.map((field) => field.accept), ["image/*", ".h5"]);
  assert.ok(result.commands[0].args.every((field) => field.control === "file" && field.required));

  const profile = await profileRepository(root);
  assert.equal(profile.primaryLanguage, "Jupyter Notebook");
});

test("ignores checkpoint notebooks", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-notebook-checkpoint-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".ipynb_checkpoints"));
  await fs.writeFile(path.join(root, ".ipynb_checkpoints", "draft.ipynb"), notebook([]));
  const result = await analyzeJupyterNotebooks(root);
  assert.equal(result.commands.length, 0);
  assert.equal(result.detected, false);
});

test("splits independent notebook examples and collapses repeated demo inputs", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-notebook-sections-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "denoising_testing.ipynb"), notebook([
    { cell_type: "code", source: ["import tensorflow as tf\n", "model = load_model('./model.h5')\n"] },
    { cell_type: "code", source: ["import cv2\n", "image_path = '/demo/one.png'\n", "img = cv2.imread(image_path)\n"] },
    { cell_type: "code", source: ["import cv2\n", "image_path = '/demo/two.png'\n", "img = cv2.imread(image_path)\n"] },
    { cell_type: "code", source: ["import numpy as np\n", "X = np.load('/demo/X.npy')\n"] },
  ]));

  const result = await analyzeJupyterNotebooks(root);
  assert.deepEqual(result.commands.map((command) => command.displayName), ["Denoise a micrograph", "Evaluate denoising on a dataset"]);
  const imageTask = result.commands[0];
  assert.deepEqual(imageTask.cellIndexes, [0, 1]);
  assert.deepEqual(imageTask.args.map((field) => field.displayLabel), ["Denoising model", "Noisy micrograph"]);
  assert.equal(imageTask.args[1].preview, true);
});

test("executes only the selected notebook section and reuses chosen inputs", async (context) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-notebook-run-"));
  context.after(() => fs.rm(storage, { recursive: true, force: true }));
  const root = path.join(storage, "r", "example");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "denoising_testing.ipynb"), notebook([
    { cell_type: "code", source: ["import tensorflow as tf\n", "model = load_model('./model.h5')\n"] },
    { cell_type: "code", source: ["import cv2\n", "image_path = '/demo/one.png'\n", "img = cv2.imread(image_path)\n"] },
    { cell_type: "code", source: ["import numpy as np\n", "X = np.load('/demo/X.npy')\n"] },
  ]));
  const model = path.join(storage, "chosen-model.h5");
  const image = path.join(storage, "chosen-image.jpg");
  await fs.writeFile(model, "model");
  await fs.writeFile(image, "image");
  const analyzed = await analyzeJupyterNotebooks(root);
  const command = analyzed.commands.find((item) => item.displayName === "Denoise a micrograph");
  const prepared = prepareNotebookExecution({ repository: { localPath: root } }, command, {
    "notebook-input-1": model,
    "notebook-input-2": image,
  });
  const result = JSON.parse(await fs.readFile(prepared.preparedPath, "utf8"));
  const source = result.cells.map((cell) => cell.source.join("")).join("\n");
  assert.equal(result.cells.length, 2);
  assert.match(source, /chosen-model\.h5/);
  assert.match(source, /chosen-image\.jpg/);
  assert.doesNotMatch(source, /X\.npy/);
});

test("accepts common table formats and adapts JSON records to a notebook CSV input", async (context) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "repo-gui-notebook-table-"));
  context.after(() => fs.rm(storage, { recursive: true, force: true }));
  const root = path.join(storage, "r", "example");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "table_analysis.ipynb"), notebook([
    { cell_type: "markdown", source: ["# Population analysis\n", "Summarize a table of observations."] },
    { cell_type: "code", source: ["import pandas as pd\n", "observations = pd.read_csv('./inputs/observations.csv')\n"] },
  ]));
  const json = path.join(storage, "observations.json");
  await fs.writeFile(json, JSON.stringify([{ species: "oak", count: 4 }, { species: "pine", count: 7 }]));

  const analyzed = await analyzeJupyterNotebooks(root);
  const command = analyzed.commands[0];
  assert.equal(command.displayName, "Population analysis");
  assert.equal(command.args[0].displayLabel, "Observations table");
  assert.equal(command.args[0].accept, ".csv,.tsv,.txt,.json");

  const prepared = prepareNotebookExecution({ repository: { localPath: root } }, command, {
    "notebook-input-1": json,
  });
  const result = JSON.parse(await fs.readFile(prepared.preparedPath, "utf8"));
  const source = result.cells.map((cell) => cell.source.join("")).join("\n");
  const adaptedPath = source.match(/read_csv\('([^']+)'\)/)[1];
  assert.match(adaptedPath, /notebook-input-1-adapted\.csv$/);
  assert.equal(await fs.readFile(adaptedPath, "utf8"), "species,count\noak,4\npine,7");
});
