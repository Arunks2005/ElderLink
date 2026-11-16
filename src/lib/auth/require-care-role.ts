import { createClient } from "@/lib/supabase/server";

export type CareRole = "admin" | "staff";

type Ok = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  role: CareRole;
};
type Denied = { ok: false; response: Response };

/**
 * Server-side guard for API routes used by care staff.
 *
 * - Reads the signed-in user from the auth cookie (no service-role key).
 * - Confirms the user is in `admins` or `staff`. A family account or an
 *   anonymous caller gets 401/403.
 * - Returns a Supabase client that acts AS that user, so every later query
 *   is still filtered by the database's row-level security.
 */
export async function requireCareRole(): Promise<Ok | Denied> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { ok: false, response: Response.json({ error: "Server is missing Supabase configuration." }, { status: 500 }) };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { ok: false, response: Response.json({ error: "Please sign in." }, { status: 401 }) };
  }
  const userId = data.user.id;

  const { data: admin } = await supabase.from("admins").select("id").eq("id", userId).maybeSingle();
  if (admin) return { ok: true, supabase, userId, role: "admin" };

  const { data: staff } = await supabase.from("staff").select("id").eq("id", userId).maybeSingle();
  if (staff) return { ok: true, supabase, userId, role: "staff" };

  return { ok: false, response: Response.json({ error: "Care staff access only." }, { status: 403 }) };
}
