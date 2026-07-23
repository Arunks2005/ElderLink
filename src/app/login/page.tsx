'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, HeartHandshake } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();

      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', signInData.user.id)
        .single();

      if (profileError || !profile) {
        setError('Could not find a matching profile.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      if (profile.role === 'admin') {
        router.push('/admin/dashboard');
      } else if (profile.role === 'staff') {
        router.push('/staff/dashboard');
      } else {
        setError('This account role is not supported for sign in yet.');
        await supabase.auth.signOut();
        setLoading(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setGoogleLoading(true);
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setGoogleLoading(false);
      }
      // On success, the browser redirects away — no need to reset loading here
    } catch (err) {
      console.error('Google login failed:', err);
      setError(getErrorMessage(err));
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#3B4A54] flex items-center justify-center p-6">
      <div
        className={`w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-[#46565F] p-8 md:p-10 transition-all duration-700 ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div
          className={`transition-all duration-500 ease-out ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          <div className="w-11 h-11 rounded-full bg-[#E8934A] flex items-center justify-center mb-6 transition-transform duration-500 hover:scale-110 hover:rotate-6">
            <HeartHandshake className="w-5 h-5 text-[#2F3B43]" strokeWidth={2.5} />
          </div>

          <h1 className="font-serif text-2xl text-[#F5F3EF] mb-1">Sign in</h1>
          <p className="text-sm text-[#AEBAC2] mb-8">
            Sign in with your ElderLink account.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div
            className={`transition-all duration-500 ease-out ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
            style={{ transitionDelay: mounted ? '120ms' : '0ms' }}
          >
            <label className="text-xs font-semibold text-[#C7D0D6] tracking-wide">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-[#F5F1EA] text-[#2B2B2B] placeholder:text-[#8A8378] border border-transparent focus:border-[#E8934A] focus:shadow-[0_0_0_3px_rgba(232,147,74,0.2)] outline-none py-2.5 px-3.5 text-sm transition-all duration-200"
              placeholder="you@example.com"
            />
          </div>

          <div
            className={`transition-all duration-500 ease-out ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
            style={{ transitionDelay: mounted ? '200ms' : '0ms' }}
          >
            <label className="text-xs font-semibold text-[#C7D0D6] tracking-wide">
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl bg-[#F5F1EA] text-[#2B2B2B] placeholder:text-[#8A8378] border border-transparent focus:border-[#E8934A] focus:shadow-[0_0_0_3px_rgba(232,147,74,0.2)] outline-none py-2.5 pl-3.5 pr-10 text-sm transition-all duration-200"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8378] hover:text-[#2B2B2B] transition-transform duration-200 hover:scale-110"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-[#FF9E8A] bg-[#3B2A28] border border-[#5A3B37] rounded-lg px-3 py-2 animate-[fadeSlideDown_0.3s_ease-out]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || googleLoading}
            className="w-full bg-[#E8934A] text-[#2B2B2B] font-semibold py-3 rounded-full hover:bg-[#F0A25E] active:scale-[0.98] disabled:opacity-60 transition-all duration-200"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-[#8FA0A9]">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading || googleLoading}
            className="w-full border border-[#8FA0A9] text-[#F5F3EF] font-semibold py-3 rounded-full flex items-center justify-center gap-2 hover:bg-white/5 active:scale-[0.98] disabled:opacity-60 transition-all duration-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.81z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A11.998 11.998 0 0 0 12 24z"/>
              <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.27a12 12 0 0 0 0 10.75l4-3.11z"/>
              <path fill="#EA4335" d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l4 3.1C6.22 6.88 8.87 4.77 12 4.77z"/>
            </svg>
            {googleLoading ? 'Redirecting…' : 'Sign in with Google'}
          </button>
        </form>

        <p className="text-center text-sm text-[#AEBAC2] mt-6">
          Don&rsquo;t have an account?{' '}
          <a href="/signup" className="font-semibold text-[#E8934A] hover:underline">
            Sign up
          </a>
        </p>
      </div>

      <style jsx global>{`
        @keyframes fadeSlideDown {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}