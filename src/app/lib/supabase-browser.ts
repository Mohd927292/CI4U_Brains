import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function isProductionAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CI4U_AUTH_MODE === "production";
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const supabaseUrl = getSupabaseUrl();
  const publicKey = getSupabasePublicKey();

  if (!supabaseUrl || !publicKey) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(supabaseUrl, publicKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}

function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function getSupabasePublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
