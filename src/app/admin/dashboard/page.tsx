'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  Bell,
  HeartHandshake,
  Loader2,
  ChevronRight,
  Phone,
  Mail,
  UserCircle,
  Clock,
  MapPin,
  Briefcase,
  ShieldCheck,
  Activity,
  TrendingUp,
  Calendar,
  Star,
  AlertCircle,
  CheckCircle2,
  UserCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────
type ResidentStatus = 'active' | 'discharged' | 'deceased';
type StaffStatus = 'active' | 'on_leave' | 'inactive';
type Tab = 'overview' | 'residents' | 'family' | 'staff';

interface Resident {
  id: string;
  full_name: string;
  dob: string | null;
  address: string | null;
  room_number: string | null;
  photo_url: string | null;
  medical_notes: string | null;
  dietary_needs: string | null;
  status: ResidentStatus;
  created_at: string;
}

interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  phone_number: string;
  created_at: string;
}

interface StaffDetails {
  id: string;
  room_no_assigned: string | null;
  shift_start: string | null;
  shift_end: string | null;
  position: string | null;
  department: string | null;
  status: StaffStatus;
  phone_verified: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

interface FamilyContact {
  id: string;
  resident_id: string;
  full_name: string;
  relationship: string | null;
  phone: string;
  email: string | null;
  is_primary: boolean;
  resident_name?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const emptyResidentForm = {
  full_name: '',
  dob: '',
  address: '',
  room_number: '',
  medical_notes: '',
  dietary_needs: '',
  status: 'active' as ResidentStatus,
};

const emptyStaffForm = {
  full_name: '',
  email: '',
  phone_number: '',
  room_no_assigned: '',
  shift_start: '',
  shift_end: '',
  position: '',
  department: '',
  status: 'active' as StaffStatus,
  phone_verified: false,
  notes: '',
};

const emptyContactForm = {
  resident_id: '',
  full_name: '',
  relationship: '',
  phone: '',
  email: '',
  is_primary: false,
};

const NAV_ITEMS: { id: Tab; label: string; icon: typeof LayoutDashboard; desc: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, desc: 'Dashboard & stats' },
  { id: 'residents', label: 'Residents', icon: Users, desc: 'Resident profiles' },
  { id: 'family', label: 'Family', icon: UserCircle, desc: 'Emergency contacts' },
  { id: 'staff', label: 'Staff', icon: ClipboardList, desc: 'Team management' },
];

// Reusable input field classes to guarantee visible fonts across all browsers/themes
const INPUT_CLASS =
  'w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 font-semibold placeholder:text-gray-400 placeholder:font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all text-sm';
const SELECT_CLASS =
  'w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 font-semibold outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all text-sm';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getAge(dob: string | null) {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function formatTime(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-rose-500 to-pink-600',
  'from-indigo-500 to-blue-600',
];

function getAvatarColor(id: string) {
  const code = (id || 'a').charCodeAt(0) + ((id || 'a').charCodeAt(1) || 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>('overview');
  const [mounted, setMounted] = useState(false);

  // Residents state
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [residentSearch, setResidentSearch] = useState('');
  const [showResidentModal, setShowResidentModal] = useState(false);
  const [residentModalClosing, setResidentModalClosing] = useState(false);
  const [editingResidentId, setEditingResidentId] = useState<string | null>(null);
  const [residentForm, setResidentForm] = useState(emptyResidentForm);
  const [residentSaving, setResidentSaving] = useState(false);
  const [residentError, setResidentError] = useState('');
  const [residentView, setResidentView] = useState<'grid' | 'table'>('grid');

  // Staff state
  const [staffList, setStaffList] = useState<(StaffMember & StaffDetails)[]>([]);
  const [pendingStaff, setPendingStaff] = useState<StaffMember[]>([]);
  const [isNewAssignment, setIsNewAssignment] = useState(false);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffSearch, setStaffSearch] = useState('');
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffModalClosing, setStaffModalClosing] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError, setStaffError] = useState('');

  // Family contacts state
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState('');
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactModalClosing, setContactModalClosing] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState(emptyContactForm);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState('');

  // Stats
  const [stats, setStats] = useState({
    totalResidents: 0,
    activeResidents: 0,
    totalStaff: 0,
    familyContacts: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchResidents = useCallback(async () => {
    setResidentsLoading(true);
    const { data } = await supabase.from('residents').select('*').order('created_at', { ascending: false });
    setResidents((data as Resident[]) || []);
    setResidentsLoading(false);
  }, [supabase]);

  const fetchStaff = useCallback(async () => {
    setStaffLoading(true);
    const { data, error } = await supabase
      .from('staff')
      .select('*, staff_details(*)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching staff details:', error);
      setStaffLoading(false);
      return;
    }

    const all = (data as any[]) || [];
    const assigned: (StaffMember & StaffDetails)[] = [];
    const pending: StaffMember[] = [];

    all.forEach((s) => {
      const details = Array.isArray(s.staff_details)
        ? s.staff_details[0]
        : s.staff_details;

      if (details && typeof details === 'object' && Object.keys(details).length > 0) {
        assigned.push({
          ...s,
          ...details,
          id: s.id,
        });
      } else {
        pending.push(s);
      }
    });

    setStaffList(assigned);
    setPendingStaff(pending);
    setStaffLoading(false);
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    setContactsLoading(true);
    const { data } = await supabase
      .from('family_contacts')
      .select('*, residents(full_name)')
      .order('full_name');
    const mapped = (data || []).map((c: any) => ({
      ...c,
      resident_name: c.residents?.full_name ?? 'Unknown',
    }));
    setContacts(mapped);
    setContactsLoading(false);
  }, [supabase]);

  const fetchStats = useCallback(async () => {
    const [r, a, s, f] = await Promise.all([
      supabase.from('residents').select('id', { count: 'exact', head: true }),
      supabase.from('residents').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('staff').select('id', { count: 'exact', head: true }),
      supabase.from('family_contacts').select('id', { count: 'exact', head: true }),
    ]);
    setStats({
      totalResidents: r.count ?? 0,
      activeResidents: a.count ?? 0,
      totalStaff: s.count ?? 0,
      familyContacts: f.count ?? 0,
    });
  }, [supabase]);

  useEffect(() => {
    fetchResidents();
    fetchStaff();
    fetchContacts();
    fetchStats();
  }, [fetchResidents, fetchStaff, fetchContacts, fetchStats]);

  // ── Resident helpers ───────────────────────────────────────────────────────
  function openAddResident() {
    setEditingResidentId(null);
    setResidentForm(emptyResidentForm);
    setResidentError('');
    setResidentModalClosing(false);
    setShowResidentModal(true);
  }

  function openEditResident(r: Resident) {
    setEditingResidentId(r.id);
    setResidentForm({
      full_name: r.full_name,
      dob: r.dob ?? '',
      address: r.address ?? '',
      room_number: r.room_number ?? '',
      medical_notes: r.medical_notes ?? '',
      dietary_needs: r.dietary_needs ?? '',
      status: r.status,
    });
    setResidentError('');
    setResidentModalClosing(false);
    setShowResidentModal(true);
  }

  function closeResidentModal() {
    setResidentModalClosing(true);
    setTimeout(() => {
      setShowResidentModal(false);
      setResidentModalClosing(false);
    }, 200);
  }

  async function handleSaveResident(e: React.FormEvent) {
    e.preventDefault();
    setResidentSaving(true);
    setResidentError('');
    const payload = {
      full_name: residentForm.full_name,
      dob: residentForm.dob || null,
      address: residentForm.address || null,
      room_number: residentForm.room_number || null,
      medical_notes: residentForm.medical_notes || null,
      dietary_needs: residentForm.dietary_needs || null,
      status: residentForm.status,
    };
    const { error } = editingResidentId
      ? await supabase.from('residents').update(payload).eq('id', editingResidentId)
      : await supabase.from('residents').insert(payload);
    setResidentSaving(false);
    if (error) {
      setResidentError(error.message);
      return;
    }
    closeResidentModal();
    fetchResidents();
    fetchStats();
  }

  async function handleDeleteResident(id: string) {
    if (!confirm('Remove this resident? This cannot be undone.')) return;
    await supabase.from('residents').delete().eq('id', id);
    fetchResidents();
    fetchStats();
  }

  // ── Staff helpers ──────────────────────────────────────────────────────────
  function openAssignStaff(s: StaffMember) {
    setIsNewAssignment(true);
    setEditingStaffId(s.id);
    setStaffForm({
      ...emptyStaffForm,
      full_name: s.full_name,
      email: s.email,
      phone_number: s.phone_number || '',
    });
    setStaffError('');
    setStaffModalClosing(false);
    setShowStaffModal(true);
  }

  function openEditStaff(s: StaffMember & StaffDetails) {
    setIsNewAssignment(false);
    setEditingStaffId(s.id);
    setStaffForm({
      full_name: s.full_name,
      email: s.email,
      phone_number: s.phone_number || '',
      room_no_assigned: s.room_no_assigned ?? '',
      shift_start: s.shift_start ?? '',
      shift_end: s.shift_end ?? '',
      position: s.position ?? '',
      department: s.department ?? '',
      status: s.status || 'active',
      phone_verified: s.phone_verified ?? false,
      notes: s.notes ?? '',
    });
    setStaffError('');
    setStaffModalClosing(false);
    setShowStaffModal(true);
  }

  function closeStaffModal() {
    setStaffModalClosing(true);
    setTimeout(() => {
      setShowStaffModal(false);
      setStaffModalClosing(false);
    }, 200);
  }

  async function handleSaveStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStaffId) {
      setStaffError('No staff account selected.');
      return;
    }
    setStaffSaving(true);
    setStaffError('');

    const { error: staffErr } = await supabase
      .from('staff')
      .update({
        full_name: staffForm.full_name,
        phone_number: staffForm.phone_number,
      })
      .eq('id', editingStaffId);

    if (staffErr) {
      setStaffError(staffErr.message);
      setStaffSaving(false);
      return;
    }

    const detailsPayload = {
      id: editingStaffId,
      room_no_assigned: staffForm.room_no_assigned || null,
      shift_start: staffForm.shift_start || null,
      shift_end: staffForm.shift_end || null,
      position: staffForm.position || null,
      department: staffForm.department || null,
      status: staffForm.status,
      phone_verified: staffForm.phone_verified,
      notes: staffForm.notes || null,
      updated_at: new Date().toISOString(),
    };

    const { error: detailsErr } = await supabase
      .from('staff_details')
      .upsert(detailsPayload, { onConflict: 'id' });

    setStaffSaving(false);

    if (detailsErr) {
      setStaffError(detailsErr.message);
      return;
    }

    closeStaffModal();
    fetchStaff();
    fetchStats();
  }

  async function handleDeleteStaff(id: string) {
    if (!confirm('Remove this staff member? This cannot be undone.')) return;
    await supabase.from('staff').delete().eq('id', id);
    fetchStaff();
    fetchStats();
  }

  // ── Contact helpers ────────────────────────────────────────────────────────
  function openAddContact(residentId?: string) {
    setEditingContactId(null);
    setContactForm({ ...emptyContactForm, resident_id: residentId ?? '' });
    setContactError('');
    setContactModalClosing(false);
    setShowContactModal(true);
  }

  function openEditContact(c: FamilyContact) {
    setEditingContactId(c.id);
    setContactForm({
      resident_id: c.resident_id,
      full_name: c.full_name,
      relationship: c.relationship ?? '',
      phone: c.phone,
      email: c.email ?? '',
      is_primary: c.is_primary,
    });
    setContactError('');
    setContactModalClosing(false);
    setShowContactModal(true);
  }

  function closeContactModal() {
    setContactModalClosing(true);
    setTimeout(() => {
      setShowContactModal(false);
      setContactModalClosing(false);
    }, 200);
  }

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    setContactSaving(true);
    setContactError('');
    if (!contactForm.resident_id || !contactForm.phone) {
      setContactError('Resident and phone number are required.');
      setContactSaving(false);
      return;
    }
    const payload = {
      resident_id: contactForm.resident_id,
      full_name: contactForm.full_name,
      relationship: contactForm.relationship || null,
      phone: contactForm.phone,
      email: contactForm.email || null,
      is_primary: contactForm.is_primary,
    };
    const { error } = editingContactId
      ? await supabase.from('family_contacts').update(payload).eq('id', editingContactId)
      : await supabase.from('family_contacts').insert(payload);
    setContactSaving(false);
    if (error) {
      setContactError(error.message);
      return;
    }
    closeContactModal();
    fetchContacts();
    fetchStats();
  }

  async function handleDeleteContact(id: string) {
    if (!confirm('Remove this contact?')) return;
    await supabase.from('family_contacts').delete().eq('id', id);
    fetchContacts();
    fetchStats();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredResidents = residents.filter((r) =>
    r.full_name.toLowerCase().includes(residentSearch.toLowerCase())
  );
  const filteredStaff = staffList.filter(
    (s) =>
      (s.full_name || '').toLowerCase().includes(staffSearch.toLowerCase()) ||
      (s.position || '').toLowerCase().includes(staffSearch.toLowerCase()) ||
      (s.department || '').toLowerCase().includes(staffSearch.toLowerCase())
  );
  const filteredContacts = contacts.filter(
    (c) =>
      c.full_name.toLowerCase().includes(contactSearch.toLowerCase()) ||
      (c.resident_name ?? '').toLowerCase().includes(contactSearch.toLowerCase())
  );

  // ── Derived stats ──────────────────────────────────────────────────────────
  const activeStaff = staffList.filter((s) => s.status === 'active').length;
  const onLeaveStaff = staffList.filter((s) => s.status === 'on_leave').length;
  const inactiveStaff = staffList.filter((s) => s.status === 'inactive').length;

  return (
    <div
      className="min-h-screen flex font-sans antialiased text-gray-900"
      style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #f7fffe 40%, #ecfdf5 100%)' }}
    >
      {/* ── SIDEBAR ──────────────────────────────────────────────────────────── */}
      <aside
        className={`w-72 shrink-0 flex flex-col border-r border-emerald-100/60 transition-all duration-500 ease-out ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-6'
        }`}
        style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%)' }}
      >
        {/* Brand */}
        <div className="px-6 pt-7 pb-6 border-b border-emerald-100/60">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200/60 hover:scale-110 hover:rotate-6 transition-transform duration-300"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              <HeartHandshake className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <p className="text-sm font-black tracking-tight text-gray-900">ElderLink</p>
              <p className="text-[10px] font-bold text-emerald-600 tracking-widest uppercase">
                Care Management
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-5 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon, desc }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-left transition-all duration-200 group ${
                  active
                    ? 'text-white shadow-lg shadow-emerald-200/50'
                    : 'text-gray-700 hover:bg-emerald-50/80 hover:text-emerald-700'
                }`}
                style={
                  active
                    ? { background: 'linear-gradient(135deg, #10b981, #059669)' }
                    : {}
                }
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                    active
                      ? 'bg-white/20'
                      : 'bg-gray-100 group-hover:bg-emerald-100 group-hover:scale-105'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-gray-600 group-hover:text-emerald-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${active ? 'text-white' : 'text-gray-900'}`}>{label}</p>
                  <p className={`text-[10px] truncate ${active ? 'text-white/80' : 'text-gray-500'}`}>{desc}</p>
                </div>
                {(id === 'residents' || id === 'staff') && (
                  <span
                    className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
                      active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {id === 'residents' ? stats.totalResidents : stats.totalStaff}
                  </span>
                )}
                {id === 'staff' && pendingStaff.length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="px-4 pb-6">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all duration-200 group"
          >
            <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center group-hover:bg-red-100 transition-colors">
              <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </div>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div key={tab} className="min-h-full p-8 xl:p-10 animate-[fadeUp_0.4s_ease-out]">

          {/* ════ OVERVIEW ════════════════════════════════════════════════════ */}
          {tab === 'overview' && (
            <div className="max-w-6xl mx-auto">
              <div className="mb-8">
                <h1 className="text-3xl font-black text-gray-900 mb-1">Good morning</h1>
                <p className="text-gray-600 font-medium">Here's what's happening at your facility today.</p>
              </div>

              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
                <StatCard
                  label="Total residents"
                  value={stats.totalResidents}
                  sub={`${stats.activeResidents} active`}
                  icon={Users}
                  color="emerald"
                  delay={0}
                />
                <StatCard
                  label="Active residents"
                  value={stats.activeResidents}
                  sub={stats.totalResidents > 0 ? `${Math.round((stats.activeResidents / stats.totalResidents) * 100)}% of total` : '—'}
                  icon={Activity}
                  color="teal"
                  delay={60}
                />
                <StatCard
                  label="Staff members"
                  value={stats.totalStaff}
                  sub={pendingStaff.length > 0 ? `${pendingStaff.length} pending details` : 'All details assigned'}
                  icon={ClipboardList}
                  color="blue"
                  delay={120}
                />
                <StatCard
                  label="Family contacts"
                  value={stats.familyContacts}
                  sub="Emergency links"
                  icon={UserCircle}
                  color="violet"
                  delay={180}
                />
              </div>

              <div className="grid lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3 bg-white/90 backdrop-blur-sm rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-emerald-700" />
                      </div>
                      <h2 className="font-black text-gray-900">Recent residents</h2>
                    </div>
                    <button
                      onClick={() => setTab('residents')}
                      className="text-xs font-bold text-emerald-700 flex items-center gap-1 hover:gap-2 transition-all duration-200 bg-emerald-50 px-3 py-1.5 rounded-full"
                    >
                      View all <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="px-4 py-3">
                    {residents.slice(0, 6).length === 0 ? (
                      <EmptyState icon={Users} message="No residents yet — add one to get started." />
                    ) : (
                      <div className="space-y-1">
                        {residents.slice(0, 6).map((r, i) => (
                          <button
                            key={r.id}
                            onClick={() => router.push(`/admin/residents/${r.id}`)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-emerald-50/50 transition-colors text-left group animate-[fadeUp_0.4s_ease-out_backwards]"
                            style={{ animationDelay: `${i * 60}ms` }}
                          >
                            <div
                              className={`w-9 h-9 rounded-xl bg-gradient-to-br ${getAvatarColor(r.id)} flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-sm`}
                            >
                              {getInitials(r.full_name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-gray-900 text-sm truncate group-hover:text-emerald-700 transition-colors">
                                {r.full_name}
                              </p>
                              <p className="text-xs text-gray-500 font-medium">
                                {r.room_number ? `Room ${r.room_number}` : 'No room assigned'}
                                {getAge(r.dob) ? ` · ${getAge(r.dob)} yrs` : ''}
                              </p>
                            </div>
                            <ResidentStatusBadge status={r.status} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div className="bg-white/90 backdrop-blur-sm rounded-3xl border border-gray-200/80 shadow-sm p-5 flex-1">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-blue-700" />
                      </div>
                      <h2 className="font-black text-gray-900 text-sm">Staff snapshot</h2>
                    </div>
                    <div className="space-y-2.5">
                      <StaffStatusBar label="Active" count={activeStaff} total={staffList.length} color="emerald" />
                      <StaffStatusBar label="On leave" count={onLeaveStaff} total={staffList.length} color="amber" />
                      <StaffStatusBar label="Inactive" count={inactiveStaff} total={staffList.length} color="gray" />
                    </div>
                    {pendingStaff.length > 0 && (
                      <div className="mt-4 flex items-center gap-2 bg-amber-50 border border-amber-200/80 rounded-2xl px-3.5 py-2.5">
                        <Bell className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                        <p className="text-xs font-bold text-amber-900">
                          {pendingStaff.length} staff member{pendingStaff.length > 1 ? 's' : ''} need details assigned
                        </p>
                      </div>
                    )}
                  </div>

                  <div
                    className="rounded-3xl p-5 shadow-lg shadow-emerald-200/30"
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                  >
                    <p className="font-black text-white text-sm mb-3">Quick actions</p>
                    <div className="space-y-2">
                      {[
                        { label: 'Add resident', icon: Plus, action: openAddResident },
                        { label: 'View staff', icon: ClipboardList, action: () => setTab('staff') },
                        { label: 'Add contact', icon: UserCheck, action: () => { openAddContact(); setTab('family'); } },
                      ].map(({ label, icon: Icon, action }) => (
                        <button
                          key={label}
                          onClick={action}
                          className="w-full flex items-center gap-2.5 bg-white/20 hover:bg-white/30 text-white font-bold text-sm px-4 py-2.5 rounded-2xl transition-all duration-200 text-left active:scale-95"
                        >
                          <Icon className="w-4 h-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ RESIDENTS ═══════════════════════════════════════════════════ */}
          {tab === 'residents' && (
            <div className="max-w-6xl mx-auto">
              <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
                <div>
                  <h1 className="text-2xl font-black text-gray-900 mb-1">Residents</h1>
                  <p className="text-gray-600 text-sm font-medium">
                    {stats.totalResidents} total · {stats.activeResidents} active
                  </p>
                </div>
                <button
                  onClick={openAddResident}
                  className="flex items-center gap-2 text-white font-bold text-sm px-5 py-2.5 rounded-2xl shadow-lg shadow-emerald-200/50 hover:shadow-xl active:scale-95 transition-all duration-200"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                >
                  <Plus className="w-4 h-4" /> Add resident
                </button>
              </div>

              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="w-4 h-4 text-gray-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={residentSearch}
                    onChange={(e) => setResidentSearch(e.target.value)}
                    placeholder="Search residents..."
                    className={INPUT_CLASS + ' pl-11'}
                  />
                </div>
                <div className="flex bg-gray-200/70 rounded-xl p-1">
                  {(['grid', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setResidentView(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        residentView === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {v === 'grid' ? 'Grid' : 'Table'}
                    </button>
                  ))}
                </div>
              </div>

              {residentsLoading ? (
                <LoadingState />
              ) : filteredResidents.length === 0 ? (
                <EmptyState icon={Users} message="No residents found." />
              ) : residentView === 'grid' ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredResidents.map((r) => {
                    const age = getAge(r.dob);
                    return (
                      <div
                        key={r.id}
                        className="bg-white/90 backdrop-blur-sm rounded-3xl border border-gray-200/80 shadow-sm hover:shadow-md p-5 flex flex-col justify-between transition-all duration-300 group"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${getAvatarColor(r.id)} flex items-center justify-center text-white font-bold text-base shadow-sm`}
                              >
                                {getInitials(r.full_name)}
                              </div>
                              <div>
                                <h3 className="font-bold text-gray-900 text-base group-hover:text-emerald-700 transition-colors">
                                  {r.full_name}
                                </h3>
                                <p className="text-xs font-medium text-gray-500">
                                  {r.room_number ? `Room ${r.room_number}` : 'No room'}
                                  {age ? ` · ${age} yrs` : ''}
                                </p>
                              </div>
                            </div>
                            <ResidentStatusBadge status={r.status} />
                          </div>

                          <div className="space-y-2 mb-4 text-xs font-medium text-gray-700">
                            {r.medical_notes && (
                              <p className="bg-emerald-50 rounded-xl px-3 py-2 text-emerald-950 border border-emerald-200/60 line-clamp-2">
                                <strong className="font-bold text-emerald-950">Medical:</strong> {r.medical_notes}
                              </p>
                            )}
                            {r.dietary_needs && (
                              <p className="bg-amber-50 rounded-xl px-3 py-2 text-amber-950 border border-amber-200/60 line-clamp-2">
                                <strong className="font-bold text-amber-950">Dietary:</strong> {r.dietary_needs}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                          <button
                            onClick={() => router.push(`/admin/residents/${r.id}`)}
                            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                          >
                            View details <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEditResident(r)}
                              className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteResident(r.id)}
                              className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white/90 backdrop-blur-sm rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm text-gray-700">
                    <thead className="bg-gray-100/70 text-gray-700 font-bold text-xs uppercase tracking-wider border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4">Resident</th>
                        <th className="px-6 py-4">Room</th>
                        <th className="px-6 py-4">Age / DOB</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredResidents.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-gray-900">{r.full_name}</td>
                          <td className="px-6 py-4 font-medium">{r.room_number ? `Room ${r.room_number}` : 'Unassigned'}</td>
                          <td className="px-6 py-4 font-medium">{getAge(r.dob) ? `${getAge(r.dob)} yrs (${r.dob})` : r.dob || '—'}</td>
                          <td className="px-6 py-4"><ResidentStatusBadge status={r.status} /></td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEditResident(r)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteResident(r.id)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ════ FAMILY ══════════════════════════════════════════════════════ */}
          {tab === 'family' && (
            <div className="max-w-6xl mx-auto">
              <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
                <div>
                  <h1 className="text-2xl font-black text-gray-900 mb-1">Family Contacts</h1>
                  <p className="text-gray-600 text-sm font-medium">{stats.familyContacts} emergency contacts connected</p>
                </div>
                <button
                  onClick={() => openAddContact()}
                  className="flex items-center gap-2 text-white font-bold text-sm px-5 py-2.5 rounded-2xl shadow-lg shadow-emerald-200/50 hover:shadow-xl active:scale-95 transition-all duration-200"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                >
                  <Plus className="w-4 h-4" /> Add contact
                </button>
              </div>

              <div className="mb-6 max-w-sm">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search by contact or resident name..."
                    className={INPUT_CLASS + ' pl-11'}
                  />
                </div>
              </div>

              {contactsLoading ? (
                <LoadingState />
              ) : filteredContacts.length === 0 ? (
                <EmptyState icon={UserCircle} message="No family contacts found." />
              ) : (
                <div className="bg-white/90 backdrop-blur-sm rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm text-gray-700">
                    <thead className="bg-gray-100/70 text-gray-700 font-bold text-xs uppercase tracking-wider border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4">Contact Name</th>
                        <th className="px-6 py-4">Relationship</th>
                        <th className="px-6 py-4">Resident</th>
                        <th className="px-6 py-4">Phone / Email</th>
                        <th className="px-6 py-4">Primary</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredContacts.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-gray-900">{c.full_name}</td>
                          <td className="px-6 py-4 font-medium capitalize">{c.relationship || '—'}</td>
                          <td className="px-6 py-4 font-bold text-emerald-800">{c.resident_name}</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-gray-900">{c.phone}</div>
                            {c.email && <div className="text-xs text-gray-500 font-medium">{c.email}</div>}
                          </td>
                          <td className="px-6 py-4">
                            {c.is_primary ? (
                              <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-bold">
                                Primary
                              </span>
                            ) : (
                              <span className="text-gray-500 font-medium text-xs">Secondary</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEditContact(c)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteContact(c.id)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ════ STAFF ═══════════════════════════════════════════════════════ */}
          {tab === 'staff' && (
            <div className="max-w-6xl mx-auto space-y-8">
              <div>
                <h1 className="text-2xl font-black text-gray-900 mb-1">Staff Management</h1>
                <p className="text-gray-600 text-sm font-medium">{stats.totalStaff} staff members registered</p>
              </div>

              {pendingStaff.length > 0 && (
                <div className="bg-amber-50/90 backdrop-blur-sm border border-amber-300 rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <Bell className="w-5 h-5 text-amber-600" />
                    <h2 className="font-black text-amber-950 text-base">
                      Pending Staff Details ({pendingStaff.length})
                    </h2>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {pendingStaff.map((s) => (
                      <div
                        key={s.id}
                        className="bg-white rounded-2xl p-4 border border-amber-200 shadow-sm flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{s.full_name}</p>
                          <p className="text-xs text-gray-500 font-medium">{s.email}</p>
                        </div>
                        <button
                          onClick={() => openAssignStaff(s)}
                          className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-xl transition-colors shrink-0 shadow-sm"
                        >
                          Add Details
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="max-w-sm">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                    placeholder="Search staff, position, or department..."
                    className={INPUT_CLASS + ' pl-11'}
                  />
                </div>
              </div>

              {staffLoading ? (
                <LoadingState />
              ) : filteredStaff.length === 0 ? (
                <EmptyState icon={ClipboardList} message="No staff members with assigned details found." />
              ) : (
                <div className="bg-white/90 backdrop-blur-sm rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm text-gray-700">
                    <thead className="bg-gray-100/70 text-gray-700 font-bold text-xs uppercase tracking-wider border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4">Staff Member</th>
                        <th className="px-6 py-4">Position / Dept</th>
                        <th className="px-6 py-4">Assigned Room</th>
                        <th className="px-6 py-4">Shift</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredStaff.map((s) => (
                        <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-900">{s.full_name}</p>
                              {s.phone_verified && (
                                <span title="Phone Verified" className="text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 font-medium">{s.email}</p>
                            {s.phone_number && <p className="text-[11px] text-gray-500 font-medium">{s.phone_number}</p>}
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-bold text-gray-900">{s.position || '—'}</p>
                            <p className="text-xs text-gray-500 font-medium">{s.department || '—'}</p>
                          </td>
                          <td className="px-6 py-4 font-medium">
                            {s.room_no_assigned ? `Room ${s.room_no_assigned}` : 'Unassigned'}
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-gray-800">
                            {s.shift_start && s.shift_end
                              ? `${formatTime(s.shift_start)} - ${formatTime(s.shift_end)}`
                              : '—'}
                          </td>
                          <td className="px-6 py-4"><StaffStatusBadge status={s.status} /></td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEditStaff(s)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50"
                                title="Edit staff details"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteStaff(s.id)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-rose-600 hover:bg-rose-50"
                                title="Delete staff member"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* ════ RESIDENT MODAL ══════════════════════════════════════════════════ */}
      {showResidentModal && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm transition-opacity duration-200 ${
            residentModalClosing ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-gray-900">
                {editingResidentId ? 'Edit Resident' : 'Add New Resident'}
              </h2>
              <button
                onClick={closeResidentModal}
                className="p-2 rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {residentError && (
              <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-2xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{residentError}</span>
              </div>
            )}

            <form onSubmit={handleSaveResident} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Full Name *</label>
                <input
                  required
                  value={residentForm.full_name}
                  onChange={(e) => setResidentForm({ ...residentForm, full_name: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="e.g. Jane Doe"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={residentForm.dob}
                    onChange={(e) => setResidentForm({ ...residentForm, dob: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Room Number</label>
                  <input
                    value={residentForm.room_number}
                    onChange={(e) => setResidentForm({ ...residentForm, room_number: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="e.g. 104-B"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Status</label>
                <select
                  value={residentForm.status}
                  onChange={(e) => setResidentForm({ ...residentForm, status: e.target.value as ResidentStatus })}
                  className={SELECT_CLASS}
                >
                  <option value="active" className="bg-white text-gray-900 font-medium py-1.5">Active</option>
                  <option value="discharged" className="bg-white text-gray-900 font-medium py-1.5">Discharged</option>
                  <option value="deceased" className="bg-white text-gray-900 font-medium py-1.5">Deceased</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Address / Prior Location</label>
                <input
                  value={residentForm.address}
                  onChange={(e) => setResidentForm({ ...residentForm, address: e.target.value })}
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Medical Notes</label>
                <textarea
                  rows={2}
                  value={residentForm.medical_notes}
                  onChange={(e) => setResidentForm({ ...residentForm, medical_notes: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Allergies, conditions, medications..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Dietary Needs</label>
                <textarea
                  rows={2}
                  value={residentForm.dietary_needs}
                  onChange={(e) => setResidentForm({ ...residentForm, dietary_needs: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Low sodium, diabetic, pureed..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeResidentModal}
                  className="px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={residentSaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md flex items-center gap-2"
                >
                  {residentSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Resident
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ STAFF MODAL ══════════════════════════════════════════════════════ */}
      {showStaffModal && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm transition-opacity duration-200 ${
            staffModalClosing ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-gray-900">
                {isNewAssignment ? 'Assign Staff Details' : 'Edit Staff Details'}
              </h2>
              <button
                onClick={closeStaffModal}
                className="p-2 rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {staffError && (
              <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-2xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{staffError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStaff} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Full Name</label>
                  <input
                    required
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="Thomas"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Phone Number</label>
                  <input
                    value={staffForm.phone_number}
                    onChange={(e) => setStaffForm({ ...staffForm, phone_number: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="1234567890"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Position</label>
                  <input
                    value={staffForm.position}
                    onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="Floor Cleaner"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Department</label>
                  <input
                    value={staffForm.department}
                    onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="House Keeping"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Room Assigned</label>
                  <input
                    value={staffForm.room_no_assigned}
                    onChange={(e) => setStaffForm({ ...staffForm, room_no_assigned: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="214, 207"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Shift Start</label>
                  <input
                    type="time"
                    value={staffForm.shift_start}
                    onChange={(e) => setStaffForm({ ...staffForm, shift_start: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Shift End</label>
                  <input
                    type="time"
                    value={staffForm.shift_end}
                    onChange={(e) => setStaffForm({ ...staffForm, shift_end: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Status</label>
                  <select
                    value={staffForm.status}
                    onChange={(e) => setStaffForm({ ...staffForm, status: e.target.value as StaffStatus })}
                    className={SELECT_CLASS}
                  >
                    <option value="active" className="bg-white text-gray-900 font-medium py-1.5">Active</option>
                    <option value="on_leave" className="bg-white text-gray-900 font-medium py-1.5">On Leave</option>
                    <option value="inactive" className="bg-white text-gray-900 font-medium py-1.5">Inactive</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={staffForm.phone_verified}
                      onChange={(e) => setStaffForm({ ...staffForm, phone_verified: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                    />
                    <span className="text-xs font-bold text-gray-900">Phone Verified</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={staffForm.notes}
                  onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Additional observations or administrative notes..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeStaffModal}
                  className="px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={staffSaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md flex items-center gap-2"
                >
                  {staffSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Staff Details
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ CONTACT MODAL ═══════════════════════════════════════════════════ */}
      {showContactModal && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm transition-opacity duration-200 ${
            contactModalClosing ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-gray-900">
                {editingContactId ? 'Edit Family Contact' : 'Add Emergency Contact'}
              </h2>
              <button
                onClick={closeContactModal}
                className="p-2 rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {contactError && (
              <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-2xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{contactError}</span>
              </div>
            )}

            <form onSubmit={handleSaveContact} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Select Resident *</label>
                <select
                  required
                  value={contactForm.resident_id}
                  onChange={(e) => setContactForm({ ...contactForm, resident_id: e.target.value })}
                  className={SELECT_CLASS}
                >
                  <option value="" className="bg-white text-gray-900 font-medium py-1.5">-- Select Resident --</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id} className="bg-white text-gray-900 font-medium py-1.5">
                      {r.full_name} {r.room_number ? `(Room ${r.room_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Contact Full Name *</label>
                <input
                  required
                  value={contactForm.full_name}
                  onChange={(e) => setContactForm({ ...contactForm, full_name: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="e.g. John Smith"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Relationship</label>
                  <input
                    value={contactForm.relationship}
                    onChange={(e) => setContactForm({ ...contactForm, relationship: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="e.g. Son, Daughter"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-900 mb-1">Phone Number *</label>
                  <input
                    required
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">Email Address</label>
                <input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  className={INPUT_CLASS}
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="is_primary"
                  checked={contactForm.is_primary}
                  onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                />
                <label htmlFor="is_primary" className="text-xs font-bold text-gray-900 cursor-pointer">
                  Set as primary emergency contact
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeContactModal}
                  className="px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={contactSaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md flex items-center gap-2"
                >
                  {contactSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents & Helpers ───────────────────────────────────────────────────

function ResidentStatusBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'Active' },
    discharged: { cls: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Discharged' },
    deceased: { cls: 'bg-gray-200 text-gray-800 border-gray-300', label: 'Deceased' },
  };

  const normalized = (status || '').toLowerCase().trim();
  const badge = map[normalized] ?? {
    cls: 'bg-gray-100 text-gray-800 border-gray-300',
    label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown',
  };

  return (
    <span className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-bold border ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

function StaffStatusBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'Active' },
    on_leave: { cls: 'bg-amber-100 text-amber-900 border-amber-300', label: 'On Leave' },
    inactive: { cls: 'bg-rose-100 text-rose-900 border-rose-300', label: 'Inactive' },
  };

  const normalized = (status || '').toLowerCase().trim();
  const badge = map[normalized] ?? {
    cls: 'bg-gray-100 text-gray-800 border-gray-300',
    label: status ? status.replace('_', ' ') : 'Unknown',
  };

  return (
    <span className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-bold border ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  delay,
}: {
  label: string;
  value: number;
  sub: string;
  icon: typeof Users;
  color: string;
  delay: number;
}) {
  return (
    <div
      className="bg-white/90 backdrop-blur-sm rounded-3xl p-5 border border-gray-200/80 shadow-sm animate-[fadeUp_0.4s_ease-out_backwards]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">{label}</span>
        <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-black text-gray-900">{value}</p>
      <p className="text-xs font-semibold text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function StaffStatusBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs font-bold mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-900 font-extrabold">{count} ({percent}%)</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            color === 'emerald' ? 'bg-emerald-600' : color === 'amber' ? 'bg-amber-500' : 'bg-gray-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof Users; message: string }) {
  return (
    <div className="py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-gray-200/80 text-gray-500 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-sm font-bold text-gray-600">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="py-20 text-center flex flex-col items-center justify-center gap-2">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
      <p className="text-xs font-bold text-gray-500">Loading data...</p>
    </div>
  );
}