'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, HeartHandshake, ShieldCheck, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  try {
    const str = JSON.stringify(err);
    return str && str !== '{}' ? str : 'Something went wrong. Please try again.';
  } catch {
    return 'Something went wrong. Please try again.';
  }
}

type Role = 'admin' | 'staff';

export default function SignupPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [role, setRole] = useState<Role>('staff');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleChange(field: keyof typeof formData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();

      const { error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName,
            phone_number: formData.phone,
            role,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message || getErrorMessage(signUpError));
        setLoading(false);
        return;
      }

      router.push('/login');
    } catch (err) {
      console.error('Signup failed:', err);
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }

  async function handleGoogleSignup() {
    setError('');
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) setError(oauthError.message || getErrorMessage(oauthError));
    } catch (err) {
      console.error('Google signup failed:', err);
      setError(getErrorMessage(err));
    }
  }

  const fields: {
    key: keyof typeof formData;
    label: string;
    type: string;
    placeholder: string;
    required?: boolean;
  }[] = [
    { key: 'fullName', label: 'Full name', type: 'text', placeholder: 'Jane Doe', required: true },
    { key: 'email', label: 'Email', type: 'email', placeholder: 'jane@example.com', required: true },
    { key: 'phone', label: 'Phone number', type: 'tel', placeholder: '+34 600 000 000' },
  ];

  return (
    <div className="min-h-screen bg-[#3B4A54] flex items-center justify-center p-6">
      <div
        className={`w-full max-w-4xl grid md:grid-cols-[0.85fr_1.15fr] rounded-3xl overflow-hidden shadow-2xl border border-white/10 transition-all duration-700 ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        {/* Left — brand panel */}
        <div className="hidden md:flex flex-col justify-between bg-[#2F3B43] p-10 relative overflow-hidden">
          <div
            className={`transition-all duration-700 delay-100 ease-out ${
              mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
            }`}
          >
            <div className="w-11 h-11 rounded-full bg-[#E8934A] flex items-center justify-center transition-transform duration-500 hover:scale-110 hover:rotate-6">
              <HeartHandshake className="w-5 h-5 text-[#2F3B43]" strokeWidth={2.5} />
            </div>
            <h2 className="font-serif text-3xl text-[#F5F3EF] mt-8 leading-tight">
              Care that stays
              <br />
              close, always.
            </h2>
            <p className="text-[#B9C4CB] text-sm mt-4 leading-relaxed max-w-xs">
              ElderLink keeps families and caregivers on the same page, with
              real-time updates on the people who matter most.
            </p>
          </div>

          <div
            className={`border-t border-white/10 pt-6 transition-all duration-700 delay-300 ease-out ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <p className="text-[#F5F3EF] text-sm leading-relaxed italic">
              &ldquo;I finally feel like I know what&rsquo;s happening with
              Mom&rsquo;s care, every day, not just at the doctor&rsquo;s
              visit.&rdquo;
            </p>
            <p className="text-[#8FA0A9] text-xs mt-3 uppercase tracking-wider">
              Family member, ElderLink user
            </p>
          </div>

          <div className="absolute -bottom-16 -right-16 w-48 h-48 bg-[#E8934A]/10 rounded-full blur-3xl transition-transform duration-1000" />
        </div>

        {/* Right — form */}
        <div className="bg-[#46565F] p-8 md:p-10">
          <h1 className="font-serif text-2xl text-[#F5F3EF] mb-1">
            Create your account
          </h1>
          <p className="text-sm text-[#AEBAC2] mb-6">
            Join ElderLink to stay connected with care updates.
          </p>

          {/* Role toggle — sliding segmented control */}
          <div className="relative bg-[#3B4A54] rounded-full p-1 flex mb-7">
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-[#E8934A] transition-transform duration-300 ease-out"
              style={{
                transform: role === 'staff' ? 'translateX(0%)' : 'translateX(calc(100% + 8px))',
              }}
            />
            <button
              type="button"
              onClick={() => setRole('staff')}
              className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-sm font-semibold transition-colors duration-300 ${
                role === 'staff' ? 'text-[#2B2B2B]' : 'text-[#C7D0D6]'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Staff
            </button>
            <button
              type="button"
              onClick={() => setRole('admin')}
              className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-sm font-semibold transition-colors duration-300 ${
                role === 'admin' ? 'text-[#2B2B2B]' : 'text-[#C7D0D6]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin
            </button>
          </div>

          <form onSubmit={handleSignup} className="space-y-5">
            {fields.map((field, i) => (
              <div
                key={field.key}
                className={`transition-all duration-500 ease-out ${
                  mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
                }`}
                style={{ transitionDelay: mounted ? `${150 + i * 80}ms` : '0ms' }}
              >
                <label className="text-xs font-semibold text-[#C7D0D6] tracking-wide">
                  {field.label}
                </label>
                <input
                  type={field.type}
                  required={field.required}
                  value={formData[field.key]}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="mt-1.5 w-full rounded-xl bg-[#F5F1EA] text-[#2B2B2B] placeholder:text-[#8A8378] border border-transparent focus:border-[#E8934A] focus:shadow-[0_0_0_3px_rgba(232,147,74,0.2)] outline-none py-2.5 px-3.5 text-sm transition-all duration-200"
                  placeholder={field.placeholder}
                />
              </div>
            ))}

            <div
              className={`transition-all duration-500 ease-out ${
                mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
              style={{ transitionDelay: mounted ? '390ms' : '0ms' }}
            >
              <label className="text-xs font-semibold text-[#C7D0D6] tracking-wide">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
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
              {loading ? 'Creating account…' : `Sign up as ${role === 'admin' ? 'Admin' : 'Staff'}`}
            </button>

            <button
              type="button"
              onClick={handleGoogleSignup}
              className="w-full border border-[#8FA0A9] text-[#F5F3EF] font-semibold py-3 rounded-full flex items-center justify-center gap-2 hover:bg-white/5 active:scale-[0.98] transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.81z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A11.998 11.998 0 0 0 12 24z"/>
                <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.27a12 12 0 0 0 0 10.75l4-3.11z"/>
                <path fill="#EA4335" d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l4 3.1C6.22 6.88 8.87 4.77 12 4.77z"/>
              </svg>
              Sign up with Google
            </button>
          </form>

          <p className="text-center text-sm text-[#AEBAC2] mt-6">
            Already have an account?{' '}
            <a href="/login" className="font-semibold text-[#E8934A] hover:underline">
              Log in
            </a>
          </p>
        </div>
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