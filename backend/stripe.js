// backend/stripe.js
import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Success/Cancel URLs (adjust to your deployed domain)
const SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || "https://app.sateratuning.com/success";
const CANCEL_URL  = process.env.STRIPE_CANCEL_URL  || "https://app.sateratuning.com/billing";

// (Optional) map Firebase UID -> Stripe Customer ID in your DB.
// For demo we create/reuse by email passed from frontend.
async function getOrCreateCustomerByEmail(email) {
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length) return existing.data[0];
  return stripe.customers.create({ email });
}

// Create a Checkout Session (subs or one-time)
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId, quantity = 1, email, uid } = req.body;

    if (!priceId || !email) {
      return res.status(400).json({ error: "Missing priceId or email" });
    }

    const customer = await getOrCreateCustomerByEmail(email);

    const session = await stripe.checkout.sessions.create({
      mode: priceId.includes("_one") ? "payment" : "subscription", // if you use one-time price with type=one_time
      line_items: [{ price: priceId, quantity }],
      customer: customer.id,
      success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true,
      billing_address_collection: "required",
      automatic_tax: { enabled: true }, // optional if you want tax calc
      metadata: { uid: uid || "", app: "SateraTuning" },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error("Stripe create-checkout-session error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Customer Portal (manage card, cancel, invoices)
router.post("/create-portal-session", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

    const customer = await getOrCreateCustomerByEmail(email);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: SUCCESS_URL,
    });
    return res.json({ url: portal.url });
  } catch (e) {
    console.error("Stripe create-portal-session error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Webhook to grant/revoke access
router.post("/webhook", bodyParser.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("⚠️  Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle subscription lifecycle + one-time purchases
  switch (event.type) {
    case "checkout.session.completed": {
      // session.mode = subscription|payment
      const session = event.data.object;
      // TODO: mark user active / increment vehicle credits, using session.metadata.uid or customer email
      break;
    }
    case "invoice.payment_succeeded": {
      // Renewals
      const invoice = event.data.object;
      // TODO: ensure access remains active
      break;
    }
    case "customer.subscription.deleted":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      // TODO: if canceled or past_due -> revoke access accordingly
      break;
    }
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      // For one-time vehicle purchases (if not using checkout.session)
      break;
    }
    default:
      // console.log(`Unhandled event type ${event.type}`);
      break;
  }

  res.json({ received: true });
});

export default router;
