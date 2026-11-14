// Stripe Payment Link purchase tracking for Netlify Functions.
// Configure STRIPE_PURCHASE_WEBHOOK_SECRET, STRIPE_PAYMENT_LINK_ID, GA4_MEASUREMENT_ID,
// and GA4_API_SECRET in Netlify environment variables. Never expose secrets in browser code.
// STRIPE_WEBHOOK_SECRET remains a fallback for installations using one endpoint.
import crypto from "node:crypto";
import { findMOS2CareerProfile } from "./lib/find-profile.mjs";
import { sendGA4Purchase } from "./lib/ga4-purchase.mjs";

function verifiedEvent(payload, header, secret) {
  const parts = Object.fromEntries((header || "").split(",").map(x => x.trim().split("=")).filter(x => x.length === 2));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const signatures = (header || "").split(",").filter(x => x.startsWith("v1=")).map(x => x.slice(3));
  const digest = crypto.createHmac("sha256", secret).update(timestamp + "." + payload).digest("hex");
  return signatures.some(sig => /^[0-9a-f]{64}$/i.test(sig) &&
    crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(digest, "hex")));
}
function respond(statusCode, body) {
  return {statusCode, headers: {"Content-Type":"application/json"}, body:JSON.stringify({status:body})};
}
export const handler = async event => {
  if (event.httpMethod !== "POST") return respond(405, "method_not_allowed");
  const {STRIPE_PURCHASE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET, STRIPE_PAYMENT_LINK_ID, GA4_MEASUREMENT_ID, GA4_API_SECRET} = process.env;
  const webhookSecret = STRIPE_PURCHASE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET;
  if (![webhookSecret, STRIPE_PAYMENT_LINK_ID, GA4_MEASUREMENT_ID, GA4_API_SECRET].every(Boolean)) {
    console.error("Purchase tracking not configured");
    return respond(503, "not_configured");
  }
  const payload = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const header = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"];
  if (!verifiedEvent(payload, header, webhookSecret)) return respond(400, "invalid_signature");
  let stripeEvent;
  try { stripeEvent = JSON.parse(payload); } catch { return respond(400, "invalid_payload"); }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(stripeEvent.type)) {
    return respond(200, "ignored_event");
  }
  const session = stripeEvent.data?.object;
  if (!session || session.object !== "checkout.session" || session.mode !== "payment" ||
      session.payment_status !== "paid" || session.livemode !== true ||
      session.payment_link !== STRIPE_PAYMENT_LINK_ID ||
      session.currency?.toLowerCase() !== "usd" || session.amount_total !== 3900 ||
      !session.id || !session.client_reference_id) return respond(200, "not_matching_paid_blueprint");
  let profile;
  // Retry this measurement if Forms is delayed, rather than first recording a
  // synthetic client and later recording the same purchase against a browser ID.
  // This endpoint does not queue or otherwise affect fulfillment.
  try {
    const submission = await findMOS2CareerProfile(session.client_reference_id, { deadline: Date.now() + 5_000 });
    if (!submission) return respond(503, "attribution_profile_unavailable");
    profile = submission.data || {};
  } catch {
    console.warn("Purchase attribution profile unavailable; retrying measurement");
    return respond(503, "attribution_profile_unavailable");
  }
  const result = await sendGA4Purchase({
    transactionId: session.id,
    submissionId: session.client_reference_id,
    amountTotal: session.amount_total,
    currency: session.currency,
    profile,
  });
  if (result.reason === "tracking_unavailable") return respond(200, "analytics_skipped");
  if (!result.sent) return respond(502, "analytics_unavailable");
  return respond(200, "recorded");
};
