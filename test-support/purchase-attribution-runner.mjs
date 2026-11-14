// Run real webhook modules with verified fixture events and isolated transports.
// No live payments, fulfillment, customer data, or Analytics events are sent.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { buildGA4Purchase, sendGA4Purchase } from "../netlify/functions/lib/ga4-purchase.mjs";

const root = path.resolve(import.meta.dirname, "..");
const NOW = Date.parse("2026-11-14T12:00:00Z");
const SESSION = String(NOW / 1000 - 120);
const CID = "123456789.1794657480";
const SID = "M2C-ATTRIBUTION-FIXTURE";
const profile = {
  submission_id: SID, ga_client_id: CID, ga_session_id: SESSION,
  first_name: "PrivateName", email: "private@example.invalid", duties: "PRIVATE-DUTIES",
};
const env = {
  GA4_MEASUREMENT_ID: "G-FIXTURE", GA4_API_SECRET: "fixture-ga-secret",
  STRIPE_WEBHOOK_SECRET: "fixture-live-secret", STRIPE_WEBHOOK_SECRET_TEST: "fixture-test-secret",
  STRIPE_PAYMENT_LINK_ID: "plink_fixture", BLUEPRINT_INTERNAL_SECRET: "fixture-internal",
  NETLIFY_API_TOKEN: "fixture-netlify", NETLIFY_SITE_ID: "fixture-site",
  CONTEXT: "production", URL: "https://example.invalid",
};
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); }
}
const order = overrides => ({
  transactionId: "cs_live_fixture", submissionId: SID, amountTotal: 3900, currency: "usd", profile, now: NOW, ...overrides,
});
const event = overrides => ({
  id: "evt_fixture", type: "checkout.session.completed", livemode: true,
  data: { object: { id: "cs_live_fixture", object: "checkout.session", mode: "payment",
    client_reference_id: SID, payment_status: "paid", livemode: true,
    payment_link: "plink_fixture", currency: "usd", amount_total: 3900, ...overrides } },
});
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
class StripeFixture {
  constructor() {
    this.webhooks = { constructEvent(body, signature, secret) {
      if ((signature === "fixture-live-signature" && secret === env.STRIPE_WEBHOOK_SECRET) ||
        (signature === "fixture-test-signature" && secret === env.STRIPE_WEBHOOK_SECRET_TEST)) return JSON.parse(body);
      throw new Error("Invalid signature");
    } };
  }
}
async function harness(filename, { saved = profile, formsFailure = false, gaFailure = false, variables = env } = {}) {
  const analytics = [], queued = [], logs = [], requests = [];
  const transport = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith("https://api.netlify.com/")) {
      return formsFailure ? new Response(null, { status: 503 }) : Response.json(saved ? [{ data: saved }] : []);
    }
    if (new URL(url).pathname === "/.netlify/functions/fulfill-blueprint") {
      queued.push(JSON.parse(options.body)); return new Response(null, { status: 202 });
    }
    assert.equal(new URL(url).origin, "https://www.google-analytics.com");
    analytics.push(JSON.parse(options.body));
    assert.ok(options.signal instanceof AbortSignal, "Analytics request needs its timeout signal");
    if (gaFailure === "throw") throw new Error(`network failed ${url}`);
    return new Response(null, { status: gaFailure ? 503 : 204 });
  };
  const context = vm.createContext({
    Request, Response, URL, Buffer, AbortSignal, Date: FixtureDate,
    process: { env: variables }, fetch: transport,
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });
  const modules = new Map();
  const imports = { stripe: { default: StripeFixture }, "node:crypto": { default: crypto, createHash: crypto.createHash } };
  async function moduleFor(filename) {
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(await readFile(filename, "utf8"), { context, identifier: filename }));
    return modules.get(filename);
  }
  const entry = await moduleFor(path.join(root, filename));
  await entry.link(async (specifier, parent) => {
    if (imports[specifier]) return new vm.SyntheticModule(Object.keys(imports[specifier]), function () {
      for (const [key, value] of Object.entries(imports[specifier])) this.setExport(key, value);
    }, { context });
    assert.ok(specifier.startsWith("."), specifier);
    return moduleFor(path.resolve(path.dirname(parent.identifier), specifier));
  });
  await entry.evaluate();
  return { handler: entry.namespace.default || entry.namespace.handler, analytics, queued, logs, requests };
}
const primaryRequest = (body = event(), signature = "fixture-live-signature") => new Request(
  "https://example.invalid/.netlify/functions/stripe-webhook", {
    method: "POST", body: JSON.stringify(body), headers: { "stripe-signature": signature },
  }
);
function legacyRequest(body = event(), valid = true, secret = env.STRIPE_WEBHOOK_SECRET) {
  const payload = JSON.stringify(body), timestamp = NOW / 1000;
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return { httpMethod: "POST", body: payload, headers: { "stripe-signature": `t=${timestamp},v1=${valid ? digest : "0".repeat(64)}` } };
}

await check("GA4 purchase joins saved browser client/session and excludes all profile answers", () => {
  const payload = buildGA4Purchase(order());
  assert.equal(payload.client_id, CID);
  assert.equal(payload.events[0].params.session_id, Number(SESSION));
  assert.equal(payload.events[0].params.transaction_id, "cs_live_fixture");
  assert.equal(payload.events[0].params.value, 39);
  assert.equal(payload.events[0].params.currency, "USD");
  assert.equal(payload.events[0].params.engagement_time_msec, undefined);
  for (const value of [profile.first_name, profile.email, profile.duties, SID]) assert.equal(JSON.stringify(payload).includes(value), false);
});
await check("Invalid client IDs never reach Analytics and use a stable unattributed fallback", () => {
  for (const ga_client_id of [profile.email, "123.456?email=private@example.invalid", {}, "", "1".repeat(21) + ".1"]) {
    const first = buildGA4Purchase(order({ profile: { ...profile, ga_client_id } }));
    const second = buildGA4Purchase(order({ profile: {} }));
    assert.equal(first.client_id, second.client_id);
    assert.match(first.client_id, /^\d+\.\d+$/);
    assert.equal(first.events[0].params.session_id, undefined);
    assert.equal(JSON.stringify(first).includes(profile.email), false);
  }
});
await check("Stale, future, and malformed sessions are omitted while browser client identity remains", () => {
  for (const ga_session_id of [String(NOW / 1000 - 86400), String(NOW / 1000 + 1), "0", "abc", profile.email, "9007199254740992", {}, ""]) {
    const payload = buildGA4Purchase(order({ profile: { ...profile, ga_session_id } }));
    assert.equal(payload.client_id, CID);
    assert.equal(payload.events[0].params.session_id, undefined, String(ga_session_id));
  }
});
await check("Explicitly unavailable or malformed new-profile analytics never invent a synthetic visitor", async () => {
  for (const tracking of [
    { ga_tracking_status: "unavailable" },
    { ga_tracking_status: "available", ga_client_id: "private@example.invalid" },
    { ga_tracking_status: "unknown" },
  ]) {
    const purchase = order({ profile: { ...profile, ...tracking } });
    assert.equal(buildGA4Purchase(purchase), null);
    const result = await sendGA4Purchase(purchase, { env, now: NOW, fetchImpl: () => assert.fail("Must not send") });
    assert.equal(result.reason, "tracking_unavailable");
  }
  assert.equal(buildGA4Purchase(order({ profile: { ...profile, ga_tracking_status: "available" } })).client_id, CID);
});
await check("Unconfigured Analytics never sends a request; rejected/failed transport is safe", async () => {
  const result = await sendGA4Purchase(order(), { env: {}, fetchImpl: () => assert.fail("Must not send") });
  assert.equal(result.reason, "not_configured");
  const failure = await sendGA4Purchase(order(), { env, now: NOW, fetchImpl: async () => { throw new Error("Contains secret URL"); } });
  assert.equal(failure.reason, "transport_error");
  const rejected = await sendGA4Purchase(order(), { env, now: NOW, fetchImpl: async () => new Response(null, { status: 500 }) });
  assert.equal(rejected.reason, "rejected");
});
await check("Primary paid webhook queues fulfillment and sends joined purchase with original session transaction", async () => {
  const h = await harness("netlify/functions/stripe-webhook.mjs");
  const response = await h.handler(primaryRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fulfillmentQueued, true);
  assert.equal(h.queued.length, 1);
  assert.equal(h.analytics.length, 1);
  assert.equal(h.analytics[0].client_id, CID);
  assert.equal(h.analytics[0].events[0].params.session_id, Number(SESSION));
  assert.equal(h.analytics[0].events[0].params.transaction_id, "cs_live_fixture");
});
await check("Primary retries preserve purchase transaction/client identity for GA4 deduplication", async () => {
  const h = await harness("netlify/functions/stripe-webhook.mjs");
  await h.handler(primaryRequest()); await h.handler(primaryRequest());
  assert.equal(h.analytics.length, 2);
  assert.deepEqual(h.analytics[0], h.analytics[1]);
});
await check("Delayed paid confirmation reports the same transaction and omits an expired session", async () => {
  const saved = { ...profile, ga_session_id: String(NOW / 1000 - 172800) };
  for (const filename of ["netlify/functions/stripe-webhook.mjs", "netlify/functions/stripe-purchase-webhook.js"]) {
    const h = await harness(filename, { saved });
    const body = { ...event(), type: "checkout.session.async_payment_succeeded" };
    await h.handler(filename.endsWith("stripe-webhook.mjs") ? primaryRequest(body) : legacyRequest(body));
    assert.equal(h.analytics.length, 1);
    assert.equal(h.analytics[0].client_id, CID);
    assert.equal(h.analytics[0].events[0].params.session_id, undefined);
    assert.equal(h.analytics[0].events[0].params.transaction_id, "cs_live_fixture");
  }
});
await check("Primary old profiles still record purchases with a deterministic fallback", async () => {
  const h = await harness("netlify/functions/stripe-webhook.mjs", { saved: { submission_id: SID, email: profile.email } });
  assert.equal((await h.handler(primaryRequest())).status, 200);
  assert.match(h.analytics[0].client_id, /^\d+\.\d+$/);
  assert.equal(h.analytics[0].events[0].params.session_id, undefined);
  assert.equal(JSON.stringify(h.analytics).includes(profile.email), false);
});
await check("Primary analytics failures never fail the already queued paid fulfillment", async () => {
  for (const gaFailure of [true, "throw"]) {
    const h = await harness("netlify/functions/stripe-webhook.mjs", { gaFailure });
    const response = await h.handler(primaryRequest());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).fulfillmentQueued, true);
    assert.equal(h.queued.length, 1);
    assert.equal(JSON.stringify(h.logs).includes(env.GA4_API_SECRET), false);
  }
});
await check("Both paid webhook paths skip analytics for explicitly unavailable tracking", async () => {
  const saved = { ...profile, ga_tracking_status: "unavailable" };
  const primary = await harness("netlify/functions/stripe-webhook.mjs", { saved });
  assert.equal((await primary.handler(primaryRequest())).status, 200);
  assert.equal(primary.queued.length, 1);
  assert.equal(primary.analytics.length, 0);
  const legacy = await harness("netlify/functions/stripe-purchase-webhook.js", { saved });
  const response = await legacy.handler(legacyRequest());
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).status, "analytics_skipped");
  assert.equal(legacy.analytics.length, 0);
});
await check("Primary unpaid, sandbox, bad-signature, and unsupported events never report purchases", async () => {
  for (const [body, signature] of [
    [event({ payment_status: "unpaid" }), "fixture-live-signature"],
    [{ ...event(), livemode: false }, "fixture-test-signature"],
    [event(), "invalid-signature"],
    [{ ...event(), type: "charge.refunded" }, "fixture-live-signature"],
  ]) {
    const h = await harness("netlify/functions/stripe-webhook.mjs");
    await h.handler(primaryRequest(body, signature));
    assert.equal(h.analytics.length, 0);
  }
});
await check("Legacy paid webhook retrieves saved attribution and sends the same purchase contract", async () => {
  const h = await harness("netlify/functions/stripe-purchase-webhook.js");
  assert.equal((await h.handler(legacyRequest())).statusCode, 200);
  assert.equal(h.analytics[0].client_id, CID);
  assert.equal(h.analytics[0].events[0].params.session_id, Number(SESSION));
  assert.equal(h.analytics[0].events[0].params.transaction_id, "cs_live_fixture");
  assert.equal(h.analytics[0].events[0].params.value, 39);
  assert.equal(h.queued.length, 0);
});
await check("Legacy purchase webhook accepts its dedicated endpoint signing secret", async () => {
  const secret = "fixture-dedicated-purchase-secret";
  const h = await harness("netlify/functions/stripe-purchase-webhook.js", {
    variables: { ...env, STRIPE_PURCHASE_WEBHOOK_SECRET: secret },
  });
  assert.equal((await h.handler(legacyRequest(event(), true, secret))).statusCode, 200);
  assert.equal(h.analytics.length, 1);
});
await check("Legacy purchase webhook rejects the primary secret when a dedicated secret is configured", async () => {
  const h = await harness("netlify/functions/stripe-purchase-webhook.js", {
    variables: { ...env, STRIPE_PURCHASE_WEBHOOK_SECRET: "fixture-dedicated-purchase-secret" },
  });
  assert.equal((await h.handler(legacyRequest())).statusCode, 400);
  assert.equal(h.requests.length, 0);
});
await check("Legacy purchase webhook preserves primary-secret fallback when dedicated secret is absent", async () => {
  const h = await harness("netlify/functions/stripe-purchase-webhook.js", { variables: { ...env } });
  assert.equal((await h.handler(legacyRequest())).statusCode, 200);
  assert.equal(h.analytics.length, 1);
});
await check("Legacy lookup failures are retryable without creating a second analytics identity", async () => {
  for (const options of [{ formsFailure: true }, { saved: null }]) {
    const h = await harness("netlify/functions/stripe-purchase-webhook.js", options);
    assert.equal((await h.handler(legacyRequest())).statusCode, 503);
    assert.equal(h.analytics.length, 0);
  }
});
await check("Legacy confirmed older profiles preserve unattributed purchase counting", async () => {
  const h = await harness("netlify/functions/stripe-purchase-webhook.js", { saved: { submission_id: SID, email: profile.email } });
  assert.equal((await h.handler(legacyRequest())).statusCode, 200);
  assert.match(h.analytics[0].client_id, /^\d+\.\d+$/);
  assert.equal(h.analytics[0].events[0].params.session_id, undefined);
});
await check("Legacy webhook still rejects nonmatching, unpaid, sandbox, and unsigned events", async () => {
  for (const request of [
    legacyRequest(event({ payment_status: "unpaid" })), legacyRequest(event({ livemode: false })),
    legacyRequest(event({ amount_total: 1 })), legacyRequest(event({ payment_link: "plink_other" })),
    legacyRequest(event(), false),
  ]) {
    const h = await harness("netlify/functions/stripe-purchase-webhook.js");
    await h.handler(request);
    assert.equal(h.analytics.length, 0);
    assert.equal(h.requests.length, 0);
  }
});
await check("Legacy analytics transport failure stays retryable without exposing its secret", async () => {
  const h = await harness("netlify/functions/stripe-purchase-webhook.js", { gaFailure: "throw" });
  assert.equal((await h.handler(legacyRequest())).statusCode, 502);
  assert.equal(JSON.stringify(h.logs).includes(env.GA4_API_SECRET), false);
});

process.stdout.write(JSON.stringify(results));
if (results.some(result => !result.passed)) process.exitCode = 1;
