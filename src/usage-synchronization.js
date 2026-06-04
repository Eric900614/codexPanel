class UsageSynchronization {
  constructor({ reader, publishSnapshot, publishProgress }) {
    this.reader = reader;
    this.publishSnapshot = typeof publishSnapshot === "function" ? publishSnapshot : () => {};
    this.publishProgress = typeof publishProgress === "function" ? publishProgress : () => {};
    this.latestSnapshot = null;
  }

  start() {
    if (this.latestSnapshot) {
      this.publishSnapshot(this.latestSnapshot);
      return this.latestSnapshot;
    }
    return this.refreshFull();
  }

  refreshFull() {
    const snapshot = this.reader.reconcileFull({
      onProgress: (progress) => this.publishProgress(progress)
    });
    this.latestSnapshot = snapshot;
    this.publishSnapshot(snapshot);
    return snapshot;
  }

  syncIncremental() {
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
}

module.exports = {
  UsageSynchronization
};
