/**
 * The Ledger — design tokens (v10)
 *
 * Concept: the app is an auditor for datasets, so it wears the auditor's
 * material: ledger paper. Pale green feint-ruled paper, ink, an auditor's
 * stamp green for actions, a pencil amber for warnings, and ONE red
 * vertical margin rule as the signature element (findings live in the
 * margin, like an auditor's marks).
 *
 * The `brand` and `gray` scales are deliberately overridden so the whole
 * existing class vocabulary re-skins itself: gray-50 = paper, gray-200 =
 * feint rule, gray-900/950 = after-hours ledger (dark mode).
 */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // v20.4 After-Hours Console: the auditor's pencil takes over as the
        // primary instrument accent — amber calibration marks on navy ink.
        brand: {
          50:  "#FDF6E7", 100: "#FAEBC7", 200: "#F5D98F", 300: "#F0BE4E",
          400: "#F5A00B", 500: "#D98B06", 600: "#B37204", 700: "#8C5903",
          800: "#664103", 900: "#402902",
        },
        // Verdict green — the stamp's ink, kept for GOOD grades only
        stamp:  { DEFAULT: "#2F9E6E", dark: "#34D399" },
        // The red margin rule — signature; used sparingly (critical, danger)
        rule:   { DEFAULT: "#C13B27", deep: "#A93321", soft: "#F0D6D0", line: "#DFB0A6", dark: "#D9573F" },
        // Auditor's pencil — warnings
        pencil: { DEFAULT: "#B7791F", soft: "#EFE2C6", line: "#DFC79A", dark: "#CE9A3C" },
        // Green-tinted neutrals: paper → ink (light), after-hours ledger (dark)
        // Light = ledger paper (unchanged). Dark end = after-hours console:
        // navy ink surfaces instead of the old green-black ledger.
        gray: {
          50:  "#F2F4EC", 100: "#E7EBE0", 200: "#D6DECE", 300: "#AEB8A9",
          400: "#82909F", 500: "#5E6B80", 600: "#465468", 700: "#2A3752",
          800: "#1F2B45", 900: "#121C30", 950: "#0B1220",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Forms, not bubbles: firm up every existing rounded-* class
      borderRadius: { lg: "6px", xl: "8px", "2xl": "10px" },
      boxShadow: {
        paper: "0 1px 2px rgba(27,33,29,0.07), 0 0 0 1px rgba(27,33,29,0.02)",
      },
      letterSpacing: { eyebrow: "0.14em" },
    },
  },
  plugins: [],
};
