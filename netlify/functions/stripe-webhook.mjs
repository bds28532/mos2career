import Stripe from "stripe";

const stripe = new Stripe(
  "sk_placeholder_for_webhook_verification_only"
);

const jsonResponse = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

/*
 * ---------------------------------------------------------
 * FIND MOS2CAREER PROFILE
 * ---------------------------------------------------------
 */

async function findMOS2CareerProfile(submissionId) {
  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;

  if (!token) {
    throw new Error(
      "NETLIFY_API_TOKEN is not configured"
    );
  }

  if (!siteId) {
    throw new Error(
      "NETLIFY_SITE_ID is not configured"
    );
  }

  const url =
    `https://api.netlify.com/api/v1/sites/` +
    `${encodeURIComponent(siteId)}/submissions`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Netlify submissions API failed: ` +
      `${response.status} ${body}`
    );
  }

  const submissions = await response.json();

  if (!Array.isArray(submissions)) {
    throw new Error(
      "Unexpected Netlify submissions response"
    );
  }

  const wantedId = String(
    submissionId || ""
  )
    .trim()
    .toUpperCase();

  const match = submissions.find(
    (submission) => {
      const data =
        submission.data || {};

      const possibleIds = [
        data.submissionId,
        data.submission_id,
        data["submission-id"],
        data.referenceId,
        data.reference_id,
      ]
        .filter(Boolean)
        .map((value) =>
          String(value)
            .trim()
            .toUpperCase()
        );

      return possibleIds.includes(
        wantedId
      );
    }
  );

  return match || null;
}

/*
 * ---------------------------------------------------------
 * TRIGGER BACKGROUND BLUEPRINT FULFILLMENT
 * ---------------------------------------------------------
 */

async function triggerBlueprintFulfillment({
  request,
  submissionId,
  checkoutSessionId,
  eventId,
  mode,
  profile,
}) {
  const internalSecret =
    process.env.BLUEPRINT_INTERNAL_SECRET;

  if (!internalSecret) {
    throw new Error(
      "BLUEPRINT_INTERNAL_SECRET is not configured"
    );
  }

  /*
   * Build the fulfillment URL from the
   * current request domain.
   *
   * Production:
   * https://mos2career.com/.netlify/functions/fulfill-blueprint
   */

  const fulfillmentUrl = new URL(
    "/.netlify/functions/fulfill-blueprint",
    request.url
  );

  const response = await fetch(
    fulfillmentUrl,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${internalSecret}`,

        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        submissionId,
        checkoutSessionId,
        eventId,
        mode,
        profile,
      }),
    }
  );

  /*
   * Background Functions normally return
   * HTTP 202 Accepted.
   *
   * Any 2xx status counts as successful
   * queueing.
   */

  if (!response.ok) {
    const responseBody =
      await response.text();

    throw new Error(
      `Blueprint fulfillment trigger failed: ` +
      `${response.status} ${responseBody}`
    );
  }

  console.log(
    `MOS2Career FULFILLMENT QUEUED: ${submissionId}`
  );

  return true;
}

/*
 * ---------------------------------------------------------
 * STRIPE WEBHOOK
 * ---------------------------------------------------------
 */

export default async (request) => {
  /*
   * Only Stripe POST requests are allowed.
   */

  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed",
    });
  }

  /*
   * Stripe signature.
   */

  const signature =
    request.headers.get(
      "stripe-signature"
    );

  if (!signature) {
    return jsonResponse(400, {
      error:
        "Missing Stripe signature",
    });
  }

  /*
   * IMPORTANT:
   * Stripe signature verification requires
   * the exact raw request body.
   */

  const rawBody =
    await request.text();

  const liveSecret =
    process.env
      .STRIPE_WEBHOOK_SECRET;

  const testSecret =
    process.env
      .STRIPE_WEBHOOK_SECRET_TEST;

  let event = null;
  let verifiedMode = null;

  /*
   * -------------------------------------------------------
   * TRY LIVE WEBHOOK SECRET
   * -------------------------------------------------------
   */

  if (liveSecret) {
    try {
      event =
        stripe.webhooks.constructEvent(
          rawBody,
          signature,
          liveSecret
        );

      verifiedMode = "live";
    } catch {
      /*
       * Continue and try sandbox.
       */
    }
  }

  /*
   * -------------------------------------------------------
   * TRY SANDBOX WEBHOOK SECRET
   * -------------------------------------------------------
   */

  if (!event && testSecret) {
    try {
      event =
        stripe.webhooks.constructEvent(
          rawBody,
          signature,
          testSecret
        );

      verifiedMode = "sandbox";
    } catch {
      /*
       * Signature did not match sandbox.
       */
    }
  }

  /*
   * Neither secret verified the request.
   */

  if (!event) {
    console.error(
      "Stripe webhook signature verification failed"
    );

    return jsonResponse(400, {
      error:
        "Invalid Stripe signature",
    });
  }

  /*
   * -------------------------------------------------------
   * LIVE / SANDBOX MODE SAFETY
   * -------------------------------------------------------
   */

  if (
    verifiedMode === "live" &&
    event.livemode !== true
  ) {
    console.error(
      "Live secret verified a non-live event"
    );

    return jsonResponse(400, {
      error: "Stripe mode mismatch",
    });
  }

  if (
    verifiedMode === "sandbox" &&
    event.livemode !== false
  ) {
    console.error(
      "Sandbox secret verified a live event"
    );

    return jsonResponse(400, {
      error: "Stripe mode mismatch",
    });
  }

  console.log(
    `MOS2Career Stripe webhook verified: ` +
    `${verifiedMode}`
  );

  console.log(
    `Stripe event ID: ${event.id}`
  );

  console.log(
    `Stripe event type: ${event.type}`
  );

  /*
   * -------------------------------------------------------
   * EVENTS WE CARE ABOUT
   * -------------------------------------------------------
   */

  const supportedEvents = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ];

  if (
    !supportedEvents.includes(
      event.type
    )
  ) {
    return jsonResponse(200, {
      received: true,
      ignored: true,
    });
  }

  const session =
    event.data.object;

  /*
   * MOS2Career reference ID.
   */

  const submissionId =
    session.client_reference_id ||
    null;

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    null;

  /*
   * Safe payment/order log.
   *
   * Do NOT log full customer
   * Career Translator data.
   */

  const order = {
    mode: verifiedMode,

    stripeLivemode:
      event.livemode,

    eventId:
      event.id,

    eventType:
      event.type,

    submissionId,

    checkoutSessionId:
      session.id,

    email,

    paymentStatus:
      session.payment_status,

    amountTotal:
      session.amount_total,

    currency:
      session.currency,

    paymentIntent:
      typeof session.payment_intent ===
      "string"
        ? session.payment_intent
        : session.payment_intent?.id ||
          null,
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
   * -------------------------------------------------------
   * DETERMINE PAYMENT STATUS
   * -------------------------------------------------------
   */

  let paymentConfirmed = false;

  if (
    event.type ===
      "checkout.session.completed" &&
    session.payment_status ===
      "paid"
  ) {
    paymentConfirmed = true;
  }

  if (
    event.type ===
    "checkout.session.async_payment_succeeded"
  ) {
    paymentConfirmed = true;
  }

  /*
   * Async payment failed.
   */

  if (
    event.type ===
    "checkout.session.async_payment_failed"
  ) {
    console.warn(
      `MOS2Career PAYMENT FAILED: ` +
      `${submissionId || "NO-ID"}`
    );

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: false,
      submissionId,
    });
  }

  /*
   * Payment isn't final yet.
   */

  if (!paymentConfirmed) {
    console.log(
      `MOS2Career PAYMENT PENDING: ` +
      `${submissionId || "NO-ID"}`
    );

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: false,
      submissionId,
    });
  }

  console.log(
    `MOS2Career PAYMENT CONFIRMED: ` +
    `${submissionId || "NO-ID"}`
  );

  /*
   * -------------------------------------------------------
   * SUBMISSION ID REQUIRED
   * -------------------------------------------------------
   */

  if (!submissionId) {
    console.error(
      "Cannot locate profile because submission ID is missing"
    );

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: true,
      profileFound: false,
      reason:
        "missing_submission_id",
    });
  }

  /*
   * -------------------------------------------------------
   * FIND CUSTOMER PROFILE
   * -------------------------------------------------------
   */

  try {
    const profileSubmission =
      await findMOS2CareerProfile(
        submissionId
      );

    if (!profileSubmission) {
      console.error(
        `MOS2Career PROFILE NOT FOUND: ` +
        `${submissionId}`
      );

      return jsonResponse(200, {
        received: true,
        paymentConfirmed: true,
        submissionId,
        profileFound: false,
      });
    }

    const profile =
      profileSubmission.data || {};

    console.log(
      `MOS2Career PROFILE FOUND: ` +
      `${submissionId}`
    );

    /*
     * Only log basic matching
     * information.
     */

    console.log(
      JSON.stringify({
        submissionId,

        profileFound: true,

        branch:
          profile.branch || null,

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
     * -----------------------------------------------------
     * QUEUE BACKGROUND BLUEPRINT GENERATION
     * -----------------------------------------------------
     *
     * The Stripe webhook itself does NOT wait
     * for OpenAI to generate the Blueprint.
     *
     * The Background Function accepts the job,
     * then generates it separately.
     */

    await triggerBlueprintFulfillment({
      request,

      submissionId,

      checkoutSessionId:
        session.id,

      eventId:
        event.id,

      mode:
        verifiedMode,

      profile,
    });

    /*
     * Stripe receives success after the
     * fulfillment job has been accepted.
     */

    return jsonResponse(200, {
      received: true,
      paymentConfirmed: true,
      submissionId,
      profileFound: true,
      fulfillmentQueued: true,
    });
  } catch (error) {
    console.error(
      "MOS2Career paid fulfillment error:",
      error?.message ||
        "Unknown error"
    );

    /*
     * Return HTTP 500.
     *
     * Stripe can retry this webhook later.
     *
     * Duplicate Blueprint protection is handled
     * inside fulfill-blueprint using Netlify
     * Blobs, so a Stripe retry should not
     * create another completed Blueprint.
     */

    return jsonResponse(500, {
      received: true,
      paymentConfirmed: true,
      submissionId,
      profileFound: false,
      fulfillmentQueued: false,
      error:
        "paid_fulfillment_failed",
    });
  }
};
