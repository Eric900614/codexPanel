# Codex Panel

Windows desktop meter for local Codex token usage and rate-limit windows.

## Run

```powershell
npm install
npm start
```

## Verify Data Reader

```powershell
npm run smoke
```

## Data Source

The app reads local Codex session JSONL files from:

```text
%USERPROFILE%\.codex\sessions
```

It parses structured `session_meta`, `turn_context`, and `token_count` events. It does not display prompt or response text.
