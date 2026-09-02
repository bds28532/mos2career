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

      return jsonResponse(
        { error: "Unauthorized" },
        401
      );
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

    const customerEmail =
      profile?.email?.trim();

    if (!customerEmail) {
      throw new Error(
        `MOS2Career fulfillment missing customer email: ${submissionId}`
      );
    }

    /*
     * ------------------------------------------------------
     * 4. ENVIRONMENT
     * ------------------------------------------------------
     */

    const resendApiKey =
      process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      throw new Error(
        "RESEND_API_KEY is not configured"
      );
    }

    /*
     * ------------------------------------------------------
     * 5. STORES
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

    const pdfStore =
      getStore(
        "mos2career-blueprint-pdfs"
      );

    const fulfillmentKey =
      `blueprint-${String(
        submissionId
      )
        .trim()
        .toUpperCase()}`;

    /*
     * ------------------------------------------------------
     * 6. CHECK EXISTING FULFILLMENT
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
      "delivered"
    ) {
      console.log(
        `MOS2Career FULFILLMENT ALREADY DELIVERED: ${submissionId}`
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
     * 7. CLAIM JOB
     * ------------------------------------------------------
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
          ...existing,

          status: "processing",

          submissionId,

          checkoutSessionId:
            checkoutSessionId || null,

          eventId:
            eventId || null,

          mode:
            mode || null,

          retryingPreviousAttempt: true,

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
       * 8. LOAD EXISTING BLUEPRINT IF AVAILABLE
       * ----------------------------------------------------
       */

      let storedBlueprint =
        await blueprintStore.get(
          fulfillmentKey,
          {
            type: "json",
            consistency: "strong",
          }
        );

      let completeBlueprint;

      /*
       * If a Blueprint was already generated during a
       * previous attempt, reuse it instead of charging for
       * another OpenAI generation.
       */

      if (
        storedBlueprint?.blueprint
      ) {
        completeBlueprint =
          storedBlueprint.blueprint;

        console.log(
          `MOS2Career EXISTING BLUEPRINT REUSED: ${submissionId}`
        );
      } else {
        /*
         * --------------------------------------------------
         * 9. GENERATE COMPLETE BLUEPRINT
         * --------------------------------------------------
         */

        completeBlueprint =
          await generateCompleteCareerBlueprint({
            ...profile,
            submissionId,
          });

        console.log(
          `MOS2Career COMPLETE BLUEPRINT GENERATED: ${submissionId}`
        );

        /*
         * --------------------------------------------------
         * 10. STORE COMPLETE BLUEPRINT
         * --------------------------------------------------
         */

        storedBlueprint = {
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
        };

        await blueprintStore.setJSON(
          fulfillmentKey,
          storedBlueprint
        );

        console.log(
          `MOS2Career COMPLETE BLUEPRINT STORED: ${submissionId}`
        );
      }

      /*
       * ----------------------------------------------------
       * 11. MARK GENERATED
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

          generatedAt:
            storedBlueprint?.generatedAt ||
            new Date().toISOString(),
        }
      );

      /*
       * ----------------------------------------------------
       * 12. CREATE PDF
       * ----------------------------------------------------
       *
       * IMPORTANT:
       *
       * buildBlueprintPDF previously worked using the
       * stored Blueprint record, not only the raw
       * completeBlueprint object.
       */

      console.log(
        `MOS2Career PDF CREATION STARTED: ${submissionId}`
      );

      const pdfBytes =
        await buildBlueprintPDF(
          storedBlueprint
        );

      if (
        !pdfBytes ||
        !pdfBytes.length
      ) {
        throw new Error(
          `MOS2Career PDF generation returned no data: ${submissionId}`
        );
      }

      const pdfFilename =
        `MOS2Career-${submissionId}.pdf`;

      /*
       * ----------------------------------------------------
       * 13. STORE PDF
       * ----------------------------------------------------
       */

      await pdfStore.set(
        fulfillmentKey,
        pdfBytes,
        {
          metadata: {
            submissionId,

            filename:
              pdfFilename,

            contentType:
              "application/pdf",

            generatedAt:
              new Date().toISOString(),
          },
        }
      );

      console.log(
        `MOS2Career PDF STORED: ${submissionId}`
      );

      /*
       * ----------------------------------------------------
       * 14. PREPARE EMAIL ATTACHMENT
       * ----------------------------------------------------
       */

      const pdfBase64 =
        Buffer.from(
          pdfBytes
        ).toString("base64");

      const emailIdempotencyKey =
        `career-blueprint/${String(
          submissionId
        )
          .trim()
          .toUpperCase()}`;

      /*
       * ----------------------------------------------------
       * 15. SEND EMAIL WITH RESEND
       * ----------------------------------------------------
       */

      console.log(
        `MOS2Career EMAIL DELIVERY STARTED: ${submissionId}`
      );

      const resendResponse =
        await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${resendApiKey}`,

              "Content-Type":
                "application/json",

              "Idempotency-Key":
                emailIdempotencyKey,
            },

            body: JSON.stringify({
              from:
                "MOS2Career <blueprints@mos2career.com>",

              to: [
                customerEmail,
              ],

              subject:
                "Your MOS2Career Personalized Career Blueprint",

              text:
`Your MOS2Career Personalized Career Blueprint is ready.

Thank you for using MOS2Career.

Your personalized military-to-civilian Career Blueprint is attached to this email.

Reference ID: ${submissionId}

Your Blueprint includes career matches, transferable-skill translations, qualification gaps, certification recommendations, compensation guidance, resume strategy, interview preparation, and a 90-day transition plan.

Keep this email for your records so you can reference your MOS2Career ID if you ever need support.

MOS2Career
Military Experience. Civilian Opportunity.

Career matches and compensation figures are planning estimates. MOS2Career does not guarantee employment, compensation, certification eligibility, licensing, clearance eligibility, or hiring outcomes.`,

              html: `
                <div
                  style="
                    font-family:
                      Arial,
                      Helvetica,
                      sans-serif;
                    max-width:640px;
                    margin:0 auto;
                    padding:24px;
                    line-height:1.6;
                    color:#1f2937;
                  "
                >
                  <h2
                    style="
                      margin-bottom:8px;
                    "
                  >
                    Your MOS2Career Career Blueprint is ready
                  </h2>

                  <p>
                    Thank you for using
                    <strong>MOS2Career</strong>.
                  </p>

                  <p>
                    Your personalized
                    military-to-civilian
                    Career Blueprint is attached
                    to this email.
                  </p>

                  <div
                    style="
                      margin:20px 0;
                      padding:16px;
                      background:#f3f4f6;
                      border-radius:8px;
                    "
                  >
                    <strong>
                      Reference ID:
                    </strong>

                    ${submissionId}
                  </div>

                  <p>
                    Your Blueprint includes:
                  </p>

                  <ul>
                    <li>
                      Top civilian career matches
                    </li>

                    <li>
                      Military-to-civilian
                      skill translations
                    </li>

                    <li>
                      Qualification gap analysis
                    </li>

                    <li>
                      Certification and
                      education strategy
                    </li>

                    <li>
                      Compensation guidance
                    </li>

                    <li>
                      Resume and LinkedIn strategy
                    </li>

                    <li>
                      Interview preparation
                    </li>

                    <li>
                      A personalized
                      90-day transition plan
                    </li>
                  </ul>

                  <p>
                    Keep this email for your
                    records so you can reference
                    your MOS2Career ID if you
                    ever need support.
                  </p>

                  <p>
                    — MOS2Career
                    <br>
                    Military Experience.
                    Civilian Opportunity.
                  </p>

                  <hr
                    style="
                      margin:28px 0 16px;
                      border:0;
                      border-top:
                        1px solid #d1d5db;
                    "
                  >

                  <p
                    style="
                      font-size:12px;
                      color:#6b7280;
                    "
                  >
                    Career matches,
                    compensation figures,
                    credential recommendations,
                    and other guidance are
                    planning estimates.
                    MOS2Career does not guarantee
                    employment, compensation,
                    certification eligibility,
                    licensing,
                    clearance eligibility,
                    or hiring outcomes.
                  </p>
                </div>
              `,

              attachments: [
                {
                  filename:
                    pdfFilename,

                  content:
                    pdfBase64,
                },
              ],
            }),
          }
        );

      let resendResult;

      try {
        resendResult =
          await resendResponse.json();
      } catch {
        resendResult = {};
      }

      if (
        !resendResponse.ok
      ) {
        throw new Error(
          `Resend delivery failed: ${
            resendResult?.message ||
            resendResult?.error ||
            `HTTP ${resendResponse.status}`
          }`
        );
      }

      console.log(
        `MOS2Career EMAIL SENT: ${submissionId}`
      );

      /*
       * ----------------------------------------------------
       * 16. MARK DELIVERED
       * ----------------------------------------------------
       */

      await fulfillmentStore.setJSON(
        fulfillmentKey,
        {
          status: "delivered",

          submissionId,

          checkoutSessionId:
            checkoutSessionId || null,

          eventId:
            eventId || null,

          mode:
            mode || null,

          generatedAt:
            storedBlueprint?.generatedAt ||
            null,

          pdfGeneratedAt:
            new Date().toISOString(),

          deliveredAt:
            new Date().toISOString(),

          customerEmail,

          pdfFilename,

          resendEmailId:
            resendResult?.id ||
            null,

          emailIdempotencyKey,
        }
      );

      console.log(
        `MOS2Career FULFILLMENT DELIVERED: ${submissionId}`
      );
    } catch (error) {
      console.error(
        `MOS2Career COMPLETE FULFILLMENT FAILED: ${submissionId}`,
        error?.message ||
          "Unknown error"
      );

      /*
       * ----------------------------------------------------
       * 17. SAVE FAILURE
       * ----------------------------------------------------
       *
       * A future retry can resume.
       *
       * The stored Blueprint remains available, so if AI
       * generation already succeeded we can reuse it.
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
            "Unknown fulfillment error",
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
