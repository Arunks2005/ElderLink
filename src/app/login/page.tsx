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

      // Just confirm a matching profile row exists — no role check for now
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', signInData.user.id)
        .single();

      if (profileError || !profile) {
        setError('Could not find a matching profile.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      router.push('/admin/dashboard');
    } catch (err) {
      console.error('Login failed:', err);
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#3B4A54] flex items-center justify-center p-6">
      <div
        className={`w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-[#46565F] p-8 md:p-10 transition-all duration-700 ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="w-11 h-11 rounded-full bg-[#E8934A] flex items-center justify-center mb-6 transition-transform duration-500 hover:scale-110 hover:rotate-6">
          <HeartHandshake className="w-5 h-5 text-[#2F3B43]" strokeWidth={2.5} />
        </div>

        <h1 className="font-serif text-2xl text-[#F5F3EF] mb-1">Sign in</h1>
        <p className="text-sm text-[#AEBAC2] mb-8">
          Sign in with your ElderLink account.
        </p>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
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

          <div>
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
            disabled={loading}
            className="w-full bg-[#E8934A] text-[#2B2B2B] font-semibold py-3 rounded-full hover:bg-[#F0A25E] active:scale-[0.98] disabled:opacity-60 transition-all duration-200"
          >
            {loading ? 'Signing in…' : 'Sign in'}
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