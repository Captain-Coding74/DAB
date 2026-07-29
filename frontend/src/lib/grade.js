/**
 * lib/grade.js — v12: the ONE place grade thresholds live on the client.
 * (Backend keeps its own copy in qualityScore.js — a deliberate boundary,
 * but within each side there is exactly one source.)
 */
import { LEDGER } from "./ledger.js";

export const GRADE_BANDS = [
  { min: 90, grade: "A" }, { min: 75, grade: "B" }, { min: 60, grade: "C" },
  { min: 45, grade: "D" }, { min: 0,  grade: "F" },
];

export const clampScore = (score) => Math.min(100, Math.max(0, score || 0));
export const gradeFor   = (score) => GRADE_BANDS.find(b => clampScore(score) >= b.min).grade;
export const gradeHex   = (score) => {
  const s = clampScore(score);
  // v20.4 dual-legible readout colours; named in the runtime palette since v20.5
  return s >= 80 ? LEDGER.stamp.mid : s >= 60 ? LEDGER.pencil.dark : LEDGER.rule.dark;
};
/** Tailwind classes for the double-ruled stamp chip. */
export const gradeStampClass = (score) => {
  const s = clampScore(score);
  return s >= 80 ? "text-stamp border-stamp dark:text-stamp-dark dark:border-stamp-dark"
       : s >= 60 ? "text-pencil border-pencil dark:text-pencil-dark dark:border-pencil-dark"
       : "text-rule border-rule dark:text-rule-dark dark:border-rule-dark";
};
