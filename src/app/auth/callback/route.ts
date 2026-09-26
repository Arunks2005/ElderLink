import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const next = searchParams.get('next') ?? '/login';
  // 'signup' when the person clicked "Sign up with Google", 'login' (or
  // absent) when they clicked "Sign in with Google". See app/login/page.tsx.
  const flow = searchParams.get('flow') === 'signup' ? 'signup' : 'login';

  // Google/Supabase sometimes redirect back with an error instead of a code
  // (e.g. user cancelled consent, misconfigured redirect URI)
  if (errorParam) {
    console.error('OAuth provider returned an error:', errorParam, errorDescription);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription || errorParam)}`
    );
  }

  // Also handles the email-confirmation link sent after a password signup:
  // that link points back here too, so a session gets created either way.
  if (!code) {
    console.error('No code or error param present in callback URL');
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data: exchangeData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !exchangeData.user) {
    console.error('exchangeCodeForSession failed:', exchangeError?.message);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const userId = exchangeData.user.id;
  const userEmail = exchangeData.user.email;

  // Same admin-then-staff lookup the login page does after a password
  // sign-in, so a returning Google user lands on the right dashboard.
  const { data: adminRow, error: adminError } = await supabase
    .from('admins')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (adminError) {
    console.error('Admin lookup failed:', adminError);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  if (adminRow) {
    return NextResponse.redirect(`${origin}/admin/dashboard`);
  }

  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (staffError) {
    console.error('Staff lookup failed:', staffError);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  if (staffRow) {
    return NextResponse.redirect(`${origin}/staff/dashboard`);
  }

  // No admin/staff row yet. Only auto-create one if this was a *signup*
  // click — a plain Google *login* with no matching account should not
  // silently create one, since a login has no role to assign.
  if (flow === 'signup') {
    const { error: insertError } = await supabase
      .from('staff')
      .insert({ id: userId, email: userEmail });

    if (insertError) {
      console.error('Staff row creation failed:', insertError);
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=account_setup_failed`);
    }

    return NextResponse.redirect(`${origin}/staff/dashboard`);
  }

  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/login?error=no_account&next=${encodeURIComponent(next)}`);
}