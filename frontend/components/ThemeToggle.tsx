"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle dark / light theme"
      title="Toggle theme"
    >
      <span className="knob">{theme === "dark" ? "🌙" : "☀️"}</span>
    </button>
  );
}
