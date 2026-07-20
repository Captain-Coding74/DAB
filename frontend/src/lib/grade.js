/**
 * lib/grade.js — v12: the ONE place grade thresholds live on the client.
 * (Backend keeps its own copy in qualityScore.js — a deliberate boundary,
 * but within each side there is exactly one source.)
 */
export const GRADE_BANDS = [
  { min: 90, grade: "A" }, { min: 75, grade: "B" }, { min: 60, grade: "C" },
  { min: 45, grade: "D" }, { min: 0,  grade: "F" },
];

export const clampScore = (score) => Math.min(100, Math.max(0, score || 0));
export const gradeFor   = (score) => GRADE_BANDS.find(b => clampScore(score) >= b.min).grade;
export const gradeHex   = (score) => {
  const s = clampScore(score);
  return s >= 80 ? "#2F6B4F" : s >= 60 ? "#B7791F" : "#C13B27";
};
/** Tailwind classes for the double-ruled stamp chip. */
export const gradeStampClass = (score) => {
  const s = clampScore(score);
  return s >= 80 ? "text-brand-600 border-brand-400 dark:text-brand-300 dark:border-brand-500"
       : s >= 60 ? "text-pencil border-pencil dark:text-pencil-dark dark:border-pencil-dark"
       : "text-rule border-rule dark:text-rule-dark dark:border-rule-dark";
};
