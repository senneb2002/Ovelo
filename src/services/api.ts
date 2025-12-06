

const EDGE_FUNCTION_BASE_URL = "https://huuwlnviesmjatrzgdbp.functions.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1dXdsbnZpZXNtamF0cnpnZGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NjQzNzEsImV4cCI6MjA4MDM0MDM3MX0.NLs6R6DNwwuOEfZ-dIGXJvfKF_ChpAkZziGgTCUcv88";

interface RegisterDeviceResponse {
  deviceId: string;
  licenseStatus: "free" | "pro";
  existed: boolean;
  renewalDate?: string; // ISO date string, e.g., "2025-01-04T00:00:00Z"
}

interface CheckoutSessionResponse {
  url: string;
}

export const getMachineFingerprint = (): string => {
  let fingerprint = localStorage.getItem("machine_fingerprint");
  if (!fingerprint) {
    fingerprint = crypto.randomUUID();
    localStorage.setItem("machine_fingerprint", fingerprint);
  }
  return fingerprint;
};

export const registerDevice = async (): Promise<RegisterDeviceResponse> => {
  const fingerprint = getMachineFingerprint();
  const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/register-device`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      machineFingerprint: fingerprint,
      platform: "windows", // Hardcoded as per user context
      appVersion: "0.1.0", // TODO: Get real version
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Register device error:", response.status, errorBody);
    throw new Error(`Failed to register device: ${response.status} - ${errorBody}`);
  }

  return response.json();
};

export const createCheckoutSession = async (deviceId: string): Promise<string> => {
  const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/create-checkout-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      deviceId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Checkout session error:", response.status, errorBody);
    throw new Error(`Failed to create checkout session: ${response.status} - ${errorBody}`);
  }

  const data: CheckoutSessionResponse = await response.json();
  return data.url;
};

export const createPortalSession = async (deviceId: string): Promise<string> => {
  const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/create-portal-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      deviceId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Portal session error:", response.status, errorBody);
    throw new Error(`Failed to create portal session: ${response.status} - ${errorBody}`);
  }

  const data: CheckoutSessionResponse = await response.json();
  return data.url;
};

export interface ReflectionResponse {
  text: string;
  isPreview: boolean;
  requiresUpgrade: boolean;
  freeRemaining: number | null;
  licenseStatus: "free" | "pro";
  reflectionCount: number;
}

export const generateReflectionApi = async (prompt: string, persona: string, date: string): Promise<ReflectionResponse> => {
  const deviceId = getMachineFingerprint();
  const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/generate-reflection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      deviceId,
      prompt,
      persona,
      date,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Generate reflection error:", response.status, errorBody);
    throw new Error(`Failed to generate reflection: ${response.status} - ${errorBody}`);
  }

  return response.json();
};
