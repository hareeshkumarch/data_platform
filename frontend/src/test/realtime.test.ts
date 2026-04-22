/** Unit tests for the realtime integration layer (SSE + WebSocket). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type OpenHandler = () => void;
type MessageHandler = (event: { data: string }) => void;
type ErrorHandler = () => void;

class MockWebSocket {
  public static instance: MockWebSocket | null = null;
  public readyState = 0;
  public onopen: OpenHandler | null = null;
  public onmessage: MessageHandler | null = null;
  public onerror: ErrorHandler | null = null;
  public onclose: (() => void) | null = null;
  public sent: string[] = [];
  public closed = false;

  constructor(public readonly url: string) {
    MockWebSocket.instance = this;
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  /** Emit a message to the listener. */
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });

import { newPipeline, runPipeline, streamChatReply } from "../lib/query-api";

describe("runPipeline (WebSocket)", () => {
  beforeEach(() => {
    MockWebSocket.instance = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a websocket, sends the prompt, surfaces stages, and completes", async () => {
    const stages: unknown[] = [];
    let finalReply = "";
    const cancel = runPipeline(
      "What is retention?",
      "Select dataset",
      (s) => stages.push(s),
      (reply) => {
        finalReply = reply;
      },
    );

    const ws = MockWebSocket.instance!;
    expect(ws).toBeTruthy();
    ws.onopen?.();
    expect(ws.sent).toHaveLength(1);
    const payload = JSON.parse(ws.sent[0]) as { prompt: string; dataset_id: string };
    expect(payload.prompt).toBe("What is retention?");
    expect(payload.dataset_id).toBe("");

    ws.emit({
      type: "stage",
      stages: [
        { id: "ingestion", name: "Ingestion Agent", status: "running", log: "Fetching..." },
        { id: "understanding", name: "Understanding Agent", status: "pending", log: "" },
      ],
    });
    expect(stages).toHaveLength(1);

    ws.emit({ type: "complete", reply: "Done — retention is 78% MoM." });
    expect(finalReply).toContain("retention is 78%");
    expect(ws.closed).toBe(true);

    cancel();
  });

  it("returns a fully-populated pipeline blueprint with 5 stages", () => {
    const pipeline = newPipeline();
    expect(pipeline).toHaveLength(5);
    expect(pipeline.map((s) => s.id)).toEqual([
      "ingestion", "understanding", "insight", "visualization", "report",
    ]);
    expect(pipeline.every((s) => s.status === "pending")).toBe(true);
  });

  it("closes the socket when the consumer cancels", () => {
    const cancel = runPipeline("hi", "", () => undefined, () => undefined);
    const ws = MockWebSocket.instance!;
    cancel();
    expect(ws.closed).toBe(true);
  });
});

describe("streamChatReply (SSE)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("accumulates tokens and signals done on [DONE]", async () => {
    const sse = [
      'data: {"token": "Hello"}\n\n',
      'data: {"token": " "}\n\n',
      'data: {"token": "world"}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ body: stream, ok: true }));

    const updates: Array<{ value: string; done: boolean }> = [];
    const cancel = streamChatReply("say hi", "Select dataset", (value, done) => {
      updates.push({ value, done });
    });
    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));
    cancel();

    const last = updates.at(-1);
    expect(last?.done).toBe(true);
    expect(last?.value).toBe("Hello world");
  });
});
