# Stripe-confirmed GA4 purchase tracking

This feature is **inactive until configured**. It does not alter the checkout link or any page styling.

## Setup (Netlify environment variables)
- `STRIPE_PURCHASE_WEBHOOK_SECRET`: signing secret (`whsec_...`) for this webhook endpoint
- `STRIPE_PAYMENT_LINK_ID`: exact Stripe Payment Link ID (`plink_...`) of the $39 Blueprint
- `GA4_MEASUREMENT_ID`: your GA4 web data stream ID (existing site currently uses `G-2251989Z9F`)
- `GA4_API_SECRET`: GA4 Measurement Protocol API secret, created in the GA4 web data stream settings

Set all four securely in Netlify, then redeploy. Do not put secret values in GitHub.

## Stripe webhook
Create a Stripe **live-mode** webhook endpoint at:
`https://mos2career.com/.netlify/functions/stripe-purchase-webhook`

Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
Copy that endpoint's signing secret into Netlify.

## What counts as a purchase
The function checks Stripe's signed payload, event age, live mode, payment status paid, payment mode, matching Payment Link ID, USD currency, exact $39 amount, and an existing profile submission reference. It sends GA4 a `purchase` event with the Stripe checkout session ID as transaction ID, value $39, and a single Blueprint item.

**Important limitations:** The server-generated anonymous GA4 client ID is not the browser's client ID. GA4 can record purchases and revenue but cannot reliably attribute these purchases back to the original browser session or traffic source. Implementing a first-party client ID bridge would be a separate project. GA4 Measurement Protocol HTTP 2xx alone does not guarantee that an event is processed; verify in GA4 Realtime/DebugView and purchase reports. Duplicate webhook deliveries can happen; the same transaction ID is used to help GA4 deduplicate purchases, but durable webhook idempotency storage is recommended for stronger guarantees. The exact $39 requirement will reject purchases with tax, discounts, or price changes.

## Testing
- Confirm webhook endpoint rejects unsigned POSTs.
- Use Stripe webhook test deliveries to verify signature handling. Test-mode payments intentionally do **not** emit revenue because `livemode` must be true.
- After configuration, use a real low-risk authorized live transaction and verify Stripe shows paid and GA4 shows the matching purchase. Do not create fictitious sales.
- Review Stripe webhook delivery logs for retries/errors.

No Blueprint fulfillment is triggered by this function. It only reports analytics.
