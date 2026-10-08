"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ lightLabel = "Switch to light theme", darkLabel = "Switch to dark theme", showLabel = false }: { lightLabel?: string; darkLabel?: string; showLabel?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? lightLabel : darkLabel;
  return <Button type="button" variant="ghost" size={showLabel ? "default" : "icon"} className={showLabel ? "h-9 w-full justify-start gap-2" : "h-9 w-9 shrink-0"} aria-label={label} title={label} onClick={toggleTheme}>
    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    {showLabel && <span className="truncate">{label}</span>}
  </Button>;
}
