# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo.

Expected domain documentation locations:

- `CONTEXT.md` at the repo root
- `docs/adr/` at the repo root

If either location does not exist, proceed silently. Do not flag its absence and do not suggest creating it upfront. Producer workflows can create these files lazily when domain terms or architectural decisions need to be recorded.

## Before exploring, read these

- Read `CONTEXT.md` before proposing issue text, refactors, tests, or architecture changes that depend on domain language.
- Read relevant ADRs under `docs/adr/` before changing architecture or contradicting prior decisions.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept is missing from the glossary, either reconsider the language or note the gap for a domain-docs workflow.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
