import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    // PKCE flow: email confirmation links produce a ?code= param instead of a one-time
    // token URL. Safe Links (Outlook) can't consume the code because exchanging it
    // requires JavaScript — so the link survives Lancaster Uni's email scanner.
    flowType: 'pkce',
  },
});
