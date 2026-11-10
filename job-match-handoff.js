export const HANDOFF_KEY = 'mos2career.job-match-profile.v1';
export const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

const branches = new Set(['Navy', 'Army', 'Air Force', 'Marine Corps', 'Coast Guard', 'Space Force']);
const limits = { specialty: 100, duties: 2000, certifications: 500 };

function validProfile(profile) {
  if (!profile || !branches.has(profile.branch)) return false;
  return Object.entries(limits).every(([key, limit]) =>
    typeof profile[key] === 'string' && profile[key].length <= limit
  ) && Boolean(profile.specialty.trim());
}

export function saveProfileHandoff(storage, profile, now = Date.now()) {
  if (!validProfile(profile)) return false;
  // Carry only the visitor's answers, never job requirements or AI-inferred skills.
  const record = {
    version: 1,
    createdAt: now,
    profile: {
      branch: profile.branch,
      specialty: profile.specialty,
      duties: profile.duties,
      certifications: profile.certifications
    }
  };
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function consumeProfileHandoff(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    storage.removeItem(HANDOFF_KEY);
    if (!raw || raw.length > 20000) return null;
    const record = JSON.parse(raw);
    if (record?.version !== 1 || !Number.isFinite(record.createdAt)) return null;
    const age = now - record.createdAt;
    if (age < 0 || age > HANDOFF_MAX_AGE_MS || !validProfile(record.profile)) return null;
    return record.profile;
  } catch {
    return null;
  }
}

export function translatorDuties(profile) {
  const parts = [profile.duties.trim()];
  if (profile.certifications.trim()) {
    parts.push('Credentials or education I provided: ' + profile.certifications.trim());
  }
  return parts.filter(Boolean).join('\n\n');
}
