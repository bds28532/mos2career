const educationLabels = {
  0: "High school / GED",
  1: "Some college",
  2: "Associate degree",
  3: "Bachelor's degree",
  4: "Master's or higher",
};

const clearanceLabels = {
  0: "None / Unknown",
  1: "Confidential",
  2: "Secret",
  3: "Top Secret",
  4: "TS/SCI",
};

const goalLabels = {
  defense: "Defense / government contracting",
  engineering: "Engineering / technical",
  cyber: "Cybersecurity / IT",
  management: "Management / leadership",
  operations: "Operations / logistics",
  healthcare: "Healthcare / medical",
  remote: "Remote-friendly work",
  income: "Highest earning potential",
};

const workSetupLabels = {
  any: "No preference",
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

const skillLabels = {
  testing: "Testing / validation",
  troubleshooting: "Troubleshooting",
  electronics: "Electronics",
  networking: "Networking",
  cyber: "Cyber / security",
  leadership: "Leadership",
  training: "Training",
  project: "Project coordination",
  maintenance: "Maintenance",
  logistics: "Logistics",
  documentation: "Technical documentation",
  data: "Data / analytics",
};

function firstValue(...values) {
  return values.find((value) =>
    value !== null && value !== undefined && String(value).trim() !== ""
  ) ?? "";
}

function text(...values) {
  return String(firstValue(...values)).trim();
}

function optionLabel(value, labels, numericCode = false) {
  const supplied = text(value);
  if (Object.hasOwn(labels, supplied)) return labels[supplied];
  // An unknown stored number has no reliable meaning. Preserve descriptive
  // legacy values, and leave unknown codes unspecified rather than guessing.
  if (numericCode && supplied && Number.isFinite(Number(supplied))) return "";
  return supplied;
}

function normalizeSkills(value) {
  let skills = value;
  if (typeof skills === "string") {
    try {
      const parsed = JSON.parse(skills);
      if (Array.isArray(parsed)) skills = parsed;
    } catch {
      // Older callers can supply a plain-text skills description.
    }
  }
  if (!Array.isArray(skills)) return text(skills);
  return [...new Set(skills.map((skill) => optionLabel(skill, skillLabels)).filter(Boolean))];
}

export function normalizeBlueprintProfile(profile = {}) {
  const p = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const combinedName = [
    text(p.firstName, p.first_name),
    text(p.lastName, p.last_name),
  ].filter(Boolean).join(" ");

  return {
    submissionId: text(p.submissionId, p.submission_id, p["submission-id"]),
    name: text(p.name, p.fullName, combinedName),
    email: text(p.email),
    branch: text(p.branch),
    militarySpecialty: text(p.militarySpecialty, p.military_specialty, p.specialty, p.mos, p.rating, p.afsc),
    rank: text(p.rank, p.rankGrade, p.rank_grade),
    yearsOfService: text(p.yearsOfService, p.years_of_service, p.years_service, p.years),
    education: optionLabel(p.education, educationLabels, true),
    clearance: optionLabel(firstValue(p.clearance, p.clearanceCategory, p.clearance_category), clearanceLabels, true),
    careerGoal: optionLabel(firstValue(p.careerGoal, p.career_goal, p.goal), goalLabels),
    workSetup: optionLabel(firstValue(p.workSetup, p.work_setup, p.workPreference, p.worksetup), workSetupLabels),
    skills: normalizeSkills(p.skills),
    duties: text(p.duties, p.primaryDuties, p.primary_duties),
    topMatches: text(p.topMatches, p.top_matches),
  };
}
