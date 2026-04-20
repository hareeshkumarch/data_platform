import { create } from "zustand";
import { persist } from "zustand/middleware";
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

  setMode: (mode: QueryMode) => void;
  newConversation: (mode: QueryMode) => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameFromFirstMessage: (id: string, prompt: string) => void;

  appendMessage: (id: string, message: QueryMessage) => void;
  updateLastMessage: (id: string, patch: Partial<QueryMessage>) => void;
}

export const useQueryStore = create<QueryState>()(
  persist(
    (set) => ({
      conversations: [],
      activeId: null,
      mode: "chat",

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

      deleteConversation: (id) =>
        set((s) => {
          const remaining = s.conversations.filter((c) => c.id !== id);
          return {
            conversations: remaining,
            activeId: s.activeId === id ? remaining[0]?.id ?? null : s.activeId,
          };
        }),

      renameFromFirstMessage: (id, prompt) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id && (c.title === "New conversation" || !c.title)
              ? { ...c, title: titleFromPrompt(prompt) }
              : c,
          ),
        })),

      appendMessage: (id, message) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id
              ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
              : c,
          ),
        })),

      updateLastMessage: (id, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== id || c.messages.length === 0) return c;
            const messages = [...c.messages];
            messages[messages.length - 1] = { ...messages[messages.length - 1], ...patch };
            return { ...c, messages, updatedAt: Date.now() };
          }),
        })),
    }),
    {
      name: "dp-query-state",
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
        mode: s.mode,
      }),
      // Reset streaming flags on store rehydration (#56)
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.conversations = state.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) => ({ ...m, streaming: false })),
          }));
        }
      },
    },
  ),
);
