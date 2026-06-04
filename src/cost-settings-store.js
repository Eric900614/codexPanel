const fs = require("node:fs");
const path = require("node:path");

const COST_SETTINGS_FILE_NAME = "cost-settings.json";

function defaultCostSettings() {
  return {
    version: 1,
    configured: false,
    costPackage: null,
    updatedAt: null
  };
}

function normalizeCostPackage(costPackage) {
  if (!costPackage || typeof costPackage !== "object") return null;

  const amountCny = Number(costPackage.amountCny);
  if (!Number.isFinite(amountCny) || amountCny <= 0) return null;

  const name = String(costPackage.name || "成本套餐").trim() || "成本套餐";
  const currency = String(costPackage.currency || "CNY").trim() || "CNY";
  return {
    name,
    amountCny,
    currency
  };
}

function normalizeCostSettings(settings) {
  const costPackage = normalizeCostPackage(settings?.costPackage);
  return {
    version: 1,
    configured: Boolean(costPackage),
    costPackage,
    updatedAt: settings?.updatedAt || (costPackage ? new Date().toISOString() : null)
  };
}

class CostSettingsStore {
  constructor({ configDir, fileName = COST_SETTINGS_FILE_NAME } = {}) {
    if (!configDir) {
      throw new Error("CostSettingsStore requires configDir.");
    }
    this.configDir = configDir;
    this.filePath = path.join(configDir, fileName);
  }

  getSettings() {
    if (!fs.existsSync(this.filePath)) {
      return defaultCostSettings();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return normalizeCostSettings(parsed);
    } catch {
      return defaultCostSettings();
    }
  }

  saveSettings(settings) {
    const normalized = normalizeCostSettings({
      ...settings,
      updatedAt: new Date().toISOString()
    });
    fs.mkdirSync(this.configDir, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
    return normalized;
  }
}

module.exports = {
  CostSettingsStore,
  defaultCostSettings,
  normalizeCostSettings
};
