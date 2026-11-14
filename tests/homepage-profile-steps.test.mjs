import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { normalizeBlueprintProfile } from '../netlify/functions/lib/blueprint-profile.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const decode = text => text.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, value => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  return named[value] ?? String.fromCodePoint(value.startsWith('&#x') ? parseInt(value.slice(3), 16) : parseInt(value.slice(2), 10));
});

// Exercise the browser scripts and native form semantics without sending a
// visitor profile to Netlify or opening a real Stripe checkout.
function page({ response = { ok: true }, specialty = 'IT', executeScripts = true, analytics = 'available', analyticsIds = { client_id: '123456789.1700000000', session_id: '1700000000' }, analyticsOptOut = false } = {}) {
  const ids = new Map();
  const all = [];
  const requests = [];
  const nativeSubmissions = [];
  const alerts = [];
  const errors = [];
  const analyticsCalls = [];
  const analyticsCallbacks = [];
  const timers = new Map();
  let nextTimerId = 0;
  let document;
  class Element {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map(Object.entries(attributes));
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
      this.style = {};
      this._value = attributes.value ?? '';
      this._text = '';
      this.checked = 'checked' in attributes;
      this.classList = {
        add: (...names) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach(n => set.add(n)); this.className = [...set].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? 'add' : 'remove'](name); return enabled; }
      };
      this.dataset = new Proxy({}, { get: (_, name) => this.getAttribute('data-' + String(name).replace(/[A-Z]/g, c => '-' + c.toLowerCase())) });
      all.push(this);
      if (attributes.id) ids.set(attributes.id, this);
    }
    get id() { return this.getAttribute('id') || ''; }
    get name() { return this.getAttribute('name') || ''; }
    get type() { return this.getAttribute('type') || (this.tagName === 'BUTTON' ? 'submit' : 'text'); }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get hidden() { return this.attributes.has('hidden'); }
    set hidden(value) { this[value ? 'setAttribute' : 'removeAttribute']('hidden', ''); }
    get disabled() { return this.attributes.has('disabled'); }
    set disabled(value) { this[value ? 'setAttribute' : 'removeAttribute']('disabled', ''); }
    get required() { return this.attributes.has('required'); }
    get noValidate() { return this.attributes.has('novalidate'); }
    set noValidate(value) { this[value ? 'setAttribute' : 'removeAttribute']('novalidate', ''); }
    get href() { return this.getAttribute('href') || ''; }
    set href(value) { this.setAttribute('href', value); }
    get textContent() { return this._text + this.children.map(e => e.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get innerHTML() { return this._html || ''; }
    set innerHTML(value) { this._html = String(value); this.children = []; }
    get elements() { return all.filter(e => this.contains(e) && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.tagName)); }
    setAttribute(name, value = '') { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, handler) { const handlers = this.listeners.get(type) || []; handlers.push(handler); this.listeners.set(type, handlers); }
    dispatchEvent(event) {
      event.target ||= this;
      event.currentTarget = this;
      event.preventDefault ||= function () { this.defaultPrevented = true; };
      for (const handler of this.listeners.get(event.type) || []) handler(event);
      if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(child) { return this.appendChild(child); }
    contains(element) { for (let e = element; e; e = e.parentElement) if (e === this) return true; return false; }
    closest(selector) { for (let e = this; e; e = e.parentElement) if (e.matches(selector)) return e; return null; }
    get form() { return this.closest('form'); }
    get effectivelyDisabled() { for (let e = this; e; e = e.parentElement) if (e.disabled) return true; return false; }
    get visible() { for (let e = this; e; e = e.parentElement) if (e.hidden) return false; return true; }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (part.includes(' ')) {
          const segments = part.split(/\s+/);
          return this.matches(segments.pop()) && !!this.parentElement?.closest(segments.join(' '));
        }
        if (/:checked/.test(part) && !this.checked) return false;
        if (/:disabled/.test(part) && !this.effectivelyDisabled) return false;
        if (part.includes(':not([disabled])') && this.disabled) return false;
        if (part.includes(':not([hidden])') && this.hidden) return false;
        part = part.replace(/:checked|:disabled|:not\(\[(?:disabled|hidden)\]\)/g, '');
        const tag = part.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        const id = part.match(/#([\w-]+)/)?.[1];
        if (id && this.id !== id) return false;
        for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
          if (!this.hasAttribute(name) || (value !== undefined && this.getAttribute(name) !== value)) return false;
        }
        return true;
      });
    }
    querySelectorAll(selector) { return all.filter(e => e !== this && this.contains(e) && e.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    checkValidity() {
      if (this.tagName === 'FORM') return this.elements.every(e => e.checkValidity());
      if (this.effectivelyDisabled || this.type === 'hidden' || !['INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName)) return true;
      if (this.required && (!this.value || (this.type === 'checkbox' && !this.checked))) return false;
      if (this.type === 'email' && this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)) return false;
      if (this.type === 'number' && this.value) {
        const number = Number(this.value);
        if (!Number.isFinite(number)) return false;
        if (this.hasAttribute('min') && number < Number(this.getAttribute('min'))) return false;
        if (this.hasAttribute('max') && number > Number(this.getAttribute('max'))) return false;
      }
      return true;
    }
    reportValidity() {
      const invalid = this.tagName === 'FORM' ? this.elements.find(e => !e.checkValidity()) : !this.checkValidity() && this;
      if (invalid) { invalid.reported = true; invalid.focus(); return false; }
      return true;
    }
    requestSubmit(submitter) {
      if (!this.noValidate && !this.reportValidity()) return;
      if (this.dispatchEvent({ type: 'submit', submitter, bubbles: true, defaultPrevented: false })) nativeSubmissions.push(this);
    }
    click() {
      if (this.effectivelyDisabled || !this.visible) return;
      const event = { type: 'click', bubbles: true, defaultPrevented: false };
      this.dispatchEvent(event);
      if (!event.defaultPrevented && this.tagName === 'BUTTON' && this.type === 'submit') this.form?.requestSubmit(this);
    }
  }
  const root = new Element('document');
  const stack = [root];
  const clean = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '');
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of clean.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const text = token[0];
    if (!text.startsWith('<')) { stack.at(-1)._text += decode(text); continue; }
    const close = text.match(/^<\/([a-z][\w-]*)/i);
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === close[1].toLowerCase()) {
          const element = stack[i];
          if (element.tagName === 'OPTION') {
            const select = element.closest('select');
            const value = element.getAttribute('value') ?? element.textContent.trim();
            if (select && (select._firstOption === undefined || element.hasAttribute('selected'))) select.value = value;
            if (select) select._firstOption = true;
          }
          stack.length = i; break;
        }
      }
      continue;
    }
    const [, tag, raw] = text.match(/^<([a-z][\w-]*)([\s\S]*?)\/?\s*>$/i) || [];
    if (!tag) continue;
    const attributes = {};
    for (const [, name, quoted, single, bare] of raw.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[name] = decode(quoted ?? single ?? bare ?? '');
    const element = new Element(tag, attributes);
    stack.at(-1).appendChild(element);
    if (!voidTags.has(tag.toLowerCase()) && !text.endsWith('/>')) stack.push(element);
  }
  document = {
    activeElement: null,
    getElementById: id => ids.get(id) || null,
    querySelector: selector => all.find(e => e.matches(selector)) || null,
    querySelectorAll: selector => all.filter(e => e.matches(selector)),
    createElement: tag => new Element(tag),
    addEventListener: root.addEventListener.bind(root),
    dispatchEvent: root.dispatchEvent.bind(root)
  };
  class LocalFormData {
    constructor(form) {
      this.entries = form.elements.filter(e => e.name && !e.effectivelyDisabled && e.tagName !== 'BUTTON' && (e.type !== 'checkbox' || e.checked)).map(e => [e.name, e.value]);
    }
    get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
    set(name, value) { this.entries = this.entries.filter(([key]) => key !== name); this.entries.push([name, String(value)]); }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
  }
  const context = {
    document, URL, URLSearchParams, Blob, FormData: LocalFormData,
    alert: message => alerts.push(message),
    console: { error: (...args) => errors.push(args), log() {} },
    location: { href: 'https://mos2career.com/', search: '' },
    setTimeout: (handler, delay) => { const id = ++nextTimerId; timers.set(id, { handler, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => { requests.push({ url, options }); return typeof response === 'function' ? response() : Promise.resolve(response); }
  };
  context.window = context;
  vm.createContext(context);
  for (const [, attrs, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!executeScripts || /\bsrc=|type="module"/.test(attrs)) continue;
    vm.runInContext(source, context, { timeout: 3000 });
  }
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  // Preserve normal tag events while supplying deterministic get callbacks.
  // A real blocked tag queues the command without ever invoking its callback.
  const queuedGtag = context.gtag;
  if (analytics === 'absent') context.gtag = undefined;
  else if (executeScripts) context.gtag = (...args) => {
    queuedGtag(...args);
    if (args[0] !== 'get') return;
    const [, measurementId, field, callback] = args;
    analyticsCalls.push({ measurementId, field });
    if (analytics === 'throws') throw new Error('Analytics tag blocked');
    if (analytics === 'timeout' || analytics === 'deferred') analyticsCallbacks.push({ field, callback });
    else callback(analyticsIds[field]);
  };
  context['ga-disable-G-2251989Z9F'] = analyticsOptOut;
  const resolveAnalytics = (values = analyticsIds) => {
    for (const { field, callback } of analyticsCallbacks.splice(0)) callback(values[field]);
  };
  const expireAnalytics = () => {
    const scheduled = [...timers.entries()].filter(([, timer]) => timer.delay === 600);
    assert.equal(scheduled.length, 1, 'The analytics lookup must have one bounded timeout');
    for (const [id, timer] of scheduled) { timers.delete(id); timer.handler(); }
  };
  const element = id => { assert.ok(ids.has(id), 'Expected page control: ' + id); return ids.get(id); };
  // Most cases begin with a valid service answer so each test can isolate the
  // contact/save behavior. Empty-specialty validation has its own case below.
  element('specialty').value = specialty;
  const change = (id, value, type = 'input') => {
    const input = element(id); input.value = value; input.dispatchEvent({ type, target: input, bubbles: true });
  };
  const preview = () => element('profilePreviewBtn').click();
  const save = () => element('profileSaveBtn').click();
  const contact = () => { change('firstName', 'Sam'); change('lastName', 'Veteran'); change('email', 'sam@example.invalid'); };
  return { context, document, element, change, preview, save, contact, requests, nativeSubmissions, alerts, errors, analyticsCalls, resolveAnalytics, expireAnalytics };
}

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
const locked = p => assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'true');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('a visitor can preview real career matches without contact details or a profile POST', () => {
  const p = page();
  assert.equal(p.element('contactStep').hidden, true);
  assert.equal(p.element('contactStep').disabled, true);
  p.change('branch', 'Army', 'change');
  p.change('specialty', '25B');
  p.change('duties', 'Maintained user accounts and troubleshot network equipment.');
  p.preview();
  assert.equal(p.alerts.length, 0);
  assert.equal(p.requests.length, 0);
  assert.equal(p.element('submissionId').value, '');
  assert.equal(p.context.currentReport.profile.branch, 'Army');
  assert.equal(p.context.currentReport.profile.specialty, '25B');
  assert.equal(p.context.currentReport.results.length, 7);
  assert.ok(p.context.currentReport.results.every(r => typeof r.title === 'string' && Number.isFinite(r.score)));
  assert.equal(p.element('results').children.length, 7);
  assert.equal(p.element('contactStep').hidden, false);
  assert.equal(p.element('contactStep').disabled, false);
  assert.equal(p.element('experienceStep').hidden, true);
  assert.equal(p.document.activeElement, p.element('matchesTitle'));
  assert.equal(p.element('profileSavePrompt').hidden, false);
  locked(p);
});

test('invalid service input stays in step one without generating or saving matches', () => {
  const p = page();
  p.change('years', '-1');
  p.preview();
  assert.equal(p.requests.length, 0);
  assert.equal(p.context.currentReport == null, true);
  assert.equal(p.element('experienceStep').hidden, false);
  assert.equal(p.element('contactStep').hidden, true);
  assert.equal(p.document.activeElement, p.element('years'));
  assert.equal(p.element('years').closest('details').open, true, 'Invalid optional answers must be revealed for correction');
  locked(p);
});

test('an empty required specialty never produces generic matches or submits a profile', () => {
  const p = page({ specialty: '' });
  p.preview();
  assert.equal(p.context.currentReport == null, true);
  assert.equal(p.requests.length, 0);
  assert.equal(p.element('experienceStep').hidden, false);
  assert.equal(p.element('contactStep').hidden, true);
  assert.equal(p.document.activeElement, p.element('specialty'));
  locked(p);
});

test('saving requires complete contact information and a valid email', async () => {
  const p = page();
  p.preview();
  p.save();
  await settle();
  assert.equal(p.requests.length, 0);
  locked(p);
  p.change('firstName', 'Sam');
  p.change('lastName', 'Veteran');
  p.change('email', 'invalid-email');
  p.save();
  await settle();
  assert.equal(p.requests.length, 0);
  assert.equal(p.document.activeElement, p.element('email'));
  locked(p);
});

test('saving includes service answers from the hidden first step and unlocks the referenced Stripe checkout', async () => {
  const p = page();
  const values = { branch: 'Army', specialty: '25B', rank: 'E-5', years: '8', education: '2', clearance: '0', goal: 'cyber', worksetup: 'hybrid', duties: 'Maintained network equipment and user accounts.' };
  for (const [id, value] of Object.entries(values)) p.change(id, value);
  for (const control of p.document.querySelectorAll('.check input')) control.checked = ['networking', 'documentation'].includes(control.value);
  p.preview();
  assert.equal(p.element('experienceStep').hidden, true);
  assert.equal(p.element('experienceStep').disabled, false, 'Hidden service fields must remain successful form controls');
  p.contact();
  p.save();
  await settle();
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url, '/');
  assert.equal(p.requests[0].options.method, 'POST');
  const body = new URLSearchParams(p.requests[0].options.body);
  for (const [key, value] of Object.entries({ 'form-name': 'career-translator', first_name: 'Sam', last_name: 'Veteran', email: 'sam@example.invalid', branch: 'Army', military_specialty: '25B', rank_grade: 'E-5', years_service: '8', education: '2', clearance_category: '0', career_goal: 'cyber', work_setup: 'hybrid', primary_duties: values.duties })) assert.equal(body.get(key), value, key);
  assert.match(body.get('submission_id'), /^M2C-/);
  assert.deepEqual(body.getAll('skills'), ['networking', 'documentation']);
  assert.ok(body.get('top_matches').includes(p.context.currentReport.results[0].title));
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
  const checkout = new URL(p.element('blueprintCheckoutBtn').href);
  assert.equal(checkout.origin, 'https://buy.stripe.com');
  assert.equal(checkout.searchParams.get('client_reference_id'), body.get('submission_id'));
  assert.equal(checkout.searchParams.get('prefilled_email'), body.get('email'));
});

test('a failed profile save keeps checkout locked and allows retry', async () => {
  let succeed = false;
  const p = page({ response: () => Promise.resolve({ ok: succeed }) });
  p.preview(); p.contact(); p.save();
  await settle();
  locked(p);
  assert.equal(p.requests.length, 1);
  assert.match(p.element('saveStatus').textContent, /couldn't save|try again|failed/i);
  succeed = true;
  p.save();
  await settle();
  assert.equal(p.requests.length, 2);
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
});

test('repeated save clicks while a request is pending create one profile POST', async () => {
  const deferred = defer();
  const p = page({ response: () => deferred.promise });
  p.preview(); p.contact(); p.save(); p.save();
  await settle();
  assert.equal(p.requests.length, 1);
  locked(p);
  deferred.resolve({ ok: true });
  await settle();
  assert.equal(p.requests.length, 1);
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
});

test('contact edits during a pending save cannot unlock checkout with an outdated profile', async () => {
  const deferred = defer();
  const p = page({ response: () => deferred.promise });
  p.preview(); p.contact(); p.save();
  await settle();
  assert.equal(p.requests.length, 1, 'Exercise an edit after the profile POST has started');
  p.change('email', 'new-address@example.invalid');
  deferred.resolve({ ok: true });
  await settle();
  locked(p);
  assert.equal(p.element('submissionId').value, '');
  assert.ok(p.context.currentReport, 'Contact edits should preserve free matches');
});

test('editing saved contact details invalidates the old checkout reference', async () => {
  const p = page();
  p.preview(); p.contact(); p.save();
  await settle();
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
  p.change('email', 'updated@example.invalid', 'change');
  locked(p);
  assert.equal(p.element('submissionId').value, '');
  assert.ok(p.context.currentReport);
  assert.equal(p.element('blueprintCheckoutBtn').href, '#');
});

test('back navigation retains answers and locks checkout; changed experience requires a fresh preview', async () => {
  const p = page();
  p.change('specialty', '25B');
  p.preview(); p.contact(); p.save();
  await settle();
  p.element('profileBackBtn').click();
  assert.equal(p.element('experienceStep').hidden, false);
  assert.equal(p.element('contactStep').hidden, true);
  assert.equal(p.element('profileSavePrompt').hidden, true, 'Back must not leave a save link targeting a hidden contact step');
  assert.equal(p.element('specialty').value, '25B');
  assert.equal(p.element('email').value, 'sam@example.invalid');
  locked(p);
  p.change('specialty', '92Y', 'change');
  assert.equal(p.context.currentReport, null);
  assert.equal(p.element('profileSavePrompt').hidden, true);
  assert.equal(p.element('submissionId').value, '');
  assert.equal(p.element('topMatchesHidden').value, '');
  p.preview();
  assert.equal(p.context.currentReport.profile.specialty, '92Y');
  assert.equal(p.requests.length, 1, 'Refreshing a free preview must not submit another profile');
});

test('an older save response cannot unlock or replace a newer experience preview', async () => {
  const deferred = defer();
  let attempt = 0;
  const p = page({ response: () => ++attempt === 1 ? deferred.promise : Promise.resolve({ ok: true }) });
  p.preview(); p.contact(); p.save();
  await settle();
  assert.equal(p.requests.length, 1);
  p.element('profileBackBtn').click();
  p.change('specialty', 'LS', 'change');
  p.preview();
  assert.equal(p.context.currentReport.profile.specialty, 'LS');
  p.save();
  assert.equal(p.requests.length, 1, 'A pending request cannot be duplicated by re-previewing');
  deferred.resolve({ ok: true });
  await settle();
  locked(p);
  assert.equal(p.element('submissionId').value, '');
  assert.equal(p.context.currentReport.profile.specialty, 'LS');
  p.save();
  await settle();
  assert.equal(p.requests.length, 2);
  const saved = new URLSearchParams(p.requests[1].options.body);
  assert.equal(saved.get('military_specialty'), 'LS');
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
});

test('free preview analytics contain no contact or career-profile answers', () => {
  const p = page();
  p.element('firstName').value = 'PrivateFirstName';
  p.element('lastName').value = 'PrivateLastName';
  p.element('email').value = 'private-person@example.invalid';
  p.change('duties', 'PRIVATE-DUTIES: maintained network equipment.');
  p.preview();
  assert.ok(p.context.currentReport);
  assert.equal(p.requests.length, 0);
  const analytics = JSON.stringify(p.context.dataLayer);
  for (const privateValue of ['PrivateFirstName', 'PrivateLastName', 'private-person@example.invalid', 'PRIVATE-DUTIES']) assert.equal(analytics.includes(privateValue), false, privateValue);
  assert.ok(analytics.includes('career_translator_completed'));
});

test('analytics identifiers are read only on explicit save and accompany that profile POST', async () => {
  const p = page();
  // These accessors make a cookie/storage fallback fail this flow immediately.
  Object.defineProperty(p.document, 'cookie', { get() { throw new Error('Do not parse analytics cookies'); } });
  p.context.localStorage = { getItem() { throw new Error('Do not read stored analytics identifiers'); } };
  assert.equal(p.element('gaClientId').value, '');
  assert.equal(p.element('gaSessionId').value, '');
  p.change('duties', 'PRIVATE-SAVED-DUTIES: maintained networks.');
  p.preview();
  p.contact();
  assert.equal(p.requests.length, 0);
  assert.deepEqual(p.analyticsCalls, [], 'Preview and contact edits must not request tracking identifiers');
  p.save();
  await settle();
  assert.equal(p.requests.length, 1);
  assert.deepEqual(p.analyticsCalls, [
    { measurementId: 'G-2251989Z9F', field: 'client_id' },
    { measurementId: 'G-2251989Z9F', field: 'session_id' }
  ]);
  const body = new URLSearchParams(p.requests[0].options.body);
  assert.equal(body.get('ga_client_id'), '123456789.1700000000');
  assert.equal(body.get('ga_session_id'), '1700000000');
  assert.equal(body.get('ga_tracking_status'), 'available');
  const events = JSON.stringify(p.context.dataLayer);
  for (const privateValue of ['Sam', 'Veteran', 'sam@example.invalid', 'PRIVATE-SAVED-DUTIES']) assert.equal(events.includes(privateValue), false, privateValue);
  assert.equal(new URL(p.element('blueprintCheckoutBtn').href).searchParams.get('client_reference_id'), body.get('submission_id'));
});

test('an unanswered analytics lookup times out without blocking save or accepting late identifiers', async () => {
  const p = page({ analytics: 'timeout' });
  p.preview(); p.contact(); p.save(); p.save();
  await settle();
  assert.equal(p.requests.length, 0, 'Wait for the bounded identifier lookup before posting');
  assert.equal(p.analyticsCalls.length, 2, 'Repeated save must not start a second lookup');
  locked(p);
  p.expireAnalytics();
  await settle();
  assert.equal(p.requests.length, 1);
  const body = new URLSearchParams(p.requests[0].options.body);
  assert.equal(body.get('ga_client_id'), '');
  assert.equal(body.get('ga_session_id'), '');
  assert.equal(body.get('ga_tracking_status'), 'unavailable');
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
  p.resolveAnalytics();
  await settle();
  assert.equal(p.requests.length, 1, 'Late tag callbacks must not post or replace the saved payload');
  assert.equal(new URLSearchParams(p.requests[0].options.body).get('ga_client_id'), '');
});

for (const [label, options] of [
  ['opted out', { analyticsOptOut: true }],
  ['absent', { analytics: 'absent' }],
  ['throwing', { analytics: 'throws' }]
]) test(`${label === 'throwing' ? 'a' : 'an'} ${label} analytics tag does not prevent profile saving`, async () => {
  const p = page(options);
  p.preview(); p.contact(); p.save();
  await settle();
  assert.equal(p.requests.length, 1);
  const body = new URLSearchParams(p.requests[0].options.body);
  assert.equal(body.get('ga_client_id'), '');
  assert.equal(body.get('ga_session_id'), '');
  assert.equal(body.get('ga_tracking_status'), 'unavailable');
  if (label !== 'throwing') assert.equal(p.analyticsCalls.length, 0);
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
});

test('non-numeric or oversized analytics identifiers cannot enter the saved profile', async () => {
  for (const analyticsIds of [
    { client_id: 'person@example.invalid', session_id: '1700000000' },
    { client_id: '<script>alert(1)</script>', session_id: 'https://attacker.invalid/' },
    { client_id: '1'.repeat(21) + '.2', session_id: '1'.repeat(17) }
  ]) {
    const p = page({ analyticsIds });
    p.preview(); p.contact(); p.save();
    await settle();
    assert.equal(p.requests.length, 1);
    const body = new URLSearchParams(p.requests[0].options.body);
    assert.equal(body.get('ga_client_id'), '');
    assert.equal(body.get('ga_session_id'), '', 'A session alone must not mark an unrecognized client as trackable');
    assert.equal(body.get('ga_tracking_status'), 'unavailable');
  }
  const p = page({ analyticsIds: { client_id: '123.456', session_id: 'sam@example.invalid' } });
  p.preview(); p.contact(); p.save();
  await settle();
  const body = new URLSearchParams(p.requests[0].options.body);
  assert.equal(body.get('ga_client_id'), '123.456');
  assert.equal(body.get('ga_session_id'), '');
  assert.equal(body.get('ga_tracking_status'), 'available');
});

test('edits while analytics is pending cancel the stale POST and allow a fresh save', async () => {
  const p = page({ analytics: 'deferred' });
  p.preview(); p.contact(); p.save();
  assert.equal(p.requests.length, 0);
  assert.equal(p.analyticsCalls.length, 2);
  p.change('email', 'fresh-address@example.invalid');
  p.resolveAnalytics();
  await settle();
  assert.equal(p.requests.length, 0, 'An edited profile must not be posted after identifier lookup');
  assert.equal(p.element('submissionId').value, '');
  assert.ok(p.context.currentReport, 'Contact edits preserve the free preview');
  locked(p);
  p.save();
  p.resolveAnalytics();
  await settle();
  assert.equal(p.requests.length, 1);
  assert.equal(new URLSearchParams(p.requests[0].options.body).get('email'), 'fresh-address@example.invalid');
  assert.equal(p.element('blueprintCheckoutBtn').getAttribute('aria-disabled'), 'false');
});

test('blocked JavaScript cannot turn the Preview button into a native profile POST', () => {
  const p = page({ executeScripts: false });
  assert.equal(p.element('profilePreviewBtn').disabled, true);
  assert.equal(p.element('contactStep').disabled, true);
  assert.match(p.document.querySelector('noscript').textContent, /enable javascript|contact support/i);
  p.preview();
  assert.equal(p.nativeSubmissions.length, 0);
  assert.equal(p.requests.length, 0);
  const initialized = page();
  assert.equal(initialized.element('profilePreviewBtn').disabled, false, 'Enable preview after the complete controller initializes');
});

test('whitespace-only specialty is rejected using trimmed native validity', () => {
  const p = page({ specialty: '   ' });
  p.preview();
  assert.equal(p.element('specialty').value, '');
  assert.equal(p.document.activeElement, p.element('specialty'));
  assert.equal(p.context.currentReport == null, true);
  assert.equal(p.element('contactStep').hidden, true);
  assert.equal(p.requests.length, 0);
});

test('omitted optional years and education remain unknown in preview and the paid profile', async () => {
  const p = page();
  assert.equal(p.element('years').value, '');
  assert.equal(p.element('education').value, '');
  p.preview();
  const profile = p.context.currentReport.profile;
  assert.equal(profile.years, null);
  assert.equal(profile.education, null);
  const gaps = p.context.gapList(p.context.currentReport.results[0], profile);
  assert.ok(gaps.some(gap => /education was not provided/i.test(gap)));
  assert.equal(gaps.some(gap => /education level may be below/i.test(gap)), false);
  // Unknown education should neither grant the education bonus nor infer a
  // shortfall. An explicit zero still means a supplied high-school answer.
  const role = { title: 'Example role', base: 60, skills: [], goals: [], minEdu: 3, clearance: 0, remote: 0 };
  const neutral = { ...profile, specialty: 'Unlisted specialty', skills: [], goal: '', rank: '', worksetup: 'any' };
  const unknown = p.context.roleScore(role, neutral).score;
  assert.equal(unknown, 60);
  assert.ok(p.context.roleScore(role, { ...neutral, education: 0 }).score < unknown);
  assert.ok(p.context.roleScore(role, { ...neutral, education: 3 }).score > unknown);
  p.contact(); p.save();
  await settle();
  assert.equal(p.requests.length, 1);
  const body = new URLSearchParams(p.requests[0].options.body);
  assert.equal(body.get('years_service'), '');
  assert.equal(body.get('education'), '');
  const paid = normalizeBlueprintProfile(Object.fromEntries(body));
  assert.equal(paid.yearsOfService, '');
  assert.equal(paid.education, '');
});
