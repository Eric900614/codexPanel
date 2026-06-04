const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DAY_MS = 24 * 60 * 60 * 1000;

function getDefaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 1000000000000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfLocalDay(time = Date.now()) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfLocalMonth(time = Date.now()) {
  const date = new Date(time);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addToMap(map, key, tokens) {
  const safeKey = key || "unknown";
  map.set(safeKey, (map.get(safeKey) || 0) + (tokens || 0));
}

function normalizeSource(source) {
  if (!source) return "Unknown";
  if (typeof source === "object") {
    if (source.subagent) return "Sub-agent";
    return "Other";
  }
  if (source === "cli") return "CLI";
  if (source === "vscode" || source === "electron" || source === "app") return "Codex App";
  if (source.startsWith("{")) return "Sub-agent";
  return source;
}

function formatPathProject(cwd) {
  if (!cwd) return "Projectless";
  return path.basename(cwd) || cwd;
}

function walkJsonlFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

class UsageReader {
  constructor(options = {}) {
    this.codexHome = options.codexHome || getDefaultCodexHome();
    this.sessionsRoot = options.sessionsRoot || path.join(this.codexHome, "sessions");
    this.cache = new Map();
  }

  setCodexHome(codexHome) {
    this.codexHome = codexHome || getDefaultCodexHome();
    this.sessionsRoot = path.join(this.codexHome, "sessions");
    this.cache.clear();
  }

  getSnapshot() {
    return this.reconcileFull();
  }

  reconcileFull(options = {}) {
    const startedAt = Date.now();
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

    emitProgress(onProgress, {
      state: "scanning",
      phase: "scanning",
      processedFileCount: 0,
      totalFileCount: null,
      message: "Scanning Codex session files.",
      errorCount: 0
    });

    const files = walkJsonlFiles(this.sessionsRoot);
    emitProgress(onProgress, {
      state: "scanning",
      phase: "scanning",
      processedFileCount: files.length,
      totalFileCount: files.length,
      message: `Found ${files.length} session files.`,
      errorCount: 0
    });

    const sessions = [];
    let errorCount = 0;
    if (files.length === 0) {
      emitProgress(onProgress, {
        state: "reconciling",
        phase: "reconciling",
        processedFileCount: 0,
        totalFileCount: 0,
        message: "No session files to parse.",
        errorCount: 0
      });
    }

    files.forEach((filePath, index) => {
      const session = this.parseSession(filePath);
      if (session) {
        sessions.push(session);
        if (session.error) errorCount += 1;
      }

      emitProgress(onProgress, {
        state: "reconciling",
        phase: "reconciling",
        processedFileCount: index + 1,
        totalFileCount: files.length,
        message: `Parsed ${index + 1} of ${files.length} session files.`,
        errorCount
      });
    });

    const finalSync = {
      state: "idle",
      phase: "idle",
      processedFileCount: files.length,
      totalFileCount: files.length,
      message: errorCount > 0
        ? `Refresh finished with ${errorCount} temporary read error${errorCount === 1 ? "" : "s"}.`
        : "Refresh complete.",
      errorCount
    };

    const snapshot = buildSnapshot({
      codexHome: this.codexHome,
      sessionsRoot: this.sessionsRoot,
      sessions,
      scannedFileCount: files.length,
      elapsedMs: Date.now() - startedAt,
      sync: finalSync
    });
    emitProgress(onProgress, finalSync);
    return snapshot;
  }

  parseSession(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return null;
    }

    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.session;
    }

    let text = "";
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      return buildReadErrorSession(filePath, stat, error, cached);
    }

    const session = {
      id: "",
      filePath,
      fileName: path.basename(filePath),
      source: "unknown",
      sourceLabel: "Unknown",
      model: "",
      modelProvider: "",
      cwd: "",
      project: "Projectless",
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
      eventCount: 0,
      tokenEventCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      lastTokens: 0,
      contextWindow: 0,
      latestRateLimits: null,
      tokenEvents: []
    };

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      session.eventCount += 1;
      const payload = event.payload || {};
      const eventTime = toMs(event.timestamp);
      if (eventTime) {
        session.updatedAt = Math.max(session.updatedAt, eventTime);
      }

      if (event.type === "session_meta") {
        session.id = payload.id || session.id;
        session.source = payload.source || payload.originator || session.source;
        session.sourceLabel = normalizeSource(session.source);
        session.modelProvider = payload.model_provider || session.modelProvider;
        session.cwd = payload.cwd || session.cwd;
        session.project = formatPathProject(session.cwd);
        session.createdAt = toMs(payload.timestamp) || session.createdAt;
      }

      if (event.type === "turn_context") {
        session.model = payload.model || session.model;
        session.cwd = payload.cwd || session.cwd;
        session.project = formatPathProject(session.cwd);
      }

      if (event.type === "event_msg" && payload.type === "token_count") {
        session.tokenEventCount += 1;
        const info = payload.info || {};
        const total = info.total_token_usage || {};
        const last = info.last_token_usage || {};
        const tokenEventTime = eventTime || stat.mtimeMs;

        session.inputTokens = total.input_tokens || 0;
        session.cachedInputTokens = total.cached_input_tokens || 0;
        session.outputTokens = total.output_tokens || 0;
        session.reasoningOutputTokens = total.reasoning_output_tokens || 0;
        session.totalTokens = total.total_tokens || 0;
        session.lastTokens = last.total_tokens || 0;
        session.contextWindow = info.model_context_window || session.contextWindow;
        session.latestRateLimits = payload.rate_limits || session.latestRateLimits;
        session.tokenEvents.push({
          timestamp: tokenEventTime,
          totalTokens: total.total_tokens || 0,
          lastTokens: last.total_tokens || 0,
          inputTokens: last.input_tokens || 0,
          cachedInputTokens: last.cached_input_tokens || 0,
          outputTokens: last.output_tokens || 0,
          reasoningOutputTokens: last.reasoning_output_tokens || 0
        });
      }
    }

    if (!session.id) {
      const match = path.basename(filePath).match(/rollout-[^-]+-[^-]+-[^-]+-(.+)\.jsonl$/);
      session.id = match ? match[1] : path.basename(filePath, ".jsonl");
    }

    session.sourceLabel = normalizeSource(session.source);
    session.project = formatPathProject(session.cwd);

    this.cache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      session
    });

    return session;
  }
}

function emitProgress(onProgress, progress) {
  if (onProgress) onProgress(progress);
}

function buildReadErrorSession(filePath, stat, error, cached) {
  const fallback = cached?.session;
  if (fallback) {
    return {
      ...fallback,
      filePath,
      fileName: path.basename(filePath),
      error: error.message,
      updatedAt: Math.max(fallback.updatedAt || 0, stat.mtimeMs || 0)
    };
  }

  return {
    filePath,
    fileName: path.basename(filePath),
    error: error.message,
    updatedAt: stat.mtimeMs,
    totalTokens: 0
  };
}

function latestRateLimit(sessions) {
  return sessions
    .filter((session) => session.latestRateLimits)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.latestRateLimits || null;
}

function buildDistribution(map) {
  const entries = Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((sum, item) => sum + item.value, 0);
  return entries.map((item) => ({
    ...item,
    percent: total > 0 ? item.value / total : 0
  }));
}

function sumEventsSince(session, startTime) {
  if (!session.tokenEvents || session.tokenEvents.length === 0) {
    return session.updatedAt >= startTime ? session.totalTokens || 0 : 0;
  }

  return session.tokenEvents.reduce((sum, event) => {
    return event.timestamp >= startTime ? sum + (event.lastTokens || 0) : sum;
  }, 0);
}

function buildSnapshot({ codexHome, sessionsRoot, sessions, scannedFileCount, elapsedMs, sync = null }) {
  const now = Date.now();
  const todayStart = startOfLocalDay(now);
  const weekStart = now - 7 * DAY_MS;
  const monthStart = startOfLocalMonth(now);
  const sourceMap = new Map();
  const modelMap = new Map();
  const projectMap = new Map();

  let todayTokens = 0;
  let weekTokens = 0;
  let monthTokens = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let tokenEventCount = 0;

  for (const session of sessions) {
    const tokens = session.totalTokens || 0;
    const todaySessionTokens = sumEventsSince(session, todayStart);
    const weekSessionTokens = sumEventsSince(session, weekStart);
    const monthSessionTokens = sumEventsSince(session, monthStart);

    totalTokens += tokens;
    inputTokens += session.inputTokens || 0;
    cachedInputTokens += session.cachedInputTokens || 0;
    outputTokens += session.outputTokens || 0;
    reasoningOutputTokens += session.reasoningOutputTokens || 0;
    tokenEventCount += session.tokenEventCount || 0;

    todayTokens += todaySessionTokens;
    weekTokens += weekSessionTokens;
    monthTokens += monthSessionTokens;

    addToMap(sourceMap, session.sourceLabel, monthSessionTokens);
    addToMap(modelMap, session.model || "unknown model", tokens);
    addToMap(projectMap, session.project, monthSessionTokens);
  }

  const activeSessions = sessions
    .filter((session) => session.totalTokens > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const rateLimits = latestRateLimit(activeSessions);
  const temporaryErrors = sessions
    .filter((session) => session.error)
    .map((session) => ({
      fileName: session.fileName,
      message: session.error
    }));

  return {
    generatedAt: now,
    codexHome,
    sessionsRoot,
    exists: fs.existsSync(sessionsRoot),
    scannedFileCount,
    parsedSessionCount: sessions.length,
    tokenSessionCount: activeSessions.length,
    tokenEventCount,
    elapsedMs,
    totals: {
      totalTokens,
      todayTokens,
      weekTokens,
      monthTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens
    },
    rateLimits,
    distributions: {
      source: buildDistribution(sourceMap),
      model: buildDistribution(modelMap),
      project: buildDistribution(projectMap)
    },
    recentSessions: activeSessions.slice(0, 12).map((session) => ({
      id: session.id,
      fileName: session.fileName,
      source: session.sourceLabel,
      model: session.model || "unknown model",
      project: session.project,
      totalTokens: session.totalTokens,
      lastTokens: session.lastTokens,
      updatedAt: session.updatedAt,
      contextWindow: session.contextWindow
    })),
    sync: sync || {
      state: "idle",
      phase: "idle",
      processedFileCount: scannedFileCount,
      totalFileCount: scannedFileCount,
      message: "Snapshot ready.",
      errorCount: temporaryErrors.length
    },
    temporaryErrors
  };
}

module.exports = {
  UsageReader,
  buildSnapshot,
  getDefaultCodexHome,
  normalizeSource
};
