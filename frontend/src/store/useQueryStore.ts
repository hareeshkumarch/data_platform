import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiFetch } from "@/lib/api-client";
import {
  type Conversation,
  type QueryMessage,
  type QueryMode,
  titleFromPrompt,
  uid,
} from "@/lib/query-api";

interface QueryState {
  conversations: Conversation[];
  activeId: string | null;
  mode: QueryMode;
  syncing: boolean;
  lastSyncedAt: number | null;

  setMode: (mode: QueryMode) => void;
  newConversation: (mode: QueryMode) => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameFromFirstMessage: (id: string, prompt: string) => void;

  appendMessage: (id: string, message: QueryMessage) => void;
  updateLastMessage: (id: string, patch: Partial<QueryMessage>) => void;

  /** Fetch conversations from the backend and merge them into local state. */
  hydrateFromServer: () => Promise<void>;
  /** Persist a single conversation to the backend (fire-and-forget). */
  saveToServer: (id: string) => Promise<void>;
}

interface ServerConversation {
  id: string;
  title: string;
  mode: string;
  updatedAt: number;
  messages: QueryMessage[];
}

/** Drop heavy render-only fields before sending to the server. */
const toServer = (c: Conversation) => ({
  id: c.id,
  title: c.title,
  mode: c.mode,
  messages: (Array.isArray(c.messages) ? c.messages : []).filter(m => m && typeof m === "object").map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    mode: m.mode,
    streaming: false,
    pipeline: Array.isArray(m.pipeline)
      ? m.pipeline.filter(s => s && typeof s === "object").map((s) => ({ id: s.id, name: s.name, status: s.status, log: s.log, detail: s.detail }))
      : null,
    agentSummaries: Array.isArray(m.agentSummaries) ? m.agentSummaries : null,
    datasetId: m.datasetId ?? null,
  })),
});

export const useQueryStore = create<QueryState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      mode: "chat",
      syncing: false,
      lastSyncedAt: null,

      setMode: (mode) => set({ mode }),

      newConversation: (mode) => {
        const id = uid();
        set((s) => ({
          conversations: [
            { id, title: "New conversation", mode, updatedAt: Date.now(), messages: [] },
            ...s.conversations,
          ],
          activeId: id,
          mode,
        }));
        return id;
      },

      selectConversation: (id) =>
        set((s) => {
          const c = s.conversations.find((x) => x.id === id);
          return { activeId: id, mode: c?.mode ?? s.mode };
        }),

      deleteConversation: (id) => {
        set((s) => {
          const remaining = s.conversations.filter((c) => c.id !== id);
          return {
            conversations: remaining,
            activeId: s.activeId === id ? remaining[0]?.id ?? null : s.activeId,
          };
        });
        void apiFetch(`/conversations/${id}`, { method: "DELETE" }).catch(() => undefined);
      },

      renameFromFirstMessage: (id, prompt) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id && (c.title === "New conversation" || !c.title)
              ? { ...c, title: titleFromPrompt(prompt) }
              : c,
          ),
        })),

      appendMessage: (id, message) => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, messages: [...(Array.isArray(c.messages) ? c.messages : []), message], updatedAt: Date.now() } : c,
          ),
        }));
      },

      updateLastMessage: (id, patch) => {
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== id || !Array.isArray(c.messages) || c.messages.length === 0) return c;
            const messages = [...c.messages];
            const last = messages[messages.length - 1];
            if (!last) return c;
            messages[messages.length - 1] = { ...last, ...patch };
            return { ...c, messages, updatedAt: Date.now() };
          }),
        }));

        // Persist when the message finishes streaming
        if (patch.streaming === false) {
          void get().saveToServer(id);
        }
      },

      hydrateFromServer: async () => {
        if (get().syncing) return;
        set({ syncing: true });
        try {
          const data = await apiFetch<{ conversations: ServerConversation[] }>("/conversations");
          if (!data.conversations) return;
          set((s) => {
            // Merge: server wins for entries not yet in local state
            const byId = new Map(s.conversations.map((c) => [c.id, c]));
            for (const sc of (data.conversations || [])) {
              if (!sc || typeof sc !== "object") continue;
              const sanitized = {
                ...sc,
                title: sc.title || "New conversation",
                messages: Array.isArray(sc.messages) ? sc.messages.filter(m => m && typeof m === "object") : [],
                updatedAt: sc.updatedAt || Date.now(),
                mode: ((sc.mode === "chat" || sc.mode === "pipeline") ? sc.mode : "chat") as QueryMode
              };
              if (!byId.has(sanitized.id)) {
                byId.set(sanitized.id, sanitized);
              } else {
                const local = byId.get(sanitized.id)!;
                if (sanitized.updatedAt > (local.updatedAt ?? 0)) {
                  byId.set(sanitized.id, sanitized);
                }
              }
            }
            const conversations = Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
            return { conversations, lastSyncedAt: Date.now() };
          });
        } catch {
          /* hydration best-effort only */
        } finally {
          set({ syncing: false });
        }
      },

      saveToServer: async (id) => {
        const conversation = get().conversations.find((c) => c.id === id);
        if (!conversation) return;
        try {
          await apiFetch("/conversations", {
            method: "POST",
            body: JSON.stringify(toServer(conversation)),
          });
          set({ lastSyncedAt: Date.now() });
        } catch {
          /* backend persistence is best-effort; local storage still holds the data */
        }
      },
    }),
    {
      name: "dp-query-state",
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
        mode: s.mode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.conversations = (Array.isArray(state.conversations) ? state.conversations : []).filter(c => c && typeof c === "object").map((c) => ({
            ...c,
            messages: (Array.isArray(c.messages) ? c.messages : []).filter(m => m && typeof m === "object").map((m) => ({
              ...m,
              streaming: false,
              pipeline: Array.isArray(m.pipeline) ? m.pipeline : undefined,
              agentSummaries: Array.isArray(m.agentSummaries) ? m.agentSummaries : undefined,
            })),
          }));
        }
      },
    },
  ),
);
