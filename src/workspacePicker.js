const { app, dialog } = require("electron");

app.whenReady().then(async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose a RepoPilot working folder",
    properties: ["openDirectory", "createDirectory"],
  });
  const selected = !result.canceled && result.filePaths[0] ? result.filePaths[0] : "";
  process.stdout.write(`REPO_GUI_WORKSPACE:${JSON.stringify({ selected })}\n`, () => app.quit());
}).catch((error) => {
  process.stdout.write(`REPO_GUI_WORKSPACE:${JSON.stringify({ error: error.message })}\n`, () => app.quit());
});
