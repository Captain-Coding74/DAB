# 6. The AI agent queries computed stats, never raw rows

**Date:** 2026-07-14 · **Status:** Accepted

## Context

The deep-dive agent answers open questions ("which column is most worrying?").
The tempting design is to give it the dataset and let it look. Datasets are up
to 10 MB and may contain personal data.

## Decision

The agent's tools are **read-only queries over the already-computed statistics**
(`list_columns`, `get_column_detail`, `get_correlations`, `get_forecasts`).
It never sees raw rows. It must call a tool before quoting a number, and the UI
shows the trail of checks it ran.

The Anthropic client is **dependency-injected**, so the loop, tool dispatch and
iteration cap are unit-tested against a scripted fake — no API key required.

## Consequences

- Cheap and fast: tools read a small JSON blob, not the file.
- Privacy: raw customer rows are never sent to the model by the agent.
- Answers are checkable — the user can see which statistics were consulted.
- The agent cannot answer questions that need row-level access ("show me the
  three weirdest records"). Accepted; that's what the dataset preview is for.
- Bounded cost: a hard iteration cap (5 rounds) makes a runaway tool loop
  impossible.
