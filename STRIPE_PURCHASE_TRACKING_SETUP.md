# Stripe-confirmed GA4 purchase tracking

Only signed, paid Stripe Checkout notifications can report a purchase. A checkout
button click, return URL, test-mode payment, or free Translator result is not a
production purchase. Checkout pricing, tax collection, and Blueprint fulfillment
are independent of these measurement changes.

## Endpoints and configuration

Store secret values in Netlify environment variables, never in GitHub or browser
code. Configuration presence is not proof that a signing secret or GA4 secret is
valid. Each Stripe webhook endpoint has its own signing secret.

The primary endpoint is
`https://mos2career.com/.netlify/functions/stripe-webhook`.
It verifies `STRIPE_WEBHOOK_SECRET` for live events and
`STRIPE_WEBHOOK_SECRET_TEST` for sandbox events, checks the verified mode, finds
the saved profile, and queues the existing Blueprint fulfillment process.
Subscribe to `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, and
`checkout.session.async_payment_failed`. Both successful event types must carry
`payment_status: paid`; failures and unpaid sessions do not report revenue.
Only verified live events attempt GA4 reporting. An Analytics transport failure
does not fail an already queued paid Blueprint.

Both reporting paths need:

- `GA4_MEASUREMENT_ID`: the web stream ID (the public site uses `G-2251989Z9F`).
- `GA4_API_SECRET`: that stream's Measurement Protocol secret.

The separate analytics-only endpoint is
`https://mos2career.com/.netlify/functions/stripe-purchase-webhook`.
If this endpoint is registered in Stripe, it also needs:

- `STRIPE_PURCHASE_WEBHOOK_SECRET`: this endpoint's signing secret. It takes
  precedence over the legacy `STRIPE_WEBHOOK_SECRET` fallback. Do not reuse a
  different endpoint's secret.
- `STRIPE_PAYMENT_LINK_ID`: the exact Blueprint Payment Link ID (`plink_...`).

It accepts `checkout.session.completed` and
`checkout.session.async_payment_succeeded`, verifies the signature and its
five-minute tolerance, and requires a paid, live, one-time USD Checkout Session
on the configured link with a profile reference. The expected item subtotal is
3900 cents, before tax/discount changes to the paid total. Old payloads without
`amount_subtotal` retain the untaxed 3900-cent fallback. A different base price
requires reviewing this guard. This endpoint never queues fulfillment. Missing
profiles and Analytics transport failures remain retryable on this endpoint.

## Revenue and attribution

The Stripe Checkout Session ID is the GA4 `transaction_id` on both paths. For
this single-item USD Blueprint, `value` and item `price` are the amount actually
paid minus tax and shipping. Tax and shipping are separate event parameters.
Discounts are already reflected in Stripe's paid total and are not subtracted
twice. Negative, noninteger, missing, or impossible monetary amounts are not sent.
For example, a test payment of $41.58 with $2.58 tax produces $39 item revenue,
$2.58 tax, and $0 shipping. It must not produce $41.58 item revenue.

On an explicit profile save, the homepage asks the existing Google tag for its
numeric browser client ID and session ID. The saved profile carries those IDs
and `ga_tracking_status`. The server validates them before use. A session ID is
included only within 24 hours of its start; an older purchase can still share
the browser client ID. No names, email addresses, profile answers, or submission
reference are included in the GA4 purchase payload.

If a new profile explicitly says tracking is unavailable, the server skips
Analytics rather than bypassing that state with a synthetic visitor. Profiles
from before this bridge existed retain their deterministic anonymous fallback;
those older purchases cannot reliably join an original browser session/source.

Google tag configuration ignores the referrer only for HTTPS returns from the
exact `checkout.stripe.com` and `buy.stripe.com` hosts. For other traffic the
`ignore_referrer` key is omitted entirely: even setting it to false would suppress
referral attribution. This change affects future collection, not historical
attribution. Stripe referral sessions alone are not evidence of purchases.

## Test-only verification

The November 21, 2026 audit used the connected Stripe test account only. It found
two paid test Checkouts, each with a 3900-cent subtotal, 258-cent tax, and
4158-cent total. Stripe's successful-delivery filter returned both completed
events. The enabled test webhook points to the primary endpoint and subscribes
to all three supported Checkout event types. There was no analytics-only
endpoint in that test account. These findings do not establish the live account's
configuration, delivery history, or real purchase totals.

Run `node --test` before deploying changes. The purchase fixtures execute both
real handler modules with isolated Stripe, profile, fulfillment, and Analytics
transports. They cover taxed/discounted amounts, delayed success, retries,
signature/mode checks, unavailable tracking, and the rule that sandbox revenue
never reaches production Analytics. Fixture `livemode` flags are local test
inputs, not real live Stripe events. Referral tests execute every Analytics
bootstrap and check that search/social referrals remain available.

Use Google's `/debug/mp/collect` validation endpoint with synthetic values for
payload validation. It does not ingest events into reports and does not validate
the API secret. Do not use `/mp/collect` for synthetic purchase validation or
replay test notifications against the public fulfillment endpoint: the latter
can queue Blueprint generation and email even though it skips GA4 revenue.
Unsigned public POST probes should be rejected; they cannot confirm that a
real signed payment was ingested by GA4.

## Operational limits

- GA4 Measurement Protocol HTTP 2xx means transport receipt, not validated report
  ingestion. The analytics-only endpoint's `recorded` response has that same
  transport-only meaning. Actual report ingestion requires a matching real
  transaction and processed GA4 reports; that was outside this test-only audit.
- Duplicate deliveries retain the same transaction/client identity to help GA4
  deduplicate. There is no durable Analytics delivery ledger. Fulfillment has
  its own separate duplicate protection.
- A primary-endpoint Analytics failure is logged after fulfillment is queued;
  it is not independently retried there. A registered analytics-only endpoint
  provides its own Stripe retries for transport/profile failures.
- This audit did not create a charge, send a synthetic purchase to production
  GA4, replay old purchases, or change Stripe/GA4/hosting account settings.

## Primary references

- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe Checkout Session fields](https://docs.stripe.com/api/checkout/sessions/object)
- [Google Analytics purchase parameters](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events#purchase)
- [Measurement Protocol validation](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events)
- [Measurement Protocol session attribution](https://developers.google.com/analytics/devguides/collection/protocol/ga4/use-cases)
- [Unwanted referrals and ignore_referrer](https://support.google.com/analytics/answer/10327750)
