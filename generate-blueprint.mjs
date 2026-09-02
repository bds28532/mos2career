import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function cleanProfile(profile = {}) {
  /*
   * Only send information needed to create the Blueprint.
   * Do not send Netlify metadata, IP addresses, payment data,
   * Stripe objects, or other unnecessary information.
   */
  return {
    submissionId:
      profile.submissionId ||
      profile.submission_id ||
      null,

    firstName:
      profile.firstName ||
      profile.first_name ||
      "",

    branch: profile.branch || "",

    militarySpecialty:
      profile.militarySpecialty ||
      profile.military_specialty ||
      profile.specialty ||
      "",

    rank:
      profile.rank ||
      profile.rankGrade ||
      profile.rank_grade ||
      "",

    yearsService:
      profile.yearsService ||
      profile.years_service ||
      profile.years ||
      "",

    education:
      profile.education || "",

    clearanceCategory:
      profile.clearanceCategory ||
      profile.clearance_category ||
      "",

    careerGoal:
      profile.careerGoal ||
      profile.career_goal ||
      "",

    workSetup:
      profile.workSetup ||
      profile.work_setup ||
      "",

    skills: profile.skills || "",

    primaryDuties:
      profile.primaryDuties ||
      profile.primary_duties ||
      profile.duties ||
      "",

    topMatches:
      profile.topMatches ||
      profile.top_matches ||
      "",
  };
}

export async function generateCareerBlueprint(profile) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const customer = cleanProfile(profile);

  if (!customer.submissionId) {
    throw new Error("Blueprint profile is missing submissionId");
  }

  const instructions = `
You are the career-analysis engine for MOS2Career.

MOS2Career helps U.S. military members and veterans translate military
experience into civilian career opportunities.

Create a highly useful personalized Career Blueprint based ONLY on the
customer information supplied.

IMPORTANT RULES:

1. Never invent military duties, qualifications, degrees, licenses,
   certifications, security clearances, accomplishments, metrics, or
   technical experience the customer did not provide.

2. When information is missing, explicitly identify what the customer
   should quantify, verify, or research.

3. Civilian career match percentages are FIT ESTIMATES only.
   They are not probabilities of employment and must never be presented
   as hiring guarantees.

4. Salary figures are planning estimates, not guarantees.
   State that compensation varies by geography, employer, experience,
   credentials, clearance requirements, and current market conditions.

5. Do not claim that a specific certification guarantees employment.

6. Translate military terminology into civilian business language.

7. Recommendations should be concrete and actionable.

8. Never request or encourage classified information, CUI,
   export-controlled data, operational details, sensitive mission
   information, or other protected information.

9. Security-clearance information must remain general.
   Do not infer access level, SCI eligibility, programs, compartments,
   missions, or classified systems.

10. Treat the customer's free Career Translator matches as initial
    heuristic results. You may reorder or refine career recommendations
    when justified by the profile, but explain the reasoning.

The paid MOS2Career Career Blueprint must contain:

- Executive Career Assessment
- Career Positioning Statement
- Military-to-Civilian Skill Translation
- Top 10 Civilian Career Matches
- Qualification Gap Analysis
- Certification / Education Strategy
- Compensation Strategy
- Target Employer Strategy
- Resume Strategy
- LinkedIn / Networking Strategy
- Interview Preparation
- 90-Day Transition Plan
- Final Recommendations

Write professionally and specifically enough that the output is useful
as a paid career-transition product.
`;

  const input = `
Create a personalized MOS2Career Career Blueprint for this customer.

CUSTOMER PROFILE:

${JSON.stringify(customer, null, 2)}

Additional guidance:

For skill translations, connect actual supplied military duties or skills
to terminology understood by civilian recruiters.

For career matches, give exactly 10 roles. For each role include:
- rank
- title
- fit score from 0-100
- compensation estimate
- why it fits
- strongest transferable skills
- likely gaps
- best next action

For the 90-day plan, divide actions into:
- Days 1-30
- Days 31-60
- Days 61-90

Do not fabricate facts merely to fill fields.
`;

  const response = await client.responses.create({
    model: "gpt-5.6-terra",

    instructions,

    input,

    reasoning: {
      effort: "medium",
    },

    text: {
      format: {
        type: "json_schema",
        name: "mos2career_blueprint",
        strict: true,
        schema: {
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

            skillTranslations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  militaryExperience: {
                    type: "string",
                  },
                  civilianTranslation: {
                    type: "string",
                  },
                  evidenceToAdd: {
                    type: "string",
                  },
                },
                required: [
                  "militaryExperience",
                  "civilianTranslation",
                  "evidenceToAdd",
                ],
              },
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
                  compensationEstimate: {
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
                  likelyGaps: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  bestNextAction: {
                    type: "string",
                  },
                },
                required: [
                  "rank",
                  "title",
                  "fitScore",
                  "compensationEstimate",
                  "whyItFits",
                  "transferableSkills",
                  "likelyGaps",
                  "bestNextAction",
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
                  action: {
                    type: "string",
                  },
                },
                required: [
                  "gap",
                  "importance",
                  "action",
                ],
              },
            },

            certificationStrategy: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  credential: {
                    type: "string",
                  },
                  reason: {
                    type: "string",
                  },
                  priority: {
                    type: "string",
                  },
                },
                required: [
                  "credential",
                  "reason",
                  "priority",
                ],
              },
            },

            compensationStrategy: {
              type: "object",
              additionalProperties: false,
              properties: {
                targetRange: {
                  type: "string",
                },
                positioning: {
                  type: "string",
                },
                negotiationGuidance: {
                  type: "string",
                },
                disclaimer: {
                  type: "string",
                },
              },
              required: [
                "targetRange",
                "positioning",
                "negotiationGuidance",
                "disclaimer",
              ],
            },

            targetEmployers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  employerType: {
                    type: "string",
                  },
                  whyTarget: {
                    type: "string",
                  },
                  searchTerms: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                required: [
                  "employerType",
                  "whyTarget",
                  "searchTerms",
                ],
              },
            },

            resumeStrategy: {
              type: "object",
              additionalProperties: false,
              properties: {
                headline: {
                  type: "string",
                },
                summaryGuidance: {
                  type: "string",
                },
                bulletGuidance: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                },
                keywords: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                },
              },
              required: [
                "headline",
                "summaryGuidance",
                "bulletGuidance",
                "keywords",
              ],
            },

            linkedinStrategy: {
              type: "object",
              additionalProperties: false,
              properties: {
                headline: {
                  type: "string",
                },
                aboutGuidance: {
                  type: "string",
                },
                networkingActions: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                },
              },
              required: [
                "headline",
                "aboutGuidance",
                "networkingActions",
              ],
            },

            interviewPrep: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  question: {
                    type: "string",
                  },
                  preparationGuidance: {
                    type: "string",
                  },
                },
                required: [
                  "question",
                  "preparationGuidance",
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
            "disclaimer",
          ],
        },
      },
    },
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned no Blueprint content");
  }

  return JSON.parse(response.output_text);
}

/*
 * Direct POST endpoint for sandbox testing.
 *
 * We will eventually call generateCareerBlueprint(profile)
 * from the Stripe fulfillment workflow instead.
 */
export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed",
    });
  }

  try {
    const body = await request.json();

    const profile = body?.profile;

    if (!profile || typeof profile !== "object") {
      return jsonResponse(400, {
        error: "Missing profile",
      });
    }

    const blueprint =
      await generateCareerBlueprint(profile);

    console.log(
      `MOS2Career BLUEPRINT GENERATED: ${
        blueprint.submissionId || "NO-ID"
      }`
    );

    /*
     * Don't print the whole Blueprint or customer profile
     * to Netlify logs.
     */

    return jsonResponse(200, {
      success: true,
      blueprint,
    });
  } catch (error) {
    console.error(
      "MOS2Career Blueprint generation error:",
      error.message
    );

    return jsonResponse(500, {
      success: false,
      error: "blueprint_generation_failed",
    });
  }
};
