# Paid Blueprint recovery

Paid Stripe events with a known submission ID return HTTP 503 while the saved
Forms profile is missing. Forms lookups page through older submissions. API
failures or lookup timeouts also return a failure response so Stripe can retry;
no fulfillment job is queued until the profile is available.

Fulfillment claims last 20 minutes, exceeding Netlify's 15-minute background
execution limit. A retry can atomically replace an expired claim or a failed
attempt using the current Blob ETag. Active claims and delivered orders are
skipped. The claim stays active through PDF rendering and email delivery; stage
updates, completion, and failure writes also require the owner's current ETag.

An accepted job's profile is retained in its private fulfillment record until
delivery. The generated Blueprint, exact PDF attachment, and existing Resend
idempotency key are reused after a failed attempt. The retained profile is
cleared from the fulfillment record when delivery is recorded.

`recover-blueprints` runs every five minutes on the currently published
production deploy. It checks up to 20 records per run and uses a rotating cursor
so historical deliveries and individual errors cannot starve later records.
It requeues expired processing/generated records and failures at least five
minutes old. Legacy records without a retained profile use Forms lookup.
Recovery remains dependent on the Forms API, internal secret, and email/AI
credentials being valid. A larger order history takes multiple scans to cycle.
Deploy Previews and unpublished production deploys cannot run recovery.

After release, check the Netlify `recover-blueprints` function schedule and logs.
The handler-level tests verify recovery and concurrency using local provider
fixtures; they do not exercise Netlify's production scheduler or send emails.

Run the main-branch regression suite and recovery tests with:

```sh
node --test tests/job-match.test.js tests/job-match-content.test.js tests/payment-recovery.test.mjs
```

References:

- [Netlify conditional Blob writes](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Background execution and automatic retries](https://docs.netlify.com/build/functions/background-functions/)
- [Scheduled functions and production-only scheduling](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Runtime deploy context](https://docs.netlify.com/build/functions/api/#deploy)
- [Forms API pagination](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/#pagination)
