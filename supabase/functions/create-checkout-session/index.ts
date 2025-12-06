
import Stripe from "npm:stripe";

// ---------------------
// CORS HEADERS
// ---------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------
// ENV VARS (read once)
// ---------------------
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const priceId = Deno.env.get("STRIPE_PRICE_ID") ?? "";

// ---------------------
// MAIN HANDLER
// ---------------------
Deno.serve(async (req) => {
  // 1) Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2) Allow only POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  // 3) Check config
  if (!stripeSecretKey || !priceId) {
    // Config problem: tell the caller instead of crashing
    return new Response(
      JSON.stringify({
        error: "Stripe not configured",
        details: "Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // 4) Create Stripe client
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-06-20",
  });

  try {
    const { deviceId } = await req.json();

    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: "Missing deviceId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const origin = req.headers.get("origin") ?? "http://localhost:1420";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancel`,
      metadata: {
        device_id: deviceId,
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Checkout failure:", err);

    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
