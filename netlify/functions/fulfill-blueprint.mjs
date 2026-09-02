import { getStore } from "@netlify/blobs";
import { buildBlueprintPDF } from "./create-blueprint-pdf.mjs";
import {
  generateCompleteCareerBlueprint,
} from "./generate-blueprint.mjs";

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

export default async function handler(request) {
  try {
    /*
     * ------------------------------------------------------
     * 1. ONLY POST
     * ------------------------------------------------------
     */

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed" },
        405
      );
    }

    /*
     * ------------------------------------------------------
     * 2. INTERNAL AUTHORIZATION
     * ------------------------------------------------------
     */

    const internalSecret =
      process.env.BLUEPRINT_INTERNAL_SECRET;

    if (!internalSecret) {
      throw new Error(
        "BLUEPRINT_INTERNAL_SECRET is not configured"
      );
    }

    const authHeader =
      request.headers.get("authorization");

    if (
      authHeader !==
      `Bearer ${internalSecret}`
    ) {
      console.error(
        "MOS2Career fulfillment authorization failed"
      );

      return;
    }

    /*
     * ------------------------------------------------------
     * 3. READ JOB
     * ------------------------------------------------------
     */

    let body;

    try {
      body = await request.json();
    } catch {
      throw new Error(
        "MOS2Career fulfillment received invalid JSON"
      );
    }

    const {
      submissionId,
      checkoutSessionId,
      eventId,
      mode,
      profile,
    } = body || {};

    if (!submissionId) {
      throw new Error(
        "MOS2Career fulfillment missing submissionId"
      );
    }

    if (
      !profile ||
      typeof profile !== "object"
    ) {
      throw new Error(
        `MOS2Career fulfillment missing profile: ${submissionId}`
      );
    }

    /*
     * ------------------------------------------------------
     * 4. STORES
     * ------------------------------------------------------
     */

    const fulfillmentStore =
      getStore(
        "mos2career-fulfillments"
      );

    const blueprintStore =
      getStore(
        "mos2career-blueprints"
      );

    const fulfillmentKey =
      `blueprint-${String(
        submissionId
      )
        .trim()
        .toUpperCase()}`;

    /*
     * ------------------------------------------------------
     * 5. CHECK EXISTING FULFILLMENT
     * ------------------------------------------------------
     */

    const existing =
      await fulfillmentStore.get(
        fulfillmentKey,
        {
          type: "json",
          consistency: "strong",
        }
      );

    if (
      existing?.status ===
      "generated"
    ) {
      console.log(
        `MOS2Career FULFILLMENT ALREADY COMPLETE: ${submissionId}`
      );

      return;
    }

    if (
      existing?.status ===
      "processing"
    ) {
      console.log(
        `MOS2Career FULFILLMENT ALREADY PROCESSING: ${submissionId}`
      );

      return;
    }

    /*
     * ------------------------------------------------------
     * 6. CLAIM JOB
     * ------------------------------------------------------
     *
     * If no record exists, create one atomically.
     *
     * If a previous attempt failed, we intentionally
     * overwrite that failed status and retry.
     */

    if (!existing) {
      const claim =
        await fulfillmentStore.setJSON(
          fulfillmentKey,
          {
            status: "processing",
            submissionId,
            checkoutSessionId:
              checkoutSessionId || null,
            eventId:
              eventId || null,
            mode:
              mode || null,
            startedAt:
              new Date().toISOString(),
          },
          {
            onlyIfNew: true,
          }
        );

      if (!claim.modified) {
        console.log(
          `MOS2Career FULFILLMENT CLAIMED BY ANOTHER RUN: ${submissionId}`
        );

        return;
      }
    } else {
      await fulfillmentStore.setJSON(
        fulfillmentKey,
        {
          status: "processing",
          submissionId,
          checkoutSessionId:
            checkoutSessionId || null,
          eventId:
            eventId || null,
          mode:
            mode || null,
          retryingPreviousFailure: true,
          startedAt:
            new Date().toISOString(),
        }
      );
    }

    console.log(
      `MOS2Career COMPLETE FULFILLMENT STARTED: ${submissionId}`
    );

    try {
      /*
       * ----------------------------------------------------
       * 7. GENERATE COMPLETE BLUEPRINT
       * ----------------------------------------------------
       */

      const completeBlueprint =
        await generateCompleteCareerBlueprint({
          ...profile,
          submissionId,
        });

      /*
       * ----------------------------------------------------
       * 8. STORE COMPLETE BLUEPRINT
       * ----------------------------------------------------
       */

      await blueprintStore.setJSON(
        fulfillmentKey,
        {
          submissionId,

          checkoutSessionId:
            checkoutSessionId || null,

          eventId:
            eventId || null,

          mode:
            mode || null,

          generatedAt:
            new Date().toISOString(),

          blueprint:
            completeBlueprint,
        }
      );

      /*
       * ----------------------------------------------------
       * 9. MARK GENERATED
       * ----------------------------------------------------
       */

      await fulfillmentStore.setJSON(
        fulfillmentKey,
        {
          status: "generated",
          submissionId,

          checkoutSessionId:
            checkoutSessionId || null,

          eventId:
            eventId || null,

          mode:
            mode || null,

          completedAt:
            new Date().toISOString(),
        }
      );

      console.log(
        `MOS2Career COMPLETE BLUEPRINT STORED: ${submissionId}`
      );

      /*
       * NEXT STAGE:
       *
       * createBlueprintPDF(...)
       * emailBlueprint(...)
       */
    } catch (error) {
      console.error(
        `MOS2Career COMPLETE BLUEPRINT FAILED: ${submissionId}`,
        error?.message ||
          "Unknown error"
      );

      /*
       * Keep a failure record.
       *
       * Unlike the old version, a future Stripe
       * retry can retry a failed record.
       */

      await fulfillmentStore.setJSON(
        fulfillmentKey,
        {
          status: "failed",

          submissionId,

          checkoutSessionId:
            checkoutSessionId || null,

          eventId:
            eventId || null,

          mode:
            mode || null,

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
      error?.message ||
        "Unknown error"
    );

    throw error;
  }
}

export const config = {
  background: true,
};
