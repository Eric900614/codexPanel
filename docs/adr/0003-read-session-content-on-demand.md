# ADR 0003: Read Session Content On Demand

## Status

Accepted

Codex Panel will support session content preview by reading user prompt and assistant reply text only when the user opens a task or session detail view. The main synchronization path remains focused on Codex flow metadata, token events, and rate-limit windows, so the app can explain what a session was about without turning every refresh into full conversation indexing.
