// Execute the real handlers with isolated storage and provider transports.
// No API keys, network access, AI calls, payments, or emails are used.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const NOW = Date.parse("2026-11-10T12:00:00Z");
const SID = "M2C-RECOVERY-TEST";
const KEY = `blueprint-${SID}`;
const profile = { submission_id: SID, email: "qa@example.invalid", branch: "Army" };
const env = {
  BLUEPRINT_INTERNAL_SECRET: "fixture-internal",
  RESEND_API_KEY: "fixture-email",
  NETLIFY_API_TOKEN: "fixture-forms",
  NETLIFY_SITE_ID: "fixture-site",
  STRIPE_WEBHOOK_SECRET_TEST: "fixture-webhook",
  CONTEXT: "production",
  URL: "https://example.invalid",
};
const quiet = { log() {}, error() {}, warn() {} };
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); }
}

async function load(filename, imports, fetchImpl, variables = env, clock = { now: NOW }) {
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const context = vm.createContext({
    Request, Response, URL, Buffer, AbortSignal, Date: FixtureDate,
    console: quiet, process: { env: variables }, fetch: fetchImpl,
  });
  const modules = new Map();
  async function getModule(filename) {
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(
      await readFile(filename, "utf8"), { context, identifier: filename }
    ));
    return modules.get(filename);
  }
  const entry = await getModule(path.join(root, filename));
  await entry.link(async (specifier, parent) => {
    if (imports[specifier]) return new vm.SyntheticModule(
      Object.keys(imports[specifier]), function () {
        for (const [key, value] of Object.entries(imports[specifier])) this.setExport(key, value);
      }, { context }
    );
    if (!specifier.startsWith(".")) throw new Error(`Unexpected import: ${specifier}`);
    return getModule(path.resolve(path.dirname(parent.identifier), specifier));
  });
  await entry.evaluate();
  return entry.namespace;
}

function storage() {
  const maps = new Map();
  let revision = 0;
  const mapFor = name => {
    if (!maps.has(name)) maps.set(name, new Map());
    return maps.get(name);
  };
  const seed = (name, key, data, binary = false) => {
    mapFor(name).set(key, { data: binary ? Buffer.from(data) : structuredClone(data), etag: `etag-${++revision}`, binary });
  };
  const getStore = name => ({
    async get(key, options = {}) {
      const item = mapFor(name).get(key);
      if (!item) return null;
      if (options.type === "arrayBuffer") {
        const bytes = Buffer.from(item.data);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      return structuredClone(item.data);
    },
    async getWithMetadata(key) {
      const item = mapFor(name).get(key);
      return item ? { data: structuredClone(item.data), etag: item.etag, metadata: {} } : null;
    },
    async setJSON(key, value, options = {}) {
      const current = mapFor(name).get(key);
      if (options.onlyIfNew && current) return { modified: false };
      if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
      seed(name, key, value);
      return { modified: true, etag: mapFor(name).get(key).etag };
    },
    async set(key, bytes) { seed(name, key, bytes, true); },
    async list({ prefix }) {
      return { blobs: [...mapFor(name).keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) };
    },
  });
  return { getStore, seed, record: () => mapFor("mos2career-fulfillments").get(KEY)?.data };
}

function webhookRequest(event, signature = "fixture-signature") {
  return new Request("https://example.invalid/.netlify/functions/stripe-webhook", {
    method: "POST", body: JSON.stringify(event),
    headers: signature ? { "stripe-signature": signature } : {},
  });
}
const event = (paid = "paid", type = "checkout.session.completed") => ({
  id: "evt_fixture", livemode: false, type,
  data: { object: { id: "cs_test_fixture", client_reference_id: SID, payment_status: paid } },
});
class StripeFixture {
  constructor() {
    this.webhooks = { constructEvent(body, signature, secret) {
      if (signature !== "fixture-signature" || secret !== env.STRIPE_WEBHOOK_SECRET_TEST) throw new Error("Invalid signature");
      return JSON.parse(body);
    } };
  }
}
async function webhook(forms) {
  const queued = [];
  const pages = [];
  const { default: handler } = await load("netlify/functions/stripe-webhook.mjs", {
    stripe: { default: StripeFixture },
  }, async (url, options) => {
    if (String(url).startsWith("https://api.netlify.com/")) {
      pages.push(Number(new URL(url).searchParams.get("page")));
      return forms(url, options);
    }
    assert.equal(new URL(url).pathname, "/.netlify/functions/fulfill-blueprint");
    queued.push(JSON.parse(options.body));
    return new Response(null, { status: 202 });
  });
  return { handler, queued, pages };
}

await check("Missing paid profile returns retryable 503; later replay queues the profile", async () => {
  let visible = false;
  const w = await webhook(() => Response.json(visible ? [{ data: profile }] : []));
  const first = await w.handler(webhookRequest(event()));
  assert.equal(first.status, 503);
  assert.equal((await first.json()).retryable, true);
  assert.equal(w.queued.length, 0);
  visible = true;
  const replay = await w.handler(webhookRequest(event()));
  assert.equal(replay.status, 200);
  assert.equal(w.queued.length, 1);
  assert.equal(w.queued[0].profile.email, profile.email);
});
await check("Older profile is found beyond the first 100 submissions", async () => {
  const w = await webhook(url => Response.json(new URL(url).searchParams.get("page") === "1"
    ? Array.from({ length: 100 }, (_, i) => ({ data: { reference_id: `other-${i}` } }))
    : [{ data: { ...profile, submission_id: undefined, referenceId: ` ${SID.toLowerCase()} ` } }]));
  assert.equal((await w.handler(webhookRequest(event()))).status, 200);
  assert.deepEqual(w.pages, [1, 2]);
  assert.equal(w.queued.length, 1);
});
await check("Forms API failure remains retryable and queues nothing", async () => {
  const w = await webhook(() => new Response(null, { status: 503 }));
  assert.equal((await w.handler(webhookRequest(event()))).status, 500);
  assert.equal(w.queued.length, 0);
});
for (const [name, payload, signature] of [
  ["Unpaid payment does not queue", event("unpaid"), "fixture-signature"],
  ["Failed delayed payment does not queue", event("unpaid", "checkout.session.async_payment_failed"), "fixture-signature"],
  ["Missing signature does not look up or queue a customer", event(), null],
]) await check(name, async () => {
  const w = await webhook(() => { throw new Error("Profile lookup should not run"); });
  const response = await w.handler(webhookRequest(payload, signature));
  assert.equal(response.status, signature ? 200 : 400);
  assert.equal(w.queued.length, 0);
  assert.equal(w.pages.length, 0);
});

async function fulfillment(existing, hooks = {}) {
  const db = hooks.db || storage();
  if (existing) db.seed("mos2career-fulfillments", KEY, existing);
  const stats = { generated: 0, pdfBuilt: 0, emails: [] };
  const { default: handler } = await load("netlify/functions/fulfill-blueprint.mjs", {
    "@netlify/blobs": { getStore: db.getStore },
    "./generate-blueprint.mjs": { generateCompleteCareerBlueprint: async () => {
      stats.generated++; await hooks.generate?.(db); return { fixture: true };
    } },
    "./create-blueprint-pdf.mjs": { buildBlueprintPDF: async () => {
      stats.pdfBuilt++; await hooks.pdf?.(db); return Buffer.from("PDF fixture");
    } },
  }, async (url, options) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    stats.emails.push({ body: options.body, key: options.headers["Idempotency-Key"] });
    return hooks.email ? hooks.email(db, stats) : Response.json({ id: "email_fixture" });
  });
  const invoke = () => handler(new Request("https://example.invalid/.netlify/functions/fulfill-blueprint", {
    method: "POST", headers: { authorization: `Bearer ${env.BLUEPRINT_INTERNAL_SECRET}` },
    body: JSON.stringify({ submissionId: SID, checkoutSessionId: "cs_test_fixture", eventId: "evt_fixture", mode: "sandbox", profile }),
  }));
  return { db, stats, invoke };
}
const old = { status: "processing", startedAt: "2000-01-01T00:00:00Z", submissionId: SID };
for (const [name, existing] of [
  ["New order", null], ["Abandoned processing order", old],
  ["Legacy processing order with no timestamp", { status: "processing" }],
  ["Previously failed order", { status: "failed" }],
  ["Abandoned legacy generated order", { status: "generated", generatedAt: old.startedAt }],
]) await check(`${name}: simultaneous retries produce one Blueprint and email`, async () => {
  const f = await fulfillment(existing);
  await Promise.all([f.invoke(), f.invoke(), f.invoke()]);
  assert.equal(f.stats.generated, 1);
  assert.equal(f.stats.emails.length, 1);
  assert.equal(f.db.record().status, "delivered");
});
for (const status of ["processing", "generated", "delivered"]) await check(`Current ${status} order is not duplicated`, async () => {
  const f = await fulfillment({ status, startedAt: new Date(NOW).toISOString() });
  await f.invoke();
  assert.equal(f.stats.generated, 0);
  assert.equal(f.stats.emails.length, 0);
});
for (const [age, expected] of [[20 * 60 * 1000 - 1, 0], [20 * 60 * 1000, 1]]) {
  await check(`Processing lease boundary at ${age}ms admits ${expected} recovery`, async () => {
    const f = await fulfillment({ status: "processing", startedAt: new Date(NOW - age).toISOString() });
    await f.invoke();
    assert.equal(f.stats.emails.length, expected);
  });
}
await check("Retry during PDF rendering cannot take over the generated stage", async () => {
  let resume, entered;
  const blocked = new Promise(resolve => { resume = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const f = await fulfillment(null, { pdf: async () => { entered(); await blocked; } });
  const first = f.invoke();
  await ready;
  await f.invoke();
  resume();
  await first;
  assert.equal(f.stats.generated, 1);
  assert.equal(f.stats.emails.length, 1);
});
await check("Worker that loses its claim cannot email or overwrite its successor", async () => {
  const replacement = { status: "processing", startedAt: new Date(NOW).toISOString(), owner: "successor" };
  const f = await fulfillment(old, { generate: db => db.seed("mos2career-fulfillments", KEY, replacement) });
  await assert.rejects(f.invoke(), /claim expired or was replaced/);
  assert.equal(f.stats.emails.length, 0);
  assert.equal(f.db.record().owner, "successor");
});
await check("Late delivery failure cannot turn an already delivered successor into failed", async () => {
  const f = await fulfillment(null, { email: db => {
    db.seed("mos2career-fulfillments", KEY, { status: "delivered", owner: "successor" });
    return Response.json({ id: "email_fixture" });
  } });
  await assert.rejects(f.invoke(), /claim expired or was replaced/);
  assert.equal(f.db.record().status, "delivered");
  assert.equal(f.db.record().owner, "successor");
});
await check("Ambiguous email failure reuses Blueprint, exact PDF, payload, and idempotency key", async () => {
  const f = await fulfillment(null, { email: (_db, stats) => {
    if (stats.emails.length === 1) throw new Error("Transport timed out after sending");
    return Response.json({ id: "email_fixture" });
  } });
  await assert.rejects(f.invoke(), /Transport timed out/);
  assert.equal(f.db.record().status, "failed");
  await f.invoke();
  assert.equal(f.stats.generated, 1);
  assert.equal(f.stats.pdfBuilt, 1);
  assert.equal(f.stats.emails.length, 2);
  assert.deepEqual(f.stats.emails[0], f.stats.emails[1]);
  assert.equal(f.db.record().status, "delivered");
});

async function recover(db, fetchImpl, variables = env, deploy = { context: "production", published: true }) {
  const { default: handler, config } = await load("netlify/functions/recover-blueprints.mjs", {
    "@netlify/blobs": { getStore: db.getStore },
  }, fetchImpl, variables);
  assert.equal(config.schedule, "*/5 * * * *");
  return () => handler(new Request("https://example.invalid/.netlify/functions/recover-blueprints"), { deploy });
}
await check("Scheduled recovery resumes an abandoned order without a payment replay", async () => {
  const f = await fulfillment({ ...old, profile });
  let queued = 0;
  const run = await recover(f.db, async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${env.BLUEPRINT_INTERNAL_SECRET}`);
    queued++;
    await f.invoke();
    return new Response(null, { status: 202 });
  });
  await run(); await run();
  assert.equal(queued, 1);
  assert.equal(f.db.record().status, "delivered");
  assert.equal(f.stats.emails.length, 1);
});
await check("Legacy recovery looks up the saved profile; active and delivered orders are skipped", async () => {
  const db = storage();
  db.seed("mos2career-fulfillments", KEY, old);
  db.seed("mos2career-fulfillments", "blueprint-fresh", { status: "processing", startedAt: new Date(NOW).toISOString() });
  db.seed("mos2career-fulfillments", "blueprint-delivered", { status: "delivered" });
  const queued = [];
  const run = await recover(db, async (url, options) => {
    if (new URL(url).hostname === "api.netlify.com") return Response.json([{ data: profile }]);
    queued.push(JSON.parse(options.body)); return new Response(null, { status: 202 });
  });
  await run();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].submissionId, SID);
});
await check("Recovery cursor rotates past historical deliveries and an unavailable profile", async () => {
  const db = storage();
  for (let i = 0; i < 45; i++) db.seed("mos2career-fulfillments", `blueprint-${String(i).padStart(2, "0")}`, { status: "delivered" });
  db.seed("mos2career-fulfillments", "blueprint-20-bad", { ...old, submissionId: "missing" });
  db.seed("mos2career-fulfillments", "blueprint-44-stale", { ...old, profile });
  const queued = [];
  const run = await recover(db, async (url, options) => {
    if (new URL(url).hostname === "api.netlify.com") return Response.json([]);
    queued.push(JSON.parse(options.body)); return new Response(null, { status: 202 });
  });
  await run(); await run(); await run();
  assert.equal(queued.length, 1);
});
await check("Preview recovery is inactive and cannot touch production jobs", async () => {
  const db = { getStore() { throw new Error("Preview must not read shared Blobs"); } };
  const run = await recover(db, () => { throw new Error("Preview must not fetch"); }, env, { context: "deploy-preview", published: false });
  await run();
});
await check("Unpublished production deploy cannot recover jobs", async () => {
  const db = { getStore() { throw new Error("Unpublished deploy must not read shared Blobs"); } };
  const run = await recover(db, () => { throw new Error("Unpublished deploy must not fetch"); }, env, { context: "production", published: false });
  await run();
});
await check("Scheduled recovery waits five minutes after a failure", async () => {
  const db = storage();
  db.seed("mos2career-fulfillments", KEY, { ...old, profile, status: "failed", failedAt: new Date(NOW - 60_000).toISOString() });
  let queued = 0;
  const run = await recover(db, () => { queued++; return new Response(null, { status: 202 }); });
  await run();
  assert.equal(queued, 0);
  db.seed("mos2career-fulfillments", KEY, { ...old, profile, status: "failed", failedAt: new Date(NOW - 300_000).toISOString() });
  await run();
  assert.equal(queued, 1);
});

console.log(JSON.stringify(results));
if (results.some(result => !result.passed)) process.exitCode = 1;
