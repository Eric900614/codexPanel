const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");
const { CostSettingsStore } = require("../src/cost-settings-store");
const { UsageReader, getDefaultCodexHome } = require("../src/usage-reader");
const { UsageSynchronization } = require("../src/usage-synchronization");

const reader = new UsageReader();
const costSettingsStore = new CostSettingsStore({
  configDir: fs.mkdtempSync(path.join(app.getPath("temp"), "codex-panel-screenshot-config-"))
});
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
ipcMain.handle("cost:getSettings", () => costSettingsStore.getSettings());
ipcMain.handle("cost:saveSettings", (_event, settings) => costSettingsStore.saveSettings(settings));
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

  const uiState = await window.webContents.executeJavaScript(`(() => {
    const progress = document.getElementById("syncProgress");
    const progressText = document.getElementById("syncProgressMessage")?.textContent?.trim() || "";
    const progressCount = document.getElementById("syncProgressCount")?.textContent?.trim() || "";
    const statusText = document.getElementById("liveStatus")?.textContent?.trim() || "";
    const appText = document.getElementById("app")?.innerText?.trim() || "";
    return {
      progressVisible: Boolean(progress && !progress.hidden && progress.offsetHeight > 0),
      progressText,
      progressCount,
      statusText,
      showsNoCostPackage: appText.includes("未配置成本套餐"),
      showsTokenBoard: appText.includes("Token 消耗看板"),
      appTextLength: appText.length,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };
  })()`);

  const phasePattern = /扫描|解析|校准|监听|重试|已同步|降级/;
  assert.equal(uiState.progressVisible, true, "sync progress should stay visible");
  assert.match(uiState.progressText, phasePattern, "sync progress should name the sync phase");
  assert.match(uiState.statusText, phasePattern, "status pill should name the sync phase");
  assert(uiState.progressCount || /监听|已同步|重试|降级/.test(uiState.progressText), "progress should show counts when useful");
  assert(uiState.appTextLength > 80, "dashboard should not be blank");
  assert.equal(uiState.showsNoCostPackage, true, "dashboard should show the no-cost-package state");
  assert.equal(uiState.showsTokenBoard, true, "token dashboard should remain visible without a cost package");
  assert(uiState.scrollWidth <= uiState.viewportWidth, "dashboard should not have a horizontal scrollbar");
  assert(uiState.scrollHeight <= uiState.viewportHeight, "dashboard should not have a vertical scrollbar");

  window.webContents.send("usage:syncProgress", {
    state: "idle",
    phase: "idle",
    processedFileCount: uiState.progressCount ? Number(uiState.progressCount.split(" / ")[0]) || 0 : 0,
    totalFileCount: null,
    message: "Temporary read errors.",
    errorCount: 2
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  const degradedState = await window.webContents.executeJavaScript(`(() => {
    const progressText = document.getElementById("syncProgressMessage")?.textContent?.trim() || "";
    const statusText = document.getElementById("liveStatus")?.textContent?.trim() || "";
    const appText = document.getElementById("app")?.innerText?.trim() || "";
    return { progressText, statusText, appTextLength: appText.length };
  })()`);

  assert.match(degradedState.progressText, /降级|重试/, "temporary errors should be inline degraded status");
  assert.match(degradedState.statusText, /降级|重试/, "status pill should show degraded retry state");
  assert(degradedState.appTextLength > 80, "existing snapshot should remain visible during degraded state");

  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  console.log(outputPath);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
