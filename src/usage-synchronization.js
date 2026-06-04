const fs = require("node:fs");

const DEFAULT_DEBOUNCE_MS = 350;
const DEFAULT_RECONCILE_INTERVAL_MS = 60 * 1000;

function defaultWatchFactory(root, onChange) {
  const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
    onChange({
      eventType,
      filename: filename ? String(filename) : ""
    });
  });
  watcher.on("error", (error) => onChange({ error }));
  return watcher;
}

class UsageSynchronization {
  constructor({
    reader,
    publishSnapshot,
    publishProgress,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
    watchFactory = defaultWatchFactory,
    setTimeout: setTimeoutFn = setTimeout,
    clearTimeout: clearTimeoutFn = clearTimeout,
    setInterval: setIntervalFn = setInterval,
    clearInterval: clearIntervalFn = clearInterval
  }) {
    this.reader = reader;
    this.publishSnapshot = typeof publishSnapshot === "function" ? publishSnapshot : () => {};
    this.publishProgress = typeof publishProgress === "function" ? publishProgress : () => {};
    this.latestSnapshot = null;
    this.debounceMs = debounceMs;
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.watchFactory = watchFactory;
    this.setTimeout = setTimeoutFn;
    this.clearTimeout = clearTimeoutFn;
    this.setInterval = setIntervalFn;
    this.clearInterval = clearIntervalFn;
    this.started = false;
    this.watcher = null;
    this.reconcileTimer = null;
    this.debounceTimer = null;
    this.watchErrorMessage = "";
  }

  start() {
    this.ensureStarted();
    if (this.latestSnapshot) {
      this.publishSnapshot(this.latestSnapshot);
      return this.latestSnapshot;
    }
    return this.refreshFull();
  }

  ensureStarted() {
    if (!this.started) {
      this.started = true;
      this.startReconcileBackstop();
    }
    this.startWatching();
  }

  startWatching() {
    if (this.watcher || !this.reader?.sessionsRoot) return;

    try {
      this.watcher = this.watchFactory(this.reader.sessionsRoot, (change) => {
        this.handleWatcherChange(change);
      });
      this.watchErrorMessage = "";
    } catch (error) {
      this.publishWatcherError(error);
    }
  }

  startReconcileBackstop() {
    if (this.reconcileTimer || this.reconcileIntervalMs <= 0) return;
    this.reconcileTimer = this.setInterval(() => {
      this.syncIncremental();
    }, this.reconcileIntervalMs);
  }

  handleWatcherChange(change = {}) {
    if (!this.started) return;
    if (change.error) {
      this.publishWatcherError(change.error);
      this.closeWatcher();
      return;
    }
    const filename = change.filename ? String(change.filename) : "";
    if (filename && !filename.toLowerCase().endsWith(".jsonl")) return;
    this.scheduleIncrementalSync();
  }

  publishWatcherError(error) {
    const message = error?.message || String(error);
    if (message === this.watchErrorMessage) return;

    this.watchErrorMessage = message;
    this.publishProgress({
      state: "idle",
      phase: "error",
      processedFileCount: 0,
      totalFileCount: 0,
      message,
      errorCount: 1
    });
  }

  closeWatcher() {
    if (this.watcher && typeof this.watcher.close === "function") {
      try {
        this.watcher.close();
      } catch {
        // Watchers can already be closed after filesystem errors.
      }
    }
    this.watcher = null;
  }

  scheduleIncrementalSync() {
    if (!this.started) return;
    if (this.debounceTimer) {
      this.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = this.setTimeout(() => {
      this.debounceTimer = null;
      this.syncIncremental();
    }, this.debounceMs);
  }

  cancelPendingIncremental() {
    if (!this.debounceTimer) return;
    this.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  refreshFull() {
    this.ensureStarted();
    this.cancelPendingIncremental();
    const snapshot = this.reader.reconcileFull({
      onProgress: (progress) => this.publishProgress(progress)
    });
    this.latestSnapshot = snapshot;
    this.publishSnapshot(snapshot);
    return snapshot;
  }

  syncIncremental() {
    this.ensureStarted();
    const snapshot = this.reader.reconcileIncremental({
      onProgress: (progress) => this.publishProgress(progress)
    });
    this.latestSnapshot = snapshot;
    this.publishSnapshot(snapshot);
    return snapshot;
  }

  getLatestSnapshot() {
    return this.latestSnapshot;
  }

  getSnapshot() {
    return this.latestSnapshot || this.start();
  }

  stop() {
    this.started = false;
    this.cancelPendingIncremental();
    if (this.reconcileTimer) {
      this.clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.closeWatcher();
  }
}

module.exports = {
  UsageSynchronization
};
