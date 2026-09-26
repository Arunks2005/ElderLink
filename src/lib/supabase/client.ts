import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client. Safe to call anywhere in client components —
// it reads the public URL/anon key, which are meant to be exposed to the browser.
// Row Level Security on your tables is what actually keeps data safe, not these keys.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.local.example to .env.local and fill in your Supabase project values.'
    );
  }

  return createBrowserClient(url, anonKey);
}