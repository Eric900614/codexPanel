const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { CostSettingsStore } = require("./cost-settings-store");
const { UsageReader, getDefaultCodexHome } = require("./usage-reader");
const { UsageSynchronization } = require("./usage-synchronization");

const reader = new UsageReader();
let costSettingsStore = null;
const synchronization = new UsageSynchronization({
  reader,
  publishSnapshot,
  publishProgress: publishSyncProgress
});

function getCostSettingsStore() {
  if (!costSettingsStore) {
    costSettingsStore = new CostSettingsStore({ configDir: app.getPath("userData") });
  }
  return costSettingsStore;
}

function publishSnapshot(snapshot) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("usage:snapshot", snapshot);
    }
  });
}

function publishSyncProgress(progress) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("usage:syncProgress", progress);
    }
  });
}

function publishCostSettings(settings) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("cost:settings", settings);
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
  window.webContents.once("did-finish-load", () => {
    synchronization.start();
  });
  return window;
}

ipcMain.handle("usage:getSnapshot", () => synchronization.getSnapshot());

ipcMain.handle("usage:refreshFull", () => synchronization.refreshFull());

ipcMain.handle("usage:getConfig", () => ({
  codexHome: getDefaultCodexHome(),
  platform: process.platform
}));

ipcMain.handle("cost:getSettings", () => getCostSettingsStore().getSettings());

ipcMain.handle("cost:saveSettings", (_event, settings) => {
  const saved = getCostSettingsStore().saveSettings(settings);
  publishCostSettings(saved);
  return saved;
});

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

app.on("before-quit", () => {
  synchronization.stop();
});
