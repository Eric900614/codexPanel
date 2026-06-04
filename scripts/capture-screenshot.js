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
reader.setCostSettingsProvider(() => costSettingsStore.getSettings());
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
ipcMain.handle("cost:saveSettings", (_event, settings) => {
  const saved = costSettingsStore.saveSettings(settings);
  synchronization.syncIncremental();
  return saved;
});
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
      showsUnavailableCost: Boolean(document.querySelector(".cost-estimate.is-unavailable")),
      showsCostSetupEntry: Boolean(document.querySelector(".cost-setup-entry")),
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
  assert.equal(uiState.showsUnavailableCost, true, "cost estimate should be unavailable without an active package");
  assert.equal(uiState.showsCostSetupEntry, true, "unconfigured homepage should include a cost setup entry");
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
      hasCycleMode: Boolean(document.getElementById("costCycleModeCustom") && document.getElementById("costCycleModeNaturalMonth")),
      hasCycleDates: Boolean(document.getElementById("costCycleStartDate") && document.getElementById("costCycleEndDate")),
      appTextLength: appText.length
    };
  })()`);

  assert.equal(settingsUiState.visible, true, "cost settings should open from the toolbar");
  assert.equal(settingsUiState.hasPackageList, true, "cost settings should manage a package list");
  assert.equal(settingsUiState.hasCurrencyInput, true, "cost settings should allow editing package currency");
  assert.equal(settingsUiState.hasCycleMode, true, "cost settings should show cost cycle mode controls");
  assert.equal(settingsUiState.hasCycleDates, true, "cost settings should allow editing custom cost cycle dates");
  assert(settingsUiState.appTextLength > 80, "token dashboard should remain rendered while settings are open");

  const packageUiState = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (label, predicate, timeoutMs = 2400) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await wait(60);
      }
      throw new Error(label);
    };
    const submit = async () => {
      document.getElementById("costSettingsForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await wait();
    };
    const setValue = (id, value) => {
      const node = document.getElementById(id);
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const changeValue = async (id, value) => {
      const node = document.getElementById(id);
      node.value = value;
      node.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
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
    const invalidPackageMessage = document.getElementById("costSettingsMessage")?.innerText || "";

    setValue("costPackageAmount", "790");
    document.getElementById("costCycleStartDate").value = "2026-07-01";
    document.getElementById("costCycleEndDate").value = "2026-06-01";
    document.getElementById("costCycleEndDate").dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor("invalid cost cycle feedback", () => (
      (document.getElementById("costSettingsMessage")?.innerText || "").length > 0
    ));
    const invalidCycleMessage = document.getElementById("costSettingsMessage")?.innerText || "";

    document.getElementById("costCycleStartDate").value = "2026-06-01";
    await changeValue("costCycleEndDate", "2026-06-30");
    await waitFor("custom cost cycle publish", () => (
      (document.querySelector(".cost-cycle-row strong")?.title || "").includes("2026-06-30") &&
      (document.getElementById("costCycleSummary")?.innerText || "").includes("2026-06-30")
    ));
    const appTextAfterCustomCycle = document.getElementById("app")?.innerText || "";
    const cycleTitleAfterCustomCycle = document.querySelector(".cost-cycle-row strong")?.title || "";
    const customCycleSummaryText = document.getElementById("costCycleSummary")?.innerText || "";

    document.getElementById("costCycleStartDate").value = "1900-01-01";
    await changeValue("costCycleEndDate", "1900-01-01");
    await waitFor("zero-token cost cycle unavailable", () => (
      (document.getElementById("app")?.innerText || "").includes("当前周期没有 Token") &&
      Boolean(document.querySelector(".cost-estimate.is-unavailable"))
    ));
    const zeroTokenCycleHasSetupEntry = Boolean(document.querySelector(".cost-estimate.is-unavailable .cost-setup-entry"));

    document.getElementById("costCycleStartDate").value = "2026-06-01";
    await changeValue("costCycleEndDate", "2026-06-30");
    await waitFor("custom cost cycle republish", () => (
      Boolean(document.querySelector(".cost-estimate:not(.is-unavailable)")) &&
      (document.querySelector(".cost-cycle-row strong")?.title || "").includes("2026-06-30")
    ));

    document.getElementById("costCycleModeNaturalMonth").click();
    await waitFor("natural-month cost cycle publish", () => (
      (document.getElementById("app")?.innerText || "").includes("自然月") &&
      (document.getElementById("costCycleSummary")?.innerText || "").includes("自然月")
    ));

    const appText = document.getElementById("app")?.innerText || "";
    const listText = document.getElementById("costPackageList")?.innerText || "";
    const messageText = document.getElementById("costSettingsMessage")?.innerText || "";
    const cycleSummaryText = document.getElementById("costCycleSummary")?.innerText || "";
    const overlay = document.getElementById("costSettingsOverlay");
    return {
      activeSummaryVisible: appText.includes("20x Pro"),
      inactiveEditPreservedActive: appTextAfterInactiveEdit.includes("20x Pro"),
      listShowsBothPackages: listText.includes("5x") && listText.includes("20x Pro"),
      invalidInputRejected: invalidPackageMessage.length > 0 && appText.includes("20x Pro"),
      invalidCycleRejected: invalidCycleMessage.length > 0,
      customCyclePublished: appTextAfterCustomCycle.includes("自定义") && cycleTitleAfterCustomCycle.includes("2026-06-30") && customCycleSummaryText.includes("2026-06-30"),
      zeroTokenCycleHasSetupEntry,
      naturalMonthVisible: appText.includes("自然月") && cycleSummaryText.includes("自然月"),
      costAllocationVisible: Boolean(document.querySelector(".cost-estimate:not(.is-unavailable)")),
      projectAllocationVisible: document.querySelectorAll(".cost-project-row").length > 0,
      projectRowsWithTokenContext: Array.from(document.querySelectorAll(".cost-project-row"))
        .every((row) => Boolean(row.querySelector(".cost-project-token"))),
      projectRowsWithShareBars: Array.from(document.querySelectorAll(".cost-project-row"))
        .every((row) => Boolean(row.querySelector(".cost-project-bar"))),
      homepageCostMetaVisible: Boolean(document.querySelector(".cost-home-summary")),
      costPackageSummaryVisible: Boolean(document.querySelector(".cost-package-summary")),
      costCycleRowVisible: Boolean(document.querySelector(".cost-cycle-row")),
      compactHeaderVisible: (document.querySelector(".cost-kicker")?.innerText || "").startsWith("样本 "),
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
  assert.equal(packageUiState.invalidCycleRejected, true, "invalid cost cycle dates should show clear feedback");
  assert.equal(packageUiState.customCyclePublished, true, "custom cost cycle date changes should publish visible app state without saving a package");
  assert.equal(packageUiState.zeroTokenCycleHasSetupEntry, false, "zero-token cost cycle should not ask users to configure a package");
  assert.equal(packageUiState.naturalMonthVisible, true, "natural-month cycle should update visible app state without restart");
  assert.equal(packageUiState.costAllocationVisible, true, "active package should show an available cost allocation");
  assert.equal(packageUiState.projectAllocationVisible, true, "cost allocation should include project rows");
  assert.equal(packageUiState.projectRowsWithTokenContext, true, "top project cost rows should include token context");
  assert.equal(packageUiState.projectRowsWithShareBars, true, "top project cost rows should include compact share bars");
  assert.equal(packageUiState.homepageCostMetaVisible, true, "configured homepage should show active package and cycle summary");
  assert.equal(packageUiState.costPackageSummaryVisible, true, "configured homepage should show active package separately from the header");
  assert.equal(packageUiState.costCycleRowVisible, true, "configured homepage should show cost cycle in its own row");
  assert.equal(packageUiState.compactHeaderVisible, true, "token board header should stay compact");
  assert.equal(packageUiState.overlayVisible, true, "cost settings should remain visible for final screenshot");

  await new Promise((resolve) => setTimeout(resolve, 900));
  window.webContents.send("usage:syncProgress", {
    state: "idle",
    phase: "idle",
    processedFileCount: uiState.progressCount ? Number(uiState.progressCount.split(" / ")[0]) || 0 : 0,
    totalFileCount: null,
    message: "Temporary read errors.",
    errorCount: 2
  });
  await new Promise((resolve) => setTimeout(resolve, 120));

  const degradedState = await window.webContents.executeJavaScript(`(() => {
    const progressText = document.getElementById("syncProgressMessage")?.textContent?.trim() || "";
    const statusText = document.getElementById("liveStatus")?.textContent?.trim() || "";
    const appText = document.getElementById("app")?.innerText?.trim() || "";
    const cycleSummaryText = document.getElementById("costCycleSummary")?.innerText?.trim() || "";
    return {
      progressText,
      statusText,
      appTextLength: appText.length,
      costCycleStillVisible: appText.includes("自然月"),
      cycleSummaryStillVisible: cycleSummaryText.includes("自然月"),
      naturalMonthModeChecked: Boolean(document.getElementById("costCycleModeNaturalMonth")?.checked)
    };
  })()`);

  assert.match(degradedState.progressText, /降级|重试/, "temporary errors should be inline degraded status");
  assert.match(degradedState.statusText, /降级|重试/, "status pill should show degraded retry state");
  assert(degradedState.appTextLength > 80, "existing snapshot should remain visible during degraded state");
  assert.equal(degradedState.costCycleStillVisible, true, "latest cost cycle should survive concurrent snapshot refreshes");
  assert.equal(degradedState.cycleSummaryStillVisible, true, "cost cycle form summary should stay on the latest cycle");
  assert.equal(degradedState.naturalMonthModeChecked, true, "cost cycle form mode should stay on the latest cycle");

  const configuredHomepageState = await window.webContents.executeJavaScript(`(async () => {
    document.getElementById("closeCostSettingsButton")?.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      overlayHidden: Boolean(document.getElementById("costSettingsOverlay")?.hidden),
      costAllocationVisible: Boolean(document.querySelector(".cost-estimate:not(.is-unavailable)")),
      projectRowsWithTokenContext: Array.from(document.querySelectorAll(".cost-project-row"))
        .every((row) => Boolean(row.querySelector(".cost-project-token"))),
      projectRowsWithShareBars: Array.from(document.querySelectorAll(".cost-project-row"))
        .every((row) => Boolean(row.querySelector(".cost-project-bar"))),
      homepageCostMetaVisible: Boolean(document.querySelector(".cost-home-summary")),
      costPackageSummaryVisible: Boolean(document.querySelector(".cost-package-summary")),
      costCycleRowVisible: Boolean(document.querySelector(".cost-cycle-row")),
      compactHeaderVisible: (document.querySelector(".cost-kicker")?.innerText || "").startsWith("样本 "),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };
  })()`);

  assert.equal(configuredHomepageState.overlayHidden, true, "final screenshot should show the configured homepage, not the settings modal");
  assert.equal(configuredHomepageState.costAllocationVisible, true, "configured homepage should show available cost allocation");
  assert.equal(configuredHomepageState.projectRowsWithTokenContext, true, "configured homepage project rows should include token context");
  assert.equal(configuredHomepageState.projectRowsWithShareBars, true, "configured homepage project rows should include compact share bars");
  assert.equal(configuredHomepageState.homepageCostMetaVisible, true, "configured homepage should show active package and cycle summary");
  assert.equal(configuredHomepageState.costPackageSummaryVisible, true, "configured homepage should show active package separately from the header");
  assert.equal(configuredHomepageState.costCycleRowVisible, true, "configured homepage should show cost cycle in its own row");
  assert.equal(configuredHomepageState.compactHeaderVisible, true, "configured homepage token board header should stay compact");
  assert(configuredHomepageState.scrollWidth <= configuredHomepageState.viewportWidth, "configured dashboard should not have a horizontal scrollbar");
  assert(configuredHomepageState.scrollHeight <= configuredHomepageState.viewportHeight, "configured dashboard should not have a vertical scrollbar");

  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, image.toPNG());
  console.log(outputPath);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
