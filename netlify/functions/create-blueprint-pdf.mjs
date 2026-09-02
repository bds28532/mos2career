import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getStore } from "@netlify/blobs";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const MARGIN_X = 54;
const TOP_Y = 738;
const BOTTOM_Y = 54;

const COLORS = {
  navy: rgb(0.04, 0.12, 0.22),
  blue: rgb(0.08, 0.35, 0.62),
  teal: rgb(0.05, 0.50, 0.50),
  gray: rgb(0.35, 0.39, 0.44),
  lightGray: rgb(0.92, 0.94, 0.96),
  white: rgb(1, 1, 1),
  black: rgb(0.08, 0.09, 0.10),
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeText(item)).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function wrapText(text, font, fontSize, maxWidth) {
  const clean = safeText(text)
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return [];
  }

  const words = clean.split(" ");
  const lines = [];

  let line = "";

  for (const word of words) {
    const testLine =
      line.length > 0
        ? `${line} ${word}`
        : word;

    const width =
      font.widthOfTextAtSize(
        testLine,
        fontSize
      );

    if (
      width <= maxWidth ||
      line.length === 0
    ) {
      line = testLine;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

function addPageNumber(
  page,
  font,
  pageNumber
) {
  page.drawText(
    `MOS2Career | Page ${pageNumber}`,
    {
      x: MARGIN_X,
      y: 28,
      size: 8,
      font,
      color: COLORS.gray,
    }
  );
}

function drawHeader(
  page,
  boldFont,
  regularFont,
  title,
  subtitle = ""
) {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 88,
    width: PAGE_WIDTH,
    height: 88,
    color: COLORS.navy,
  });

  page.drawText("MOS2Career", {
    x: MARGIN_X,
    y: PAGE_HEIGHT - 43,
    size: 22,
    font: boldFont,
    color: COLORS.white,
  });

  page.drawText(title, {
    x: MARGIN_X,
    y: PAGE_HEIGHT - 69,
    size: 12,
    font: boldFont,
    color: COLORS.white,
  });

  if (subtitle) {
    page.drawText(subtitle, {
      x: 340,
      y: PAGE_HEIGHT - 68,
      size: 8,
      font: regularFont,
      color: COLORS.white,
    });
  }
}

function createWriter(
  pdfDoc,
  fonts
) {
  let page = null;
  let y = TOP_Y;
  let pageNumber = 0;

  function newPage(
    title = "Personalized Career Blueprint",
    subtitle = ""
  ) {
    page = pdfDoc.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

    pageNumber += 1;

    drawHeader(
      page,
      fonts.bold,
      fonts.regular,
      title,
      subtitle
    );

    addPageNumber(
      page,
      fonts.regular,
      pageNumber
    );

    y = PAGE_HEIGHT - 122;

    return page;
  }

  function ensureSpace(
    requiredHeight,
    title
  ) {
    if (
      y - requiredHeight <
      BOTTOM_Y
    ) {
      newPage(title);
    }
  }

  function heading(
    text,
    options = {}
  ) {
    const size =
      options.size || 16;

    const before =
      options.before ?? 8;

    const after =
      options.after ?? 10;

    ensureSpace(
      size + before + after + 10,
      options.pageTitle ||
        "Personalized Career Blueprint"
    );

    y -= before;

    page.drawText(
      safeText(text),
      {
        x: MARGIN_X,
        y,
        size,
        font: fonts.bold,
        color:
          options.color ||
          COLORS.navy,
      }
    );

    y -= size + after;
  }

  function paragraph(
    text,
    options = {}
  ) {
    const size =
      options.size || 10;

    const lineHeight =
      options.lineHeight ||
      size * 1.45;

    const indent =
      options.indent || 0;

    const maxWidth =
      PAGE_WIDTH -
      MARGIN_X * 2 -
      indent;

    const lines =
      wrapText(
        text,
        options.bold
          ? fonts.bold
          : fonts.regular,
        size,
        maxWidth
      );

    for (const line of lines) {
      ensureSpace(
        lineHeight + 2,
        options.pageTitle ||
          "Personalized Career Blueprint"
      );

      page.drawText(line, {
        x: MARGIN_X + indent,
        y,
        size,
        font:
          options.bold
            ? fonts.bold
            : fonts.regular,
        color:
          options.color ||
          COLORS.black,
      });

      y -= lineHeight;
    }

    y -= options.after ?? 6;
  }

  function bullet(
    text,
    options = {}
  ) {
    const size =
      options.size || 9.5;

    const lineHeight =
      options.lineHeight ||
      size * 1.45;

    const bulletIndent = 12;
    const textIndent = 24;

    const lines =
      wrapText(
        text,
        fonts.regular,
        size,
        PAGE_WIDTH -
          MARGIN_X * 2 -
          textIndent
      );

    if (!lines.length) {
      return;
    }

    ensureSpace(
      lineHeight * lines.length + 4,
      options.pageTitle ||
        "Personalized Career Blueprint"
    );

    page.drawCircle({
      x: MARGIN_X + bulletIndent,
      y: y + size / 3,
      size: 2,
      color: COLORS.teal,
    });

    lines.forEach(
      (line, index) => {
        page.drawText(line, {
          x:
            MARGIN_X +
            textIndent,
          y,
          size,
          font: fonts.regular,
          color: COLORS.black,
        });

        y -= lineHeight;
      }
    );

    y -= 2;
  }

  function divider() {
    ensureSpace(
      12,
      "Personalized Career Blueprint"
    );

    page.drawLine({
      start: {
        x: MARGIN_X,
        y,
      },
      end: {
        x:
          PAGE_WIDTH -
          MARGIN_X,
        y,
      },
      thickness: 0.7,
      color: COLORS.lightGray,
    });

    y -= 14;
  }

  return {
    newPage,
    heading,
    paragraph,
    bullet,
    divider,
    getPage: () => page,
    getY: () => y,
    setY: (value) => {
      y = value;
    },
  };
}

export async function buildBlueprintPDF(
  storedRecord
) {
  const blueprint =
    storedRecord?.blueprint ||
    storedRecord;

  if (!blueprint) {
    throw new Error(
      "Stored Blueprint is missing"
    );
  }

  const phaseOne =
    blueprint.phaseOne || {};

  const phaseTwo =
    blueprint.phaseTwo || {};

  const phaseThree =
    blueprint.phaseThree || {};

  const submissionId =
    blueprint.submissionId ||
    storedRecord.submissionId ||
    "";

  const pdfDoc =
    await PDFDocument.create();

  const regular =
    await pdfDoc.embedFont(
      StandardFonts.Helvetica
    );

  const bold =
    await pdfDoc.embedFont(
      StandardFonts.HelveticaBold
    );

  const writer =
    createWriter(pdfDoc, {
      regular,
      bold,
    });

  /*
   * ------------------------------------------------------
   * COVER PAGE
   * ------------------------------------------------------
   */

  const cover =
    pdfDoc.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

  cover.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: COLORS.navy,
  });

  cover.drawText(
    "MOS2Career",
    {
      x: MARGIN_X,
      y: 610,
      size: 38,
      font: bold,
      color: COLORS.white,
    }
  );

  cover.drawText(
    "Personalized Career Blueprint",
    {
      x: MARGIN_X,
      y: 558,
      size: 22,
      font: bold,
      color: COLORS.white,
    }
  );

  cover.drawText(
    "Military Experience. Civilian Opportunity.",
    {
      x: MARGIN_X,
      y: 524,
      size: 12,
      font: regular,
      color: rgb(
        0.75,
        0.84,
        0.93
      ),
    }
  );

  cover.drawRectangle({
    x: MARGIN_X,
    y: 478,
    width: 90,
    height: 5,
    color: COLORS.teal,
  });

  cover.drawText(
    `Reference: ${safeText(
      submissionId,
      "N/A"
    )}`,
    {
      x: MARGIN_X,
      y: 420,
      size: 11,
      font: regular,
      color: COLORS.white,
    }
  );

  cover.drawText(
    `Generated: ${new Date()
      .toLocaleDateString(
        "en-US"
      )}`,
    {
      x: MARGIN_X,
      y: 398,
      size: 10,
      font: regular,
      color: COLORS.white,
    }
  );

  cover.drawText(
    "Prepared exclusively for career-planning purposes.",
    {
      x: MARGIN_X,
      y: 92,
      size: 9,
      font: regular,
      color: rgb(
        0.72,
        0.78,
        0.84
      ),
    }
  );

  /*
   * ------------------------------------------------------
   * EXECUTIVE ASSESSMENT
   * ------------------------------------------------------
   */

  writer.newPage(
    "Executive Career Assessment",
    submissionId
  );

  writer.heading(
    "Executive Career Assessment"
  );

  writer.paragraph(
    phaseOne.executiveAssessment ||
      "Assessment unavailable."
  );

  writer.heading(
    "Career Positioning Statement",
    {
      size: 13,
      before: 10,
    }
  );

  writer.paragraph(
    phaseOne.careerPositioningStatement ||
      "Positioning statement unavailable."
  );

  /*
   * ------------------------------------------------------
   * TOP 10 CAREER MATCHES
   * ------------------------------------------------------
   */

  writer.newPage(
    "Top 10 Civilian Career Matches",
    submissionId
  );

  writer.heading(
    "Top 10 Civilian Career Matches"
  );

  writer.paragraph(
    "Fit scores reflect estimated career alignment based on the information supplied. They do not guarantee interviews, hiring, compensation, or career outcomes.",
    {
      size: 8.5,
      color: COLORS.gray,
    }
  );

  const matches =
    Array.isArray(
      phaseOne.careerMatches
    )
      ? phaseOne.careerMatches
      : [];

  matches.forEach(
    (match, index) => {
      writer.heading(
        `${safeText(
          match.rank ||
            index + 1
        )}. ${safeText(
          match.title,
          "Career Match"
        )}`,
        {
          size: 13,
          before: 8,
          after: 5,
        }
      );

      writer.paragraph(
        `Estimated Fit: ${safeText(
          match.fitScore,
          "N/A"
        )}% | Compensation: ${safeText(
          match.compensation,
          "Planning estimate unavailable"
        )}`,
        {
          bold: true,
          size: 9,
          after: 5,
        }
      );

      writer.paragraph(
        safeText(
          match.whyItFits
        ),
        {
          size: 9.5,
        }
      );

      if (
        Array.isArray(
          match.transferableSkills
        )
      ) {
        writer.paragraph(
          "Transferable skills:",
          {
            bold: true,
            size: 9,
            after: 2,
          }
        );

        match.transferableSkills.forEach(
          (item) =>
            writer.bullet(
              item
            )
        );
      }

      if (
        Array.isArray(
          match.gaps
        )
      ) {
        writer.paragraph(
          "Potential gaps:",
          {
            bold: true,
            size: 9,
            after: 2,
          }
        );

        match.gaps.forEach(
          (item) =>
            writer.bullet(
              item
            )
        );
      }

      writer.paragraph(
        `Recommended next action: ${safeText(
          match.nextAction
        )}`,
        {
          size: 9,
          bold: true,
        }
      );

      writer.divider();
    }
  );

  /*
   * ------------------------------------------------------
   * SKILL TRANSLATION
   * ------------------------------------------------------
   */

  writer.newPage(
    "Military-to-Civilian Skill Translation",
    submissionId
  );

  writer.heading(
    "Military-to-Civilian Skill Translation"
  );

  const skillTranslations =
    Array.isArray(
      phaseTwo.skillTranslations
    )
      ? phaseTwo.skillTranslations
      : [];

  skillTranslations.forEach(
    (item) => {
      writer.heading(
        safeText(
          item.militarySkill,
          "Military Skill"
        ),
        {
          size: 12,
          before: 7,
          after: 4,
        }
      );

      writer.paragraph(
        `Civilian translation: ${safeText(
          item.civilianTranslation
        )}`,
        {
          size: 9.5,
        }
      );

      writer.paragraph(
        `Business value: ${safeText(
          item.businessValue
        )}`,
        {
          size: 9.5,
        }
      );

      writer.divider();
    }
  );

  /*
   * ------------------------------------------------------
   * GAP ANALYSIS
   * ------------------------------------------------------
   */

  writer.newPage(
    "Qualification Gap Analysis",
    submissionId
  );

  writer.heading(
    "Qualification Gap Analysis"
  );

  const gaps =
    Array.isArray(
      phaseTwo.qualificationGaps
    )
      ? phaseTwo.qualificationGaps
      : [];

  gaps.forEach((item) => {
    writer.heading(
      safeText(
        item.gap,
        "Potential Gap"
      ),
      {
        size: 12,
        before: 6,
        after: 4,
      }
    );

    writer.paragraph(
      `Importance: ${safeText(
        item.importance
      )}`,
      {
        bold: true,
        size: 9,
      }
    );

    writer.paragraph(
      safeText(
        item.recommendedAction
      ),
      {
        size: 9.5,
      }
    );
  });

  /*
   * ------------------------------------------------------
   * CERTIFICATIONS
   * ------------------------------------------------------
   */

  writer.newPage(
    "Certification & Education Strategy",
    submissionId
  );

  writer.heading(
    "Certification & Education Strategy"
  );

  const certifications =
    Array.isArray(
      phaseTwo.certificationStrategy
    )
      ? phaseTwo.certificationStrategy
      : [];

  certifications.forEach(
    (item) => {
      writer.heading(
        safeText(
          item.certification,
          "Credential"
        ),
        {
          size: 12,
          before: 6,
          after: 4,
        }
      );

      writer.paragraph(
        `Priority: ${safeText(
          item.priority
        )}`,
        {
          bold: true,
          size: 9,
        }
      );

      writer.paragraph(
        safeText(
          item.rationale
        ),
        {
          size: 9.5,
        }
      );
    }
  );

  /*
   * ------------------------------------------------------
   * COMPENSATION + EMPLOYERS
   * ------------------------------------------------------
   */

  writer.newPage(
    "Compensation & Employer Strategy",
    submissionId
  );

  writer.heading(
    "Compensation Strategy"
  );

  writer.paragraph(
    phaseTwo.compensationStrategy ||
      "Compensation strategy unavailable."
  );

  writer.heading(
    "Target Employers",
    {
      size: 14,
      before: 14,
    }
  );

  const employers =
    Array.isArray(
      phaseTwo.targetEmployers
    )
      ? phaseTwo.targetEmployers
      : [];

  employers.forEach(
    (item) => {
      writer.heading(
        safeText(
          item.employer,
          "Employer"
        ),
        {
          size: 11,
          before: 6,
          after: 4,
        }
      );

      writer.paragraph(
        safeText(
          item.reason
        ),
        {
          size: 9.5,
        }
      );

      if (
        Array.isArray(
          item.targetRoles
        )
      ) {
        writer.paragraph(
          "Potential target roles:",
          {
            bold: true,
            size: 9,
            after: 2,
          }
        );

        item.targetRoles.forEach(
          (role) =>
            writer.bullet(role)
        );
      }
    }
  );

  /*
   * ------------------------------------------------------
   * RESUME
   * ------------------------------------------------------
   */

  writer.newPage(
    "Resume Strategy",
    submissionId
  );

  writer.heading(
    "Resume Strategy"
  );

  const resume =
    phaseThree.resumeStrategy ||
    {};

  writer.paragraph(
    `Target headline: ${safeText(
      resume.targetHeadline
    )}`,
    {
      bold: true,
    }
  );

  writer.heading(
    "Professional Summary Guidance",
    {
      size: 12,
    }
  );

  writer.paragraph(
    safeText(
      resume.professionalSummaryGuidance
    )
  );

  writer.heading(
    "Bullet Point Strategy",
    {
      size: 12,
    }
  );

  (
    resume.bulletPointStrategy ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Keywords to Prioritize",
    {
      size: 12,
    }
  );

  (
    resume.keywordsToPrioritize ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Mistakes to Avoid",
    {
      size: 12,
    }
  );

  (
    resume.mistakesToAvoid ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  /*
   * ------------------------------------------------------
   * LINKEDIN + INTERVIEW
   * ------------------------------------------------------
   */

  writer.newPage(
    "LinkedIn & Interview Strategy",
    submissionId
  );

  writer.heading(
    "LinkedIn Strategy"
  );

  const linkedin =
    phaseThree.linkedinStrategy ||
    {};

  writer.paragraph(
    `Headline guidance: ${safeText(
      linkedin.headlineGuidance
    )}`
  );

  writer.paragraph(
    `About section guidance: ${safeText(
      linkedin.aboutSectionGuidance
    )}`
  );

  writer.heading(
    "Profile Priorities",
    {
      size: 12,
    }
  );

  (
    linkedin.profilePriorities ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Networking Actions",
    {
      size: 12,
    }
  );

  (
    linkedin.networkingActions ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Interview Preparation",
    {
      size: 14,
      before: 14,
    }
  );

  (
    phaseThree.interviewPrep ||
    []
  ).forEach((item) => {
    writer.paragraph(
      safeText(item.topic),
      {
        bold: true,
        after: 2,
      }
    );

    writer.paragraph(
      safeText(
        item.guidance
      ),
      {
        size: 9.5,
      }
    );
  });

  /*
   * ------------------------------------------------------
   * 90 DAY PLAN
   * ------------------------------------------------------
   */

  writer.newPage(
    "90-Day Career Transition Plan",
    submissionId
  );

  writer.heading(
    "90-Day Career Transition Plan"
  );

  const plan =
    phaseThree.ninetyDayPlan ||
    {};

  writer.heading(
    "Days 1-30",
    {
      size: 12,
    }
  );

  (
    plan.days1to30 ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Days 31-60",
    {
      size: 12,
    }
  );

  (
    plan.days31to60 ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Days 61-90",
    {
      size: 12,
    }
  );

  (
    plan.days61to90 ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  /*
   * ------------------------------------------------------
   * SCORECARD + FINAL RECOMMENDATIONS
   * ------------------------------------------------------
   */

  writer.newPage(
    "Action Scorecard & Final Recommendations",
    submissionId
  );

  writer.heading(
    "Weekly Career Search Scorecard"
  );

  (
    phaseThree.weeklyScorecard ||
    []
  ).forEach((item) => {
    writer.paragraph(
      `${safeText(
        item.metric
      )}: ${safeText(
        item.target
      )}`,
      {
        bold: true,
      }
    );
  });

  writer.heading(
    "Final Recommendations",
    {
      size: 14,
      before: 18,
    }
  );

  (
    phaseThree.finalRecommendations ||
    []
  ).forEach((item) =>
    writer.bullet(item)
  );

  writer.heading(
    "Important Disclaimer",
    {
      size: 12,
      before: 18,
    }
  );

  writer.paragraph(
    safeText(
      phaseThree.disclaimer,
      "MOS2Career provides career-planning guidance only. Recommendations, fit scores, compensation estimates, certifications, employer suggestions, and career strategies do not guarantee interviews, employment, compensation, advancement, or other outcomes."
    ),
    {
      size: 8.5,
      color: COLORS.gray,
    }
  );

  pdfDoc.setTitle(
    "MOS2Career Personalized Career Blueprint"
  );

  pdfDoc.setAuthor(
    "MOS2Career"
  );

  pdfDoc.setSubject(
    "Military-to-Civilian Career Transition Blueprint"
  );

  return await pdfDoc.save();
}

export default async function handler(
  request
) {
  try {
    if (
      request.method !== "POST"
    ) {
      return jsonResponse(
        {
          error:
            "Method not allowed",
        },
        405
      );
    }

    /*
     * Reuse the private internal secret.
     * This prevents public PDF generation.
     */

    const expectedSecret =
      process.env
        .BLUEPRINT_INTERNAL_SECRET;

    if (!expectedSecret) {
      return jsonResponse(
        {
          error:
            "BLUEPRINT_INTERNAL_SECRET is not configured",
        },
        500
      );
    }

    const authHeader =
      request.headers.get(
        "authorization"
      );

    if (
      authHeader !==
      `Bearer ${expectedSecret}`
    ) {
      return jsonResponse(
        {
          error:
            "Unauthorized",
        },
        401
      );
    }

    let body;

    try {
      body =
        await request.json();
    } catch {
      return jsonResponse(
        {
          error:
            "Invalid JSON request body",
        },
        400
      );
    }

    const submissionId =
      String(
        body?.submissionId ||
        ""
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
     * Load completed Blueprint JSON.
     */

    const blueprintStore =
      getStore(
        "mos2career-blueprints"
      );

    const storedBlueprint =
      await blueprintStore.get(
        fulfillmentKey,
        {
          type: "json",
          consistency: "strong",
        }
      );

    if (!storedBlueprint) {
      return jsonResponse(
        {
          error:
            "Stored Blueprint not found",
          submissionId,
        },
        404
      );
    }

    /*
     * Generate PDF.
     */

    console.log(
      `MOS2Career PDF GENERATION STARTED: ${submissionId}`
    );

    const pdfBytes =
      await buildBlueprintPDF(
        storedBlueprint
      );

    /*
     * Store PDF.
     */

    const pdfStore =
      getStore(
        "mos2career-blueprint-pdfs"
      );

    await pdfStore.set(
      fulfillmentKey,
      pdfBytes,
      {
        metadata: {
          submissionId,
          filename:
            `MOS2Career-${submissionId}.pdf`,
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

    return jsonResponse({
      success: true,
      submissionId,
      pdfStored: true,
      filename:
        `MOS2Career-${submissionId}.pdf`,
      byteLength:
        pdfBytes.length,
    });
  } catch (error) {
    console.error(
      "MOS2Career PDF generation error:",
      error?.message ||
        "Unknown error"
    );

    return jsonResponse(
      {
        success: false,
        error:
          "PDF generation failed",
      },
      500
    );
  }
}
