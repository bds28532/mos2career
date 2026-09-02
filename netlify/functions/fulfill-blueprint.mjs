import { getStore } from "@netlify/blobs";
import { generateCareerBlueprintPhaseOne } from "./generate-blueprint.mjs";

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed" },
        405
      );
    }

    const internalSecret =
      process.env.BLUEPRINT_INTERNAL_SECRET;

    if (!internalSecret) {
      console.error(
        "BLUEPRINT_INTERNAL_SECRET is not configured"
      );
      return;
    }

    const authHeader =
      request.headers.get("authorization");

    if (
      authHeader !== `Bearer ${internalSecret}`
    ) {
      console.error(
        "MOS2Career fulfillment authorization failed"
      );
      return;
    }

    let body;

    try {
      body = await request.json();
    } catch {
      console.error(
        "MOS2Career fulfillment received invalid JSON"
      );
      return;
    }

    const {
      submissionId,
      checkoutSessionId,
      eventId,
      mode,
      profile,
    } = body || {};

    if (!submissionId) {
      console.error(
        "MOS2Career fulfillment missing submissionId"
      );
      return;
    }

    if (!profile || typeof profile !== "object") {
      console.error(
        `MOS2Career fulfillment missing profile: ${submissionId}`
      );
      return;
    }

    /*
     * --------------------------------------------
     * IDEMPOTENCY / DUPLICATE PROTECTION
     * --------------------------------------------
     *
     * We create a persistent claim using the
     * submission ID.
     *
     * onlyIfNew prevents two Stripe webhook
     * deliveries from starting fulfillment twice.
     */

    const fulfillmentStore =
      getStore("mos2career-fulfillments");

    const fulfillmentKey =
      `blueprint-${String(submissionId)
        .trim()
        .toUpperCase()}`;

    const claim = await fulfillmentStore.setJSON(
      fulfillmentKey,
      {
        status: "processing",
        submissionId,
        checkoutSessionId:
          checkoutSessionId || null,
        eventId: eventId || null,
        mode: mode || null,
        startedAt:
          new Date().toISOString(),
      },
      {
        onlyIfNew: true,
      }
    );

    if (!claim.modified) {
      console.log(
        `MOS2Career FULFILLMENT ALREADY CLAIMED: ${submissionId}`
      );
      return;
    }

    console.log(
      `MOS2Career FULFILLMENT STARTED: ${submissionId}`
    );

    try {
      /*
       * --------------------------------------------
       * GENERATE PHASE 1
       * --------------------------------------------
       */

      const phaseOne =
        await generateCareerBlueprintPhaseOne(
          {
          ...profile,
          submissionId,
        } );

      /*
       * Store generated Blueprint data.
       */

      const blueprintStore =
        getStore("mos2career-blueprints");

      await blueprintStore.setJSON(
        fulfillmentKey,
        {
          submissionId,
          checkoutSessionId:
            checkoutSessionId || null,

          generatedAt:
            new Date().toISOString(),

          phaseOne,
        }
      );

      /*
       * Update fulfillment status.
       */

      await fulfillmentStore.setJSON(
        fulfillmentKey,
        {
          status: "generated",
          submissionId,
          checkoutSessionId:
            checkoutSessionId || null,
          eventId: eventId || null,
          mode: mode || null,
          completedAt:
            new Date().toISOString(),
        }
      );

      console.log(
        `MOS2Career BLUEPRINT STORED: ${submissionId}`
      );

      /*
       * NEXT STAGES:
       *
       * Generate remaining Blueprint sections
       * Create PDF
       * Email customer
       *
       * Those come after we prove this
       * background workflow works.
       */
    } catch (error) {
      console.error(
        `MOS2Career BLUEPRINT GENERATION FAILED: ${submissionId}`,
        error?.message || "Unknown error"
      );

      /*
       * Record failure so we know what happened.
       */

      await fulfillmentStore.setJSON(
        fulfillmentKey,
        {
          status: "failed",
          submissionId,
          checkoutSessionId:
            checkoutSessionId || null,
          eventId: eventId || null,
          mode: mode || null,
          failedAt:
            new Date().toISOString(),
          error:
            error?.message ||
            "Unknown generation error",
        }
      );

      throw error;
    }
  } catch (error) {
    console.error(
      "MOS2Career fulfillment error:",
      error?.message || "Unknown error"
    );

    /*
     * Re-throwing allows Netlify Background
     * Functions to treat this as a failed run
     * and apply its retry behavior.
     */
    throw error;
  }
}

export const config = {
  background: true,
};
