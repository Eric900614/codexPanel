const { UsageReader } = require("../src/usage-reader");

const reader = new UsageReader();
const snapshot = reader.getSnapshot();

console.log(JSON.stringify({
  codexHome: snapshot.codexHome,
  sessionsRoot: snapshot.sessionsRoot,
  exists: snapshot.exists,
  scannedFileCount: snapshot.scannedFileCount,
  parsedSessionCount: snapshot.parsedSessionCount,
  tokenSessionCount: snapshot.tokenSessionCount,
  tokenEventCount: snapshot.tokenEventCount,
  totalTokens: snapshot.totals.totalTokens,
  todayTokens: snapshot.totals.todayTokens,
  weekTokens: snapshot.totals.weekTokens,
  monthTokens: snapshot.totals.monthTokens,
  hasRateLimits: Boolean(snapshot.rateLimits),
  sourceBuckets: snapshot.distributions.source.map((item) => item.label),
  elapsedMs: snapshot.elapsedMs
}, null, 2));

if (!snapshot.exists) {
  console.error("Codex sessions directory was not found.");
  process.exit(1);
}

if (snapshot.scannedFileCount === 0) {
  console.error("No Codex session JSONL files were found.");
  process.exit(1);
}
