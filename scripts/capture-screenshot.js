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

  const settingsUiState = await window.webContents.executeJavaScript(`(async () => {
    document.getElementById("costSettingsButton")?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const overlay = document.getElementById("costSettingsOverlay");
    const appText = document.getElementById("app")?.innerText?.trim() || "";
    return {
      visible: Boolean(overlay && !overlay.hidden && overlay.offsetHeight > 0),
      hasPackageList: Boolean(document.getElementById("costPackageList")),
      hasCurrencyInput: Boolean(document.getElementById("costPackageCurrency")),
      appTextLength: appText.length
    };
  })()`);

  assert.equal(settingsUiState.visible, true, "cost settings should open from the toolbar");
  assert.equal(settingsUiState.hasPackageList, true, "cost settings should manage a package list");
  assert.equal(settingsUiState.hasCurrencyInput, true, "cost settings should allow editing package currency");
  assert(settingsUiState.appTextLength > 80, "token dashboard should remain rendered while settings are open");

  const packageUiState = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));
    const submit = async () => {
      document.getElementById("costSettingsForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await wait();
    };
    const setValue = (id, value) => {
      const node = document.getElementById(id);
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    };

    setValue("costPackageName", "5x");
    setValue("costPackageAmount", "780");
    setValue("costPackageCurrency", "CNY");
    await submit();

    document.getElementById("newCostPackageButton").click();
    await wait(80);
    setValue("costPackageName", "20x");
    setValue("costPackageAmount", "1280");
    setValue("costPackageCurrency", "CNY");
    await submit();

    const twentyRadio = Array.from(document.querySelectorAll("input[name='activeCostPackage']"))
      .find((radio) => radio.closest(".package-row")?.innerText.includes("20x"));
    twentyRadio.click();
    twentyRadio.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();

    const twentyEdit = Array.from(document.querySelectorAll("[data-action='edit-package']"))
      .find((button) => button.closest(".package-row")?.innerText.includes("20x"));
    twentyEdit.click();
    await wait(80);
    setValue("costPackageName", "20x Pro");
    await submit();

    const fiveEdit = Array.from(document.querySelectorAll("[data-action='edit-package']"))
      .find((button) => button.closest(".package-row")?.innerText.includes("5x"));
    fiveEdit.click();
    await wait(80);
    setValue("costPackageAmount", "790");
    await submit();
    const appTextAfterInactiveEdit = document.getElementById("app")?.innerText || "";

    setValue("costPackageAmount", "-1");
    await submit();

    const appText = document.getElementById("app")?.innerText || "";
    const listText = document.getElementById("costPackageList")?.innerText || "";
    const messageText = document.getElementById("costSettingsMessage")?.innerText || "";
    const overlay = document.getElementById("costSettingsOverlay");
    return {
      activeSummaryVisible: appText.includes("20x Pro"),
      inactiveEditPreservedActive: appTextAfterInactiveEdit.includes("20x Pro"),
      listShowsBothPackages: listText.includes("5x") && listText.includes("20x Pro"),
      invalidInputRejected: messageText.length > 0 && appText.includes("20x Pro"),
      overlayVisible: Boolean(overlay && !overlay.hidden && overlay.offsetHeight > 0),
      listText,
      formName: document.getElementById("costPackageName")?.value || "",
      appText
    };
  })()`);
  assert.equal(packageUiState.activeSummaryVisible, true, "active package should update the dashboard without restart");
  assert.equal(packageUiState.inactiveEditPreservedActive, true, "editing an inactive package should not switch the active package");
  assert.equal(packageUiState.listShowsBothPackages, true, "settings should show created and edited packages");
  assert.equal(packageUiState.invalidInputRejected, true, "invalid package input should not corrupt saved settings");
  assert.equal(packageUiState.overlayVisible, true, "cost settings should remain visible for final screenshot");

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

  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  console.log(outputPath);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
