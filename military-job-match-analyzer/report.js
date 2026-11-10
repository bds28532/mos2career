const text = value => typeof value === 'string' ? value : '';
const items = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];

export function normalizeReport(report) {
  if (!report || typeof report.summary !== 'string' || !report.summary.trim()) {
    throw new Error('The analysis was incomplete. Please try again.');
  }
  return {
    summary: report.summary,
    demonstratedSkills: items(report.demonstratedSkills),
    potentialSkillsToVerify: items(report.potentialSkillsToVerify),
    gaps: items(report.gaps),
    nextSteps: items(report.nextSteps),
    resumeExample: text(report.resumeExample) || 'Add only experience you can substantiate.'
  };
}

export function reportText(analysis) {
  const { profile, report } = analysis;
  const lines = [
    'MOS2CAREER — JOB MATCH ANALYSIS',
    'https://www.mos2career.com/military-job-match-analyzer/',
    '',
    'YOUR ANSWERS FOR THIS ANALYSIS',
    'Branch: ' + profile.branch,
    'Military specialty: ' + profile.specialty,
    'Military duties: ' + (profile.duties || 'Not provided'),
    'Credentials or education: ' + (profile.certifications || 'Not provided'),
    '',
    'JOB DESCRIPTION YOU COMPARED',
    profile.jobDescription,
    '',
    'SUMMARY',
    report.summary
  ];
  for (const [title, values] of [
    ['SKILLS SUPPORTED BY YOUR DESCRIPTION', report.demonstratedSkills],
    ['POTENTIAL SKILLS TO VERIFY', report.potentialSkillsToVerify],
    ['GAPS OR REQUIREMENTS TO CHECK', report.gaps],
    ['RECOMMENDED NEXT STEPS', report.nextSteps]
  ]) {
    if (values.length) lines.push('', title, ...values.map(value => '- ' + value));
  }
  lines.push('', 'RESUME WORDING EXAMPLE', report.resumeExample, '',
    'Career-planning guidance only, not a hiring decision or guarantee. Verify current job requirements and include only experience and credentials you can substantiate.',
    '', 'NEXT STEP',
    'Explore free career matches at https://www.mos2career.com/. The optional personalized Career Blueprint costs $39 and adds broader career guidance, resume and LinkedIn strategy, interview preparation, and a 90-day transition plan.');
  return lines.join('\n');
}
