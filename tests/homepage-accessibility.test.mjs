import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '');
const form = html.match(/<form\b[^>]*id="profileForm"[^>]*>[\s\S]*?<\/form>/)[0];
const attrs = source => Object.fromEntries([...source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
  .map(([, name, double, single, bare]) => [name, double ?? single ?? bare ?? '']));
const controls = [...form.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
  .map(([markup, tag, source]) => ({ markup, tag, attrs: attrs(source) }));
const labels = [...form.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)]
  .map(([, source, body]) => ({ attrs: attrs(source), body }));
const nodes = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)]
  .map(([, tag, source]) => ({ tag, attrs: attrs(source) }));

test('every homepage profile control has an actual associated label', () => {
  for (const control of controls) {
    if (control.attrs.type === 'hidden' || control.attrs.name === 'bot-field') continue;
    const label = labels.find(label => label.attrs.for && label.attrs.for === control.attrs.id)
      ?? labels.find(label => label.body.includes(control.markup));
    assert.ok(label, `${control.attrs.name} needs a label, not only a placeholder`);
    assert.ok(label.body.replace(/<[^>]*>/g, '').trim(), `${control.attrs.name} needs readable label text`);
  }
  for (const label of labels.filter(label => label.attrs.for)) {
    assert.equal(controls.filter(control => control.attrs.id === label.attrs.for).length, 1,
      `label target ${label.attrs.for} must resolve to one form control`);
  }
});

test('homepage accessible names and descriptions resolve without exposing the bot trap to keyboard users', () => {
  for (const node of nodes) {
    for (const relation of ['aria-labelledby', 'aria-describedby']) {
      for (const target of (node.attrs[relation] ?? '').split(/\s+/).filter(Boolean)) {
        assert.equal(nodes.filter(candidate => candidate.attrs.id === target).length, 1,
          `${relation} target ${target} must exist exactly once`);
      }
    }
  }
  const bot = controls.find(control => control.attrs.name === 'bot-field');
  assert.equal(bot.attrs.tabindex, '-1', 'the hidden spam trap must not interrupt keyboard navigation');
  assert.equal(bot.attrs.autocomplete, 'off');
});
