# 6. The AI agent queries computed stats, never raw rows

**Date:** 2026-07-14 · **Status:** Accepted

## Context

The deep-dive agent answers open questions ("which column is most worrying?").
The tempting design is to give it the dataset and let it look. Uploads are
capped at 25 MB by default (`MAX_UPLOAD_MB`) and may contain personal data.

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

## v21.30 update (2026-10-10)

This record was read more broadly than it was true. It holds for the agent,
but it was quoted as "the AI never sees raw rows", and that was not so:

- **The main Analyze prompt carried raw rows.** Until v21.30,
  `services/analysisPipeline.js` added five randomly sampled rows to every
  analysis prompt (identifier columns strict-masked, but every other cell
  verbatim). From v21.30 the prompt carries **no** rows: Analyze, Chat, the
  agent and Fix-suggest send no raw rows at all.
- **Statistics include real values.** The most-frequent-values tables are
  cell values, not aggregates. From v21.30 everything sent to the AI leaves
  out columns detected as personal data, apart from each column's name and
  detected kind.
- **AI Edit is the one row-level exception** (ADR-0009), and from v21.30 it
  runs only after the user confirms a dialog saying rows will be sent.

The upload cap above said 10 MB; the code's default is 25 MB (`MAX_UPLOAD_MB`,
`backend/src/config.js`). Corrected in place.
