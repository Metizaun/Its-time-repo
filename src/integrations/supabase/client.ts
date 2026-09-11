import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const isLocalSupabase = SUPABASE_URL?.includes("127.0.0.1:55321") || SUPABASE_URL?.includes("localhost:55321");
const SUPABASE_ANON_KEY = (isLocalSupabase
  ? import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL
  : import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (for example in .env.local)."
  );
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: {
    schema: 'crm'
  },
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
