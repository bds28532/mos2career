// Guide IDs carry public page context, never a visitor's answers or credentials.
export const SPECIALTY_GUIDES = Object.freeze({
  'army-25b': Object.freeze({ branch: 'Army', specialty: '25B', label: 'Army 25B', path: '/army-25b-civilian-jobs/' }),
  'army-68w': Object.freeze({ branch: 'Army', specialty: '68W', label: 'Army 68W', path: '/army-68w-civilian-jobs/' }),
  'army-92y': Object.freeze({ branch: 'Army', specialty: '92Y', label: 'Army 92Y', path: '/army-92y-civilian-jobs/' }),
  'navy-fc': Object.freeze({ branch: 'Navy', specialty: 'FC', label: 'Navy Fire Controlman (FC)', path: '/navy-fire-controlman-civilian-careers.html' }),
  'navy-it': Object.freeze({ branch: 'Navy', specialty: 'IT', label: 'Navy IT', path: '/navy-it-civilian-jobs/' }),
  'navy-ls': Object.freeze({ branch: 'Navy', specialty: 'LS', label: 'Navy LS', path: '/navy-ls-civilian-jobs/' }),
  'navy-et': Object.freeze({ branch: 'Navy', specialty: 'ET', label: 'Navy ET', path: '/navy-et-civilian-jobs/' }),
  'navy-hm': Object.freeze({ branch: 'Navy', specialty: 'HM', label: 'Navy HM', path: '/navy-hm-civilian-jobs/' })
});

export function guideContext(search) {
  const params = new URLSearchParams(search);
  if (params.get('from') === 'job-match') return null;
  const ids = params.getAll('guide');
  if (ids.length !== 1 || !Object.hasOwn(SPECIALTY_GUIDES, ids[0])) return null;
  return { id: ids[0], ...SPECIALTY_GUIDES[ids[0]] };
}

function track(win, event, id) {
  try {
    const host = new URL(win.location.href).hostname;
    if (!['mos2career.com', 'www.mos2career.com'].includes(host)) return;
    if (typeof win.gtag === 'function') win.gtag('event', event, { source_guide: id });
  } catch {
    // Analytics availability must not affect navigation or prefilling.
  }
}

function hasReport(win, doc) {
  return !!win.currentReport || !!doc.getElementById('submissionId')?.value.trim();
}

function hasAnswers(win, doc, form) {
  if (hasReport(win, doc) || win.m2cProfileRevision > 0 || form.hasAttribute('data-profile-interacted')) return true;
  if (doc.activeElement && form.contains(doc.activeElement)) return true;
  for (const control of form.querySelectorAll('input,select,textarea')) {
    if (control.type === 'hidden' || control.name === 'bot-field') continue;
    if (control.type === 'checkbox') {
      if (control.checked) return true;
    } else if (control.tagName === 'SELECT') {
      const options = [...control.querySelectorAll('option')];
      const initial = options.find(option => option.hasAttribute('selected')) || options[0];
      const value = initial?.getAttribute('value') ?? initial?.textContent.trim();
      if (control.value !== value) return true;
    } else if (control.value.trim()) return true;
  }
  return false;
}

export function initGuideTranslator(win, doc) {
  const guide = guideContext(win.location.search);
  const form = doc.getElementById('profileForm');
  const panel = doc.getElementById('specialtyGuideHandoff');
  const notice = doc.getElementById('specialtyGuideNotice');
  const apply = doc.getElementById('specialtyGuideApply');
  const branch = doc.getElementById('branch');
  const specialty = doc.getElementById('specialty');
  if (!guide || !form || !panel || !notice || !apply || !branch || !specialty || form.hasAttribute('data-guide-initialized')) return;
  form.setAttribute('data-guide-initialized', 'true');
  form.setAttribute('data-source-guide', guide.id);
  panel.hidden = false;
  const keep = () => {
    apply.hidden = true;
    apply.disabled = true;
    notice.textContent = 'You arrived from the ' + guide.label + ' guide. Your current profile is kept.';
  };
  const fill = explicit => {
    if (hasReport(win, doc)) { keep(); return; }
    // Commit the pair together. Every other field remains visitor-supplied.
    branch.value = guide.branch;
    specialty.value = guide.specialty;
    if (explicit) {
      // Notify the existing controller so any previous preview/save is invalidated.
      branch.dispatchEvent(new win.Event('input', { bubbles: true }));
      specialty.dispatchEvent(new win.Event('input', { bubbles: true }));
    }
    apply.hidden = true;
    apply.disabled = true;
    notice.textContent = 'From the ' + guide.label + ' guide: ' + guide.branch + ' and ' + guide.specialty + ' are filled in. Add your own duties, then preview your free matches.';
    track(win, 'guide_translator_prefilled', guide.id);
  };
  if (!hasAnswers(win, doc, form)) {
    // A pristine form needs no synthetic input or submit events.
    fill(false);
  } else if (hasReport(win, doc)) {
    keep();
  } else {
    notice.textContent = 'You arrived from the ' + guide.label + ' guide. Your current answers are kept. You can replace only Branch and Military specialty with ' + guide.branch + ' and ' + guide.specialty + '; your other answers stay as entered.';
    apply.textContent = 'Use ' + guide.label;
    apply.hidden = false;
    apply.addEventListener('click', () => fill(true));
  }
  form.addEventListener('submit', () => {
    if (hasReport(win, doc)) {
      apply.hidden = true;
      apply.disabled = true;
      panel.hidden = true;
    }
  });
}

function normalizedPath(path) {
  return path.replace(/\/+$/, '').replace(/\.html$/, '');
}

export function initGuideLinks(win, doc) {
  const current = new URL(win.location.href);
  const entry = Object.entries(SPECIALTY_GUIDES).find(([, guide]) => normalizedPath(guide.path) === normalizedPath(current.pathname));
  if (!entry) return;
  const [id] = entry;
  for (const link of doc.querySelectorAll('a[href]')) {
    let target;
    try { target = new URL(link.getAttribute('href'), current); } catch { continue; }
    if (target.origin !== current.origin || target.pathname !== '/' || target.hash !== '#profileForm' || guideContext(target.search)?.id !== id) continue;
    if (link.hasAttribute('data-guide-tracking')) continue;
    link.setAttribute('data-guide-tracking', 'true');
    link.addEventListener('click', () => track(win, 'guide_translator_click', id));
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.getElementById('profileForm')) initGuideTranslator(window, document);
  else initGuideLinks(window, document);
}
