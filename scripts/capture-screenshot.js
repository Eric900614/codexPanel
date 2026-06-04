const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { UsageReader, getDefaultCodexHome } = require("../src/usage-reader");
const { UsageSynchronization } = require("../src/usage-synchronization");

const reader = new UsageReader();
const outputPath = process.env.CODEX_PANEL_SCREENSHOT_PATH ||
  path.join(__dirname, "..", "artifacts", "codex-panel.png");
const synchronization = new UsageSynchronization({
  reader,
  publishSnapshot,
  publishProgress
});

function publishSnapshot(snapshot) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("usage:snapshot", snapshot);
    }
  });
}

function publishProgress(progress) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("usage:syncProgress", progress);
    }
  });
}

ipcMain.handle("usage:getSnapshot", () => synchronization.getSnapshot());
ipcMain.handle("usage:refreshFull", () => synchronization.refreshFull());
ipcMain.handle("usage:getConfig", () => ({
  codexHome: getDefaultCodexHome(),
  platform: process.platform
}));
ipcMain.handle("usage:openCodexHome", () => ({ ok: true, message: "" }));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1160,
    height: 980,
    show: false,
    backgroundColor: "#151324",
    webPreferences: {
      preload: path.join(__dirname, "..", "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await window.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
  synchronization.start();
  await new Promise((resolve) => setTimeout(resolve, 3500));

  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  console.log(outputPath);
  app.quit();
});
