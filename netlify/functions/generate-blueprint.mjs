import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "gpt-5.6-terra";

/*
 * ---------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------
 */

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function cleanProfile(profile = {}) {
  return {
    submissionId:
      profile.submissionId ||
      profile.submission_id ||
      profile["submission-id"] ||
      "",

    name:
      profile.name ||
      profile.fullName ||
      "",

    email:
      profile.email ||
      "",

    branch:
      profile.branch ||
      "",

    militarySpecialty:
      profile.militarySpecialty ||
      profile.military_specialty ||
      profile.specialty ||
      profile.mos ||
      profile.rating ||
      profile.afsc ||
      "",

    rank:
      profile.rank ||
      "",

    yearsOfService:
      profile.yearsOfService ||
      profile.years_of_service ||
      profile.years ||
      "",

    education:
      profile.education ||
      "",

    clearance:
      profile.clearance ||
      "",

    careerGoal:
      profile.careerGoal ||
      profile.career_goal ||
      profile.goal ||
      "",

    workSetup:
      profile.workSetup ||
      profile.work_setup ||
      profile.workPreference ||
      "",

    skills:
      profile.skills ||
      "",

    duties:
      profile.duties ||
      "",

    topMatches:
      profile.topMatches ||
      profile.top_matches ||
      "",
  };
}

function parseResponse(response, phaseName) {
  if (!response.output_text) {
    throw new Error(
      `${phaseName} returned an empty OpenAI response`
    );
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new Error(
      `${phaseName} returned invalid JSON`
    );
  }
}

/*
 * ---------------------------------------------------------
 * COMMON SAFETY / QUALITY INSTRUCTIONS
 * ---------------------------------------------------------
 */

const COMMON_INSTRUCTIONS = `
You are the MOS2Career military-to-civilian career analysis engine.

Use ONLY the information supplied in the customer's profile and previously
generated MOS2Career Blueprint sections.

Rules:

1. Never invent military duties, qualifications, degrees, certifications,
   achievements, awards, leadership responsibilities, metrics, equipment
   experience, licenses, clearance details, or accomplishments.

2. When information is missing, frame recommendations as possibilities,
   suggested next steps, or items the customer should verify.

3. Translate military experience into language understandable to civilian
   recruiters and hiring managers.

4. Career fit scores represent estimated alignment only and do not guarantee
   employment, interviews, hiring, promotion, compensation, or career success.

5. Compensation guidance is for planning only. Actual pay varies by geography,
   industry, employer, seniority, experience, market conditions, and other
   factors.

6. Never request, infer, reproduce, or encourage disclosure of classified,
   Controlled Unclassified Information (CUI), export-controlled information,
   sensitive operational information, vulnerabilities, mission details,
   weapons-system details, or other protected information.

7. Treat clearance only as a broad career qualification. Do not discuss
   programs, compartments, systems, missions, or classified access.

8. Employer suggestions are organizations worth researching. Do not imply
   current hiring unless independently verified.

9. Certification suggestions should be relevant to the career path and should
   not be described as mandatory unless genuinely required by law or profession.

10. Keep recommendations practical, specific, and useful for a U.S. military
    veteran transitioning into civilian employment.

11. Return only data required by the supplied JSON schema.
`;

/*
 * =========================================================
 * PHASE 1
 * Executive Assessment + Top 10 Careers
 * =========================================================
 */

const phaseOneSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    submissionId: {
      type: "string",
    },

    executiveAssessment: {
      type: "string",
    },

    careerPositioningStatement: {
      type: "string",
    },

    careerMatches: {
      type: "array",
      minItems: 10,
      maxItems: 10,

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          rank: {
            type: "integer",
          },

          title: {
            type: "string",
          },

          fitScore: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },

          compensation: {
            type: "string",
          },

          whyItFits: {
            type: "string",
          },

          transferableSkills: {
            type: "array",
            items: {
              type: "string",
            },
          },

          gaps: {
            type: "array",
            items: {
              type: "string",
            },
          },

          nextAction: {
            type: "string",
          },
        },

        required: [
          "rank",
          "title",
          "fitScore",
          "compensation",
          "whyItFits",
          "transferableSkills",
          "gaps",
          "nextAction",
        ],
      },
    },
  },

  required: [
    "submissionId",
    "executiveAssessment",
    "careerPositioningStatement",
    "careerMatches",
  ],
};

export async function generateCareerBlueprintPhaseOne(
  profile
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured"
    );
  }

  const cleanedProfile =
    cleanProfile(profile);

  const response =
    await openai.responses.create({
      model: MODEL,

      reasoning: {
        effort: "low",
      },

      instructions: `
${COMMON_INSTRUCTIONS}

PHASE 1 REQUIREMENTS:

- Write a concise executive career assessment.
- Write a strong civilian career positioning statement.
- Produce exactly 10 civilian career matches.
- Rank them from strongest to weakest.
- Keep each individual career explanation concise.
`,

      input: JSON.stringify({
        customerProfile:
          cleanedProfile,
      }),

      text: {
        format: {
          type: "json_schema",
          name:
            "mos2career_phase_one",
          strict: true,
          schema: phaseOneSchema,
        },
      },
    });

  const phaseOne =
    parseResponse(
      response,
      "MOS2Career Phase 1"
    );

  console.log(
    "MOS2Career PHASE 1 GENERATED:",
    cleanedProfile.submissionId ||
      "profile-without-id"
  );

  return phaseOne;
}

/*
 * =========================================================
 * PHASE 2
 * Skills + Gaps + Certifications + Compensation + Employers
 * =========================================================
 */

const phaseTwoSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    skillTranslations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          militarySkill: {
            type: "string",
          },

          civilianTranslation: {
            type: "string",
          },

          businessValue: {
            type: "string",
          },
        },

        required: [
          "militarySkill",
          "civilianTranslation",
          "businessValue",
        ],
      },
    },

    qualificationGaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          gap: {
            type: "string",
          },

          importance: {
            type: "string",
          },

          recommendedAction: {
            type: "string",
          },
        },

        required: [
          "gap",
          "importance",
          "recommendedAction",
        ],
      },
    },

    certificationStrategy: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          certification: {
            type: "string",
          },

          priority: {
            type: "string",
          },

          rationale: {
            type: "string",
          },
        },

        required: [
          "certification",
          "priority",
          "rationale",
        ],
      },
    },

    compensationStrategy: {
      type: "string",
    },

    targetEmployers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          employer: {
            type: "string",
          },

          reason: {
            type: "string",
          },

          targetRoles: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },

        required: [
          "employer",
          "reason",
          "targetRoles",
        ],
      },
    },
  },

  required: [
    "skillTranslations",
    "qualificationGaps",
    "certificationStrategy",
    "compensationStrategy",
    "targetEmployers",
  ],
};

export async function generateCareerBlueprintPhaseTwo(
  profile,
  phaseOne
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured"
    );
  }

  const cleanedProfile =
    cleanProfile(profile);

  const response =
    await openai.responses.create({
      model: MODEL,

      reasoning: {
        effort: "low",
      },

      instructions: `
${COMMON_INSTRUCTIONS}

PHASE 2 REQUIREMENTS:

Analyze the customer profile together with the already generated
Phase 1 career recommendations.

Create:

- Military-to-civilian skill translations.
- Qualification gap analysis.
- Certification and education strategy.
- Compensation strategy.
- Target employer research list.

Focus primarily on the strongest career paths identified in Phase 1.

Do not repeat the entire Phase 1 career analysis.
`,

      input: JSON.stringify({
        customerProfile:
          cleanedProfile,

        phaseOne,
      }),

      text: {
        format: {
          type: "json_schema",
          name:
            "mos2career_phase_two",
          strict: true,
          schema: phaseTwoSchema,
        },
      },
    });

  const phaseTwo =
    parseResponse(
      response,
      "MOS2Career Phase 2"
    );

  console.log(
    "MOS2Career PHASE 2 GENERATED:",
    cleanedProfile.submissionId ||
      "profile-without-id"
  );

  return phaseTwo;
}

/*
 * =========================================================
 * PHASE 3
 * Resume + LinkedIn + Interview + 90-Day Plan
 * =========================================================
 */

const phaseThreeSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    resumeStrategy: {
      type: "object",
      additionalProperties: false,

      properties: {
        targetHeadline: {
          type: "string",
        },

        professionalSummaryGuidance: {
          type: "string",
        },

        bulletPointStrategy: {
          type: "array",
          items: {
            type: "string",
          },
        },

        keywordsToPrioritize: {
          type: "array",
          items: {
            type: "string",
          },
        },

        mistakesToAvoid: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },

      required: [
        "targetHeadline",
        "professionalSummaryGuidance",
        "bulletPointStrategy",
        "keywordsToPrioritize",
        "mistakesToAvoid",
      ],
    },

    linkedinStrategy: {
      type: "object",
      additionalProperties: false,

      properties: {
        headlineGuidance: {
          type: "string",
        },

        aboutSectionGuidance: {
          type: "string",
        },

        profilePriorities: {
          type: "array",
          items: {
            type: "string",
          },
        },

        networkingActions: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },

      required: [
        "headlineGuidance",
        "aboutSectionGuidance",
        "profilePriorities",
        "networkingActions",
      ],
    },

    interviewPrep: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          topic: {
            type: "string",
          },

          guidance: {
            type: "string",
          },
        },

        required: [
          "topic",
          "guidance",
        ],
      },
    },

    ninetyDayPlan: {
      type: "object",
      additionalProperties: false,

      properties: {
        days1to30: {
          type: "array",
          items: {
            type: "string",
          },
        },

        days31to60: {
          type: "array",
          items: {
            type: "string",
          },
        },

        days61to90: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },

      required: [
        "days1to30",
        "days31to60",
        "days61to90",
      ],
    },

    weeklyScorecard: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          metric: {
            type: "string",
          },

          target: {
            type: "string",
          },
        },

        required: [
          "metric",
          "target",
        ],
      },
    },

    finalRecommendations: {
      type: "array",
      items: {
        type: "string",
      },
    },

    disclaimer: {
      type: "string",
    },
  },

  required: [
    "resumeStrategy",
    "linkedinStrategy",
    "interviewPrep",
    "ninetyDayPlan",
    "weeklyScorecard",
    "finalRecommendations",
    "disclaimer",
  ],
};

export async function generateCareerBlueprintPhaseThree(
  profile,
  phaseOne,
  phaseTwo
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured"
    );
  }

  const cleanedProfile =
    cleanProfile(profile);

  const response =
    await openai.responses.create({
      model: MODEL,

      reasoning: {
        effort: "low",
      },

      instructions: `
${COMMON_INSTRUCTIONS}

PHASE 3 REQUIREMENTS:

Using the customer profile and the completed Phase 1 and Phase 2
analysis, create the customer's execution strategy.

Include:

- Resume strategy.
- LinkedIn strategy.
- Interview preparation.
- A practical 90-day transition plan.
- A weekly career-search scorecard.
- Final recommendations.
- A clear professional disclaimer.

Do not fabricate resume accomplishments or metrics.

Resume bullet guidance should explain HOW the customer should translate
their actual experience rather than inventing accomplishments for them.
`,

      input: JSON.stringify({
        customerProfile:
          cleanedProfile,

        phaseOne,

        phaseTwo,
      }),

      text: {
        format: {
          type: "json_schema",
          name:
            "mos2career_phase_three",
          strict: true,
          schema: phaseThreeSchema,
        },
      },
    });

  const phaseThree =
    parseResponse(
      response,
      "MOS2Career Phase 3"
    );

  console.log(
    "MOS2Career PHASE 3 GENERATED:",
    cleanedProfile.submissionId ||
      "profile-without-id"
  );

  return phaseThree;
}

/*
 * =========================================================
 * COMPLETE BLUEPRINT GENERATOR
 * =========================================================
 */

export async function generateCompleteCareerBlueprint(
  profile
) {
  const cleanedProfile =
    cleanProfile(profile);

  console.log(
    "MOS2Career COMPLETE BLUEPRINT STARTED:",
    cleanedProfile.submissionId ||
      "profile-without-id"
  );

  const phaseOne =
    await generateCareerBlueprintPhaseOne(
      cleanedProfile
    );

  const phaseTwo =
    await generateCareerBlueprintPhaseTwo(
      cleanedProfile,
      phaseOne
    );

  const phaseThree =
    await generateCareerBlueprintPhaseThree(
      cleanedProfile,
      phaseOne,
      phaseTwo
    );

  const blueprint = {
    submissionId:
      cleanedProfile.submissionId,

    generatedAt:
      new Date().toISOString(),

    phaseOne,

    phaseTwo,

    phaseThree,
  };

  console.log(
    "MOS2Career COMPLETE BLUEPRINT GENERATED:",
    cleanedProfile.submissionId ||
      "profile-without-id"
  );

  return blueprint;
}

/*
 * =========================================================
 * TEMPORARY PROTECTED TEST ENDPOINT
 * =========================================================
 *
 * This endpoint is for development/testing only.
 *
 * Paid fulfillment should call the exported generation
 * functions internally from fulfill-blueprint.mjs.
 */

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return jsonResponse(
        {
          error:
            "Method not allowed",
        },
        405
      );
    }

    const expectedSecret =
      process.env
        .BLUEPRINT_TEST_SECRET;

    if (!expectedSecret) {
      return jsonResponse(
        {
          error:
            "BLUEPRINT_TEST_SECRET is not configured",
        },
        500
      );
    }

    const authHeader =
      req.headers.get(
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

    if (
      !process.env.OPENAI_API_KEY
    ) {
      return jsonResponse(
        {
          error:
            "OPENAI_API_KEY is not configured",
        },
        500
      );
    }

    let body;

    try {
      body =
        await req.json();
    } catch {
      return jsonResponse(
        {
          error:
            "Invalid JSON request body",
        },
        400
      );
    }

    const profile =
      body?.profile;

    if (
      !profile ||
      typeof profile !==
        "object"
    ) {
      return jsonResponse(
        {
          error:
            "A profile object is required",
        },
        400
      );
    }

    /*
     * Keep the public test endpoint lightweight.
     * It generates Phase 1 only.
     */

    const phaseOne =
      await generateCareerBlueprintPhaseOne(
        profile
      );

    return jsonResponse({
      success: true,
      phase: 1,
      blueprint: phaseOne,
    });
  } catch (error) {
    console.error(
      "MOS2Career Blueprint generation error:",
      error?.message ||
        "Unknown error"
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Blueprint generation failed",
      },
      500
    );
  }
}
