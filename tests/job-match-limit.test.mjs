import assert from "node:assert/strict";
import test from "node:test";
import { HOURLY_ANALYSIS_LIMIT, reserveAnalysis } from "../netlify/functions/lib/job-match-limit.mjs";

function storage(initial) {
  const records = new Map();
  let revision = 0;
  if (initial !== undefined) records.set("hour-ip", { data: initial, etag: "legacy" });
  const reads = [];
  const writes = [];
  return {
    records, reads, writes,
    async getWithMetadata(key, options) {
      reads.push(options);
      return structuredClone(records.get(key) || null);
    },
    async setJSON(key, data, options) {
      writes.push(options);
      const existing = records.get(key);
      if (options.onlyIfNew && existing) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== existing?.etag) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: `v${++revision}` });
      return { modified: true, etag: records.get(key).etag };
    },
  };
}

test("A burst of 100 requests can reserve exactly five new analyses", async () => {
  const store = storage();
  const results = await Promise.all(Array.from({ length: 100 }, () => reserveAnalysis(store, "hour-ip")));
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(store.records.get("hour-ip").data.count, 5);
  assert.ok(store.reads.every(read => read.consistency === "strong" && read.type === "json"));
});

test("Ten simultaneous requests with four prior uses can reserve only one", async () => {
  const store = storage({ count: 4 });
  const results = await Promise.all(Array.from({ length: 10 }, () => reserveAnalysis(store, "hour-ip")));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(store.records.get("hour-ip").data.count, 5);
  assert.ok(store.writes.every(write => write.onlyIfMatch));
});

test("Sequential use permits five requests and rejects the sixth without writing", async () => {
  const store = storage();
  for (let i = 0; i < HOURLY_ANALYSIS_LIMIT; i++) assert.equal(await reserveAnalysis(store, "hour-ip"), true);
  assert.equal(await reserveAnalysis(store, "hour-ip"), false);
  assert.equal(store.writes.length, 5);
  assert.deepEqual(store.writes[0], { onlyIfNew: true });
});

test("Existing legacy usage is preserved and exhausted records cannot be reset", async () => {
  for (const count of [5, 8]) {
    const store = storage({ count });
    assert.equal(await reserveAnalysis(store, "hour-ip"), false);
    assert.equal(store.writes.length, 0);
  }
});

test("Different IP and hour keys have independent allowances", async () => {
  const store = storage({ count: 5 });
  assert.equal(await reserveAnalysis(store, "hour-ip"), false);
  assert.equal(await reserveAnalysis(store, "hour-other-ip"), true);
  assert.equal(await reserveAnalysis(store, "next-hour-ip"), true);
});

test("Corrupt usage records fail closed without resetting the count", async () => {
  for (const data of [{}, { count: -1 }, { count: 1.5 }, { count: "4" }, { count: null }]) {
    const store = storage(data);
    await assert.rejects(reserveAnalysis(store, "hour-ip"), /Invalid free-analysis/);
    assert.equal(store.writes.length, 0);
  }
});

test("Missing record ETag fails closed instead of overwriting another request", async () => {
  const store = storage({ count: 2 });
  store.records.get("hour-ip").etag = undefined;
  await assert.rejects(reserveAnalysis(store, "hour-ip"), /no ETag/);
  assert.equal(store.writes.length, 0);
});

test("Unconfirmable claims stop after a bounded number of attempts", async () => {
  const store = storage();
  let attempts = 0;
  store.setJSON = async () => { attempts++; return { modified: false }; };
  await assert.rejects(reserveAnalysis(store, "hour-ip"), /could not be confirmed/);
  assert.equal(attempts, HOURLY_ANALYSIS_LIMIT + 1);
});

test("Storage read and conditional-write errors are propagated without granting a permit", async () => {
  const store = storage();
  store.getWithMetadata = async () => { throw new Error("Read unavailable"); };
  await assert.rejects(reserveAnalysis(store, "hour-ip"), /Read unavailable/);
  const writeStore = storage();
  writeStore.setJSON = async () => { throw new Error("Write unavailable"); };
  await assert.rejects(reserveAnalysis(writeStore, "hour-ip"), /Write unavailable/);
});
