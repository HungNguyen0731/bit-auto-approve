---
name: hungnv-continuous-learning
description: Persist HungNV's changelog, sanitized prompt outcomes, recurrence comparisons, and project-specific lessons after any prompt that changes code or runtime behavior. Use for implementation, fixes, refactors, configuration, migrations, and scripts; skip read-only work.
---

# HungNV Continuous Learning

Before editing a reported error or regression, read `CHANGELOG.md` and search the two reference files by error text, component, endpoint, file, and behavior.

After changing code or runtime behavior, update `CHANGELOG.md`, append one sanitized prompt/result record to `references/prompt-history.md`, and append one lesson (or `No new durable lesson`) to `references/lessons.md` exactly once. Never store credentials; use `[REDACTED]`.
