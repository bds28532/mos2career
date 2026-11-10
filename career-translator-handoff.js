import { HANDOFF_KEY, consumeProfileHandoff, translatorDuties } from './job-match-handoff.js';

const params = new URLSearchParams(window.location.search);
if (params.get('from') === 'job-match') {
  const notice = document.getElementById('jobMatchHandoffNotice');
  let profile = null;
  try {
    if (params.get('handoff') === 'unavailable') {
      window.sessionStorage.removeItem(HANDOFF_KEY);
    } else {
      profile = consumeProfileHandoff(window.sessionStorage);
    }
  } catch {
    // Browsers can block storage access entirely. The translator still works.
  }

  if (notice) {
    notice.hidden = false;
    if (!profile) {
      notice.textContent = 'Your analyzer answers could not be carried over or have expired. Enter your profile below to get free career matches. The $39 Career Blueprint is optional.';
    } else {
      const branch = document.getElementById('branch');
      const specialty = document.getElementById('specialty');
      const duties = document.getElementById('duties');
      // Preserve entries restored by the browser or already edited by the visitor.
      const hasExistingAnswers = Boolean(specialty.value.trim() || duties.value.trim());
      if (!hasExistingAnswers) branch.value = profile.branch;
      if (!specialty.value.trim()) specialty.value = profile.specialty;
      if (!duties.value.trim()) duties.value = translatorDuties(profile);
      notice.textContent = hasExistingAnswers
        ? 'We kept the answers already in your profile and filled any empty specialty or duties fields from your analysis. Review your details, then generate free career matches. The $39 Career Blueprint is optional.'
        : 'Your branch, specialty, and duties are filled in from your analysis. Any credentials you entered are included in Primary duties; review your education selection separately. Complete the remaining fields, then generate free career matches. The $39 Career Blueprint is optional.';
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'job_match_profile_prefilled', { tool: 'military_job_match' });
      }
    }
  }
}
