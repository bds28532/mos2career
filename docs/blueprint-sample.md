# Public Blueprint sample

The homepage previews a fictional Navy Electronics Technician profile and a PDF
generated with the unchanged paid-report renderer in
`netlify/functions/create-blueprint-pdf.mjs`. The authored example data live in
`scripts/blueprint-sample-data.mjs`; they are not an actual customer report or an
AI-generated customer result. Every PDF page identifies the fictional sample.
No real profile, payment, email, or generation service is needed to build it.

To rebuild with the repository dependencies installed:

1. Run `node scripts/build-blueprint-sample.mjs`.
2. Use a Python environment with `pypdf`, `Pillow`, and Poppler's `pdftoppm`.
3. Run `python scripts/render-blueprint-sample.py --qa-dir ../blueprint-sample-qa`.
   If needed, supply the executable with `--pdftoppm /path/to/pdftoppm`.
4. Inspect every page and the contact sheets. Check the qualification, resume,
   and 90-day-plan previews at full size. The rendering script updates the three
   homepage PDF page links and the public page manifest to match the actual PDF.
5. Run `node --test` and verify the homepage sample links before deployment.

Commit the generated PDF, its three PNG previews, the page manifest, and any
updated homepage links together. Recheck the sample when the paid-report
template changes. A purchased report's recommendations and length depend on the
customer's own submitted experience and goals.

The sample uses placeholders for illustrative resume wording and makes no claim
about an actual person's accomplishments, education, certifications, or salary.
Sources are the Navy occupational standards, O*NET's electronics technician
occupation, and the related BLS Occupational Outlook Handbook profile, reviewed
November 21, 2026. Named exam eligibility and local wage figures are not assumed.
