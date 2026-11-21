import { createHash } from "node:crypto";

function purchaseAmounts({ amountTotal, amountTax = 0, amountShipping = 0 }) {
  if (![amountTotal, amountTax, amountShipping].every(value => Number.isSafeInteger(value) && value >= 0) ||
      amountTax > amountTotal || amountShipping > amountTotal - amountTax) return null;
  // GA4 value/item price exclude tax and shipping. Stripe's paid total already
  // includes discounts, so subtracting those again would understate revenue.
  return { value: (amountTotal - amountTax - amountShipping) / 100,
    tax: amountTax / 100, shipping: amountShipping / 100 };
}

// Match the browser visit when it supplied valid GA identifiers. Never infer an
// identifier from an email address, military duties, or any other profile answer.
export function buildGA4Purchase({ transactionId, submissionId, amountTotal, amountTax, amountShipping, currency, profile = {}, now = Date.now() }) {
  const amounts = purchaseAmounts({ amountTotal, amountTax, amountShipping });
  if (!amounts) return null;
  const clientId = typeof profile.ga_client_id === "string" &&
    /^\d{1,20}\.\d{1,20}$/.test(profile.ga_client_id)
    ? profile.ga_client_id : null;
  if (Object.hasOwn(profile, "ga_tracking_status") &&
    (profile.ga_tracking_status !== "available" || !clientId)) return null;
  const digest = createHash("sha256").update(String(submissionId || transactionId)).digest("hex");
  const fallbackId = `${parseInt(digest.slice(0, 8), 16)}.${parseInt(digest.slice(8, 16), 16)}`;
  const params = {
    transaction_id: transactionId,
    ...amounts,
    currency: (currency || "usd").toUpperCase(),
    items: [{
      item_id: "career_blueprint",
      item_name: "MOS2Career Personalized Career Blueprint",
      price: amounts.value,
      quantity: 1,
    }],
  };
  const rawSession = profile.ga_session_id;
  const sessionId = typeof rawSession === "string" && /^\d{1,16}$/.test(rawSession)
    ? Number(rawSession) : NaN;
  const age = now - sessionId * 1000;
  // Google's session attribution window ends 24 hours after session start.
  // Older purchases can still join the browser user, without claiming an old session.
  if (clientId && Number.isSafeInteger(sessionId) && sessionId > 0 && age >= 0 && age < 86_400_000) {
    params.session_id = sessionId;
  }
  return { client_id: clientId || fallbackId, events: [{ name: "purchase", params }] };
}

export async function sendGA4Purchase(purchase, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return { sent: false, reason: "not_configured" };
  if (!purchaseAmounts(purchase)) return { sent: false, reason: "invalid_amounts" };
  const payload = buildGA4Purchase({ ...purchase, now });
  // A new profile explicitly reports unavailable analytics instead of creating
  // a synthetic visitor that would bypass blocked/disabled browser tracking.
  if (!payload) return { sent: false, reason: "tracking_unavailable" };
  const url = new URL("https://www.google-analytics.com/mp/collect");
  url.searchParams.set("measurement_id", env.GA4_MEASUREMENT_ID);
  url.searchParams.set("api_secret", env.GA4_API_SECRET);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok ? { sent: true } : { sent: false, reason: "rejected" };
  } catch {
    // A failed analytics request must not expose the secret URL or block delivery.
    return { sent: false, reason: "transport_error" };
  }
}
