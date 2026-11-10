import { HANDOFF_KEY, consumeProfileHandoff, translatorDuties } from './job-match-handoff.js';

const params = new URLSearchParams(window.location.search);
if (params.get('from') === 'job-match') {
  const handoff = document.getElementById('jobMatchHandoff');
  const notice = document.getElementById('jobMatchHandoffNotice');
  const applyAnswers = document.getElementById('jobMatchApplyAnswers');
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

  if (handoff && notice && applyAnswers) {
    handoff.hidden = false;
    const keepCurrentProfile = () => {
      applyAnswers.hidden = true;
      applyAnswers.disabled = true;
      notice.textContent = 'Your current profile was kept. The optional $39 Career Blueprint will use the profile you submit here.';
    };
    if (!profile) {
      notice.textContent = 'Your analyzer answers could not be carried over or have expired. Enter your profile below to get free career matches. The $39 Career Blueprint is optional.';
    } else if (window.currentReport) {
      keepCurrentProfile();
    } else {
      notice.textContent = 'Your ' + profile.branch + ' / ' + profile.specialty + ' analyzer answers are ready. Use them to replace your branch, specialty, and duties together. Credentials you entered will be included in Primary duties. Your other profile fields stay as entered.';
      applyAnswers.hidden = false;
      applyAnswers.addEventListener('click', () => {
        if (window.currentReport) {
          keepCurrentProfile();
          return;
        }
        // An explicit choice avoids guessing whether an existing answer is an edit,
        // a browser-restored value, or an untouched default. Replace the whole group.
        document.getElementById('branch').value = profile.branch;
        document.getElementById('specialty').value = profile.specialty;
        document.getElementById('duties').value = translatorDuties(profile);
        applyAnswers.disabled = true;
        applyAnswers.hidden = true;
        notice.textContent = 'Your analyzer answers have filled your branch, specialty, and duties. Any credentials you entered are included in Primary duties; review your education selection separately. Complete the remaining fields, then generate free career matches. The $39 Career Blueprint is optional.';
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'job_match_profile_prefilled', { tool: 'military_job_match' });
        }
      });
      // Once the visitor submits their chosen profile, close the pending offer so
      // it cannot replace answers after matches or a saved submission are created.
      document.getElementById('profileForm').addEventListener('submit', () => {
        if (window.currentReport && !applyAnswers.hidden) keepCurrentProfile();
      });
    }
  }
}
