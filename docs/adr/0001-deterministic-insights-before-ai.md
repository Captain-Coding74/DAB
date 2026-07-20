# 1. The deterministic insights engine runs before the AI

**Date:** 2026-07-14 · **Status:** Accepted

## Context

The product's job is to tell people what's wrong with their data. The obvious
implementation is "send the stats to an LLM and print the answer." That has
three problems: it costs money per analysis, it takes seconds, and — worst —
it is *unfalsifiable*. If the model says "column `age` has 30% missing values",
nobody can tell whether it counted or guessed.

## Decision

Compute findings **deterministically first** (`services/insights.js`): missing
-data hotspots, outliers, duplicates, constant and ID-like columns, dominant
categories, strong correlations, trends. Rank them by severity, cap at 12.

Then pass those verified findings *into* the AI prompt as facts, so the model
interprets checked statistics instead of re-deriving them.

## Consequences

- Insights are instant, free, and **unit-testable** — 14 tests pin the rules.
- The AI's report is grounded: it comments on numbers we computed, which
  measurably reduces the room for invention.
- The engine is a rules engine, so it will never surprise anyone with a novel
  observation. That's the trade: the AI supplies the novelty, the engine
  supplies the truth.
- Every rule threshold (30% missing = critical, |r| ≥ 0.7 = strong) is a
  judgement encoded in code, visible in review, and changeable in one file.
