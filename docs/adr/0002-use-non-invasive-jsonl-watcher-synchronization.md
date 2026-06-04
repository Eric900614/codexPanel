# ADR 0002: Use Non-Invasive JSONL Watcher Synchronization

## Status

Accepted

## Context

The desktop meter currently refreshes by periodically asking the main process for a full usage snapshot. That works for smoke testing, but it can become expensive as local Codex history grows. A long scan also needs visible feedback so users do not confuse normal work with a frozen app.

Codex App and Codex CLI write local session JSONL files under `%USERPROFILE%\.codex\sessions`. These JSONL files include structured `token_count` events and rate-limit window data.

## Decision

Use Codex session JSONL files as the only source of truth for usage data.

Replace renderer-driven polling with main-process synchronization:

- Watch the Codex sessions directory for changes.
- Debounce filesystem events before processing.
- Tail only newly appended JSONL bytes after the initial reconcile.
- Keep file offsets and partial-line buffers in memory for the first implementation.
- Run a 60-second reconcile as a backstop for missed watcher events.
- Let the manual refresh button trigger an immediate full reconcile.
- Push snapshots from the main process to the renderer.

Expose synchronization state as part of the app experience. Every synchronization should show a progress indicator. The status should include the current phase, processed files, total files when known, and retry/degraded counts when relevant.

The reader must be non-invasive:

- Do not write to Codex directories.
- Do not modify, move, or delete Codex session files.
- Do not keep long-lived file handles open on Codex session files.
- Open files only long enough to read the needed bytes, then close them.
- Treat partial JSONL lines as normal while Codex is writing.
- Do not interrupt the snapshot if a file is temporarily unreadable.
- Keep the previous snapshot visible while retrying failed reads.

## Consequences

- The app uses less idle CPU than periodic full scans.
- UI updates become closer to real time.
- Users can see progress during long initial scans or manual refreshes.
- Startup still performs a full reconcile because offsets are not persisted.
- Offset persistence or an app-owned SQLite index can be added later if startup scanning becomes too slow.
- The implementation must handle duplicate, coalesced, or missed filesystem watcher events.
