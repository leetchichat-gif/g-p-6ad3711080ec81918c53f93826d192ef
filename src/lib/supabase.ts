import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configurez les variables Supabase dans .env.local.");
  if (!client) client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export async function ensureIdentity() {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Supabase n’a pas renvoyé d’utilisateur.");
  return data.user.id;
}

export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
