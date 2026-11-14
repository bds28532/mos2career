import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeBlueprintProfile } from "../netlify/functions/lib/blueprint-profile.mjs";

const savedProfile = {
  submission_id: "M2C-PROFILE-TEST",
  first_name: "Sam",
  last_name: "Veteran",
  email: "person@example.com",
  branch: "Army",
  military_specialty: "25B Information Technology Specialist",
  rank_grade: "E-5",
  years_service: "8",
  education: "2",
  clearance_category: "0",
  career_goal: "cyber",
  skills: '["troubleshooting","networking","documentation"]',
  primary_duties: "Resolved help desk tickets and maintained accounts. CompTIA A+ certified.",
  work_setup: "hybrid",
  top_matches: "IT Systems Administrator",
};

test("a saved paid profile preserves the customer's identity, service history and credentials", () => {
  assert.deepEqual(normalizeBlueprintProfile(savedProfile), {
    submissionId: "M2C-PROFILE-TEST",
    name: "Sam Veteran",
    email: "person@example.com",
    branch: "Army",
    militarySpecialty: "25B Information Technology Specialist",
    rank: "E-5",
    yearsOfService: "8",
    education: "Associate degree",
    clearance: "None / Unknown",
    careerGoal: "Cybersecurity / IT",
    workSetup: "Hybrid",
    skills: ["Troubleshooting", "Networking", "Technical documentation"],
    duties: savedProfile.primary_duties,
    topMatches: "IT Systems Administrator",
  });
});

test("every choice in the live form has the same meaning in the paid report", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const [id, input, output] of [
    ["education", "education", "education"],
    ["clearance", "clearance_category", "clearance"],
    ["goal", "career_goal", "careerGoal"],
    ["worksetup", "work_setup", "workSetup"],
  ]) {
    const select = html.match(new RegExp('<select\\b[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
    assert.ok(select, id + " select exists");
    const options = [...select[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
    assert.ok(options.length > 0);
    for (const [, value, label] of options) {
      assert.equal(normalizeBlueprintProfile({ [input]: value })[output], value === "" ? "" : label, id + "=" + value);
    }
  }
});

test("zero-valued answers survive numeric and saved-string inputs", () => {
  const p = normalizeBlueprintProfile({
    education: 0,
    clearance: 0,
    clearance_category: "4",
    yearsOfService: 0,
    years_service: "8",
  });
  assert.equal(p.education, "High school / GED");
  assert.equal(p.clearance, "None / Unknown");
  assert.equal(p.yearsOfService, "0");
});

test("already descriptive and legacy API profiles retain their supplied facts", () => {
  const p = normalizeBlueprintProfile({
    fullName: "Sam Veteran",
    specialty: "25B",
    rank: "E-5",
    years_of_service: 8,
    education: "Bachelor's degree in information systems",
    clearance: "Secret",
    goal: "Cybersecurity / IT",
    workPreference: "Hybrid",
    duties: "CompTIA A+ certified.",
    skills: "Networking and documentation",
  });
  assert.equal(p.name, "Sam Veteran");
  assert.equal(p.militarySpecialty, "25B");
  assert.equal(p.yearsOfService, "8");
  assert.equal(p.education, "Bachelor's degree in information systems");
  assert.equal(p.clearance, "Secret");
  assert.equal(p.duties, "CompTIA A+ certified.");
  assert.equal(p.skills, "Networking and documentation");
});

test("missing answers and unknown stored codes do not become invented qualifications", () => {
  assert.deepEqual(normalizeBlueprintProfile(null), normalizeBlueprintProfile({}));
  const p = normalizeBlueprintProfile({ education: "99", clearance_category: "99" });
  assert.equal(p.education, "");
  assert.equal(p.clearance, "");
  assert.equal(p.rank, "");
  assert.equal(p.duties, "");
});

test("repeated phase normalization is stable and does not alter the saved submission", () => {
  const original = structuredClone(savedProfile);
  const normalized = normalizeBlueprintProfile(savedProfile);
  assert.deepEqual(normalizeBlueprintProfile(normalized), normalized);
  assert.deepEqual(savedProfile, original);
});

test("saved JSON and direct skill arrays preserve skills without duplicate entries", () => {
  const skills = ["networking", "networking", "Custom skill"];
  assert.deepEqual(normalizeBlueprintProfile({ skills }).skills, ["Networking", "Custom skill"]);
  assert.deepEqual(skills, ["networking", "networking", "Custom skill"]);
  assert.deepEqual(normalizeBlueprintProfile({ skills: '["project","data"]' }).skills, ["Project coordination", "Data / analytics"]);
});
