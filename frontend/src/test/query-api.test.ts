/** Unit tests for the frontend integration layer. */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("localStorage", {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

import { getLlmPreference, setLlmPreference, titleFromPrompt, uid } from "../lib/query-api";

describe("query-api helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates unique ids", () => {
    const a = uid();
    const b = uid();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(4);
  });

  it("truncates long prompts into titles", () => {
    const long = "a ".repeat(100).trim();
    const title = titleFromPrompt(long, 20);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns an empty preference when storage is empty", () => {
    (localStorage.getItem as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(getLlmPreference()).toEqual({});
  });

  it("round-trips preferences through localStorage", () => {
    const store: Record<string, string> = {};
    (localStorage.setItem as unknown as ReturnType<typeof vi.fn>).mockImplementation((k: string, v: string) => {
      store[k] = v;
    });
    (localStorage.getItem as unknown as ReturnType<typeof vi.fn>).mockImplementation((k: string) => store[k] ?? null);

    setLlmPreference({ provider: "anthropic", model: "claude-sonnet-4-5-20250929" });
    const pref = getLlmPreference();
    expect(pref.provider).toBe("anthropic");
    expect(pref.model).toBe("claude-sonnet-4-5-20250929");
  });
});
