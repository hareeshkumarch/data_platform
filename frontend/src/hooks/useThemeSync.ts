import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";

/** Syncs the persisted theme from the store to the <html> class. */
export const useThemeSync = () => {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);
};
