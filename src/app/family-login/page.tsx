"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function FamilyLoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError("Unable to sign in. Please try again.");
        setLoading(false);
        return;
      }

      const { data: contact, error: contactError } = await supabase
        .from("family_contacts")
        .select("resident_id")
        .eq("profile_id", data.user.id)
        .maybeSingle();

      if (contactError) {
        console.error("FAMILY CONTACT ERROR:", contactError);

        await supabase.auth.signOut();

        setError(
          "Unable to find your family account connection. Please try again.",
        );
        setLoading(false);
        return;
      }

      if (!contact) {
        await supabase.auth.signOut();

        setError(
          "Your account is not linked to a resident yet. Please contact the care home.",
        );
        setLoading(false);
        return;
      }

      if (!contact.resident_id) {
        await supabase.auth.signOut();

        setError("No resident is linked to your family account.");
        setLoading(false);
        return;
      }

      router.push(`/family-portal/${contact.resident_id}`);
      router.refresh();
    } catch (err) {
      console.error("LOGIN ERROR:", err);

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
                  d="M3 10.5 12 3l9 7.5"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.5 9.5V21h13V9.5M9 21v-6h6v6"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-semibold text-gray-900">
              Family Portal
            </h1>

            <p className="mt-2 text-sm text-gray-500">
              Welcome back. Sign in to stay connected with your loved one.
            </p>
          </div>

          <form onSubmit={handleLogin} className="px-8 pb-8">
            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

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
                placeholder="Enter your email"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20"
              />
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700"
                >
                  Password
                </label>

                <Link
                  href="/family-login/forgot-password"
                  className="text-xs font-medium text-[#357366] hover:text-[#2b5d52]"
                >
                  Forgot password?
                </Link>
              </div>

              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#357366] py-3.5 text-sm font-semibold text-white transition hover:bg-[#2d6258] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>

            <div className="mt-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-100" />
              <span className="text-xs text-gray-400">or</span>
              <div className="h-px flex-1 bg-gray-100" />
            </div>

            <p className="mt-6 text-center text-sm text-gray-500">
              Don't have a family account?{" "}
              <Link
                href="/family-signup"
                className="font-semibold text-[#357366] hover:text-[#2b5d52]"
              >
                Create one
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
