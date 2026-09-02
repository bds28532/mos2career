import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function cleanProfile(profile = {}) {
  return {
    submissionId: profile.submissionId || "",
    branch: profile.branch || "",
    militarySpecialty:
      profile.militarySpecialty ||
      profile.specialty ||
      profile.mos ||
      profile.rating ||
      profile.afsc ||
      "",
    rank: profile.rank || "",
    yearsOfService: profile.yearsOfService || profile.years || "",
    education: profile.education || "",
    clearance: profile.clearance || "",
    careerGoal: profile.careerGoal || profile.goal || "",
    workSetup: profile.workSetup || profile.workPreference || "",
    skills: profile.skills || "",
    duties: profile.duties || ""
  };
}

const phaseOneSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    submissionId: {
      type: "string"
    },

    executiveAssessment: {
      type: "string"
    },

    careerPositioningStatement: {
      type: "string"
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
            type: "integer"
          },

          title: {
            type: "string"
          },

          fitScore: {
            type: "integer",
            minimum: 0,
            maximum: 100
          },

          compensation: {
            type: "string"
          },

          whyItFits: {
            type: "string"
          },

          transferableSkills: {
            type: "array",
            items: {
              type: "string"
            }
          },

          gaps: {
            type: "array",
            items: {
              type: "string"
            }
          },

          nextAction: {
            type: "string"
          }
        },

        required: [
          "rank",
          "title",
          "fitScore",
          "compensation",
          "whyItFits",
          "transferableSkills",
          "gaps",
          "nextAction"
        ]
      }
    }
  },

  required: [
    "submissionId",
    "executiveAssessment",
    "careerPositioningStatement",
    "careerMatches"
  ]
};

export async function generateCareerBlueprintPhaseOne(profile) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const cleanedProfile = cleanProfile(profile);

  const response = await openai.responses.create({
    model: "gpt-5.6-terra",

    reasoning: {
      effort: "low"
    },

    instructions: `
You are the MOS2Career military-to-civilian career analysis engine.

Create Phase 1 of a Personalized Career Blueprint.

Use only information supplied in the customer's profile.

RULES:

- Do not invent military duties, qualifications, certifications,
  degrees, achievements, leadership responsibilities, metrics,
  equipment experience, or clearance details.

- Translate military experience into terminology civilian recruiters
  and hiring managers understand.

- Produce exactly 10 civilian career matches.

- Rank the career matches from strongest to weakest.

- Fit scores represent estimated career alignment only and do not
  guarantee hiring.

- Compensation is a planning estimate only and may vary by location,
  employer, industry, experience and other factors.

- Keep each career-match explanation concise.

- Do not request or disclose classified information, CUI,
  export-controlled information, operational information,
  vulnerabilities, weapons-system details, mission details,
  or other protected military information.

- Treat security clearance only as a broad career qualification.

- Employer hiring status is outside the scope of this phase.

Return only the JSON required by the supplied schema.
`,

    input: JSON.stringify(cleanedProfile),

    text: {
      format: {
        type: "json_schema",
        name: "mos2career_phase_one",
        strict: true,
        schema: phaseOneSchema
      }
    }
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned an empty response");
  }

  const blueprint = JSON.parse(response.output_text);

  console.log(
    "MOS2Career PHASE 1 GENERATED:",
    cleanedProfile.submissionId || "test-profile"
  );

  return blueprint;
}

export default async function handler(req) {
  try {
    // Only POST requests are allowed.
    if (req.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed" },
        405
      );
    }

    // Temporary test-endpoint protection.
    const expectedSecret =
      process.env.BLUEPRINT_TEST_SECRET;

    if (!expectedSecret) {
      return jsonResponse(
        {
          error:
            "BLUEPRINT_TEST_SECRET is not configured"
        },
        500
      );
    }

    const authHeader =
      req.headers.get("authorization");

    if (
      authHeader !==
      `Bearer ${expectedSecret}`
    ) {
      return jsonResponse(
        { error: "Unauthorized" },
        401
      );
    }

    // Confirm OpenAI is configured.
    if (!process.env.OPENAI_API_KEY) {
      return jsonResponse(
        {
          error:
            "OPENAI_API_KEY is not configured"
        },
        500
      );
    }

    // Read request.
    let body;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          error: "Invalid JSON request body"
        },
        400
      );
    }

    const profile = body?.profile;

    if (
      !profile ||
      typeof profile !== "object"
    ) {
      return jsonResponse(
        {
          error: "A profile object is required"
        },
        400
      );
    }

    // Generate Phase 1.
    const blueprint =
      await generateCareerBlueprintPhaseOne(
        profile
      );

    return jsonResponse({
      success: true,
      phase: 1,
      blueprint
    });

  } catch (error) {
    console.error(
      "MOS2Career Phase 1 error:",
      error?.message || "Unknown error"
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Phase 1 Blueprint generation failed"
      },
      500
    );
  }
}
