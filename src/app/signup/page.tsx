'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, HeartHandshake, ChevronDown, ShieldCheck, ClipboardList, Check, MailCheck } from 'lucide-react';
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

// Supabase doesn't always give a clean "duplicate email" error message —
// this normalizes the common variants into something readable.
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user already registered')) {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (m.includes('password') && m.includes('character')) {
    return 'Password must be at least 6 characters.';
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'Please enter a valid email address.';
  }
  return message;
}

type Role = 'admin' | 'staff';

const ROLE_OPTIONS: { value: Role; label: string; description: string; icon: typeof ShieldCheck }[] = [
  { value: 'staff', label: 'Staff', description: 'Log daily care and updates', icon: ClipboardList },
  { value: 'admin', label: 'Admin', description: 'Manage residents and staff', icon: ShieldCheck },
];

export default function SignupPage() {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [role, setRole] = useState<Role>('staff');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  // Shown after a successful signup that requires email confirmation.
  // Supabase returns a user with an empty identities[] array when the
  // account already existed but wasn't confirmed, so we still need to
  // branch on that instead of trusting "no error" alone.
  const [signupComplete, setSignupComplete] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

      // Trim inputs so stray whitespace doesn't create a mismatched/duplicate account
      const email = formData.email.trim().toLowerCase();
      const fullName = formData.fullName.trim();
      const phone = formData.phone.trim();

      if (!fullName || !email || !formData.password) {
        setError('Please fill in all required fields.');
        setLoading(false);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password: formData.password,
        options: {
          // These three keys land in auth.users.raw_user_meta_data and are
          // read by the handle_new_user() trigger to create the matching
          // row in admins or staff. Keep these key names in sync with the
          // trigger (full_name, phone_number, role).
          data: {
            full_name: fullName,
            phone_number: phone,
            role,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        setError(friendlyAuthError(signUpError.message || getErrorMessage(signUpError)));
        setLoading(false);
        return;
      }

      // Supabase quirk: if the email already exists but is unconfirmed,
      // signUp() can return success with no error but an empty identities
      // array instead of throwing. Catch that case explicitly.
      if (data?.user && data.user.identities && data.user.identities.length === 0) {
        setError('An account with this email already exists. Try logging in instead.');
        setLoading(false);
        return;
      }

      // If email confirmation is required, there's no active session yet —
      // show a confirmation screen instead of redirecting to /login, where
      // they'd otherwise just hit "invalid credentials" until they confirm.
      if (data?.user && !data.session) {
        setSignupComplete(true);
        setLoading(false);
        return;
      }

      // Email confirmation is off and a session was created immediately.
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
          // Google signups skip this form, so the role/full_name metadata
          // never gets set here — pass role through as a query param and
          // read it in your /auth/callback route to insert into admins/staff
          // there instead. Adjust the callback route accordingly.
          queryParams: { role },
        },
      });
      if (oauthError) setError(friendlyAuthError(oauthError.message || getErrorMessage(oauthError)));
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

  const selectedRole = ROLE_OPTIONS.find((r) => r.value === role)!;

  // Post-signup confirmation screen
  if (signupComplete) {
    return (
      <div className="min-h-screen bg-[#3B4A54] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-[#46565F] p-10 text-center shadow-2xl border border-white/10">
          <div className="w-14 h-14 rounded-full bg-[#E8934A]/15 flex items-center justify-center mx-auto mb-5">
            <MailCheck className="w-6 h-6 text-[#E8934A]" />
          </div>
          <h1 className="font-serif text-2xl text-[#F5F3EF] mb-2">Check your email</h1>
          <p className="text-sm text-[#AEBAC2] leading-relaxed mb-6">
            We sent a confirmation link to <span className="text-[#F5F3EF] font-semibold">{formData.email}</span>.
            Confirm your account to sign in as {selectedRole.label.toLowerCase()}.
          </p>
          <a
            href="/login"
            className="inline-block w-full bg-[#E8934A] text-[#2B2B2B] font-semibold py-3 rounded-full hover:bg-[#F0A25E] active:scale-[0.98] transition-all duration-200"
          >
            Back to login
          </a>
        </div>
      </div>
    );
  }

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

          {/* Role dropdown */}
          <div ref={dropdownRef} className="relative mb-6">
            <label className="text-xs font-semibold text-[#C7D0D6] tracking-wide mb-1.5 block">
              I'm signing up as
            </label>
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="w-full flex items-center justify-between rounded-xl bg-[#F5F1EA] px-3.5 py-2.5 text-sm border border-transparent hover:border-[#E8934A]/40 transition-all duration-200"
            >
              <span className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-[#E8934A]/15 flex items-center justify-center">
                  <selectedRole.icon className="w-3.5 h-3.5 text-[#C1701F]" />
                </span>
                <span className="text-left">
                  <span className="block font-semibold text-[#2B2B2B]">{selectedRole.label}</span>
                </span>
              </span>
              <ChevronDown
                className={`w-4 h-4 text-[#8A8378] transition-transform duration-200 ${
                  dropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {dropdownOpen && (
              <div className="absolute z-20 top-full mt-2 w-full bg-[#F5F1EA] rounded-xl shadow-xl border border-black/5 overflow-hidden animate-[dropIn_0.18s_ease-out]">
                {ROLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setRole(option.value);
                      setDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 hover:bg-black/5 transition-colors duration-150 text-left"
                  >
                    <span className="w-8 h-8 rounded-lg bg-[#E8934A]/15 flex items-center justify-center shrink-0">
                      <option.icon className="w-4 h-4 text-[#C1701F]" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-[#2B2B2B]">{option.label}</span>
                      <span className="block text-xs text-[#8A8378]">{option.description}</span>
                    </span>
                    {role === option.value && <Check className="w-4 h-4 text-[#C1701F]" />}
                  </button>
                ))}
              </div>
            )}
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
              {loading ? 'Creating account…' : `Sign up as ${selectedRole.label}`}
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
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes dropIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}