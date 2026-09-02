import { getStore } from "@netlify/blobs";

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
     * 2. ADMIN AUTHORIZATION
     * ------------------------------------------------------
     */

    const adminSecret =
      process.env.MOS2CAREER_ADMIN_SECRET;

    if (!adminSecret) {
      throw new Error(
        "MOS2CAREER_ADMIN_SECRET is not configured"
      );
    }

    const authHeader =
      request.headers.get("authorization");

    if (
      authHeader !==
      `Bearer ${adminSecret}`
    ) {
      return jsonResponse(
        { error: "Unauthorized" },
        401
      );
    }

    /*
     * ------------------------------------------------------
     * 3. READ REQUEST
     * ------------------------------------------------------
     */

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON" },
        400
      );
    }

    const submissionId =
      String(
        body?.submissionId || ""
      )
        .trim()
        .toUpperCase();

    if (!submissionId) {
      return jsonResponse(
        {
          error:
            "submissionId is required",
        },
        400
      );
    }

    const fulfillmentKey =
      `blueprint-${submissionId}`;

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

    const pdfStore =
      getStore(
        "mos2career-blueprint-pdfs"
      );

    /*
     * ------------------------------------------------------
     * 5. FETCH RECORDS
     * ------------------------------------------------------
     */

    const [
      fulfillment,
      blueprint,
      pdf,
    ] =
      await Promise.all([
        fulfillmentStore.get(
          fulfillmentKey,
          {
            type: "json",
            consistency: "strong",
          }
        ),

        blueprintStore.get(
          fulfillmentKey,
          {
            type: "json",
            consistency: "strong",
          }
        ),

        pdfStore.getWithMetadata(
          fulfillmentKey,
          {
            consistency: "strong",
          }
        ),
      ]);

    /*
     * ------------------------------------------------------
     * 6. NOT FOUND
     * ------------------------------------------------------
     */

    if (
      !fulfillment &&
      !blueprint &&
      !pdf
    ) {
      return jsonResponse(
        {
          found: false,
          submissionId,
        },
        404
      );
    }

    /*
     * ------------------------------------------------------
     * 7. SAFE ORDER SUMMARY
     * ------------------------------------------------------
     *
     * Do not expose the full Blueprint or
     * customer profile in the admin response.
     */

    const result = {
      found: true,

      submissionId,

      status:
        fulfillment?.status ||
        null,

      mode:
        fulfillment?.mode ||
        blueprint?.mode ||
        null,

      checkoutSessionId:
        fulfillment
          ?.checkoutSessionId ||
        blueprint
          ?.checkoutSessionId ||
        null,

      eventId:
        fulfillment?.eventId ||
        blueprint?.eventId ||
        null,

      startedAt:
        fulfillment?.startedAt ||
        null,

      generatedAt:
        fulfillment?.generatedAt ||
        blueprint?.generatedAt ||
        null,

      deliveredAt:
        fulfillment?.deliveredAt ||
        null,

      failedAt:
        fulfillment?.failedAt ||
        null,

      error:
        fulfillment?.error ||
        null,

      customerEmail:
        fulfillment
          ?.customerEmail ||
        null,

      resendEmailId:
        fulfillment
          ?.resendEmailId ||
        null,

      blueprintExists:
        Boolean(blueprint),

      pdfExists:
        Boolean(pdf?.data),

      pdfFilename:
        pdf?.metadata?.filename ||
        fulfillment?.pdfFilename ||
        null,

      pdfGeneratedAt:
        pdf?.metadata
          ?.generatedAt ||
        fulfillment
          ?.pdfGeneratedAt ||
        null,
    };

    return jsonResponse(result);
  } catch (error) {
    console.error(
      "MOS2Career admin order status error:",
      error?.message ||
        "Unknown error"
    );

    return jsonResponse(
      {
        error:
          "Internal server error",
      },
      500
    );
  }
}

export const config = {
  path:
    "/.netlify/functions/admin-order-status",
};
