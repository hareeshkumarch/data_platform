import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppStatus = "ready" | "processing" | "error";
export type Theme = "light" | "dark";

interface AppState {
  // UI
  sidebarOpen: boolean;
  theme: Theme;
  searchQuery: string;

  // Data context
  dataset: string;
  status: AppStatus;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSearchQuery: (q: string) => void;
  setDataset: (d: string) => void;
  setStatus: (s: AppStatus) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: "light",
      searchQuery: "",
      dataset: "Select dataset",
      status: "ready",

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setTheme: (theme) => set({ theme }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setDataset: (dataset) => set({ dataset }),
      setStatus: (status) => set({ status }),
    }),
    {
      name: "data-platform-state",
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        theme: s.theme,
        dataset: s.dataset,
      }),
    }
  )
);
