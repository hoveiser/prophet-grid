/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        carbon: "#06080D",
        panel: "#0E131F",
        rack: "#131A28",
        edge: "#1B2436",
        ink: "#E8EDF5",
        dim: "#7C8CA7",
        amber: "#FF9500",
        cyan: "#00E5FF",
        bid: "#10B981",
        ask: "#FB7185",
        violet: "#A78BFA",
        lime: "#FACC15",
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        rail: "inset 0 1px 0 0 rgba(255,255,255,0.04)",
        lit: "0 0 0 1px rgba(255,149,0,0.28), 0 18px 46px -24px rgba(255,149,0,0.35)",
      },
      keyframes: {
        blink: { "0%,100%": { opacity: "0.25" }, "50%": { opacity: "1" } },
        rollup: { from: { transform: "translateY(6px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
      },
      animation: {
        blink: "blink 1.6s ease-in-out infinite",
        rollup: "rollup 220ms ease-out",
        marquee: "marquee 38s linear infinite",
      },
    },
  },
  plugins: [],
};
