import Stripe from "stripe";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

 const liveSecret = process.env.STRIPE_WEBHOOK_SECRET;
const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST;

if (!liveSecret && !testSecret) {
  console.error("No Stripe webhook signing secrets are configured.");
  return new Response("Server configuration error", { status: 500 });
}

const signature = request.headers.get("stripe-signature");

if (!signature) {
  return new Response("Missing Stripe signature", { status: 400 });
}

const rawBody = await request.text();

const stripe = new Stripe("sk_placeholder_for_webhook_verification_only");

let event = null;
let verifiedMode = null;

for (const [mode, secret] of [
  ["live", liveSecret],
  ["sandbox", testSecret]
]) {
  if (!secret) continue;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      secret
    );

    verifiedMode = mode;
    break;
  } catch (err) {
    // Try the next configured signing secret.
  }
}

if (!event) {
  console.error("Stripe webhook signature verification failed.");
  return new Response("Invalid signature", { status: 400 });
}

console.log(`Stripe webhook verified using ${verifiedMode} secret.`);
