import Image from 'next/image';
import Link from 'next/link';
import { HeartPulse, UserCog, Users, ClipboardList, Bell, ShieldCheck, Radio } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1F2937]">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 md:px-16 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-[#4F9C8B]" />
          <span className="text-xl font-bold tracking-tight">ElderLink</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-500">
          <a href="#roles" className="hover:text-[#1F2937] transition">Roles</a>
          <a href="#features" className="hover:text-[#1F2937] transition">Features</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-semibold text-[#1F2937] hover:text-[#4F9C8B] transition"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="bg-[#4F9C8B] text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-[#438a7a] transition"
          >
            Sign up
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-8 md:px-16 pt-10 pb-20 max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 bg-[#EAF4F1] text-[#357366] text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <ShieldCheck className="w-3.5 h-3.5" />
            PHASE 1 · SPAIN
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold leading-[1.1] mb-6">
            Care home management,{' '}
            <span className="text-[#4F9C8B]">without the chaos.</span>
          </h1>

          <p className="text-gray-500 text-lg leading-relaxed mb-8 max-w-md">
            ElderLink helps care homes log daily care, manage staff, and notify
            families the moment something needs attention — all in one place.
          </p>

          <div className="flex flex-wrap gap-4 mb-3">
            <Link
              href="/login"
              className="bg-[#4F9C8B] text-white font-semibold px-6 py-3 rounded-full hover:bg-[#438a7a] transition"
            >
              Staff / Admin sign in
            </Link>
            <Link
              href="/login"
              className="bg-white border border-gray-200 font-semibold px-6 py-3 rounded-full hover:border-gray-300 transition"
            >
              Family portal
            </Link>
          </div>

          <p className="text-sm text-gray-500">
            New here?{' '}
            <Link href="/signup" className="font-semibold text-[#4F9C8B] hover:underline">
              Create an account
            </Link>
          </p>
        </div>

        <div className="relative">
          <div className="relative rounded-3xl overflow-hidden shadow-md aspect-[4/5]">
            <Image
              src="https://picsum.photos/seed/elderlink/900/1125"
              alt="Care home"
              fill
              className="object-cover"
              priority
            />
          </div>
          <div className="absolute -bottom-6 -left-6 bg-white rounded-2xl px-5 py-4 shadow-lg border border-gray-100">
            <p className="text-[10px] font-semibold tracking-wide text-gray-400 mb-1">
              ALERT RESPONSE
            </p>
            <p className="text-2xl font-extrabold leading-none">&lt; 3 sec</p>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="px-8 md:px-16 py-20 bg-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold mb-2">Built around three roles</h2>
          <p className="text-gray-500 mb-12 max-w-xl">
            Each person sees only what's relevant to them the moment they sign in.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-[#FAFAF8] rounded-2xl p-6 border border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-[#EAF4F1] flex items-center justify-center mb-4">
                <UserCog className="w-5 h-5 text-[#357366]" />
              </div>
              <h3 className="font-semibold mb-2">Admin</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Manages resident profiles, staff accounts, and family contacts.
                Full visibility across the home.
              </p>
            </div>

            <div className="bg-[#FAFAF8] rounded-2xl p-6 border border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-[#F3EEE6] flex items-center justify-center mb-4">
                <ClipboardList className="w-5 h-5 text-[#8A6D3B]" />
              </div>
              <h3 className="font-semibold mb-2">Staff</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Logs daily care — meals, mood, mobility, medication — in
                seconds from any device on shift.
              </p>
            </div>

            <div className="bg-[#FAFAF8] rounded-2xl p-6 border border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-[#EEF2FA] flex items-center justify-center mb-4">
                <Users className="w-5 h-5 text-[#3B5C8A]" />
              </div>
              <h3 className="font-semibold mb-2">Family</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Checks in on their relative anytime — care updates and alerts,
                without needing to call the home.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-8 md:px-16 py-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold mb-12">What ElderLink handles</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="flex gap-4">
              <Radio className="w-5 h-5 text-[#4F9C8B] shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Real-time care logs</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Family and admin dashboards update live the moment staff log
                  a new entry — no refresh needed.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <Bell className="w-5 h-5 text-[#4F9C8B] shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Emergency alerts</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  One tap notifies the primary family contact by SMS and every
                  linked contact by email, dispatched within seconds.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <ShieldCheck className="w-5 h-5 text-[#4F9C8B] shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Role-based access</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Row-level security means each role only ever sees the data
                  they're entitled to — nothing more.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 md:px-16 py-8 border-t border-gray-100 flex items-center justify-between text-sm text-gray-400 max-w-7xl mx-auto">
        <span>© 2026 ElderLink · Built for Sustainova Phase 1</span>
        <span>SDG 3 · 10 · 11</span>
      </footer>
    </div>
  );
}