import Stripe from "stripe";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured.");
    return new Response("Server configuration error", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  const rawBody = await request.text();

  const stripe = new Stripe("sk_placeholder_for_webhook_verification_only");

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      secret
    );
  } catch (err) {
    console.error(
      "Stripe webhook signature verification failed:",
      err.message
    );

    return new Response("Invalid signature", { status: 400 });
  }

  const supportedEvents = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed"
  ]);

  if (!supportedEvents.has(event.type)) {
    return Response.json({
      received: true,
      ignored: event.type
    });
  }

  const session = event.data.object;

  const order = {
    event_id: event.id,
    event_type: event.type,

    checkout_session_id: session.id,

    submission_id:
      session.client_reference_id || null,

    email:
      session.customer_details?.email ||
      session.customer_email ||
      null,

    payment_status:
      session.payment_status || null,

    amount_total:
      session.amount_total ?? null,

    currency:
      session.currency || null
  };

  console.log(
    "MOS2Career Stripe event:",
    JSON.stringify(order)
  );

  if (!order.submission_id) {
    console.warn(
      "Stripe event has no MOS2Career submission ID. Manual review required."
    );
  }

  return Response.json({
    received: true,
    matched_submission_id: order.submission_id,
    payment_status: order.payment_status
  });
};
