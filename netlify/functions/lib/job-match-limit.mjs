export const HOURLY_ANALYSIS_LIMIT = 5;

// Keep the existing hour/IP keys so deployment preserves usage already counted.
// Every permit must win a conditional write before it can incur an AI charge.
export async function reserveAnalysis(store, key) {
  for (let attempt = 0; attempt <= HOURLY_ANALYSIS_LIMIT; attempt++) {
    const snapshot = await store.getWithMetadata(key, {
      type: "json", consistency: "strong",
    });
    const count = snapshot ? snapshot.data?.count : 0;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Invalid free-analysis usage record");
    }
    if (count >= HOURLY_ANALYSIS_LIMIT) return false;
    if (snapshot && !snapshot.etag) throw new Error("Free-analysis usage record has no ETag");

    const result = await store.setJSON(key, { count: count + 1 }, snapshot
      ? { onlyIfMatch: snapshot.etag }
      : { onlyIfNew: true });
    if (result.modified) return true;
    // Another request consumed a slot. Read its new count before trying again.
  }
  // Fail closed if the storage service cannot provide a usable claim in the
  // bounded number of attempts; never send an uncounted request to OpenAI.
  throw new Error("Free-analysis usage claim could not be confirmed");
}
