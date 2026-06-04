const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { UsageReader } = require("../src/usage-reader");

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
