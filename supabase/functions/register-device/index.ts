
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const devicesTable = "devices";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { machineFingerprint, platform, appVersion } = await req.json();

    if (!machineFingerprint || !platform || !appVersion) {
      return new Response(
        JSON.stringify({ error: "machineFingerprint, platform, appVersion required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Helper for Supabase REST
    const headers = {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    };

    // 1) Check if device already exists
    const lookupRes = await fetch(
      `${supabaseUrl}/rest/v1/${devicesTable}?select=id,license_status&machine_fingerprint=eq.${encodeURIComponent(machineFingerprint)}`,
      { headers },
    );

    if (!lookupRes.ok) {
      const text = await lookupRes.text();
      console.error("Device lookup failed:", text);
      return new Response(
        JSON.stringify({ error: "Device lookup failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const existing = await lookupRes.json();

    // If exists: update version + last_seen_at and return
    if (Array.isArray(existing) && existing.length > 0) {
      const device = existing[0];

      await fetch(`${supabaseUrl}/rest/v1/${devicesTable}?id=eq.${device.id}`, {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          current_version: appVersion,
          last_seen_at: new Date().toISOString(),
        }),
      });

      return new Response(
        JSON.stringify({
          deviceId: device.id,
          licenseStatus: device.license_status ?? "free",
          existed: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) Not found: create new device
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/${devicesTable}`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        machine_fingerprint: machineFingerprint,
        platform,
        initial_version: appVersion,
        current_version: appVersion,
        license_status: "free",
      }),
    });

    if (!insertRes.ok) {
      const text = await insertRes.text();
      console.error("Device insert failed:", text);
      return new Response(
        JSON.stringify({ error: "Device insert failed", details: text}),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const created = await insertRes.json();
    const device = created[0];

    return new Response(
      JSON.stringify({
        deviceId: device.id,
        licenseStatus: device.license_status,
        existed: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("register-device error:", err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
