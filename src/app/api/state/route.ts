import type { NextRequest } from "next/server";
import { applyUpdate, ensureLoaded, getSnapshot, parseDevice, touchPresence } from "@/lib/hub";
import { normalizeRoom, type UpdateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Current state of a channel. Also used as the polling fallback when the live stream is unavailable. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const room = normalizeRoom(params.get("room"));
  await ensureLoaded(room);

  const device = parseDevice({
    id: params.get("deviceId"),
    name: params.get("name"),
    kind: params.get("kind"),
  });
  if (device) touchPresence(room, device);

  return Response.json(getSnapshot(room), { headers: NO_STORE });
}

/** Playback report from the device that is playing. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400, headers: NO_STORE });
  }

  const room = normalizeRoom((body as { room?: unknown } | null)?.room);
  const result = await applyUpdate(room, body);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400, headers: NO_STORE });
  }

  const payload: UpdateResponse = { accepted: result.accepted, ...getSnapshot(room) };
  return Response.json(payload, { headers: NO_STORE });
}
