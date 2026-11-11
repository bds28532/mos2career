import { getStore } from "@netlify/blobs";
import { fulfillmentNeedsRecovery } from "./lib/fulfillment-claim.mjs";
import { findMOS2CareerProfile } from "./lib/find-profile.mjs";

const CURSOR_KEY = "recovery-scan-cursor";
const BATCH_SIZE = 20;

export default async function handler(request, context) {
  // Netlify schedules run only on published deploys. Keep manual preview runs
  // isolated too, because site-wide Blobs are shared between deploys.
  if (context?.deploy?.context !== "production" || !context.deploy.published) return;
  const secret = process.env.BLUEPRINT_INTERNAL_SECRET;
  if (!secret) throw new Error("BLUEPRINT_INTERNAL_SECRET is not configured");
  const store = getStore("mos2career-fulfillments");
  const deadline = Date.now() + 20_000;
  const { blobs } = await store.list({ prefix: "blueprint-" });
  const keys = blobs.map(({ key }) => key).sort();
  if (!keys.length) return;
  const cursor = await store.get(CURSOR_KEY, { type: "json", consistency: "strong" });
  let offset = keys.findIndex(key => key > (cursor?.lastKey || ""));
  if (offset < 0) offset = 0;
  const batch = [...keys.slice(offset), ...keys.slice(0, offset)].slice(0, BATCH_SIZE);
  let queued = 0;
  let failed = 0;
  let inspected = 0;

  for (const key of batch) {
    if (Date.now() >= deadline) break;
    inspected++;
    // Advance even when an individual order is malformed or its provider is
    // unavailable, so one bad record cannot starve later orders on every run.
    await store.setJSON(CURSOR_KEY, { lastKey: key });
    try {
      const record = await store.get(key, { type: "json", consistency: "strong" });
      if (!fulfillmentNeedsRecovery(record)) continue;
      const submissionId = record.submissionId || key.slice("blueprint-".length);
      const profile = record.profile || (await findMOS2CareerProfile(submissionId, { deadline }))?.data;
      if (!profile?.email?.trim()) throw new Error("Recovery profile is unavailable");
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const response = await fetch(new URL(
        "/.netlify/functions/fulfill-blueprint", process.env.URL || request.url
      ), {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId, profile,
          checkoutSessionId: record.checkoutSessionId,
          eventId: record.eventId,
          mode: record.mode,
        }),
        signal: AbortSignal.timeout(Math.min(5_000, remaining)),
      });
      if (!response.ok) throw new Error(`Recovery queue failed: ${response.status}`);
      queued++;
    } catch (error) {
      failed++;
      console.error(`MOS2Career recovery failed: ${key}`, error.message);
    }
  }
  console.log("MOS2Career recovery scan", { inspected, queued, failed });
}

export const config = { schedule: "*/5 * * * *" };
