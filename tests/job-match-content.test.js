import assert from 'node:assert/strict';
import test from 'node:test';
import { EDUCATION_VERIFICATION, verifyEducationClaims } from '../netlify/functions/lib/job-match-report.mjs';
import { normalizeReport, reportText } from '../military-job-match-analyzer/report.js';

test('the live missing-education regression becomes a verification step in display and export', () => {
  const original = {
    summary: 'Experienced Army 25B with practical skills in maintaining network equipment.',
    demonstratedSkills: ['Network equipment maintenance', 'CompTIA A+ certified'],
    potentialSkillsToVerify: ['Experience with Microsoft 365'],
    gaps: ['No demonstrated experience with Microsoft 365', "No bachelor's degree"],
    resumeExample: 'Maintained and troubleshot network equipment.',
    nextSteps: ['Review the employer requirements.']
  };
  const checked = verifyEducationClaims(original);
  assert.equal(checked.gaps[1], EDUCATION_VERIFICATION);
  assert.equal(original.gaps[1], "No bachelor's degree");
  assert.equal(checked.summary, original.summary);
  assert.deepEqual(checked.demonstratedSkills, original.demonstratedSkills);
  const output = reportText({
    profile: { branch: 'Army', specialty: '25B', duties: 'Maintained network equipment.', certifications: 'CompTIA A+', jobDescription: "IT support position; a bachelor's degree is preferred." },
    report: normalizeReport(checked)
  });
  assert.ok(output.includes(EDUCATION_VERIFICATION));
  assert.equal(output.includes("No bachelor's degree"), false);
});

test('negative degree claims are checked throughout the generated report', () => {
  const checked = verifyEducationClaims({
    summary: "You lack a bachelor's degree. You maintained network equipment.",
    demonstratedSkills: ['No college degree'],
    potentialSkillsToVerify: ['You do not have a university degree.'],
    gaps: ['A bachelor’s degree is missing.'],
    resumeExample: "You don't hold a master's degree.",
    nextSteps: ["You lack the required bachelor's degree."]
  });
  assert.equal(checked.summary, EDUCATION_VERIFICATION + ' You maintained network equipment.');
  for (const key of ['demonstratedSkills', 'potentialSkillsToVerify', 'gaps', 'nextSteps']) {
    assert.deepEqual(checked[key], [EDUCATION_VERIFICATION]);
  }
  assert.equal(checked.resumeExample, EDUCATION_VERIFICATION);
});

test('supplied degrees and accurate uncertainty wording stay unchanged', () => {
  const report = {
    summary: "You reported a bachelor's degree in information systems and CompTIA A+.",
    demonstratedSkills: ["Bachelor's degree in information systems", 'CompTIA A+'],
    potentialSkillsToVerify: ['Education not provided; verify the employer requirements.'],
    gaps: ['Degree completion is not demonstrated in the supplied information.'],
    resumeExample: 'Maintained network equipment.',
    nextSteps: ['Verify the employer’s preferred degree or equivalent experience.']
  };
  assert.deepEqual(verifyEducationClaims(report), report);
});

test('a job that does not require a degree is not treated as a personal qualification claim', () => {
  const report = {
    summary: "No bachelor's degree is required for this role.",
    gaps: ['No college degree required; verify employer preferences.'],
    nextSteps: ['This role considers equivalent practical experience.']
  };
  const checked = verifyEducationClaims(report);
  assert.equal(checked.summary, report.summary);
  assert.deepEqual(checked.gaps, report.gaps);
});

test('even an explicitly missing degree is phrased as verification without inventing education facts', () => {
  const checked = verifyEducationClaims({ summary: "You have no bachelor's degree.", gaps: ['No formal education'] });
  assert.equal(checked.summary, EDUCATION_VERIFICATION);
  assert.deepEqual(checked.gaps, [EDUCATION_VERIFICATION]);
  assert.equal(EDUCATION_VERIFICATION.includes('not provided'), false);
});

test('missing or malformed optional report fields do not break education verification', () => {
  const checked = verifyEducationClaims({ summary: 'A supplied summary.', gaps: [null, 12, 'No college degree'], nextSteps: null });
  assert.deepEqual(checked.gaps, [null, 12, EDUCATION_VERIFICATION]);
  assert.equal(checked.nextSteps, null);
});
