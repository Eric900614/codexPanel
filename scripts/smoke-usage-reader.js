const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { UsageReader } = require("../src/usage-reader");
const { UsageSynchronization } = require("../src/usage-synchronization");

function writeJsonl(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, events.map((event) => JSON.stringify(event)).join("\n"), "utf8");
}

function tokenCountEvent(timestamp, totalTokens, lastTokens, model = "gpt-5.5") {
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
      rate_limits: {
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

const fixture = createFixture();
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
