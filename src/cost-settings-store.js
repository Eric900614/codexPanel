const fs = require("node:fs");
const path = require("node:path");

const COST_SETTINGS_FILE_NAME = "cost-settings.json";

function defaultCostSettings() {
  return {
    version: 1,
    configured: false,
    packages: [],
    activePackageId: "",
    activePackage: null,
    costPackage: null,
    updatedAt: null
  };
}

function safePackageId(value, fallback) {
  const id = String(value || "").trim();
  if (id) return id;
  return fallback;
}

function normalizeCurrency(value) {
  return String(value || "CNY").trim().toUpperCase() || "CNY";
}

function normalizeCostPackage(costPackage, index = 0) {
  if (!costPackage || typeof costPackage !== "object") {
    throw new Error("Cost package must be an object.");
  }

  const amount = Number(costPackage.amount ?? costPackage.amountCny);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Cost package amount must be greater than 0.");
  }

  const name = String(costPackage.name || "").trim();
  if (!name) {
    throw new Error("Cost package name is required.");
  }

  const currency = normalizeCurrency(costPackage.currency);
  const id = safePackageId(costPackage.id, `package-${index + 1}`);
  return {
    id,
    name,
    amount,
    currency,
    amountCny: amount
  };
}

function normalizeCostSettings(settings) {
  const sourcePackages = Array.isArray(settings?.packages)
    ? settings.packages
    : (settings?.costPackage ? [settings.costPackage] : []);
  const packages = sourcePackages.map((costPackage, index) => normalizeCostPackage(costPackage, index));
  const packageIds = new Set();
  for (const costPackage of packages) {
    if (packageIds.has(costPackage.id)) {
      throw new Error(`Duplicate cost package id: ${costPackage.id}`);
    }
    packageIds.add(costPackage.id);
  }

  let activePackageId = String(settings?.activePackageId || "").trim();
  if (packages.length > 0 && !activePackageId) {
    activePackageId = packages[0].id;
  }
  const activePackage = packages.find((costPackage) => costPackage.id === activePackageId) || null;
  if (packages.length > 0 && !activePackage) {
    throw new Error("Active cost package must match one saved package.");
  }

  const costPackage = activePackage
    ? {
        id: activePackage.id,
        name: activePackage.name,
        amountCny: activePackage.amount,
        currency: activePackage.currency
      }
    : null;

  return {
    version: 1,
    configured: Boolean(activePackage),
    packages,
    activePackageId: activePackage?.id || "",
    activePackage,
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
