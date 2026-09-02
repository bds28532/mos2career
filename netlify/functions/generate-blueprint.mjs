import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function cleanProfile(profile = {}) {
  return {
    submissionId: profile.submissionId || "",
    name: profile.name || "",
    email: profile.email || "",
    branch: profile.branch || "",
    militarySpecialty:
      profile.militarySpecialty ||
      profile.specialty ||
      profile.mos ||
      profile.rating ||
      profile.afsc ||
      "",
    rank: profile.rank || "",
    yearsOfService:
      profile.yearsOfService ||
      profile.years ||
      "",
    education: profile.education || "",
    clearance: profile.clearance || "",
    careerGoal:
      profile.careerGoal ||
      profile.goal ||
      "",
    workSetup:
      profile.workSetup ||
      profile.workPreference ||
      "",
    skills: profile.skills || "",
    duties: profile.duties || "",
    translatorMatches:
      profile.translatorMatches ||
      profile.topMatches ||
      []
  };
}

const blueprintSchema = {
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

    skillTranslations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          militarySkill: {
            type: "string"
          },
          civilianTranslation: {
            type: "string"
          },
          businessValue: {
            type: "string"
          }
        },
        required: [
          "militarySkill",
          "civilianTranslation",
          "businessValue"
        ]
      }
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
    },

    qualificationGaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          gap: {
            type: "string"
          },
          importance: {
            type: "string"
          },
          recommendedAction: {
            type: "string"
          }
        },
        required: [
          "gap",
          "importance",
          "recommendedAction"
        ]
      }
    },

    certificationStrategy: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          certification: {
            type: "string"
          },
          priority: {
            type: "string"
          },
          rationale: {
            type: "string"
          }
        },
        required: [
          "certification",
          "priority",
          "rationale"
        ]
      }
    },

    compensationStrategy: {
      type: "string"
    },

    targetEmployers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          employer: {
            type: "string"
          },
          reason: {
            type: "string"
          },
          targetRoles: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: [
          "employer",
          "reason",
          "targetRoles"
        ]
      }
    },

    resumeStrategy: {
      type: "string"
    },

    linkedinStrategy: {
      type: "string"
    },

    interviewPrep: {
      type: "array",
      items: {
        type: "string"
      }
    },

    ninetyDayPlan: {
      type: "object",
      additionalProperties: false,
      properties: {
        days1to30: {
          type: "array",
          items: {
            type: "string"
          }
        },
        days31to60: {
          type: "array",
          items: {
            type: "string"
          }
        },
        days61to90: {
          type: "array",
          items: {
            type: "string"
          }
        }
      },
      required: [
        "days1to30",
        "days31to60",
        "days61to90"
      ]
    },

    finalRecommendations: {
      type: "array",
      items: {
        type: "string"
      }
    },

    disclaimer: {
      type: "string"
    }
  },

  required: [
    "submissionId",
    "executiveAssessment",
    "careerPositioningStatement",
    "skillTranslations",
    "careerMatches",
    "qualificationGaps",
    "certificationStrategy",
    "compensationStrategy",
    "targetEmployers",
    "resumeStrategy",
    "linkedinStrategy",
    "interviewPrep",
    "ninetyDayPlan",
    "finalRecommendations",
    "disclaimer"
  ]
};

export async function generateCareerBlueprint(profile) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const cleanedProfile = cleanProfile(profile);

  const response = await openai.responses.create({
    model: "gpt-5.5",

    instructions: `
You are the MOS2Career Career Blueprint engine.

Create a professional military-to-civilian career transition assessment using
ONLY the information supplied in the customer's profile.

Important rules:

1. Do not invent military duties, certifications, degrees, qualifications,
   achievements, leadership responsibilities, equipment experience, clearance
   details, metrics, or accomplishments.

2. When information is not supplied, clearly frame recommendations as
   possibilities or areas the customer should verify.

3. Translate military experience into terminology that civilian recruiters and
   hiring managers understand.

4. Career fit scores are estimates of alignment only. They are not guarantees
   of interviews, employment, hiring, salary, promotion, or career success.

5. Compensation ranges are planning estimates and can vary significantly by
   geography, industry, employer, experience, clearance requirements, and
   economic conditions.

6. Do not request, infer, reproduce, or encourage disclosure of classified,
   Controlled Unclassified Information (CUI), export-controlled information,
   sensitive operational information, weapons-system details, vulnerabilities,
   mission details, or other protected military information.

7. Treat security clearance information only as a broad career qualification.
   Do not request or discuss classified access, programs, compartments,
   missions, systems, or operational details.

8. Produce exactly 10 civilian career matches ranked from strongest to weakest.

9. Make the Blueprint practical. Each recommended career path should explain
   why it fits, transferable skills, likely gaps, compensation considerations,
   and the customer's next action.

10. Recommendations should be realistic for a U.S. military veteran
    transitioning into civilian employment.

11. Employer suggestions are examples of organizations the customer may
    research. Do not imply the employer is currently hiring unless that
    information has been independently verified.

12. Certification recommendations must be relevant to the target career and
    should not be represented as mandatory unless they are legally or
    professionally required.

13. Return only information that complies with the supplied JSON schema.
`,

    input: `
Generate a MOS2Career Personalized Career Blueprint for this customer profile:

${JSON.stringify(cleanedProfile, null, 2)}
`,

    text: {
      format: {
        type: "json_schema",
        name: "mos2career_blueprint",
        strict: true,
        schema: blueprintSchema
      }
    }
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned an empty Blueprint response");
  }

  const blueprint = JSON.parse(response.output_text);

  console.log(
    "MOS2Career BLUEPRINT GENERATED:",
    cleanedProfile.submissionId || "test-profile"
  );

  return blueprint;
}

export default async function handler(req) {
  try {
    // ----------------------------------------------------
    // 1. Only allow POST requests
    // ----------------------------------------------------

    if (req.method !== "POST") {
      return jsonResponse(
        {
          error: "Method not allowed"
        },
        405
      );
    }

    // ----------------------------------------------------
    // 2. Protect temporary public test endpoint
    // ----------------------------------------------------

    const expectedSecret = process.env.BLUEPRINT_TEST_SECRET;

    if (!expectedSecret) {
      return jsonResponse(
        {
          error: "BLUEPRINT_TEST_SECRET is not configured"
        },
        500
      );
    }

    const authHeader = req.headers.get("authorization");

    if (authHeader !== `Bearer ${expectedSecret}`) {
      return jsonResponse(
        {
          error: "Unauthorized"
        },
        401
      );
    }

    // ----------------------------------------------------
    // 3. Verify OpenAI configuration
    // ----------------------------------------------------

    if (!process.env.OPENAI_API_KEY) {
      return jsonResponse(
        {
          error: "OPENAI_API_KEY is not configured"
        },
        500
      );
    }

    // ----------------------------------------------------
    // 4. Read profile sent in POST body
    // ----------------------------------------------------

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

    if (!profile || typeof profile !== "object") {
      return jsonResponse(
        {
          error: "A profile object is required"
        },
        400
      );
    }

    // ----------------------------------------------------
    // 5. Generate Blueprint
    // ----------------------------------------------------

    const blueprint = await generateCareerBlueprint(profile);

    // ----------------------------------------------------
    // 6. Return generated Blueprint
    // ----------------------------------------------------

    return jsonResponse({
      success: true,
      blueprint
    });

  } catch (error) {
    console.error(
      "MOS2Career Blueprint generation error:",
      error?.message || "Unknown error"
    );

    return jsonResponse(
      {
        success: false,
        error: "Blueprint generation failed",
        detail:
          process.env.NODE_ENV === "development"
            ? error?.message
            : undefined
      },
      500
    );
  }
}
