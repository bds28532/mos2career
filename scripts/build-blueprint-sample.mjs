import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buildBlueprintPDF } from '../netlify/functions/create-blueprint-pdf.mjs';
import { sampleBlueprint } from './blueprint-sample-data.mjs';

// This creates a public fictional sample only. It does not call generation,
// payment, profile, email, or storage endpoints and needs no service credentials.
const bytes = await buildBlueprintPDF(sampleBlueprint);
const pdf = await PDFDocument.load(bytes);
const font = await pdf.embedFont(StandardFonts.HelveticaBold);
for (const [index, page] of pdf.getPages().entries()) {
  page.drawText('ILLUSTRATIVE SAMPLE | FICTIONAL PROFILE', {
    x: 54, y: index === 0 ? 350 : 43, size: index === 0 ? 12 : 7,
    font, color: index === 0 ? rgb(0.95, 0.79, 0.35) : rgb(0.35, 0.39, 0.44)
  });
  if (index === 0) page.drawText('Not a customer report. Your recommendations and report length will vary.', {
    x: 54, y: 326, size: 9, font, color: rgb(0.82, 0.87, 0.92)
  });
}
pdf.setTitle('MOS2Career Illustrative Blueprint Sample - Fictional Navy ET');
pdf.setSubject('Fictional example using the actual Career Blueprint PDF template');
pdf.setCreationDate(new Date(sampleBlueprint.generatedAt));
pdf.setModificationDate(new Date(sampleBlueprint.generatedAt));
const output = new URL('../assets/blueprint-sample.pdf', import.meta.url);
await writeFile(output, await pdf.save());
console.log(JSON.stringify({ output: output.pathname, pages: pdf.getPageCount() }));
