'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { HeartPulse, ShieldCheck, UserCog, Users, Globe, ChevronDown } from 'lucide-react';

type LangCode = 'en' | 'es' | 'hi' | 'fr' | 'de';

const LANGUAGES: { code: LangCode; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'hi', label: 'HI' },
  { code: 'fr', label: 'FR' },
  { code: 'de', label: 'DE' },
];

const content: Record<LangCode, {
  badge: string;
  headline1: string;
  headline2: string;
  subtitle: string;
  staffTitle: string;
  staffDesc: string;
  familyTitle: string;
  familyDesc: string;
  demo: string;
  alertBadge: string;
  alertTitle: string;
  residentsLabel: string;
  residentsCount: string;
  residentsSub: string;
  banner: string;
  bannerBtn: string;
  bannerBtnLoading: string;
}> = {
  en: {
    badge: 'PHASE 1 · SPAIN',
    headline1: 'Elder care,',
    headline2: 'managed calmly.',
    subtitle: 'ElderLink helps care homes in Spain log daily care, manage staff, and notify families in seconds.',
    staffTitle: 'Staff / Admin',
    staffDesc: 'Email and password',
    familyTitle: 'Family',
    familyDesc: 'Magic link, no password',
    demo: 'Demo: admin@elderlink.es / admin123 · maria@elderlink.es / staff123',
    alertBadge: '2 TAPS',
    alertTitle: 'Emergency alert',
    residentsLabel: 'ACTIVE RESIDENTS',
    residentsCount: '4',
    residentsSub: 'Demo loaded',
    banner: 'Frontend preview only. Please wake servers to enable backend functionality.',
    bannerBtn: 'Wake up servers',
    bannerBtnLoading: 'Waking...',
  },
  es: {
    badge: 'FASE 1 · ESPAÑA',
    headline1: 'Cuidado mayor,',
    headline2: 'gestionado con calma.',
    subtitle: 'ElderLink ayuda a residencias de mayores en España a registrar el cuidado diario, gestionar al personal y notificar a las familias en segundos.',
    staffTitle: 'Personal / Administrador',
    staffDesc: 'Correo y contraseña',
    familyTitle: 'Familia',
    familyDesc: 'Enlace mágico, sin contraseña',
    demo: 'Demo: admin@elderlink.es / admin123 · maria@elderlink.es / staff123',
    alertBadge: '2 TOQUES',
    alertTitle: 'Alerta de emergencia',
    residentsLabel: 'RESIDENTES ACTIVOS',
    residentsCount: '4',
    residentsSub: 'Demo cargado',
    banner: 'Solo vista previa del frontend. Activa los servidores para habilitar la funcionalidad del backend.',
    bannerBtn: 'Activar servidores',
    bannerBtnLoading: 'Activando...',
  },
  hi: {
    badge: 'चरण 1 · स्पेन',
    headline1: 'बुज़ुर्गों की देखभाल,',
    headline2: 'शांति से प्रबंधित।',
    subtitle: 'एल्डरलिंक स्पेन के केयर होम्स को दैनिक देखभाल दर्ज करने, स्टाफ़ प्रबंधित करने और परिवारों को सेकंडों में सूचित करने में मदद करता है।',
    staffTitle: 'स्टाफ़ / एडमिन',
    staffDesc: 'ईमेल और पासवर्ड',
    familyTitle: 'परिवार',
    familyDesc: 'मैजिक लिंक, बिना पासवर्ड',
    demo: 'डेमो: admin@elderlink.es / admin123 · maria@elderlink.es / staff123',
    alertBadge: '2 टैप',
    alertTitle: 'आपातकालीन अलर्ट',
    residentsLabel: 'सक्रिय निवासी',
    residentsCount: '4',
    residentsSub: 'डेमो लोड हुआ',
    banner: 'केवल फ्रंटएंड पूर्वावलोकन। बैकएंड कार्यक्षमता सक्षम करने के लिए सर्वर जगाएं।',
    bannerBtn: 'सर्वर जगाएं',
    bannerBtnLoading: 'जगा रहे हैं...',
  },
  fr: {
    badge: 'PHASE 1 · ESPAGNE',
    headline1: "Le soin des aînés,",
    headline2: 'géré en toute sérénité.',
    subtitle: 'ElderLink aide les maisons de retraite en Espagne à enregistrer les soins quotidiens, gérer le personnel et prévenir les familles en quelques secondes.',
    staffTitle: 'Personnel / Admin',
    staffDesc: 'E-mail et mot de passe',
    familyTitle: 'Famille',
    familyDesc: 'Lien magique, sans mot de passe',
    demo: 'Démo : admin@elderlink.es / admin123 · maria@elderlink.es / staff123',
    alertBadge: '2 TOUCHES',
    alertTitle: "Alerte d'urgence",
    residentsLabel: 'RÉSIDENTS ACTIFS',
    residentsCount: '4',
    residentsSub: 'Démo chargée',
    banner: 'Aperçu du frontend uniquement. Réveillez les serveurs pour activer le backend.',
    bannerBtn: 'Réveiller les serveurs',
    bannerBtnLoading: 'Réveil...',
  },
  de: {
    badge: 'PHASE 1 · SPANIEN',
    headline1: 'Seniorenpflege,',
    headline2: 'ruhig verwaltet.',
    subtitle: 'ElderLink hilft Pflegeheimen in Spanien, die tägliche Pflege zu dokumentieren, das Personal zu verwalten und Familien in Sekunden zu benachrichtigen.',
    staffTitle: 'Personal / Admin',
    staffDesc: 'E-Mail und Passwort',
    familyTitle: 'Familie',
    familyDesc: 'Magic Link, ohne Passwort',
    demo: 'Demo: admin@elderlink.es / admin123 · maria@elderlink.es / staff123',
    alertBadge: '2 TIPPS',
    alertTitle: 'Notfallalarm',
    residentsLabel: 'AKTIVE BEWOHNER',
    residentsCount: '4',
    residentsSub: 'Demo geladen',
    banner: 'Nur Frontend-Vorschau. Bitte Server aufwecken, um Backend-Funktionen zu aktivieren.',
    bannerBtn: 'Server aufwecken',
    bannerBtnLoading: 'Wecke auf...',
  },
};

export default function HomePage() {
  const [lang, setLang] = useState<LangCode>('en');
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [waking, setWaking] = useState(false);
  const [awake, setAwake] = useState(false);

  const t = content[lang];

  async function handleWakeServers() {
    setWaking(true);
    try {
      // Points at your own health-check route once you add one, e.g. /api/health.
      // Safe to leave as-is for now — it just won't find a route yet.
      await fetch('/api/health').catch(() => null);
    } finally {
      setTimeout(() => {
        setWaking(false);
        setAwake(true);
      }, 1200);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F6F1] text-[#1C2541]">
      {/* Header */}
      <header className="flex items-center justify-between px-8 md:px-16 py-6">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-[#DE7860]" />
          <span className="text-xl font-bold tracking-tight">ElderLink</span>
        </div>

        <div className="relative">
          <button
            onClick={() => setLangMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-4 py-2 text-sm font-medium shadow-sm hover:shadow transition"
          >
            <Globe className="w-4 h-4" />
            {LANGUAGES.find((l) => l.code === lang)?.label}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {langMenuOpen && (
            <div className="absolute right-0 mt-2 w-32 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLang(l.code);
                    setLangMenuOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                    l.code === lang ? 'font-semibold text-[#DE7860]' : ''
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="px-8 md:px-16 pb-10 grid md:grid-cols-2 gap-12 items-center max-w-7xl mx-auto">
        {/* Left column */}
        <div>
          <div className="inline-flex items-center gap-1.5 bg-[#FBEAE3] text-[#C1583B] text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t.badge}
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.05] mb-6">
            {t.headline1}
            <br />
            <span className="text-[#DE7860]">{t.headline2}</span>
          </h1>

          <p className="text-gray-600 text-lg leading-relaxed mb-8 max-w-md">
            {t.subtitle}
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <Link
              href="/login"
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-[#FBEAE3] flex items-center justify-center mb-3">
                <UserCog className="w-4.5 h-4.5 text-[#C1583B]" />
              </div>
              <p className="font-semibold text-sm leading-tight mb-1">{t.staffTitle}</p>
              <p className="text-xs text-gray-500">{t.staffDesc}</p>
            </Link>

            <Link
              href="/login"
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-[#E8EFE7] flex items-center justify-center mb-3">
                <Users className="w-4.5 h-4.5 text-[#5B7A5A]" />
              </div>
              <p className="font-semibold text-sm leading-tight mb-1">{t.familyTitle}</p>
              <p className="text-xs text-gray-500">{t.familyDesc}</p>
            </Link>
          </div>

          <p className="text-xs text-gray-400">{t.demo}</p>
        </div>

        {/* Right column — hero image */}
        <div className="relative">
          <div className="relative rounded-3xl overflow-hidden shadow-xl aspect-[4/5]">
            <Image
              src="/images/hero-villa.jpg"
              alt="Care home exterior"
              fill
              className="object-cover"
              priority
            />
          </div>

          {/* Floating alert badge */}
          <div className="absolute top-6 right-6 bg-[#D8654F] text-white rounded-2xl px-5 py-4 shadow-lg max-w-[180px]">
            <p className="text-[10px] font-semibold tracking-wide opacity-90 mb-1">{t.alertBadge}</p>
            <p className="text-sm font-bold leading-tight">{t.alertTitle}</p>
          </div>

          {/* Floating residents card */}
          <div className="absolute -bottom-6 left-6 bg-white rounded-2xl px-5 py-4 shadow-lg">
            <p className="text-[10px] font-semibold tracking-wide text-gray-500 mb-1">
              {t.residentsLabel}
            </p>
            <p className="text-3xl font-extrabold leading-none mb-1">{t.residentsCount}</p>
            <p className="text-xs text-gray-400">{t.residentsSub}</p>
          </div>
        </div>
      </main>

      {/* Bottom banner */}
      <div className="px-8 md:px-16 pb-8 max-w-7xl mx-auto">
        <div className="bg-[#1C2541] text-white rounded-2xl px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm">{t.banner}</p>
          <button
            onClick={handleWakeServers}
            disabled={waking}
            className={`text-sm font-semibold px-4 py-2 rounded-full transition ${
              awake
                ? 'bg-emerald-500 text-white'
                : 'bg-emerald-400 text-[#1C2541] hover:bg-emerald-300'
            } disabled:opacity-60`}
          >
            {waking ? t.bannerBtnLoading : awake ? '✓' : t.bannerBtn}
          </button>
        </div>
      </div>
    </div>
  );
}