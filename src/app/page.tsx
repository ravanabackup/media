import RelayApp from "@/components/RelayApp";
import { ensureLoaded, getSnapshot } from "@/lib/hub";
import { normalizeRoom } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const room = normalizeRoom(Array.isArray(params.room) ? params.room[0] : params.room);

  // Render with the current state so a newly opened page shows what's playing immediately.
  await ensureLoaded(room);

  return <RelayApp room={room} initial={getSnapshot(room)} />;
}
