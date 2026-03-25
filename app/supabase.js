import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const config = window.PROJETO_POSSE_CONFIG || {};

const hasConfig =
  typeof config.supabaseUrl === "string" &&
  config.supabaseUrl.includes("supabase.co") &&
  !config.supabaseUrl.includes("YOUR_PROJECT_ID") &&
  typeof config.supabaseAnonKey === "string" &&
  !config.supabaseAnonKey.includes("YOUR_SUPABASE_ANON_KEY");

export const supabase = hasConfig
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function ensureSupabase() {
  if (!supabase) {
    throw new Error("Configure o arquivo app/config.js com a URL e a anon key do Supabase.");
  }
  return supabase;
}

export async function getSession() {
  const client = ensureSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function getProfile(userId) {
  const client = ensureSupabase();
  const { data, error } = await client
    .from("profiles")
    .select("id, nome, email, role, ativo, concurso_id, concursos(id, nome)")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email, password) {
  const client = ensureSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = ensureSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function redirectByRole(profile) {
  if (!profile) {
    window.location.href = "./login.html";
    return;
  }
  window.location.href = profile.role === "mentor" ? "./admin.html" : "./mentorado.html";
}
