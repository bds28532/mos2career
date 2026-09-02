import Stripe from "stripe";

const stripe = new Stripe("sk_placeholder_for_webhook_verification_only");

const jsonResponse = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function findMOS2CareerProfile(submissionId) {
  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;

  if (!token) {
    throw new Error("NETLIFY_API_TOKEN is not configured");
  }

  if (!siteId) {
    throw new Error("NETLIFY_SITE_ID is not configured");
  }

  // Get recent form submissions for this Netlify site.
  const url =
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/submissions`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Netlify submissions API failed: ${response.status} ${body}`
    );
  }

  const submissions = await response.json();

  if (!Array.isArray(submissions)) {
    throw new Error("Unexpected Netlify submissions response");
  }

  const wantedId = String(submissionId || "").trim().toUpperCase();

  const match = submissions.find((submission) => {
    const data = submission.data || {};

    const possibleIds = [
      data.submissionId,
      data.submission_id,
      data["submission-id"],
      data.referenceId,
      data.reference_id,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toUpperCase());

    return possibleIds.includes(wantedId);
  });

  return match || null;
}

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed",
    });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return jsonResponse(400, {
      error: "Missing Stripe signature",
    });
  }

  const rawBody = await request.text();

  const liveSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST;

  let event = null;
  let verifiedMode = null;

  /*
   * Try LIVE webhook secret first.
   */
  if (liveSecret) {
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        liveSecret
      );

      verifiedMode = "live";
    } catch {
      // Continue and try sandbox secret.
    }
  }

  /*
   * Try SANDBOX webhook secret.
   */
  if (!event && testSecret) {
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        testSecret
      );

      verifiedMode = "sandbox";
    } catch {
      // Signature did not match sandbox either.
    }
  }

  if (!event) {
    console.error("Stripe webhook signature verification failed");

    return jsonResponse(400, {
      error: "Invalid Stripe signature",
    });
  }

  /*
   * Extra protection against accidentally accepting
   * a live event with the test secret or vice versa.
   */
  if (verifiedMode === "live" && event.livemode !== true) {
    console.error("Live secret verified a non-live event");

    return jsonResponse(400, {
      error: "Stripe mode mismatch",
    });
  }

  if (verifiedMode === "sandbox" && event.livemode !== false) {
    console.error("Sandbox secret verified a live event");

    return jsonResponse(400, {
      error: "Stripe mode mismatch",
    });
  }

  console.log(
    `MOS2Career Stripe webhook verified: ${verifiedMode}`
  );

  console.log(`Stripe event ID: ${event.id}`);
  console.log(`Stripe event type: ${event.type}`);

  const supportedEvents = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ];

  if (!supportedEvents.includes(event.type)) {
    return jsonResponse(200, {
      received: true,
      ignored: true,
    });
  }

  const session = event.data.object;

  const submissionId =
    session.client_reference_id || null;

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    null;

  const order = {
    mode: verifiedMode,
    stripeLivemode: event.livemode,
    eventId: event.id,
    eventType: event.type,

    submissionId,

    checkoutSessionId: session.id,

    email,

    paymentStatus: session.payment_status,

    amountTotal: session.amount_total,

    currency: session.currency,

    paymentIntent:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null,
  };

  console.log(
    "MOS2Career Stripe order:",
    JSON.stringify(order)
  );

  if (!submissionId) {
    console.warn(
      "MOS2Career WARNING: Stripe session has no client_reference_id"
    );
  }

  /*
   * Decide whether this event means fulfillment should occur.
   */
  let paymentConfirmed = false;

  if (
    event.type === "checkout.session.completed" &&
    session.payment_status === "paid"
  ) {
    paymentConfirmed = true;
  }

  if (
    event.type ===
    "checkout.session.async_payment_succeeded"
  ) {
    paymentConfirmed = true;
  }

  if (
    event.type ===
    "checkout.session.async_payment_failed"
  ) {
    console.warn(
      `MOS2Career PAYMENT FAILED: ${submissionId || "NO-ID"}`
    );

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: false,
      submissionId,
    });
  }

  if (!paymentConfirmed) {
    console.log(
      `MOS2Career PAYMENT PENDING: ${submissionId || "NO-ID"}`
    );

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: false,
      submissionId,
    });
  }

  console.log(
    `MOS2Career PAYMENT CONFIRMED: ${submissionId || "NO-ID"}`
  );

  /*
   * Now find the customer's saved Career Translator profile.
   */
  if (!submissionId) {
    console.error(
      "Cannot locate profile because submission ID is missing"
    );

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: true,
      profileFound: false,
      reason: "missing_submission_id",
    });
  }

  try {
    const profileSubmission =
      await findMOS2CareerProfile(submissionId);

    if (!profileSubmission) {
      console.error(
        `MOS2Career PROFILE NOT FOUND: ${submissionId}`
      );

      return jsonResponse(200, {
        received: true,
        paymentConfirmed: true,
        submissionId,
        profileFound: false,
      });
    }

    const profile = profileSubmission.data || {};

    console.log(
      `MOS2Career PROFILE FOUND: ${submissionId}`
    );

    /*
     * Don't print the full profile to production logs.
     * Log only enough information to verify the match.
     */
    console.log(
      JSON.stringify({
        submissionId,
        profileFound: true,
        branch: profile.branch || null,
        militarySpecialty:
          profile.militarySpecialty ||
          profile.military_specialty ||
          profile.specialty ||
          null,
        topMatches:
          profile.topMatches ||
          profile.top_matches ||
          null,
      })
    );

    /*
     * NEXT STAGE:
     *
     * generateCareerBlueprint(profile)
     * createBlueprintPDF(...)
     * emailBlueprint(...)
     *
     * We deliberately aren't doing those yet.
     */

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: true,
      submissionId,
      profileFound: true,
      readyForBlueprint: true,
    });
  } catch (error) {
    console.error(
      "MOS2Career profile lookup error:",
      error.message
    );

    /*
     * Return 500 so Stripe can retry the webhook.
     * That's useful if Netlify's API is temporarily unavailable.
     */
    return jsonResponse(500, {
      received: true,
      paymentConfirmed: true,
      submissionId,
      profileFound: false,
      error: "profile_lookup_failed",
    });
  }
};
