import Image from 'next/image';
import Link from 'next/link';
import {
  HeartPulse,
  UserCog,
  Users,
  ClipboardList,
  Bell,
  ShieldCheck,
  Radio,
  ArrowRight,
  Sparkles,
  Zap,
} from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1F2937] selection:bg-[#4F9C8B]/20 selection:text-[#357366] relative overflow-hidden font-sans">
      {/* Background Ambient Glows */}
      <div className="absolute top-0 right-0 -z-10 w-[600px] h-[600px] bg-gradient-to-br from-[#4F9C8B]/10 via-[#EAF4F1]/30 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-[40%] -left-40 -z-10 w-[500px] h-[500px] bg-gradient-to-tr from-[#3B5C8A]/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Navigation */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#FAFAF8]/80 border-b border-gray-100/80 transition-all">
        <div className="flex items-center justify-between px-6 md:px-12 py-4 max-w-7xl mx-auto">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="p-2 rounded-xl bg-[#EAF4F1] text-[#4F9C8B] group-hover:scale-105 transition-transform duration-200">
              <HeartPulse className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1F2937]">
              Elder<span className="text-[#4F9C8B]">Link</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#roles" className="hover:text-[#4F9C8B] transition-colors">
              Roles
            </a>
            <a href="#features" className="hover:text-[#4F9C8B] transition-colors">
              Features
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-semibold text-[#1F2937] hover:text-[#4F9C8B] px-3 py-2 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-[#4F9C8B] text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-[#438a7a] hover:shadow-lg hover:shadow-[#4F9C8B]/20 active:scale-95 transition-all duration-200"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="px-6 md:px-12 pt-12 md:pt-20 pb-20 max-w-7xl mx-auto grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div>
          {/* Badge Tag */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EAF4F1] text-[#357366] text-xs font-semibold mb-6 border border-[#4F9C8B]/20 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#4F9C8B]" />
            <span>Next-Generation Senior Care Platform</span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.12] tracking-tight mb-6 text-[#1F2937]">
            Care home management,{' '}
            <span className="bg-gradient-to-r from-[#4F9C8B] to-[#357366] bg-clip-text text-transparent">
              without the chaos.
            </span>
          </h1>

          <p className="text-gray-600 text-lg leading-relaxed mb-8 max-w-lg">
            ElderLink helps care homes log daily care, manage staff, and notify
            families the moment something needs attention — all in one seamless place.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-4">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 bg-[#4F9C8B] text-white font-semibold px-7 py-3.5 rounded-full hover:bg-[#438a7a] hover:shadow-xl hover:shadow-[#4F9C8B]/25 active:scale-98 transition-all duration-200"
            >
              <span>Staff / Admin sign in</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <p className="text-sm text-gray-500">
            New here?{' '}
            <Link
              href="/signup"
              className="font-semibold text-[#4F9C8B] hover:text-[#357366] underline underline-offset-4 decoration-[#4F9C8B]/40 transition-colors"
            >
              Create an account
            </Link>
          </p>
        </div>

        {/* Hero Visual Column */}
        <div className="relative group">
          {/* Glow Frame behind Image */}
          <div className="absolute -inset-1 bg-gradient-to-r from-[#4F9C8B]/30 to-[#3B5C8A]/20 rounded-[2rem] blur-xl opacity-70 group-hover:opacity-100 transition duration-500" />

          <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-white/60 aspect-[4/5] max-w-md mx-auto md:max-w-none">
            <Image
              src="https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?auto=format&fit=crop&w=900&q=80"
              alt="Caregiver warmly holding senior resident's hand"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              priority
            />
            {/* Subtle Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </div>

          {/* Floating Stat Badge */}
          <div className="absolute -bottom-6 -left-4 sm:-left-6 bg-white/90 backdrop-blur-md rounded-2xl p-4 sm:p-5 shadow-xl border border-gray-100/80 flex items-center gap-4 hover:scale-105 transition-transform">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-emerald-600 animate-pulse" />
            </div>
            <div>
              <p className="text-[11px] font-bold tracking-wider text-gray-400 uppercase">
                Alert Response
              </p>
              <p className="text-2xl font-extrabold text-[#1F2937] tracking-tight">
                &lt; 3 sec
              </p>
            </div>
          </div>

          {/* Live Sync Badge */}
          <div className="absolute top-6 -right-4 sm:-right-6 bg-white/90 backdrop-blur-md rounded-2xl px-4 py-2.5 shadow-lg border border-gray-100/80 hidden sm:flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-xs font-semibold text-gray-700">Live Sync Active</span>
          </div>
        </div>
      </section>

      {/* Roles Section */}
      <section id="roles" className="px-6 md:px-12 py-24 bg-white/80 backdrop-blur-sm border-y border-gray-100 relative">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-14">
            <h2 className="text-3xl font-extrabold text-[#1F2937] tracking-tight mb-3">
              Built around three roles
            </h2>
            <p className="text-gray-600 text-base leading-relaxed">
              Each person sees only what's relevant to them the moment they sign in.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Admin */}
            <div className="group bg-[#FAFAF8] rounded-2xl p-8 border border-gray-200/70 hover:border-[#4F9C8B]/40 hover:shadow-xl hover:shadow-[#4F9C8B]/5 hover:-translate-y-1 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-[#EAF4F1] flex items-center justify-center mb-6 text-[#357366] group-hover:scale-110 transition-transform">
                <UserCog className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-[#1F2937]">Admin</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Manages resident profiles, staff accounts, and family contacts. Full visibility across the entire home.
              </p>
            </div>

            {/* Staff */}
            <div className="group bg-[#FAFAF8] rounded-2xl p-8 border border-gray-200/70 hover:border-[#8A6D3B]/40 hover:shadow-xl hover:shadow-[#8A6D3B]/5 hover:-translate-y-1 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-[#F3EEE6] flex items-center justify-center mb-6 text-[#8A6D3B] group-hover:scale-110 transition-transform">
                <ClipboardList className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-[#1F2937]">Staff</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Logs daily care — meals, mood, mobility, medication — in seconds from any device on shift.
              </p>
            </div>

            {/* Family */}
            <div className="group bg-[#FAFAF8] rounded-2xl p-8 border border-gray-200/70 hover:border-[#3B5C8A]/40 hover:shadow-xl hover:shadow-[#3B5C8A]/5 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
              <div className="w-12 h-12 rounded-xl bg-[#EEF2FA] flex items-center justify-center mb-6 text-[#3B5C8A] group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6" />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xl font-bold text-[#1F2937]">Family</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-200/60">
                  Coming Soon
                </span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                Checks in on their relative anytime — care updates and alerts, without needing to call the home.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="px-6 md:px-12 py-24 max-w-7xl mx-auto">
        <div className="max-w-2xl mb-14">
          <h2 className="text-3xl font-extrabold text-[#1F2937] tracking-tight mb-3">
            What ElderLink handles
          </h2>
          <p className="text-gray-600 text-base">
            Essential workflows streamlined into a clean, simple dashboard interface.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm hover:shadow-md hover:border-[#4F9C8B]/30 transition-all duration-200">
            <div className="w-10 h-10 rounded-lg bg-[#EAF4F1] flex items-center justify-center text-[#4F9C8B] mb-5">
              <Radio className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-[#1F2937] mb-2">Real-time care logs</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              Family and admin dashboards update live the moment staff log a new entry — no refresh needed.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm hover:shadow-md hover:border-[#4F9C8B]/30 transition-all duration-200">
            <div className="w-10 h-10 rounded-lg bg-[#EAF4F1] flex items-center justify-center text-[#4F9C8B] mb-5">
              <Bell className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-[#1F2937] mb-2">Emergency alerts</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              One tap notifies the primary family contact by SMS and every linked contact by email, dispatched within seconds.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-7 border border-gray-100 shadow-sm hover:shadow-md hover:border-[#4F9C8B]/30 transition-all duration-200">
            <div className="w-10 h-10 rounded-lg bg-[#EAF4F1] flex items-center justify-center text-[#4F9C8B] mb-5">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-[#1F2937] mb-2">Role-based access</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              Row-level security means each role only ever sees the data they're entitled to — nothing more.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200/80 bg-white py-10">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <HeartPulse className="w-5 h-5 text-[#4F9C8B]" />
            <span className="font-bold text-[#1F2937]">ElderLink</span>
          </div>
          <p className="text-xs text-gray-400">© 2026 ElderLink. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}