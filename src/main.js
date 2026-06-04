const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { UsageReader, getDefaultCodexHome } = require("./usage-reader");

const reader = new UsageReader();

function publishSyncProgress(progress) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("usage:syncProgress", progress);
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1160,
    height: 980,
    minWidth: 880,
    minHeight: 900,
    title: "Codex 码表",
    backgroundColor: "#151324",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  return window;
}

ipcMain.handle("usage:getSnapshot", () => reader.getSnapshot());

ipcMain.handle("usage:refreshFull", () => reader.reconcileFull({
  onProgress: publishSyncProgress
}));

ipcMain.handle("usage:getConfig", () => ({
  codexHome: getDefaultCodexHome(),
  platform: process.platform
}));

ipcMain.handle("usage:openCodexHome", async () => {
  const result = await shell.openPath(reader.codexHome);
  return { ok: !result, message: result || "" };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
