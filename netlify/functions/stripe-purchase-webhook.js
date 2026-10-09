// Stripe Payment Link purchase tracking for Netlify Functions.
// Configure STRIPE_PURCHASE_WEBHOOK_SECRET, STRIPE_PAYMENT_LINK_ID, GA4_MEASUREMENT_ID,
// and GA4_API_SECRET in Netlify environment variables. Never expose secrets in browser code.
const crypto = require("node:crypto");

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
exports.handler = async event => {
  if (event.httpMethod !== "POST") return respond(405, "method_not_allowed");
  const {STRIPE_WEBHOOK_SECRET, STRIPE_PAYMENT_LINK_ID, GA4_MEASUREMENT_ID, GA4_API_SECRET} = process.env;
  if (![STRIPE_WEBHOOK_SECRET, STRIPE_PAYMENT_LINK_ID, GA4_MEASUREMENT_ID, GA4_API_SECRET].every(Boolean)) {
    console.error("Purchase tracking not configured");
    return respond(503, "not_configured");
  }
  const payload = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const header = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"];
  if (!verifiedEvent(payload, header, STRIPE_WEBHOOK_SECRET)) return respond(400, "invalid_signature");
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
  // Synthetic client_id avoids sending an email or personal profile to GA4.
  // It cannot join the original browser visit without a separately implemented GA client ID bridge.
  const digest = crypto.createHash("sha256").update(session.client_reference_id).digest("hex");
  const clientId = parseInt(digest.slice(0, 8), 16) + "." + parseInt(digest.slice(8, 16), 16);
  const url = "https://www.google-analytics.com/mp/collect?measurement_id=" +
    encodeURIComponent(GA4_MEASUREMENT_ID) + "&api_secret=" + encodeURIComponent(GA4_API_SECRET);
  try {
    const result = await fetch(url, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({client_id:clientId, events:[{name:"purchase",params:{
        transaction_id:session.id, currency:"USD", value:39,
        items:[{item_id:"career_blueprint",item_name:"MOS2Career Personalized Career Blueprint",price:39,quantity:1}]
      }}]})
    });
    if (!result.ok) {console.error("GA4 measurement protocol rejected request", result.status); return respond(502, "analytics_unavailable");}
    return respond(200, "recorded");
  } catch (err) {
    console.error("GA4 transport failure", err.message);
    return respond(502, "analytics_unavailable");
  }
};
