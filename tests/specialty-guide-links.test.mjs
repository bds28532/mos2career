import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SPECIALTY_GUIDES, guideContext, initGuideLinks } from '../specialty-guide-handoff.js';

const root = new URL('../', import.meta.url);
for (const [id, guide] of Object.entries(SPECIALTY_GUIDES)) {
  test(id + ' translator links carry only their approved guide ID and preserve the form destination', () => {
    const file = guide.path.endsWith('/') ? guide.path.slice(1) + 'index.html' : guide.path.slice(1);
    const source = readFileSync(new URL(file, root), 'utf8');
    const targets = [...source.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(m => new URL(m[1].replace(/&amp;/g, '&'), 'https://mos2career.com' + guide.path)).filter(url => url.origin === 'https://mos2career.com' && url.pathname === '/' && url.hash === '#profileForm');
    assert.ok(targets.length >= 3);
    for (const url of targets) {
      assert.deepEqual([...url.searchParams.keys()], ['guide']);
      assert.equal(guideContext(url.search)?.id, id);
    }
    assert.equal((source.match(/src="\/specialty-guide-handoff\.js"/g) || []).length, 1);
    assert.match(source, new RegExp('<link rel="canonical" href="https://mos2career.com' + guide.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
  });
}

test('unknown, repeated, prototype-like, and conflicting analyzer contexts cannot prefill a guide', () => {
  for (const search of ['', '?guide=unknown', '?guide=__proto__', '?guide=constructor', '?guide=%3Cscript%3E', '?guide=navy-it&guide=army-25b', '?guide=navy-it&guide=navy-it', '?from=job-match&guide=army-25b']) {
    assert.equal(guideContext(search), null, search);
  }
});

test('generic directory and resume-page translator links remain generic', () => {
  for (const file of ['career-guides/index.html', 'military-to-civilian-resume-examples/index.html']) {
    const source = readFileSync(new URL(file, root), 'utf8');
    assert.ok(source.includes('href="/#profileForm"'));
    assert.equal(source.includes('?guide='), false);
  }
});

function link(href) {
  const attributes = new Map([['href', href]]), listeners = [];
  return {
    getAttribute: name => attributes.get(name) ?? null,
    hasAttribute: name => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener: (type, callback) => { if (type === 'click') listeners.push(callback); },
    click() { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; listeners.forEach(callback => callback(event)); return event; }
  };
}

test('guide click tracking is allowlisted, private, and does not block ordinary navigation', () => {
  const eligible = link('/?guide=navy-fc#profileForm');
  const wrongGuide = link('/?guide=army-25b#profileForm');
  const external = link('https://example.com/?guide=navy-fc#profileForm');
  const duplicate = link('/?guide=navy-fc&guide=navy-fc#profileForm');
  const links = [eligible, wrongGuide, external, duplicate], events = [];
  const win = { location: { href: 'https://mos2career.com/navy-fire-controlman-civilian-careers' }, gtag: (...args) => events.push(args) };
  const doc = { querySelectorAll: () => links };
  initGuideLinks(win, doc);
  initGuideLinks(win, doc);
  for (const entry of links) assert.equal(entry.click().defaultPrevented, false);
  assert.deepEqual(events, [['event', 'guide_translator_click', { source_guide: 'navy-fc' }]]);
  win.gtag = () => { throw new Error('Analytics unavailable'); };
  assert.doesNotThrow(() => eligible.click());
});

test('local previews do not send guide analytics', () => {
  const target = link('/?guide=navy-it#profileForm');
  const events = [];
  initGuideLinks({ location: { href: 'http://127.0.0.1:8766/navy-it-civilian-jobs/' }, gtag: (...args) => events.push(args) }, { querySelectorAll: () => [target] });
  target.click();
  assert.deepEqual(events, []);
});
