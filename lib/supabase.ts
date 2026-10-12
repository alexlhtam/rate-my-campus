import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Server module: Supabase Auth sessions live in cookies set by our own route handlers.
export type CampusUser = { userId: string; email: string };

const PHOTO_BUCKET = "photos";

function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function publicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
}

export function authConfigured(): boolean {
  return Boolean(supabaseUrl() && publicKey());
}

/** A per-request client bound to the visitor's auth cookies. Returns null until Supabase is configured. */
export async function authClient(): Promise<SupabaseClient | null> {
  const url = supabaseUrl(), key = publicKey();
  if (!url || !key) return null;
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try { for (const { name, value, options } of values) store.set(name, value, options); }
        catch { /* Read-only during rendering; route handlers persist refreshed sessions. */ }
      },
    },
  });
}

/** The signed-in UCL account, verified from the session JWT. */
export async function currentUser(): Promise<CampusUser | null> {
  const client = await authClient();
  if (!client) return null;
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || typeof claims.email !== "string") return null;
  const email = claims.email.toLowerCase();
  // Supabase Auth accepts any address; only UCL accounts count as signed in here.
  if (!email.endsWith("@ucl.ac.uk")) return null;
  return { userId: claims.sub, email };
}

let admin: SupabaseClient | undefined;

/** Service-role client for private photo storage and account deletion. Never expose it to the browser. */
export function adminClient(): SupabaseClient | null {
  const url = supabaseUrl(), key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  admin ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export function photoStorage() {
  return adminClient()?.storage.from(PHOTO_BUCKET) ?? null;
}
