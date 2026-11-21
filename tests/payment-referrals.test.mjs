import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const files = ['index.html', 'navy-fire-controlman-civilian-careers.html',
  'military-job-match-analyzer/index.html', 'career-guides.js'];

function config(file, referrer, hostname = 'mos2career.com') {
  const source = readFileSync(new URL(file, root), 'utf8');
  const script = file.endsWith('.js') ? source : [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find(([, attrs, code]) => !/\bsrc=/.test(attrs) && /gtag\('config'/.test(code))?.[2];
  assert.ok(script, file + ' analytics bootstrap');
  const scripts = [];
  const context = { URL, Date, location: { hostname }, document: {
    referrer, createElement: () => ({}), head: { appendChild: value => scripts.push(value) }
  } };
  context.window = context;
  vm.runInNewContext(script, context, { timeout: 1000 });
  const configs = Array.from(context.dataLayer || []).filter(args => args[0] === 'config');
  return { configs: JSON.parse(JSON.stringify(configs.map(args => Array.from(args)))), scripts };
}

for (const file of files) {
  test(file + ': Stripe checkout returns do not become a new referral source', () => {
    for (const referrer of ['https://checkout.stripe.com/c/pay/fixture', 'https://buy.stripe.com/fixture',
      'https://checkout.stripe.com/', 'https://buy.stripe.com/']) {
      const { configs } = config(file, referrer);
      assert.equal(configs.length, 1);
      assert.equal(configs[0][1], 'G-2251989Z9F');
      assert.equal(configs[0][2]?.ignore_referrer, true, referrer);
    }
  });
  test(file + ': other sources retain referral attribution', () => {
    for (const referrer of ['', 'invalid URL', 'https://www.google.com/search?q=veteran',
      'https://www.linkedin.com/', 'https://www.facebook.com/', 'https://chatgpt.com/',
      'https://checkout.stripe.com.evil.invalid/', 'https://checkout.stripe.com@evil.invalid/',
      'http://checkout.stripe.com/', 'https://example.invalid/?next=https://buy.stripe.com/']) {
      const { configs } = config(file, referrer);
      assert.equal(configs.length, 1);
      // Even ignore_referrer:false suppresses attribution; omit the key entirely.
      assert.equal(Object.hasOwn(configs[0][2] || {}, 'ignore_referrer'), false, referrer);
    }
  });
}
test('local guide previews do not load the Analytics tag', () => {
  const { configs, scripts } = config('career-guides.js', 'https://checkout.stripe.com/', '127.0.0.1');
  assert.deepEqual(configs, []);
  assert.deepEqual(scripts, []);
});
