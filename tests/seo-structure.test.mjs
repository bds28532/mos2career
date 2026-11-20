import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://mos2career.com';
const decode = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1], decode(m[3])]));
const tags = (source, tag) => [...source.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'gi'))].map(m => attributes(m[0]));
const meta = (source, name) => tags(source, 'meta').filter(a => a.name === name || a.property === name).map(a => a.content);
const jsonld = source => [...source.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap(m => {
  const data = JSON.parse(m[1]);
  return data['@graph'] || [data];
});
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith('.html') ? [file] : [];
});
const pages = walk(root).map(file => {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const route = '/' + relative.replace(/(^|\/)index\.html$/, '$1');
  const source = readFileSync(file, 'utf8');
  return { route, source, noindex: meta(source, 'robots').some(s => /\bnoindex\b/.test(s)) };
});
const publicPages = pages.filter(p => !p.noindex);
const title = source => decode(source.match(/<title>([^<]+)<\/title>/i)[1]);
const sitemap = [...readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1]));

test('every public page has a distinct title, description, one H1, and a self-referencing canonical', () => {
  const titles = new Set(), descriptions = new Set();
  for (const page of publicPages) {
    const canonical = tags(page.source, 'link').filter(a => a.rel === 'canonical').map(a => a.href);
    assert.deepEqual(canonical, [origin + page.route], page.route + ' canonical must match its actual route');
    assert.equal((page.source.match(/<h1\b/g) || []).length, 1, page.route);
    const description = meta(page.source, 'description');
    assert.equal(description.length, 1, page.route);
    assert.ok(description[0].trim(), page.route);
    assert.ok(!titles.has(title(page.source)), 'Duplicate title: ' + page.route);
    assert.ok(!descriptions.has(description[0]), 'Duplicate description: ' + page.route);
    titles.add(title(page.source)); descriptions.add(description[0]);
  }
});

test('the sitemap contains exactly the public canonical pages and excludes utility pages', () => {
  assert.equal(sitemap.length, new Set(sitemap).size);
  assert.deepEqual([...sitemap].sort(), publicPages.map(p => origin + p.route).sort());
  for (const route of ['/admin.html', '/support-sucess.html', '/feedback/', '/feedback/thanks/']) {
    const page = pages.find(p => p.route === route);
    assert.ok(page?.noindex, route + ' must stay out of search');
    assert.ok(!sitemap.includes(origin + route));
  }
});

test('social metadata agrees with search metadata and uses the existing preview asset', () => {
  for (const page of publicPages) {
    assert.deepEqual(meta(page.source, 'og:title'), [title(page.source)], page.route);
    assert.deepEqual(meta(page.source, 'twitter:title'), [title(page.source)], page.route);
    assert.deepEqual(meta(page.source, 'og:description'), meta(page.source, 'description'), page.route);
    assert.deepEqual(meta(page.source, 'twitter:description'), meta(page.source, 'description'), page.route);
    assert.deepEqual(meta(page.source, 'og:url'), [origin + page.route], page.route);
    assert.deepEqual(meta(page.source, 'twitter:card'), ['summary_large_image'], page.route);
    const image = meta(page.source, 'og:image');
    assert.deepEqual(meta(page.source, 'twitter:image'), image, page.route);
    assert.equal(image.length, 1, page.route);
    const url = new URL(image[0]);
    assert.equal(url.origin, origin);
    const png = readFileSync(path.join(root, url.pathname.slice(1)));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), Number(meta(page.source, 'og:image:width')[0]));
    assert.equal(png.readUInt32BE(20), Number(meta(page.source, 'og:image:height')[0]));
  }
});

test('the guide directory and visible breadcrumbs identify the same hierarchy as structured data', () => {
  const directory = publicPages.find(p => p.route === '/career-guides/');
  assert.ok(directory);
  const collection = jsonld(directory.source).find(node => node['@type'] === 'CollectionPage');
  const items = collection.mainEntity.itemListElement;
  assert.equal(collection.mainEntity.numberOfItems, items.length);
  assert.equal(new Set(items.map(item => item.url)).size, items.length);
  for (const [index, item] of items.entries()) {
    assert.equal(item.position, index + 1);
    const page = publicPages.find(p => origin + p.route === item.url);
    assert.ok(page, item.url + ' must be a real public guide');
    assert.ok(tags(directory.source, 'a').some(a => a.href === page.route));
    const crumbs = jsonld(page.source).find(node => node['@type'] === 'BreadcrumbList').itemListElement;
    assert.deepEqual(crumbs.map(c => c.position), [1, 2, 3]);
    assert.equal(crumbs[1].item, origin + '/career-guides/');
    assert.equal(crumbs.at(-1).item, item.url);
    const visible = page.source.match(/<nav\b[^>]*aria-label="Breadcrumb"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(visible, page.route + ' needs a visible breadcrumb');
    assert.ok(tags(visible, 'a').some(a => a.href === '/career-guides/'));
    assert.equal(jsonld(page.source).find(node => node['@type'] === 'Article').isPartOf['@id'], collection['@id']);
  }
});

test('canonical redirects resolve to real static pages without chains, loops, or backend routes', () => {
  const rules = readFileSync(path.join(root, '_redirects'), 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => line.trim().split(/\s+/));
  const sources = new Set(rules.map(rule => rule[0]));
  assert.equal(sources.size, rules.length);
  // Netlify normalizes standalone .html and trailing-slash aliases for matching.
  // Redirecting between equivalent aliases can redirect the destination to itself.
  const normalized = route => route.replace(/\/+$/, '').replace(/\.html$/, '') || '/';
  for (const [from, to, status] of rules) {
    assert.equal(status, '301!');
    assert.notEqual(from, to);
    assert.notEqual(normalized(from), normalized(to), from + ' must not redirect to its Netlify alias');
    assert.ok(!sources.has(to), from + ' must not create a redirect chain');
    assert.ok(publicPages.some(page => page.route === to), to + ' must be a public canonical page');
    assert.ok(!from.startsWith('/.netlify/'));
  }
  assert.equal(rules.find(rule => rule[0] === '/index.html')?.[1], '/');
});
