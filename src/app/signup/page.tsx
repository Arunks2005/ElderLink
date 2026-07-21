'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type FieldName = 'fullName' | 'email' | 'phone' | 'password' | null;

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [focusField, setFocusField] = useState<FieldName>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // How far the eyes shift based on which field is active
  const eyeOffset: Record<string, number> = {
    fullName: -6,
    email: 0,
    phone: 6,
    password: 0,
  };
  const currentOffset = focusField ? eyeOffset[focusField] ?? 0 : 0;

  const isPasswordFocused = focusField === 'password';
  const isTypingSomething =
    formData.fullName.length > 0 ||
    (formData.email.length > 3 && formData.email.includes('@'));

  function handleChange(field: keyof typeof formData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          full_name: formData.fullName,
          phone_number: formData.phone,
          role: 'family', // default role for public signup
        },
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    router.push('/login');
  }

  async function handleGoogleSignup() {
    setError('');
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <div className="min-h-screen bg-[#EDEBE8] flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden flex w-full max-w-4xl">
        {/* Left — reactive character panel */}
        <div className="hidden md:flex flex-1 bg-[#F0EEEA] relative items-center justify-center overflow-hidden">
          <div className="relative w-48 h-64">
            {/* Body */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-48 bg-[#2B2B2B] rounded-[28px]" />

            {/* Eyes */}
            <div className="absolute top-16 left-1/2 -translate-x-1/2 flex gap-6 z-10">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="w-6 h-6 bg-white rounded-full flex items-center justify-center overflow-hidden"
                >
                  <div
                    className="w-3 h-3 bg-[#2B2B2B] rounded-full transition-transform duration-300 ease-out"
                    style={{ transform: `translateX(${currentOffset}px)` }}
                  />
                </div>
              ))}
            </div>

            {/* Mouth — flat vs smile */}
            <div
              className={`absolute top-28 left-1/2 -translate-x-1/2 bg-[#2B2B2B] transition-all duration-300 ease-out ${
                isTypingSomething
                  ? 'w-8 h-4 rounded-b-full'
                  : 'w-6 h-[3px] rounded-full'
              }`}
            />

            {/* Hands covering eyes when password is focused */}
            <div
              className="absolute top-14 left-1/2 -translate-x-1/2 flex gap-1 z-20 transition-transform duration-300 ease-out"
              style={{
                transform: isPasswordFocused
                  ? showPassword
                    ? 'translateY(4px)' // peeking through fingers
                    : 'translateY(-2px)' // fully covering
                  : 'translateY(-60px)', // hidden above, out of the way
              }}
            >
              <div className="w-8 h-8 bg-[#F4B942] rounded-full -rotate-12" />
              <div className="w-8 h-8 bg-[#F4B942] rounded-full rotate-12" />
            </div>

            {/* Background accent blobs, subtle parallax with eyes */}
            <div
              className="absolute -left-6 top-4 w-16 h-32 bg-[#6C5CE7] rounded-2xl -z-10 transition-transform duration-500"
              style={{ transform: `translateX(${currentOffset * 0.3}px)` }}
            />
            <div
              className="absolute -right-4 bottom-0 w-20 h-20 bg-[#E8734A] rounded-t-full -z-10 transition-transform duration-500"
              style={{ transform: `translateX(${currentOffset * -0.3}px)` }}
            />
          </div>
        </div>

        {/* Right — form */}
        <div className="flex-1 p-10">
          <h1 className="text-2xl font-bold mb-1">Create your account</h1>
          <p className="text-sm text-gray-500 mb-8">
            Join ElderLink to stay connected with care updates.
          </p>

          <form onSubmit={handleSignup} className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-gray-500">Full name</label>
              <input
                type="text"
                required
                value={formData.fullName}
                onChange={(e) => handleChange('fullName', e.target.value)}
                onFocus={() => setFocusField('fullName')}
                onBlur={() => setFocusField(null)}
                className="w-full border-b border-gray-300 focus:border-[#2B2B2B] outline-none py-2 text-sm transition-colors"
                placeholder="Jane Doe"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                onFocus={() => setFocusField('email')}
                onBlur={() => setFocusField(null)}
                className="w-full border-b border-gray-300 focus:border-[#2B2B2B] outline-none py-2 text-sm transition-colors"
                placeholder="jane@example.com"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500">Phone number</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                onFocus={() => setFocusField('phone')}
                onBlur={() => setFocusField(null)}
                className="w-full border-b border-gray-300 focus:border-[#2B2B2B] outline-none py-2 text-sm transition-colors"
                placeholder="+34 600 000 000"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  onFocus={() => setFocusField('password')}
                  onBlur={() => setFocusField(null)}
                  className="w-full border-b border-gray-300 focus:border-[#2B2B2B] outline-none py-2 text-sm pr-8 transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#2B2B2B] text-white font-semibold py-3 rounded-full hover:bg-black transition disabled:opacity-60"
            >
              {loading ? 'Creating account...' : 'Sign up'}
            </button>

            <button
              type="button"
              onClick={handleGoogleSignup}
              className="w-full border border-gray-300 font-semibold py-3 rounded-full flex items-center justify-center gap-2 hover:border-gray-400 transition"
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

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <a href="/login" className="font-semibold text-[#2B2B2B]">
              Log in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}