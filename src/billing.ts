// The paid user plan in Clerk Billing (Dashboard → Billing → Plans → User Plans)
export const PRO_PLAN_SLUG = "pro";

type SubscriptionItem = { status: string; plan: { slug: string } };
type Subscription = { subscription_items: SubscriptionItem[] };

// Webhook requests carry no Clerk session, so `has({ plan })` isn't available; the plan is read
// from the Backend API by the Clerk user id the chat account is linked to instead
export const hasProPlan = async (clerkUserId: string) => {
  const res = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}/billing/subscription`,
    { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } }
  );
  // No subscription at all, e.g. a user created before Billing was enabled
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Subscription lookup failed: ${res.status} ${await res.text()}`);
  }
  const subscription = (await res.json()) as Subscription;
  // A canceled Pro item stays `active` until its period ends; upcoming (scheduled) items don't count
  return subscription.subscription_items.some(
    (item) => item.plan.slug === PRO_PLAN_SLUG && item.status === "active"
  );
};

// The hosted Account Portal lives next to the Frontend API, whose host is encoded in the
// publishable key: `<slug>.clerk.accounts.dev` → `<slug>.accounts.dev` in development,
// `clerk.<domain>` → `accounts.<domain>` in production
const accountPortalUrl = () => {
  const key = process.env.CLERK_PUBLISHABLE_KEY!;
  const frontendApi = Buffer.from(key.split("_")[2], "base64").toString().replace(/\$$/, "");
  const host = frontendApi.endsWith(".clerk.accounts.dev")
    ? frontendApi.replace(/\.clerk\.accounts\.dev$/, ".accounts.dev")
    : frontendApi.replace(/^clerk\./, "accounts.");
  return `https://${host}`;
};

// The Billing tab of the Account Portal's user profile, where users can subscribe
export const upgradeUrl = () => `${accountPortalUrl()}/user/billing`;
