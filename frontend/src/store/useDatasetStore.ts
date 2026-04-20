import { create } from "zustand";
import { apiFetch } from "@/lib/api-client";
import { Dataset } from "@/lib/types";

interface DatasetState {
  datasets: Dataset[];
  loading: boolean;
  lastFetch: number;

  /** Fetch datasets (deduped — won't re-fetch if < 5s since last call) */
  fetchDatasets: (force?: boolean) => Promise<Dataset[]>;
  /** Invalidate cache and re-fetch (call after upload / delete) */
  invalidate: () => Promise<Dataset[]>;
  /** Remove a dataset from the local list */
  removeLocal: (id: string) => void;
  /** Add a dataset to the local list (for ghost entries) */
  addLocal: (d: Dataset) => void;
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
  datasets: [],
  loading: false,
  lastFetch: 0,

  fetchDatasets: async (force = false) => {
    const now = Date.now();
    const { lastFetch, datasets, loading } = get();

    // Dedup: skip if fetched < 5s ago and not forced
    if (!force && lastFetch > 0 && now - lastFetch < 5000 && datasets.length > 0) {
      return datasets;
    }
    // Skip if already loading
    if (loading && !force) return datasets;

    set({ loading: true });
    try {
      const resp = await apiFetch<{ datasets: Dataset[] }>("/datasets");
      const list = resp.datasets || [];
      set({ datasets: list, lastFetch: Date.now(), loading: false });
      return list;
    } catch (err) {
      /* silently ignore */
      set({ loading: false });
      return get().datasets;
    }
  },

  invalidate: async () => {
    set({ lastFetch: 0 });
    return get().fetchDatasets(true);
  },

  removeLocal: (id) =>
    set((s) => ({ datasets: s.datasets.filter((d) => d.id !== id) })),

  addLocal: (d) =>
    set((s) => ({ datasets: [d, ...s.datasets] })),
}));
