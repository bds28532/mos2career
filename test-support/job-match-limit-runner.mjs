// Run the real request handler with provider fixtures; no network or AI charges.
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { reserveAnalysis } from "../netlify/functions/lib/job-match-limit.mjs";
import { JOB_MATCH_INSTRUCTIONS, verifyEducationClaims } from "../netlify/functions/lib/job-match-report.mjs";

const source = await readFile(new URL("../netlify/functions/job-match-analyze.mjs", import.meta.url), "utf8");
const results = [];
const validInput = { branch: "Army", specialty: "25B", duties: "Fixture support duties",
  jobDescription: "IT support fixture: troubleshoot desktop and network issues, support users, document incidents, and maintain equipment." };

async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); }
}

async function scenario({ prior, readError, writeError, aiError, apiKey = "fixture-no-network" } = {}) {
  const records = new Map();
  const stats = { aiCalls: 0, reads: 0, writes: 0 };
  let revision = 0;
  const clock = { now: Date.parse("2026-11-11T03:00:00Z") };
  class FixtureDate extends Date { static now() { return clock.now; } }
  const store = {
    async getWithMetadata(key, options) {
      stats.reads++;
      assert.equal(options.consistency, "strong");
      if (readError) throw new Error("Storage read failed");
      if (!records.has(key) && prior !== undefined) records.set(key, { data: { count: prior }, etag: "legacy" });
      return structuredClone(records.get(key) || null);
    },
    async setJSON(key, data, options) {
      stats.writes++;
      if (writeError) throw new Error("Storage write failed");
      const existing = records.get(key);
      if (options.onlyIfNew && existing) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== existing?.etag) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: `v${++revision}` });
      return { modified: true };
    },
  };
  class OpenAIFixture {
    constructor() {
      this.responses = { create: async () => {
        stats.aiCalls++;
        if (aiError) throw new Error("AI unavailable");
        return { output_text: JSON.stringify({ summary: "Fixture result", demonstratedSkills: [],
          potentialSkillsToVerify: [], gaps: [], resumeExample: "Fixture", nextSteps: [] }) };
      } };
    }
  }
  const context = vm.createContext({ Request, Response, Date: FixtureDate,
    console: { log() {}, error() {}, warn() {} }, process: { env: { OPENAI_API_KEY: apiKey } },
  });
  const imports = { "@netlify/blobs": { getStore: () => store }, "node:crypto": { createHash },
    openai: { default: OpenAIFixture }, "./lib/job-match-limit.mjs": { reserveAnalysis },
    "./lib/job-match-report.mjs": { JOB_MATCH_INSTRUCTIONS, verifyEducationClaims } };
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(specifier => {
    const values = imports[specifier];
    if (!values) throw new Error(`Unexpected import: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await mod.evaluate();
  return { stats, records, clock,
    invoke: (data = validInput, ip = "192.0.2.40") => mod.namespace.default(new Request(
      "https://example.invalid/.netlify/functions/job-match-analyze", {
        method: "POST", headers: ip ? { "x-nf-client-connection-ip": ip } : {}, body: JSON.stringify(data),
      }
    )),
  };
}

await check("Handler admits exactly five AI calls from a 100-request burst", async () => {
  const s = await scenario();
  const responses = await Promise.all(Array.from({ length: 100 }, () => s.invoke()));
  assert.equal(responses.filter(r => r.status === 200).length, 5);
  assert.equal(responses.filter(r => r.status === 429).length, 95);
  assert.equal(s.stats.aiCalls, 5);
});
await check("Handler with one remaining analysis admits one of ten simultaneous requests", async () => {
  const s = await scenario({ prior: 4 });
  const responses = await Promise.all(Array.from({ length: 10 }, () => s.invoke()));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 429).length, 9);
  assert.equal(s.stats.aiCalls, 1);
});
await check("Handler resets allowance in the next hour and separates client IPs", async () => {
  const s = await scenario();
  for (let i = 0; i < 5; i++) assert.equal((await s.invoke()).status, 200);
  assert.equal((await s.invoke()).status, 429);
  assert.equal((await s.invoke(validInput, "192.0.2.41")).status, 200);
  s.clock.now += 3_600_000;
  assert.equal((await s.invoke()).status, 200);
  assert.equal(s.records.size, 3);
  assert.ok([...s.records.keys()].every(key => !key.includes("192.0.2")));
});
for (const error of ["readError", "writeError"]) await check(`Handler returns 503 without calling AI on ${error}`, async () => {
  const s = await scenario({ [error]: true });
  assert.equal((await s.invoke()).status, 503);
  assert.equal(s.stats.aiCalls, 0);
});
await check("Invalid form input consumes no allowance and makes no AI call", async () => {
  const s = await scenario();
  assert.equal((await s.invoke({ ...validInput, jobDescription: "short" })).status, 400);
  assert.equal(s.stats.reads, 0);
  assert.equal(s.stats.aiCalls, 0);
});
await check("Missing API configuration consumes no allowance", async () => {
  const s = await scenario({ apiKey: "" });
  assert.equal((await s.invoke()).status, 503);
  assert.equal(s.stats.reads, 0);
  assert.equal(s.stats.aiCalls, 0);
});
await check("Unverifiable request origin cannot consume AI capacity", async () => {
  const s = await scenario();
  assert.equal((await s.invoke(validInput, null)).status, 429);
  assert.equal(s.stats.reads, 0);
  assert.equal(s.stats.aiCalls, 0);
});
await check("A failed AI attempt stays counted to protect the hourly cost limit", async () => {
  const s = await scenario({ aiError: true });
  assert.equal((await s.invoke()).status, 502);
  assert.equal(s.stats.aiCalls, 1);
  assert.equal([...s.records.values()][0].data.count, 1);
});

console.log(JSON.stringify(results));
if (results.some(result => !result.passed)) process.exitCode = 1;
