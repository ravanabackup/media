// End-to-end smoke test of the live-sync API against a running server.
// Usage: BASE_URL=http://127.0.0.1:3000 node scripts/smoke-test.mjs
// Uses a throwaway channel, so it never disturbs the default one.

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const room = `ci-${Date.now().toString(36)}`;
const phone = { deviceId: "smoke-phone-0001", deviceName: "Smoke phone", deviceKind: "mobile" };
const desktop = { deviceId: "smoke-desktop-0001", deviceName: "Smoke desktop", deviceKind: "desktop" };

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server at ${BASE} did not become healthy within 60s`);
}

async function report(device, fields) {
  const res = await fetch(`${BASE}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, ...device, rate: 1, ...fields }),
  });
  return { status: res.status, body: await res.json() };
}

async function readState(device) {
  const params = new URLSearchParams({ room, deviceId: device.deviceId, name: device.deviceName, kind: device.deviceKind });
  const res = await fetch(`${BASE}/api/state?${params}`);
  return res.json();
}

/** Open the SSE stream and resolve with the first snapshot that satisfies `predicate`. */
async function nextFromStream(device, predicate, trigger) {
  const params = new URLSearchParams({ room, deviceId: device.deviceId, name: device.deviceName, kind: device.deviceKind });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/api/stream?${params}`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let triggered = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!frame.startsWith("data: ")) continue;
        const snapshot = JSON.parse(frame.slice(6));
        if (!triggered) {
          triggered = true;
          await trigger?.();
        }
        if (predicate(snapshot)) return snapshot;
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

await waitForServer();
console.log(`Smoke-testing ${BASE} on channel "${room}"`);

const page = await fetch(`${BASE}/?room=${room}`);
check("page renders", page.ok && (await page.text()).includes("Relay"), `HTTP ${page.status}`);

const empty = await readState(desktop);
check("new channel starts empty", empty.state === null);

const started = await report(phone, { mediaId: "helix-01", status: "playing", position: 12.5, duration: 300, claim: true });
check("phone starts playing", started.status === 200 && started.body.accepted === true, JSON.stringify(started.body));

const seen = await readState(desktop);
check(
  "desktop sees the phone's playback",
  seen.state?.mediaId === "helix-01" && seen.state?.status === "playing" && seen.state?.deviceKind === "mobile",
  JSON.stringify(seen.state),
);
check("both devices are listed", seen.devices.length === 2, JSON.stringify(seen.devices));
check("server clock is included", typeof seen.serverNow === "number" && seen.serverNow >= seen.state.updatedAt);

const intruder = await report(desktop, { mediaId: "helix-03", status: "playing", position: 0, duration: 200, claim: false });
check("a non-source device cannot overwrite without claiming", intruder.body.accepted === false);

const pushed = await nextFromStream(
  desktop,
  (snapshot) => snapshot.state?.status === "paused",
  () => report(phone, { mediaId: "helix-01", status: "paused", position: 20, duration: 300, claim: false }),
);
check("pause on the phone is pushed over the live stream", pushed?.state?.position === 20, JSON.stringify(pushed?.state));

const takeover = await report(desktop, { mediaId: "helix-01", status: "playing", position: 20, duration: 300, claim: true });
check("desktop can take over playback", takeover.body.accepted === true && takeover.body.state.deviceId === desktop.deviceId);

const displaced = await report(phone, { mediaId: "helix-01", status: "playing", position: 22, duration: 300, claim: false });
check("the displaced phone's heartbeat is rejected", displaced.body.accepted === false);

const invalid = await report(phone, { mediaId: "does-not-exist", status: "playing", position: 0, duration: 0, claim: true });
check("unknown media is rejected", invalid.status === 400);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
