import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const roleScript=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const ROLES = ['));
const code=roleScript.slice(0,roleScript.indexOf('  const keywordMap'));
const pay=vm.runInNewContext(code+'; ({roles:ROLES,benchmarks:M2C_PAY_BENCHMARKS,mapping:M2C_ROLE_PAY,lookup:m2cPayBenchmark,markup:m2cPayMarkup,text:m2cPayText})');
const meta=(kind,name)=>html.match(new RegExp('<meta '+kind+'="'+name+'" content="([^"]+)"'))?.[1];
const canonical=html.match(/<link rel="canonical" href="([^"]+)"/)[1];
const asset=url=>readFileSync(new URL(new URL(url,canonical).pathname.slice(1),root));
const pngSize=data=>{
  assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return {width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
};

test('every published pay benchmark has an official occupation source and valid annual median',()=>{
  const titles=new Set(pay.roles.map(r=>r.title));
  for(const [title,key] of Object.entries(pay.mapping)) {
    assert.ok(titles.has(title),'Salary mapping must refer to an actual suggested role');
    const benchmark=pay.benchmarks[key];
    assert.ok(benchmark,'Salary mapping must resolve');
    assert.ok(Number.isSafeInteger(benchmark.median)&&benchmark.median>0);
    assert.ok(benchmark.occupation.length>0);
    assert.equal(new URL(benchmark.source).origin,'https://www.bls.gov');
    assert.ok(new URL(benchmark.source).pathname.startsWith('/ooh/'));
  }
  for(const role of pay.roles) assert.equal(role.salary,undefined,'Unverified market ranges must not remain in the role data');
});

test('display and text export use the same sourced figure, period, and non-entry-level qualification',()=>{
  for(const title of Object.keys(pay.mapping)) {
    const benchmark=pay.lookup(title), formatted=benchmark.median.toLocaleString('en-US');
    for(const output of [pay.markup(title),pay.text(title)]) {
      assert.ok(output.includes('$'+formatted));
      assert.ok(output.includes(benchmark.occupation));
      assert.ok(output.includes(benchmark.source));
      assert.ok(output.includes('May 2025'));
      assert.match(output,/Across experience levels/);
      assert.match(output,/not starting pay/);
    }
  }
  assert.match(html,/<time datetime="2026-11-14">November 14, 2026<\/time>/);
});

test('unmatched and prototype-like titles get local research guidance without a fabricated salary or injected title',()=>{
  for(const title of ['Data Analyst','Intelligence Analyst','__proto__','<img src=x onerror=alert(1)>']) {
    assert.equal(pay.lookup(title),null);
    for(const output of [pay.markup(title),pay.text(title)]) {
      assert.ok(output.includes('local postings'));
      assert.ok(output.includes('https://www.bls.gov/ooh/'));
      assert.equal(output.includes('$'),false);
      assert.equal(output.includes(title),false);
    }
  }
});

test('site and organization structured data identify the canonical brand and resolve to the actual logo asset',()=>{
  const json=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(json['@context'],'https://schema.org');
  const org=json['@graph'].find(x=>x['@type']==='Organization');
  const site=json['@graph'].find(x=>x['@type']==='WebSite');
  assert.equal(org.url,canonical); assert.equal(site.url,canonical);
  assert.equal(site.publisher['@id'],org['@id']);
  assert.equal(org.name,site.name); assert.equal(org.name,meta('property','og:site_name'));
  assert.deepEqual(pngSize(asset(org.logo.url)),{width:org.logo.width,height:org.logo.height});
  assert.equal(json['@graph'].some(x=>'aggregateRating' in x||'review' in x),false);
});

test('search, Open Graph, and Twitter titles/descriptions align and share a valid large preview image',()=>{
  const title=html.match(/<title>([^<]+)<\/title>/)[1];
  assert.equal(meta('property','og:title'),title); assert.equal(meta('name','twitter:title'),title);
  assert.equal(meta('property','og:description'),meta('name','description'));
  assert.equal(meta('name','twitter:description'),meta('name','description'));
  assert.equal(meta('property','og:url'),canonical);
  assert.equal(meta('name','twitter:card'),'summary_large_image');
  const url=meta('property','og:image');
  assert.equal(url,meta('name','twitter:image'));
  assert.deepEqual(pngSize(asset(url)),{width:Number(meta('property','og:image:width')),height:Number(meta('property','og:image:height'))});
  assert.ok(meta('property','og:image:alt')); assert.ok(meta('name','twitter:image:alt'));
  assert.equal(new URL(url).origin,new URL(canonical).origin);
  assert.equal(html.includes('<img src="'+url+'"'),false,'The social preview should not add a page-load image');
  const favicon=html.match(/<link rel="icon"[^>]*href="([^"]+)"/)[1];
  assert.match(asset(favicon).toString('utf8'),/viewBox="0 0 100 100"/);
});
