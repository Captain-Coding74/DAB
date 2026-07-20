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
        // Auditor's stamp — actions, positive marks
        brand: {
          50:  "#EDF2EA", 100: "#DFE9DB", 200: "#C2D6BC", 300: "#8FB89A",
          400: "#35795A", 500: "#2F6B4F", 600: "#275A42", 700: "#1F4834",
          800: "#173627", 900: "#0F241A",
        },
        // The red margin rule — signature; used sparingly (critical, danger)
        rule:   { DEFAULT: "#C13B27", soft: "#F0D6D0", dark: "#D9573F" },
        // Auditor's pencil — warnings
        pencil: { DEFAULT: "#B7791F", soft: "#EFE2C6", dark: "#CE9A3C" },
        // Green-tinted neutrals: paper → ink (light), after-hours ledger (dark)
        gray: {
          50:  "#F2F4EC", 100: "#E7EBE0", 200: "#D6DECE", 300: "#AEB8A9",
          400: "#7E887C", 500: "#5F695E", 600: "#49534A", 700: "#39413A",
          800: "#242B24", 900: "#171C17", 950: "#101410",
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
