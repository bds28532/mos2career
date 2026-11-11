// Background Functions stop after 15 minutes. Leave a grace period before
// another worker may take over, including records written by the old worker.
export const FULFILLMENT_LEASE_MS = 20 * 60 * 1000;

export class FulfillmentLeaseLostError extends Error {
  constructor() {
    super("Fulfillment claim expired or was replaced by another worker");
    this.name = "FulfillmentLeaseLostError";
  }
}

export function fulfillmentIsActive(record, now = Date.now()) {
  if (!["processing", "generated"].includes(record?.status)) return false;
  const startedAt = Date.parse(record.startedAt || record.generatedAt);
  const explicitExpiry = Date.parse(record.leaseExpiresAt);
  const expiresAt = Number.isFinite(explicitExpiry)
    ? explicitExpiry
    : startedAt + FULFILLMENT_LEASE_MS;
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function fulfillmentNeedsRecovery(record, now = Date.now()) {
  if (!record || record.status === "delivered") return false;
  if (record.status === "failed") {
    const failedAt = Date.parse(record.failedAt);
    return !Number.isFinite(failedAt) || now - failedAt >= 5 * 60 * 1000;
  }
  return ["processing", "generated"].includes(record.status) &&
    !fulfillmentIsActive(record, now);
}

export async function claimFulfillment(store, key, job, { now = Date.now } = {}) {
  const snapshot = await store.getWithMetadata(key, {
    type: "json", consistency: "strong",
  });
  const existing = snapshot?.data;
  if (existing?.status === "delivered") {
    return { acquired: false, reason: "delivered" };
  }
  if (fulfillmentIsActive(existing, now())) {
    return { acquired: false, reason: "processing" };
  }
  if (snapshot && !snapshot.etag) throw new Error("Fulfillment record has no ETag");

  const startedAt = now();
  let record = {
    ...existing,
    ...job,
    status: "processing",
    stage: "generating",
    startedAt: new Date(startedAt).toISOString(),
    leaseExpiresAt: new Date(startedAt + FULFILLMENT_LEASE_MS).toISOString(),
    attempt: (Number(existing?.attempt) || 0) + 1,
    retryingPreviousAttempt: Boolean(existing),
  };
  const result = await store.setJSON(key, record, snapshot
    ? { onlyIfMatch: snapshot.etag }
    : { onlyIfNew: true });
  if (!result.modified) return { acquired: false, reason: "claimed_by_another_run" };
  if (!result.etag) throw new Error("Fulfillment claim has no ETag");
  let etag = result.etag;

  return {
    acquired: true,
    async update(fields) {
      if (now() >= startedAt + FULFILLMENT_LEASE_MS) {
        throw new FulfillmentLeaseLostError();
      }
      const next = { ...record, ...fields };
      const saved = await store.setJSON(key, next, { onlyIfMatch: etag });
      if (!saved.modified) throw new FulfillmentLeaseLostError();
      if (!saved.etag) throw new Error("Fulfillment update has no ETag");
      etag = saved.etag;
      record = next;
    },
  };
}
