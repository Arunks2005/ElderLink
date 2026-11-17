/**
 * The signed-in carer (staff or admin) with a display name, for stamping
 * "who responded" on fall alerts and help requests.
 */

import type { createClient } from "@/lib/supabase/client";

type Client = ReturnType<typeof createClient>;

export type Me = { id: string; name: string; role: "staff" | "admin" | null };

let cache: { userId: string; me: Promise<Me> } | null = null;

export async function getMe(supabase: Client): Promise<Me | null> {
  const { data } = await supabase.auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  if (cache?.userId === u.id) return cache.me;
  const me = (async (): Promise<Me> => {
    const [s, a] = await Promise.all([
      supabase.from("staff").select("full_name").eq("id", u.id).maybeSingle(),
      supabase.from("admins").select("full_name").eq("id", u.id).maybeSingle(),
    ]);
    return {
      id: u.id,
      name: s.data?.full_name || a.data?.full_name || u.email?.split("@")[0] || "Staff",
      role: a.data ? "admin" : s.data ? "staff" : null,
    };
  })();
  cache = { userId: u.id, me };
  return me;
}
