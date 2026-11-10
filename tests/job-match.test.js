import assert from 'node:assert/strict';
import test from 'node:test';
import { HANDOFF_KEY, HANDOFF_MAX_AGE_MS, saveProfileHandoff, consumeProfileHandoff, translatorDuties } from '../job-match-handoff.js';
import { normalizeReport, reportText } from '../military-job-match-analyzer/report.js';

const now = 100000000;
const profile = {
  branch: 'Army', specialty: '25B', duties: 'Maintained network equipment.',
  certifications: 'CompTIA A+', jobDescription: 'Requires an advanced degree and cloud architecture experience.'
};
const report = normalizeReport({
  summary: 'Your network maintenance experience may transfer to IT support.',
  demonstratedSkills: ['Network maintenance'], potentialSkillsToVerify: ['Cloud architecture'],
  gaps: ['Verify degree requirements'], nextSteps: ['Review the posting'],
  resumeExample: 'Maintained network equipment in support of unit operations.'
});

function memoryStorage() {
  const records = new Map();
  return {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key)
  };
}

test('handoff includes only visitor answers, never requirements or inferred skills', () => {
  const storage = memoryStorage();
  assert.equal(saveProfileHandoff(storage, { ...profile, report }, now), true);
  const raw = storage.getItem(HANDOFF_KEY);
  assert.equal(raw.includes('advanced degree'), false);
  assert.equal(raw.includes('Cloud architecture'), false);
  assert.deepEqual(consumeProfileHandoff(storage, now).branch, 'Army');
  assert.deepEqual(Object.keys(JSON.parse(raw).profile), ['branch', 'specialty', 'duties', 'certifications']);
});

test('handoff is consumed once and expires after 30 minutes', () => {
  const storage = memoryStorage();
  saveProfileHandoff(storage, profile, now);
  assert.equal(consumeProfileHandoff(storage, now + 1).specialty, '25B');
  assert.equal(consumeProfileHandoff(storage, now + 2), null);
  saveProfileHandoff(storage, profile, now);
  assert.equal(consumeProfileHandoff(storage, now + HANDOFF_MAX_AGE_MS + 1), null);
  assert.equal(storage.getItem(HANDOFF_KEY), null);
});

test('invalid, oversized, and future-dated records are discarded', () => {
  for (const record of [
    '{broken', 'null', 'x'.repeat(20001),
    JSON.stringify({ version: 1, createdAt: now + 1, profile }),
    JSON.stringify({ version: 2, createdAt: now, profile }),
    JSON.stringify({ version: 1, createdAt: now, profile: { ...profile, branch: 'Invalid' } }),
    JSON.stringify({ version: 1, createdAt: now, profile: { ...profile, specialty: 'x'.repeat(101) } }),
    JSON.stringify({ version: 1, createdAt: now, profile: { ...profile, duties: { text: 'invalid' } } })
  ]) {
    const storage = memoryStorage();
    storage.setItem(HANDOFF_KEY, record);
    assert.equal(consumeProfileHandoff(storage, now), null);
    assert.equal(storage.getItem(HANDOFF_KEY), null);
  }
});

test('storage failures do not prevent continuing to the translator', () => {
  const storage = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Quota exceeded'); },
    removeItem() { throw new Error('Storage blocked'); }
  };
  assert.equal(saveProfileHandoff(storage, profile, now), false);
  assert.equal(consumeProfileHandoff(storage, now), null);
  assert.equal(saveProfileHandoff(storage, { ...profile, specialty: '' }, now), false);
});

test('valid maximum-length escaped answers survive the handoff', () => {
  const storage = memoryStorage();
  const escaped = { branch: 'Navy', specialty: 'X'.repeat(100), duties: '\u0000'.repeat(2000), certifications: '\u0000'.repeat(500) };
  assert.equal(saveProfileHandoff(storage, escaped, now), true);
  assert.deepEqual(consumeProfileHandoff(storage, now), escaped);
});

test('credentials stay verbatim in duties without copying the job requirements', () => {
  assert.equal(translatorDuties(profile), 'Maintained network equipment.\n\nCredentials or education I provided: CompTIA A+');
  assert.equal(translatorDuties({ duties: '', certifications: '' }), '');
});

test('export includes the supplied answers and every displayed report section', () => {
  const output = reportText({ profile, report });
  for (const text of [profile.branch, profile.specialty, profile.duties, profile.certifications, profile.jobDescription, report.summary, ...report.demonstratedSkills, ...report.potentialSkillsToVerify, ...report.gaps, ...report.nextSteps, report.resumeExample, '$39']) {
    assert.ok(output.includes(text), text);
  }
  assert.ok(output.indexOf('SKILLS SUPPORTED') < output.indexOf('POTENTIAL SKILLS TO VERIFY'));
  assert.ok(output.includes('not a hiring decision or guarantee'));
});

test('incomplete AI responses cannot produce a successful report', () => {
  for (const value of [null, {}, { summary: '' }, { summary: '  ' }]) {
    assert.throws(() => normalizeReport(value), /incomplete/);
  }
  const normalized = normalizeReport({ summary: 'A summary', demonstratedSkills: ['Valid', null, { text: 'Invalid' }, '  '] });
  assert.deepEqual(normalized.demonstratedSkills, ['Valid']);
  assert.deepEqual(normalized.gaps, []);
  assert.equal(normalized.resumeExample, 'Add only experience you can substantiate.');
});

let moduleNumber = 0;
async function translatorPage(search, values = {}, storage = memoryStorage()) {
  const elements = {
    jobMatchHandoffNotice: { hidden: true, textContent: '' },
    branch: { value: values.branch || 'Navy' },
    specialty: { value: values.specialty || '' },
    duties: { value: values.duties || '' },
    firstName: { value: 'Existing name' }, email: { value: 'existing@example.invalid' },
    education: { value: '0' }
  };
  const events = [];
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { location: { search }, sessionStorage: storage, gtag: (...args) => events.push(args) };
  globalThis.document = { getElementById: id => elements[id] };
  try {
    await import('../career-translator-handoff.js?test=' + moduleNumber++);
    return { elements, events };
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
  }
}

test('translator fills real answers without changing identity, education, or sending answers to analytics', async () => {
  const storage = memoryStorage();
  saveProfileHandoff(storage, profile);
  const { elements, events } = await translatorPage('?from=job-match', {}, storage);
  assert.equal(elements.branch.value, 'Army');
  assert.equal(elements.specialty.value, '25B');
  assert.equal(elements.duties.value, translatorDuties(profile));
  assert.equal(elements.firstName.value, 'Existing name');
  assert.equal(elements.email.value, 'existing@example.invalid');
  assert.equal(elements.education.value, '0');
  assert.equal(elements.jobMatchHandoffNotice.hidden, false);
  assert.deepEqual(events, [['event', 'job_match_profile_prefilled', { tool: 'military_job_match' }]]);
});

test('translator preserves existing profile entries', async () => {
  const storage = memoryStorage();
  saveProfileHandoff(storage, profile);
  const { elements } = await translatorPage('?from=job-match', { branch: 'Navy', specialty: 'IT', duties: 'My edited duties.' }, storage);
  assert.equal(elements.branch.value, 'Navy');
  assert.equal(elements.specialty.value, 'IT');
  assert.equal(elements.duties.value, 'My edited duties.');
});

test('unavailable marker never restores an older stored profile', async () => {
  const storage = memoryStorage();
  saveProfileHandoff(storage, profile);
  const { elements, events } = await translatorPage('?from=job-match&handoff=unavailable', {}, storage);
  assert.equal(elements.specialty.value, '');
  assert.ok(elements.jobMatchHandoffNotice.textContent.includes('could not be carried over'));
  assert.equal(events.length, 0);
  assert.equal(storage.getItem(HANDOFF_KEY), null);
});

test('ordinary translator visits do not apply analyzer answers or display a handoff notice', async () => {
  const storage = memoryStorage();
  saveProfileHandoff(storage, profile);
  const { elements } = await translatorPage('', {}, storage);
  assert.equal(elements.specialty.value, '');
  assert.equal(elements.jobMatchHandoffNotice.hidden, true);
  assert.notEqual(storage.getItem(HANDOFF_KEY), null);
});
