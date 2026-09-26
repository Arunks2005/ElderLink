"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function FamilySignupPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const supabase = createClient();

    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role: "family",
          },
        },
      });

      if (signupError) {
        setError(signupError.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError("Account could not be created.");
        setLoading(false);
        return;
      }

      /*
       * If email confirmation is enabled,
       * the user will not have a session yet.
       */
      if (!data.session) {
        setSuccess(
          "Account created! Please check your email and confirm your account, then log in.",
        );
        setLoading(false);
        return;
      }

      /*
       * Connect this Auth account to the existing
       * family_contacts record using the email.
       */
      const { data: claimedResidents, error: claimError } = await supabase.rpc(
        "claim_family_contact",
      );

      if (claimError) {
        await supabase.auth.signOut();
        setError("Account created, but we could not link your family account.");
        setLoading(false);
        return;
      }

      if (!claimedResidents || claimedResidents.length === 0) {
        await supabase.auth.signOut();

        setError(
          "No family contact was found for this email address. Please contact the care facility.",
        );

        setLoading(false);
        return;
      }

      const residentId = claimedResidents[0].resident_id;

      router.push(`/family-portal/${residentId}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#EAF4F1] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-8 pt-10 pb-8 text-center">
            <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-[#EAF4F1] flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[#357366]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
                />
                <circle cx="9" cy="7" r="4" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 8v6M22 11h-6"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-semibold text-gray-900">
              Create Family Account
            </h1>

            <p className="mt-2 text-sm text-gray-500">
              Stay connected with your loved one.
            </p>
          </div>

          <form onSubmit={handleSignup} className="px-8 pb-8">
            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            )}

            <div className="mb-5">
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Full name
              </label>

              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                required
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20"
              />
            </div>

            <div className="mb-5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email address
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your registered family email"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20"
              />

              <p className="mt-2 text-xs text-gray-400">
                Use the email registered with the care facility.
              </p>
            </div>

            <div className="mb-5">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password
              </label>

              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-20 text-sm text-gray-900 outline-none transition focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2 text-xs font-medium text-gray-500 hover:text-[#357366]"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div className="mb-6">
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Confirm password
              </label>

              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                autoComplete="new-password"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#357366] py-3.5 text-sm font-semibold text-white transition hover:bg-[#2d6258] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>

            <p className="mt-6 text-center text-sm text-gray-500">
              Already have an account?{" "}
              <Link
                href="/family-login"
                className="font-semibold text-[#357366] hover:text-[#2b5d52]"
              >
                Sign in
              </Link>
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Your family's information is private and protected.
        </p>
      </div>
    </main>
  );
}
