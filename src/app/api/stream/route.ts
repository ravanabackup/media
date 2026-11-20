import type { NextRequest } from "next/server";
import { ensureLoaded, getSnapshot, joinPresence, parseDevice, subscribe } from "@/lib/hub";
import { normalizeRoom } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEEPALIVE_MS = 3_000;

/**
 * Server-Sent Events stream for a channel. Every message is a full snapshot
 * (state + connected devices + server clock), pushed the moment anything
 * changes and re-sent every few seconds as a keep-alive and clock sync.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const room = normalizeRoom(params.get("room"));
  const device = parseDevice({
    id: params.get("deviceId"),
    name: params.get("name"),
    kind: params.get("kind"),
  });

  await ensureLoaded(room);

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(getSnapshot(room))}\n\n`));
        } catch {
          cleanup();
        }
      };

      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      const unsubscribe = subscribe(room, send);
      const leave = device ? joinPresence(room, device) : () => {};
      const timer = setInterval(send, KEEPALIVE_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        unsubscribe();
        leave();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };

      request.signal.addEventListener("abort", cleanup);
      send();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
