const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const preloadSource = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");

function loadPreload(getPathForFile) {
  let exposed;
  const ipcRenderer = {
    invoke: () => Promise.resolve({}),
    on: () => {},
  };
  const sandbox = {
    require(moduleName) {
      assert.equal(moduleName, "electron", "sandboxed preload must not require Node modules");
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, "repoGui");
            exposed = value;
          },
        },
        ipcRenderer,
        webUtils: { getPathForFile },
      };
    },
  };
  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.js" });
  return exposed;
}

test("loads the preload bridge without unsupported Node modules", () => {
  const file = { fullPath: "C:\\data\\chosen\\sample.txt", name: "sample.txt" };
  const api = loadPreload((item) => item.fullPath);
  assert.equal(api.filePath(file), file.fullPath);
  assert.equal(typeof api.workspace, "function");
});

test("resolves selected folder roots on Windows and POSIX", () => {
  const windows = { fullPath: "C:\\data\\chosen\\nested\\sample.txt", webkitRelativePath: "chosen/nested/sample.txt" };
  const posix = { fullPath: "/tmp/chosen/nested/sample.txt", webkitRelativePath: "chosen/nested/sample.txt" };
  assert.equal(loadPreload((item) => item.fullPath).directoryPath([windows]), "C:\\data\\chosen");
  assert.equal(loadPreload((item) => item.fullPath).directoryPath([posix]), "/tmp/chosen");
});
