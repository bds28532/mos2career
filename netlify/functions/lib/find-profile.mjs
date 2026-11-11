// Search every Forms page: a paid customer's profile may be older than the
// latest 100 submissions. Errors must propagate so the payment can be retried.
export async function findMOS2CareerProfile(submissionId, {
  fetchImpl = fetch,
  env = process.env,
  deadline = Date.now() + 20_000,
} = {}) {
  const token = env.NETLIFY_API_TOKEN;
  const siteId = env.NETLIFY_SITE_ID;
  if (!token) throw new Error("NETLIFY_API_TOKEN is not configured");
  if (!siteId) throw new Error("NETLIFY_SITE_ID is not configured");
  const wantedId = String(submissionId || "").trim().toUpperCase();
  if (!wantedId) return null;

  for (let page = 1; ; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Netlify profile lookup timed out");
    const url = new URL(
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/submissions`
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(Math.min(5_000, remaining)),
    });
    if (!response.ok) {
      throw new Error(`Netlify submissions API failed: ${response.status}`);
    }
    const submissions = await response.json();
    if (!Array.isArray(submissions)) throw new Error("Unexpected Netlify submissions response");
    const match = submissions.find(({ data = {} }) => [
      data.submissionId, data.submission_id, data["submission-id"],
      data.referenceId, data.reference_id,
    ].some(value => value && String(value).trim().toUpperCase() === wantedId));
    if (match) return match;

    const link = response.headers.get("link");
    const hasNext = link ? /rel="?next"?/.test(link) : submissions.length === 100;
    if (!hasNext || submissions.length === 0) return null;
  }
}
