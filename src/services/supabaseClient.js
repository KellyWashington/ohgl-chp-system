export const SUPABASE_URL = window.OHGL_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = window.OHGL_SUPABASE_ANON_KEY || '';

export const sb = SUPABASE_URL && SUPABASE_ANON_KEY
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export async function requireSupabase() {
  if (!sb) {
    throw new Error('Supabase is not configured. Set window.OHGL_SUPABASE_URL and window.OHGL_SUPABASE_ANON_KEY before this script.');
  }
}
