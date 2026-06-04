# ADR 0001: Read Local Codex Usage Records

## Status

Accepted

## Context

The dashboard needs to show Codex App and Codex CLI usage on Windows in near real time. The local Codex runtime writes session JSONL files under `%USERPROFILE%\.codex\sessions`. Those files include structured `token_count` events with token totals and rate-limit window data.

## Decision

Build the desktop meter as a local Electron app that reads `%USERPROFILE%\.codex\sessions` directly. The app scans JSONL session files, parses only structured metadata and `token_count` events, and refreshes the UI on a short polling interval.

## Consequences

- The app works without an OpenAI API key or remote usage API.
- The app reflects the local machine's Codex App and CLI history.
- The app does not claim to show organization-wide usage or server-side billing totals.
- If Codex changes the local session schema, the reader will need to be updated.
