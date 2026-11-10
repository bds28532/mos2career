import { saveProfileHandoff } from '../job-match-handoff.js';
import { normalizeReport, reportText } from './report.js';

const form = document.getElementById('matchForm');
const button = document.getElementById('submit');
const status = document.getElementById('status');
const results = document.getElementById('results');
const actionStatus = document.getElementById('reportActionStatus');
const manualCopy = document.getElementById('manualCopy');
let currentAnalysis = null;
let analyzing = false;

const track = name => {
  if (typeof window.gtag === 'function') window.gtag('event', name, { tool: 'military_job_match' });
};

function list(title, items) {
  if (!items.length) return;
  const heading = document.createElement('h3');
  heading.textContent = title;
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  document.getElementById('sections').append(heading, ul);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (analyzing) return;
  analyzing = true;
  currentAnalysis = null;
  status.className = 'muted';
  status.textContent = 'Analyzing your experience…';
  button.disabled = true;
  results.classList.add('hidden');
  manualCopy.hidden = true;
  document.getElementById('reportText').value = '';
  actionStatus.textContent = '';
  track('job_match_started');
  // Keep submitted answers with the report, even if the form is later edited.
  const profile = {
    branch: document.getElementById('branch').value,
    specialty: document.getElementById('specialty').value,
    duties: document.getElementById('duties').value,
    certifications: document.getElementById('certifications').value,
    jobDescription: document.getElementById('job').value
  };
  try {
    const response = await fetch('/.netlify/functions/job-match-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Unable to analyze');
    const report = normalizeReport(payload?.report);
    document.getElementById('summary').textContent = report.summary;
    document.getElementById('sections').replaceChildren();
    list('Skills supported by your description', report.demonstratedSkills);
    list('Potential skills to verify', report.potentialSkillsToVerify);
    list('Gaps or requirements to check', report.gaps);
    list('Recommended next steps', report.nextSteps);
    document.getElementById('resume').textContent = report.resumeExample;
    currentAnalysis = { profile, report };
    results.classList.remove('hidden');
    status.textContent = 'Analysis complete.';
    track('job_match_completed');
    results.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message || 'Please try again.';
  } finally {
    analyzing = false;
    button.disabled = false;
  }
});

document.getElementById('copyReport').addEventListener('click', async () => {
  if (!currentAnalysis) return;
  const analysis = currentAnalysis;
  const text = reportText(analysis);
  try {
    await navigator.clipboard.writeText(text);
    if (analysis !== currentAnalysis) return;
    manualCopy.hidden = true;
    actionStatus.textContent = 'Report copied. You can paste it into a document or notes.';
    track('job_match_report_copied');
  } catch {
    if (analysis !== currentAnalysis) return;
    const field = document.getElementById('reportText');
    field.value = text;
    manualCopy.hidden = false;
    field.focus();
    field.select();
    actionStatus.textContent = 'Automatic copying is unavailable. Copy the selected text below, or use Download report.';
  }
});

document.getElementById('downloadReport').addEventListener('click', () => {
  if (!currentAnalysis) return;
  let url;
  try {
    const blob = new Blob([reportText(currentAnalysis)], { type: 'text/plain;charset=utf-8' });
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'MOS2Career_Job_Match_Report.txt';
    document.body.append(link);
    link.click();
    link.remove();
    actionStatus.textContent = 'Report download started. Check your browser’s downloads.';
    track('job_match_report_downloaded');
  } catch {
    actionStatus.textContent = 'The download could not start. Use Copy report to keep your results.';
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
});

document.getElementById('blueprintLink').addEventListener('click', event => {
  if (!currentAnalysis) return;
  let saved = false;
  try {
    saved = saveProfileHandoff(window.sessionStorage, currentAnalysis.profile);
  } catch {
    // Continue to a working translator even when browser storage is disabled.
  }
  event.currentTarget.href = saved
    ? '/?from=job-match#profileForm'
    : '/?from=job-match&handoff=unavailable#profileForm';
  track('job_match_translator_click');
});
