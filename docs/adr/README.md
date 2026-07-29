# Architecture Decision Records

Short, dated records of decisions that were expensive to make and would be
expensive to reverse. Each states the forces at play, the call, and the
consequences — including the ones we don't like.

An ADR is not documentation of how the code works (the code does that). It
exists so that six months from now nobody re-litigates a settled trade-off
from memory, and so a decision that *should* be revisited can be found.

| # | Decision | Status |
|---|---|---|
| [0001](0001-deterministic-insights-before-ai.md) | Deterministic insights engine runs before the AI | Accepted |
| [0002](0002-one-app-factory-no-test-double.md) | One app factory; tests must not re-implement routes | Accepted |
| [0003](0003-exceljs-over-sheetjs.md) | exceljs over SheetJS for spreadsheet parsing | Accepted |
| [0004](0004-budgets-ratchets-vs-absolute.md) | Two kinds of budget: ratchets and absolute targets | Accepted |
| [0005](0005-no-realtime-collaboration-yet.md) | **No real-time collaboration (yet)** | Accepted |
| [0006](0006-agent-reads-stats-not-rows.md) | The AI agent queries computed stats, never raw rows | Accepted |
| [0007](0007-runtime-palette-for-canvas-surfaces.md) | Colours needed in JavaScript live in one runtime palette | Accepted |
| [0008](0008-accepted-dependency-risks.md) | Accepted dependency risks: ExcelJS chain + react-router, no --force | Accepted |
