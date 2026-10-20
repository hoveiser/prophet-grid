/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: "#070B14",
        panel: "#0B1220",
        panel2: "#0F1830",
        line: "#1B2740",
        ink: "#E6EDF7",
        muted: "#8FA3BF",
        yes: "#34D399",
        no: "#22D3EE",
        amber: "#FBBF24",
        danger: "#F87171",
        violet: "#A78BFA",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(52,211,153,0.25), 0 12px 40px -12px rgba(52,211,153,0.35)",
        panel: "0 24px 60px -30px rgba(0,0,0,0.9)",
      },
      keyframes: {
        pulseLine: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(220%)" },
        },
      },
      animation: {
        pulseLine: "pulseLine 2.4s ease-in-out infinite",
        rise: "rise 420ms ease-out both",
        scan: "scan 2.6s linear infinite",
      },
    },
  },
  plugins: [],
};
