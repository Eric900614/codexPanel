const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { CostSettingsStore } = require("../src/cost-settings-store");
const { UsageReader } = require("../src/usage-reader");
const { UsageSynchronization } = require("../src/usage-synchronization");

function writeJsonl(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, events.map((event) => JSON.stringify(event)).join("\n"), "utf8");
}

function tokenCountEvent(timestamp, totalTokens, lastTokens, model = "gpt-5.5", rateLimits = null) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 200000,
        total_token_usage: {
          input_tokens: Math.floor(totalTokens * 0.5),
          cached_input_tokens: Math.floor(totalTokens * 0.1),
          output_tokens: Math.floor(totalTokens * 0.3),
          reasoning_output_tokens: Math.floor(totalTokens * 0.1),
          total_tokens: totalTokens
        },
        last_token_usage: {
          input_tokens: Math.floor(lastTokens * 0.5),
          cached_input_tokens: Math.floor(lastTokens * 0.1),
          output_tokens: Math.floor(lastTokens * 0.3),
          reasoning_output_tokens: Math.floor(lastTokens * 0.1),
          total_tokens: lastTokens
        }
      },
      rate_limits: rateLimits || {
        primary: { used_percent: 12, resets_at: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) },
        secondary: { used_percent: 34, resets_at: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000) }
      }
    }
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-panel-smoke-"));
  const sessionsRoot = path.join(root, "sessions");
  const now = new Date().toISOString();

  writeJsonl(path.join(sessionsRoot, "2026", "06", "rollout-a-b-c-alpha.jsonl"), [
    {
      timestamp: now,
      type: "session_meta",
      payload: {
        id: "alpha",
        source: "electron",
        model_provider: "openai",
        cwd: "F:\\_CODE\\codexPanel",
        timestamp: now
      }
    },
    {
      timestamp: now,
      type: "turn_context",
      payload: {
        model: "gpt-5.5",
        cwd: "F:\\_CODE\\codexPanel"
      }
    },
    tokenCountEvent(now, 1200, 1200)
  ]);

  writeJsonl(path.join(sessionsRoot, "2026", "06", "rollout-a-b-c-beta.jsonl"), [
    {
      timestamp: now,
      type: "session_meta",
      payload: {
        id: "beta",
        source: "cli",
        cwd: "F:\\_CODE\\codexPanel",
        timestamp: now
      }
    },
    tokenCountEvent(now, 800, 800, "gpt-5.4")
  ]);

  writeJsonl(path.join(sessionsRoot, "2026", "06", "rollout-a-b-c-blocked.jsonl"), [
    {
      timestamp: now,
      type: "session_meta",
      payload: {
        id: "blocked",
        source: "cli",
        cwd: "F:\\_CODE\\codexPanel",
        timestamp: now
      }
    },
    tokenCountEvent(now, 400, 400, "gpt-5.4")
  ]);

  return { root, sessionsRoot };
}

function createCostFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-panel-cost-usage-"));
  const sessionsRoot = path.join(root, "sessions");

  writeJsonl(path.join(sessionsRoot, "2026", "06", "rollout-a-b-c-project-alpha.jsonl"), [
    {
      timestamp: "2026-06-05T09:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "project-alpha",
        source: "electron",
        cwd: "F:\\_CODE\\alpha",
        timestamp: "2026-06-05T09:00:00.000Z"
      }
    },
    tokenCountEvent("2026-06-05T09:30:00.000Z", 1000, 1000),
    tokenCountEvent("2026-07-02T09:30:00.000Z", 5000, 4000)
  ]);

  writeJsonl(path.join(sessionsRoot, "2026", "06", "rollout-a-b-c-project-beta.jsonl"), [
    {
      timestamp: "2026-06-10T09:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "project-beta",
        source: "cli",
        cwd: "F:\\_CODE\\beta",
        timestamp: "2026-06-10T09:00:00.000Z"
      }
    },
    tokenCountEvent("2026-06-10T09:30:00.000Z", 3000, 3000)
  ]);

  return { root, sessionsRoot };
}

function localDateForCurrentMonth(day) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0, 0);
  return date.toISOString();
}

const fixture = createFixture();

const costFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-panel-cost-"));
const costConfigDir = path.join(costFixtureRoot, "app-config");
const costSessionsRoot = path.join(costFixtureRoot, "sessions");
fs.mkdirSync(costSessionsRoot, { recursive: true });

const costStore = new CostSettingsStore({ configDir: costConfigDir });
const emptyCostSettings = costStore.getSettings();
assert.equal(emptyCostSettings.version, 1);
assert.equal(emptyCostSettings.configured, false);
assert.equal(emptyCostSettings.costPackage, null);
assert.equal(emptyCostSettings.costCycle.mode, "custom");
assert.match(emptyCostSettings.costCycle.startDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(emptyCostSettings.costCycle.endDate, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(emptyCostSettings.costCycle.effectiveStartDate, emptyCostSettings.costCycle.startDate);
assert.equal(emptyCostSettings.costCycle.effectiveEndDate, emptyCostSettings.costCycle.endDate);

const savedCostSettings = costStore.saveSettings({
  packages: [
    { id: "package-5x", name: "5x", amount: 780, currency: "CNY" },
    { id: "package-20x", name: "20x", amount: 1280, currency: "CNY" }
  ],
  activePackageId: "package-20x",
  costCycle: {
    mode: "custom",
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  }
});
assert.equal(savedCostSettings.configured, true);
assert.equal(savedCostSettings.packages.length, 2);
assert.equal(savedCostSettings.activePackageId, "package-20x");
assert.equal(savedCostSettings.activePackage.name, "20x");
assert.equal(savedCostSettings.activePackage.amount, 1280);
assert.equal(savedCostSettings.costPackage.name, "20x");
assert.equal(savedCostSettings.costPackage.amountCny, 1280);
assert.equal(savedCostSettings.costCycle.mode, "custom");
assert.equal(savedCostSettings.costCycle.effectiveStartDate, "2026-06-01");
assert.equal(savedCostSettings.costCycle.effectiveEndDate, "2026-06-30");
assert(fs.existsSync(path.join(costConfigDir, "cost-settings.json")));
assert.equal(fs.existsSync(path.join(costSessionsRoot, "cost-settings.json")), false);
assert.deepEqual(fs.readdirSync(costSessionsRoot), []);

const reloadedCostSettings = new CostSettingsStore({ configDir: costConfigDir }).getSettings();
assert.deepEqual(reloadedCostSettings, savedCostSettings);

assert.throws(() => costStore.saveSettings({
  packages: [{ id: "bad-package", name: "bad", amount: -1, currency: "CNY" }],
  activePackageId: "bad-package"
}));
assert.deepEqual(new CostSettingsStore({ configDir: costConfigDir }).getSettings(), savedCostSettings);
assert.throws(() => costStore.saveSettings({
  packages: [{ id: "bad-currency", name: "bad", amount: 1, currency: "NOT-A-CURRENCY" }],
  activePackageId: "bad-currency"
}));
assert.deepEqual(new CostSettingsStore({ configDir: costConfigDir }).getSettings(), savedCostSettings);
assert.throws(() => costStore.saveSettings({
  packages: savedCostSettings.packages,
  activePackageId: savedCostSettings.activePackageId,
  costCycle: {
    mode: "custom",
    startDate: "2026-07-01",
    endDate: "2026-06-01"
  }
}));
assert.deepEqual(new CostSettingsStore({ configDir: costConfigDir }).getSettings(), savedCostSettings);

const naturalMonthSettings = costStore.saveSettings({
  packages: savedCostSettings.packages,
  activePackageId: savedCostSettings.activePackageId,
  costCycle: {
    mode: "naturalMonth"
  }
});
assert.equal(naturalMonthSettings.costCycle.mode, "naturalMonth");
assert.match(naturalMonthSettings.costCycle.effectiveStartDate, /^\d{4}-\d{2}-01$/);
assert.match(naturalMonthSettings.costCycle.effectiveEndDate, /^\d{4}-\d{2}-\d{2}$/);

const editedCostSettings = costStore.saveSettings({
  packages: [
    { id: "package-5x", name: "5x Plus", amount: 880, currency: "CNY" },
    { id: "package-20x", name: "20x", amount: 1280, currency: "CNY" }
  ],
  activePackageId: "package-5x",
  costCycle: naturalMonthSettings.costCycle
});
assert.equal(editedCostSettings.activePackageId, "package-5x");
assert.equal(editedCostSettings.activePackage.name, "5x Plus");
assert.equal(editedCostSettings.activePackage.amount, 880);

const clearedCostSettings = costStore.saveSettings({ packages: [], activePackageId: "" });
assert.equal(clearedCostSettings.configured, false);
assert.equal(clearedCostSettings.costPackage, null);
assert.equal(clearedCostSettings.activePackage, null);

const costUsageFixture = createCostFixture();
const customCostSettings = {
  packages: [{ id: "package-20x", name: "20x", amount: 1280, currency: "CNY" }],
  activePackageId: "package-20x",
  costCycle: {
    mode: "custom",
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  }
};
const costSnapshot = new UsageReader({
  codexHome: costUsageFixture.root,
  sessionsRoot: costUsageFixture.sessionsRoot,
  costSettingsProvider: () => customCostSettings
}).reconcileFull();
assert.equal(costSnapshot.costEstimate.available, true);
assert.equal(costSnapshot.costEstimate.packageAmount, 1280);
assert.equal(costSnapshot.costEstimate.cycleTotalTokens, 4000);
assert.equal(costSnapshot.costEstimate.projects.length, 2);
assert.equal(costSnapshot.costEstimate.projects[0].project, "beta");
assert.equal(costSnapshot.costEstimate.projects[0].tokens, 3000);
assert.equal(costSnapshot.costEstimate.projects[0].allocatedCost, 960);
assert.equal(costSnapshot.costEstimate.projects[1].project, "alpha");
assert.equal(costSnapshot.costEstimate.projects[1].tokens, 1000);
assert.equal(costSnapshot.costEstimate.projects[1].allocatedCost, 320);

const lowerPackageSnapshot = new UsageReader({
  codexHome: costUsageFixture.root,
  sessionsRoot: costUsageFixture.sessionsRoot,
  costSettingsProvider: () => ({
    ...customCostSettings,
    packages: [{ id: "package-10x", name: "10x", amount: 640, currency: "CNY" }],
    activePackageId: "package-10x"
  })
}).reconcileFull();
assert.equal(lowerPackageSnapshot.costEstimate.totalAllocatedCost, 640);
assert.equal(lowerPackageSnapshot.costEstimate.projects[0].allocatedCost, 480);
assert.equal(lowerPackageSnapshot.costEstimate.projects[1].allocatedCost, 160);

const naturalMonthFixture = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-panel-natural-cost-"));
  const sessionsRoot = path.join(root, "sessions");
  writeJsonl(path.join(sessionsRoot, "current", "rollout-a-b-c-natural-alpha.jsonl"), [
    {
      timestamp: localDateForCurrentMonth(2),
      type: "session_meta",
      payload: {
        id: "natural-alpha",
        source: "electron",
        cwd: "F:\\_CODE\\natural-alpha",
        timestamp: localDateForCurrentMonth(2)
      }
    },
    tokenCountEvent(localDateForCurrentMonth(2), 2000, 2000)
  ]);
  return { root, sessionsRoot };
})();

const naturalMonthSnapshot = new UsageReader({
  codexHome: naturalMonthFixture.root,
  sessionsRoot: naturalMonthFixture.sessionsRoot,
  costSettingsProvider: () => ({
    packages: [{ id: "package-natural", name: "Natural", amount: 100, currency: "CNY" }],
    activePackageId: "package-natural",
    costCycle: { mode: "naturalMonth" }
  })
}).reconcileFull();
assert.equal(naturalMonthSnapshot.costEstimate.available, true);
assert.equal(naturalMonthSnapshot.costEstimate.cycle.mode, "naturalMonth");
assert.equal(naturalMonthSnapshot.costEstimate.cycleTotalTokens, 2000);
assert.equal(naturalMonthSnapshot.costEstimate.projects[0].allocatedCost, 100);

const noPackageSnapshot = new UsageReader({
  codexHome: costUsageFixture.root,
  sessionsRoot: costUsageFixture.sessionsRoot,
  costSettingsProvider: () => ({
    packages: [],
    activePackageId: "",
    costCycle: customCostSettings.costCycle
  })
}).reconcileFull();
assert.equal(noPackageSnapshot.costEstimate.available, false);
assert.equal(noPackageSnapshot.costEstimate.reason, "no-active-package");

const zeroTokenSnapshot = new UsageReader({
  codexHome: costUsageFixture.root,
  sessionsRoot: costUsageFixture.sessionsRoot,
  costSettingsProvider: () => ({
    ...customCostSettings,
    costCycle: {
      mode: "custom",
      startDate: "2026-08-01",
      endDate: "2026-08-31"
    }
  })
}).reconcileFull();
assert.equal(zeroTokenSnapshot.costEstimate.available, false);
assert.equal(zeroTokenSnapshot.costEstimate.reason, "zero-cycle-tokens");
assert.equal(zeroTokenSnapshot.costEstimate.cycleTotalTokens, 0);

const reader = new UsageReader({ codexHome: fixture.root, sessionsRoot: fixture.sessionsRoot });
const progressEvents = [];
const originalReadFileSync = fs.readFileSync;

fs.readFileSync = function readFixtureFile(filePath, ...args) {
  if (String(filePath).endsWith("blocked.jsonl")) {
    const error = new Error("temporary busy");
    error.code = "EBUSY";
    throw error;
  }
  return originalReadFileSync.call(fs, filePath, ...args);
};

let snapshot;
try {
  snapshot = reader.reconcileFull({
    onProgress: (progress) => progressEvents.push(progress)
  });
} finally {
  fs.readFileSync = originalReadFileSync;
}

console.log(JSON.stringify({
  sessionsRoot: snapshot.sessionsRoot,
  exists: snapshot.exists,
  scannedFileCount: snapshot.scannedFileCount,
  parsedSessionCount: snapshot.parsedSessionCount,
  tokenSessionCount: snapshot.tokenSessionCount,
  tokenEventCount: snapshot.tokenEventCount,
  totalTokens: snapshot.totals.totalTokens,
  todayTokens: snapshot.totals.todayTokens,
  hasRateLimits: Boolean(snapshot.rateLimits),
  syncErrorCount: snapshot.sync.errorCount,
  progressEvents
}, null, 2));

assert.equal(snapshot.exists, true);
assert.equal(snapshot.scannedFileCount, 3);
assert.equal(snapshot.parsedSessionCount, 3);
assert.equal(snapshot.tokenSessionCount, 2);
assert.equal(snapshot.tokenEventCount, 2);
assert.equal(snapshot.totals.totalTokens, 2000);
assert.equal(snapshot.sync.state, "idle");
assert.equal(snapshot.sync.errorCount, 1);
assert.equal(snapshot.temporaryErrors.length, 1);

assert(progressEvents.some((event) => event.state === "scanning"));
assert(progressEvents.some((event) => event.phase === "reconciling"));
assert(progressEvents.some((event) => event.state === "idle"));

const rateLimitFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-panel-rate-limits-"));
const rateLimitSessionsRoot = path.join(rateLimitFixtureRoot, "sessions");
const rateLimitResetAt = Math.floor((Date.now() + 3 * 60 * 60 * 1000) / 1000);
const rateLimitSecondaryResetAt = Math.floor((Date.now() + 6 * 24 * 60 * 60 * 1000) / 1000);
writeJsonl(path.join(rateLimitSessionsRoot, "2026", "06", "rollout-a-b-c-higher.jsonl"), [
  {
    timestamp: new Date(Date.now() - 2000).toISOString(),
    type: "session_meta",
    payload: { id: "higher", source: "electron", timestamp: new Date(Date.now() - 2000).toISOString() }
  },
  tokenCountEvent(new Date(Date.now() - 1000).toISOString(), 1000, 1000, "gpt-5.5", {
    primary: { used_percent: 30, resets_at: rateLimitResetAt },
    secondary: { used_percent: 10, resets_at: rateLimitSecondaryResetAt }
  })
]);
writeJsonl(path.join(rateLimitSessionsRoot, "2026", "06", "rollout-a-b-c-older-window.jsonl"), [
  {
    timestamp: new Date(Date.now() - 1500).toISOString(),
    type: "session_meta",
    payload: { id: "older-window", source: "electron", timestamp: new Date(Date.now() - 1500).toISOString() }
  },
  tokenCountEvent(new Date(Date.now() - 500).toISOString(), 1000, 1000, "gpt-5.5", {
    primary: { used_percent: 80, resets_at: rateLimitResetAt + 60 * 60 },
    secondary: { used_percent: 99, resets_at: rateLimitSecondaryResetAt + 60 * 60 }
  })
]);
writeJsonl(path.join(rateLimitSessionsRoot, "2026", "06", "rollout-a-b-c-lower-later.jsonl"), [
  {
    timestamp: new Date().toISOString(),
    type: "session_meta",
    payload: { id: "lower-later", source: "electron", timestamp: new Date().toISOString() }
  },
  tokenCountEvent(new Date().toISOString(), 1000, 1000, "gpt-5.5", {
    primary: { used_percent: 26, resets_at: rateLimitResetAt },
    secondary: { used_percent: 9, resets_at: rateLimitSecondaryResetAt }
  })
]);

const rateLimitSnapshot = new UsageReader({
  codexHome: rateLimitFixtureRoot,
  sessionsRoot: rateLimitSessionsRoot
}).reconcileFull();
assert.equal(rateLimitSnapshot.rateLimits.primary.used_percent, 30);
assert.equal(rateLimitSnapshot.rateLimits.primary.resets_at, rateLimitResetAt);
assert.equal(rateLimitSnapshot.rateLimits.secondary.used_percent, 10);
assert.equal(rateLimitSnapshot.rateLimits.secondary.resets_at, rateLimitSecondaryResetAt);

const parsingEvents = progressEvents.filter((event) => event.phase === "reconciling");
assert(parsingEvents.length >= 2);
assert.deepEqual(
  parsingEvents.at(-1),
  {
    state: "reconciling",
    phase: "reconciling",
    processedFileCount: 3,
    totalFileCount: 3,
    message: "Parsed 3 of 3 session files.",
    errorCount: 1
  }
);

const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-panel-empty-"));
const emptySessionsRoot = path.join(emptyRoot, "sessions");
fs.mkdirSync(emptySessionsRoot, { recursive: true });
const emptyProgressEvents = [];
const emptySnapshot = new UsageReader({ codexHome: emptyRoot, sessionsRoot: emptySessionsRoot }).reconcileFull({
  onProgress: (progress) => emptyProgressEvents.push(progress)
});

assert.equal(emptySnapshot.exists, true);
assert.equal(emptySnapshot.scannedFileCount, 0);
assert(emptyProgressEvents.some((event) => event.state === "scanning"));
assert(emptyProgressEvents.some((event) => (
  event.state === "reconciling" &&
  event.processedFileCount === 0 &&
  event.totalFileCount === 0
)));
assert(emptyProgressEvents.some((event) => event.state === "idle"));

const cachedFixture = createFixture();
const cachedReader = new UsageReader({
  codexHome: cachedFixture.root,
  sessionsRoot: cachedFixture.sessionsRoot
});
const cachedInitialSnapshot = cachedReader.reconcileFull();
const cachedAlphaPath = path.join(cachedFixture.sessionsRoot, "2026", "06", "rollout-a-b-c-alpha.jsonl");
const cachedProgressEvents = [];

assert.equal(cachedInitialSnapshot.totals.totalTokens, 2400);
fs.appendFileSync(cachedAlphaPath, "\n", "utf8");

fs.readFileSync = function readCachedFixtureFile(filePath, ...args) {
  if (String(filePath).endsWith("alpha.jsonl")) {
    const error = new Error("temporary busy");
    error.code = "EBUSY";
    throw error;
  }
  return originalReadFileSync.call(fs, filePath, ...args);
};

let cachedErrorSnapshot;
try {
  cachedErrorSnapshot = cachedReader.reconcileFull({
    onProgress: (progress) => cachedProgressEvents.push(progress)
  });
} finally {
  fs.readFileSync = originalReadFileSync;
}

assert.equal(cachedErrorSnapshot.totals.totalTokens, 2400);
assert.equal(cachedErrorSnapshot.tokenSessionCount, 3);
assert.equal(cachedErrorSnapshot.sync.errorCount, 1);
assert.equal(cachedErrorSnapshot.temporaryErrors.length, 1);
assert.equal(cachedErrorSnapshot.temporaryErrors[0].fileName, "rollout-a-b-c-alpha.jsonl");
assert.equal(cachedProgressEvents.at(-1).state, "idle");
assert.equal(cachedProgressEvents.at(-1).errorCount, 1);

const pushedSnapshots = [];
const pushedProgressEvents = [];
const fakeReader = {
  nextSnapshotId: 1,
  reconcileFull({ onProgress } = {}) {
    onProgress?.({
      state: "scanning",
      phase: "scanning",
      processedFileCount: 0,
      totalFileCount: null,
      message: "Scanning.",
      errorCount: 0
    });
    onProgress?.({
      state: "idle",
      phase: "idle",
      processedFileCount: 1,
      totalFileCount: 1,
      message: "Done.",
      errorCount: 0
    });
    return {
      exists: true,
      scannedFileCount: this.nextSnapshotId,
      sync: {
        state: "idle",
        phase: "idle",
        processedFileCount: 1,
        totalFileCount: 1,
        message: "Done.",
        errorCount: 0
      },
      marker: `snapshot-${this.nextSnapshotId++}`
    };
  },
  reconcileIncremental({ onProgress } = {}) {
    onProgress?.({
      state: "idle",
      phase: "idle",
      processedFileCount: 1,
      totalFileCount: 1,
      message: "Incremental done.",
      errorCount: 0
    });
    return {
      exists: true,
      scannedFileCount: this.nextSnapshotId,
      sync: {
        state: "idle",
        phase: "idle",
        processedFileCount: 1,
        totalFileCount: 1,
        message: "Incremental done.",
        errorCount: 0
      },
      marker: `incremental-${this.nextSnapshotId++}`
    };
  }
};
const synchronization = new UsageSynchronization({
  reader: fakeReader,
  publishSnapshot: (snapshot) => pushedSnapshots.push(snapshot),
  publishProgress: (progress) => pushedProgressEvents.push(progress)
});

const startupSnapshot = synchronization.getSnapshot();
assert.equal(startupSnapshot.marker, "snapshot-1");
assert.equal(pushedSnapshots.length, 1);
assert.equal(pushedSnapshots[0].marker, "snapshot-1");
assert(pushedProgressEvents.some((event) => event.state === "scanning"));
assert(pushedProgressEvents.some((event) => event.state === "idle"));

const cachedStartupSnapshot = synchronization.getSnapshot();
assert.equal(cachedStartupSnapshot.marker, "snapshot-1");
assert.equal(pushedSnapshots.length, 1);

synchronization.refreshFull();
assert.equal(pushedSnapshots.length, 2);
assert.equal(pushedSnapshots[1].marker, "snapshot-2");

synchronization.syncIncremental();
assert.equal(pushedSnapshots.length, 3);
assert.equal(pushedSnapshots[2].marker, "incremental-3");
synchronization.stop();

function createTimerHarness() {
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  const clearedTimeouts = [];
  const clearedIntervals = [];

  return {
    setTimeout(callback, delayMs) {
      const id = nextId++;
      timeouts.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout(id) {
      clearedTimeouts.push(id);
      timeouts.delete(id);
    },
    setInterval(callback, delayMs) {
      const id = nextId++;
      intervals.set(id, { callback, delayMs });
      return id;
    },
    clearInterval(id) {
      clearedIntervals.push(id);
      intervals.delete(id);
    },
    runTimeouts() {
      const pending = Array.from(timeouts.entries());
      timeouts.clear();
      pending.forEach(([, timer]) => timer.callback());
    },
    runIntervals() {
      Array.from(intervals.values()).forEach((timer) => timer.callback());
    },
    timeouts,
    intervals,
    clearedTimeouts,
    clearedIntervals
  };
}

const watchTimerHarness = createTimerHarness();
const watcherEvents = [];
const watcherCloses = [];
const watcherCallOrder = [];
const watcherReader = {
  sessionsRoot: path.join(os.tmpdir(), "codex-panel-watch-sessions"),
  reconcileFull({ onProgress } = {}) {
    watcherCallOrder.push("full");
    onProgress?.({
      state: "idle",
      phase: "idle",
      processedFileCount: 1,
      totalFileCount: 1,
      message: "Full done.",
      errorCount: 0
    });
    return {
      exists: true,
      scannedFileCount: watcherCallOrder.length,
      sync: { state: "idle", phase: "idle", processedFileCount: 1, totalFileCount: 1, message: "Full done.", errorCount: 0 },
      marker: `full-${watcherCallOrder.length}`
    };
  },
  reconcileIncremental({ onProgress } = {}) {
    watcherCallOrder.push("incremental");
    onProgress?.({
      state: "idle",
      phase: "idle",
      processedFileCount: 1,
      totalFileCount: 1,
      message: "Incremental done.",
      errorCount: 0
    });
    return {
      exists: true,
      scannedFileCount: watcherCallOrder.length,
      sync: { state: "idle", phase: "idle", processedFileCount: 1, totalFileCount: 1, message: "Incremental done.", errorCount: 0 },
      marker: `incremental-${watcherCallOrder.length}`
    };
  }
};
const watcherSync = new UsageSynchronization({
  reader: watcherReader,
  publishSnapshot: (snapshot) => watcherEvents.push(snapshot.marker),
  publishProgress: () => {},
  debounceMs: 25,
  reconcileIntervalMs: 60000,
  watchFactory: (root, onChange) => {
    assert.equal(root, watcherReader.sessionsRoot);
    watcherEvents.push("watch-started");
    watcherEvents.push(onChange);
    return {
      close() {
        watcherCloses.push("closed");
      }
    };
  },
  setTimeout: watchTimerHarness.setTimeout,
  clearTimeout: watchTimerHarness.clearTimeout,
  setInterval: watchTimerHarness.setInterval,
  clearInterval: watchTimerHarness.clearInterval
});

watcherSync.start();
assert.deepEqual(watcherCallOrder, ["full"]);
assert.equal(watchTimerHarness.intervals.size, 1);
assert.equal(Array.from(watchTimerHarness.intervals.values())[0].delayMs, 60000);

const emitWatcherChange = watcherEvents.find((event) => typeof event === "function");
emitWatcherChange({ eventType: "change", filename: "2026\\06\\rollout-a-b-c-alpha.jsonl" });
emitWatcherChange({ eventType: "change", filename: "2026\\06\\rollout-a-b-c-alpha.jsonl" });
assert.equal(watchTimerHarness.timeouts.size, 1);
assert.equal(Array.from(watchTimerHarness.timeouts.values())[0].delayMs, 25);
watchTimerHarness.runTimeouts();
assert.deepEqual(watcherCallOrder, ["full", "incremental"]);
assert.equal(watcherEvents.at(-1), "incremental-2");

emitWatcherChange({ eventType: "change", filename: "2026\\06\\rollout-a-b-c-beta.jsonl" });
watcherSync.refreshFull();
assert.deepEqual(watcherCallOrder, ["full", "incremental", "full"]);
watchTimerHarness.runTimeouts();
assert.deepEqual(watcherCallOrder, ["full", "incremental", "full"]);

watchTimerHarness.runIntervals();
assert.deepEqual(watcherCallOrder, ["full", "incremental", "full", "incremental"]);

watcherSync.stop();
assert.equal(watcherCloses.length, 1);
assert.equal(watchTimerHarness.intervals.size, 0);
assert(watchTimerHarness.clearedIntervals.length > 0);

const backstopFixture = createFixture();
const backstopReader = new UsageReader({
  codexHome: backstopFixture.root,
  sessionsRoot: backstopFixture.sessionsRoot
});
const backstopTimerHarness = createTimerHarness();
const backstopSnapshots = [];
const backstopSync = new UsageSynchronization({
  reader: backstopReader,
  publishSnapshot: (snapshot) => backstopSnapshots.push(snapshot),
  publishProgress: () => {},
  watchFactory: () => ({ close() {} }),
  setTimeout: backstopTimerHarness.setTimeout,
  clearTimeout: backstopTimerHarness.clearTimeout,
  setInterval: backstopTimerHarness.setInterval,
  clearInterval: backstopTimerHarness.clearInterval
});
const backstopAlphaPath = path.join(
  backstopFixture.sessionsRoot,
  "2026",
  "06",
  "rollout-a-b-c-alpha.jsonl"
);

backstopSync.start();
assert.equal(backstopSnapshots.at(-1).totals.totalTokens, 2400);
fs.appendFileSync(
  backstopAlphaPath,
  `\n${JSON.stringify(tokenCountEvent(new Date().toISOString(), 1800, 600))}`,
  "utf8"
);
backstopTimerHarness.runIntervals();
assert.equal(backstopSnapshots.at(-1).totals.totalTokens, 3000);
backstopSync.stop();

const incrementalFixture = createFixture();
const incrementalReader = new UsageReader({
  codexHome: incrementalFixture.root,
  sessionsRoot: incrementalFixture.sessionsRoot
});
const incrementalInitialSnapshot = incrementalReader.reconcileFull();
const incrementalAlphaPath = path.join(
  incrementalFixture.sessionsRoot,
  "2026",
  "06",
  "rollout-a-b-c-alpha.jsonl"
);
const incrementalStartSize = fs.statSync(incrementalAlphaPath).size;
const incrementalAppend = [
  "",
  JSON.stringify(tokenCountEvent(new Date().toISOString(), 1800, 600)),
  "{\"type\":\"bad json\"",
  JSON.stringify(tokenCountEvent(new Date().toISOString(), 2400, 600)).slice(0, 30)
].join("\n");

assert.equal(incrementalInitialSnapshot.totals.totalTokens, 2400);
fs.appendFileSync(incrementalAlphaPath, incrementalAppend, "utf8");

const incrementalReads = [];
const originalOpenSync = fs.openSync;
const originalReadSync = fs.readSync;
const originalCloseSync = fs.closeSync;
const incrementalOpenFds = new Set();
const incrementalClosedFds = new Set();
fs.openSync = function openIncrementalFile(filePath, ...args) {
  const fd = originalOpenSync.call(fs, filePath, ...args);
  incrementalOpenFds.add(fd);
  return fd;
};
fs.readSync = function readIncrementalFile(fd, buffer, offset, length, position) {
  incrementalReads.push({ length, position });
  return originalReadSync.call(fs, fd, buffer, offset, length, position);
};
fs.closeSync = function closeIncrementalFile(fd) {
  incrementalClosedFds.add(fd);
  return originalCloseSync.call(fs, fd);
};

let incrementalSnapshot;
try {
  incrementalSnapshot = incrementalReader.reconcileIncremental();
} finally {
  fs.openSync = originalOpenSync;
  fs.readSync = originalReadSync;
  fs.closeSync = originalCloseSync;
}

assert.equal(incrementalSnapshot.totals.totalTokens, 3000);
assert(incrementalReads.some((read) => (
  read.position === incrementalStartSize &&
  read.length === Buffer.byteLength(incrementalAppend)
)));
assert.equal(incrementalOpenFds.size, incrementalClosedFds.size);

fs.appendFileSync(
  incrementalAlphaPath,
  `${JSON.stringify(tokenCountEvent(new Date().toISOString(), 2400, 600)).slice(30)}\n`,
  "utf8"
);
const completedPartialSnapshot = incrementalReader.reconcileIncremental();
assert.equal(completedPartialSnapshot.totals.totalTokens, 3600);

const initialPartialFixture = createFixture();
const initialPartialReader = new UsageReader({
  codexHome: initialPartialFixture.root,
  sessionsRoot: initialPartialFixture.sessionsRoot
});
const initialPartialAlphaPath = path.join(
  initialPartialFixture.sessionsRoot,
  "2026",
  "06",
  "rollout-a-b-c-alpha.jsonl"
);
const initialPartialLine = JSON.stringify(tokenCountEvent(new Date().toISOString(), 3000, 600));
fs.appendFileSync(initialPartialAlphaPath, `\n${initialPartialLine.slice(0, 40)}`, "utf8");
const initialPartialSnapshot = initialPartialReader.reconcileFull();
assert.equal(initialPartialSnapshot.totals.totalTokens, 2400);

fs.appendFileSync(initialPartialAlphaPath, `${initialPartialLine.slice(40)}\n`, "utf8");
const completedInitialPartialSnapshot = initialPartialReader.reconcileIncremental();
assert.equal(completedInitialPartialSnapshot.totals.totalTokens, 4200);
