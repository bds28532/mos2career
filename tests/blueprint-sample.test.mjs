import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sampleBlueprint } from '../scripts/blueprint-sample-data.mjs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('assets/blueprint-sample-pages.json', root), 'utf8'));

test('the public sample is a clearly fictional complete report using the existing report schema', () => {
  assert.match(sampleBlueprint.submissionId, /^SAMPLE-FICTIONAL-/);
  assert.match(sampleBlueprint.phaseOne.executiveAssessment, /FICTIONAL PROFILE/);
  assert.equal(sampleBlueprint.phaseOne.careerMatches.length, 10);
  assert.equal(new Set(sampleBlueprint.phaseOne.careerMatches.map(match => match.rank)).size, 10);
  assert.match(sampleBlueprint.phaseThree.resumeStrategy.bulletPointStrategy.join(' '), /\[verified finding\]/);
  assert.match(sampleBlueprint.phaseThree.disclaimer, /not a customer report or testimonial/);
  assert.ok(sampleBlueprint.phaseThree.ninetyDayPlan.days1to30.length);
  assert.ok(sampleBlueprint.phaseThree.ninetyDayPlan.days31to60.length);
  assert.ok(sampleBlueprint.phaseThree.ninetyDayPlan.days61to90.length);
});

test('PDF and lazy page previews agree with their generated manifest and actual page destinations', () => {
  const pdf = readFileSync(new URL(manifest.pdf.slice(1), root));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(createHash('sha256').update(pdf).digest('hex'), manifest.pdfSha256);
  assert.equal(manifest.fictional, true);
  assert.ok(manifest.pageCount >= 4);
  for (const { image, page } of Object.values(manifest.previews)) {
    assert.ok(page >= 1 && page <= manifest.pageCount);
    const png = readFileSync(new URL(image.slice(1), root));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 612);
    assert.equal(png.readUInt32BE(20), 792);
    assert.ok(html.includes('href="/assets/blueprint-sample.pdf#page=' + page + '"'));
    const tag = html.match(new RegExp('<img[^>]*src="' + image.replaceAll('.', '\\.') + '"[^>]*>'))?.[0];
    assert.ok(tag);
    assert.match(tag, /loading="lazy"/);
    assert.match(tag, /alt="[^"]+"/);
  }
  assert.ok(html.includes('href="/assets/blueprint-sample.pdf"'));
  assert.match(html, /fictional veteran profile|Fictional Navy Electronics Technician profile/i);
});
