'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type ResidentStatus = 'active' | 'discharged' | 'deceased';
type StaffStatus = 'active' | 'on_leave' | 'inactive';

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

type Tab = 'overview' | 'residents' | 'family' | 'staff';

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

const NAV_ITEMS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'residents', label: 'Residents', icon: Users },
  { id: 'family', label: 'Family Contacts', icon: UserCircle },
  { id: 'staff', label: 'Staff', icon: ClipboardList },
];

const statusStyles: Record<ResidentStatus, string> = {
  active: 'bg-[#E8F5E9] text-[#2E7D32] font-semibold',
  discharged: 'bg-[#FFF3E0] text-[#E65100] font-semibold',
  deceased: 'bg-[#F5F5F5] text-[#616161] font-semibold',
};

const staffStatusStyles: Record<StaffStatus, string> = {
  active: 'bg-[#E8F5E9] text-[#2E7D32] font-semibold',
  on_leave: 'bg-[#FCE4EC] text-[#C2185B] font-semibold',
  inactive: 'bg-[#F5F5F5] text-[#616161] font-semibold',
};

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

  async function fetchResidents() {
    setResidentsLoading(true);
    const { data } = await supabase.from('residents').select('*').order('created_at', { ascending: false });
    setResidents((data as Resident[]) || []);
    setResidentsLoading(false);
  }

  async function fetchStaff() {
    setStaffLoading(true);
    const { data } = await supabase
      .from('staff')
      .select('*, staff_details(*)')
      .order('created_at', { ascending: false });

    const all = (data as any[]) || [];

    // Staff who signed up (so they exist in `staff`, populated automatically
    // by the handle_new_user trigger) but haven't had their role/shift/etc.
    // assigned by an admin yet — staff_details is empty for them.
    const assigned = all
      .filter((s) => s.staff_details && s.staff_details.length > 0)
      .map((s) => ({ ...s, ...s.staff_details[0] }));
    const pending = all.filter((s) => !s.staff_details || s.staff_details.length === 0);

    setStaffList(assigned as (StaffMember & StaffDetails)[]);
    setPendingStaff(pending as StaffMember[]);
    setStaffLoading(false);
  }

  async function fetchContacts() {
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
  }

  async function fetchStats() {
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
  }

  useEffect(() => {
    fetchResidents();
    fetchStaff();
    fetchContacts();
    fetchStats();
  }, []);

  // ── Resident modal helpers ────────────────────────
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
    }, 180);
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
    const { error: saveError } = editingResidentId
      ? await supabase.from('residents').update(payload).eq('id', editingResidentId)
      : await supabase.from('residents').insert(payload);
    setResidentSaving(false);
    if (saveError) {
      setResidentError(saveError.message);
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

  // ── Staff modal helpers ────────────────────────────
  // Opens the modal for a staff member who already signed up themselves
  // (they exist in `staff` via the signup trigger) but has no staff_details
  // row yet — name/email/phone come straight from their signup, read-only.
  function openAssignStaff(s: StaffMember) {
    setIsNewAssignment(true);
    setEditingStaffId(s.id);
    setStaffForm({
      ...emptyStaffForm,
      full_name: s.full_name,
      email: s.email,
      phone_number: s.phone_number,
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
      phone_number: s.phone_number,
      room_no_assigned: s.room_no_assigned ?? '',
      shift_start: s.shift_start ?? '',
      shift_end: s.shift_end ?? '',
      position: s.position ?? '',
      department: s.department ?? '',
      status: s.status,
      phone_verified: s.phone_verified,
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
    }, 180);
  }

  async function handleSaveStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStaffId) {
      setStaffError('No staff account selected.');
      return;
    }
    setStaffSaving(true);
    setStaffError('');

    // Track success locally instead of reading staffError state right after
    // setting it — state updates aren't visible until the next render.
    let succeeded = false;

    const detailsPayload = {
      room_no_assigned: staffForm.room_no_assigned || null,
      shift_start: staffForm.shift_start || null,
      shift_end: staffForm.shift_end || null,
      position: staffForm.position || null,
      department: staffForm.department || null,
      status: staffForm.status,
      phone_verified: staffForm.phone_verified,
      notes: staffForm.notes || null,
    };

    if (isNewAssignment) {
      // This staff member already exists in `staff` (created automatically
      // when they signed up) — we're just assigning their work details for
      // the first time, so this is an insert, not an update.
      const { error: insertError } = await supabase
        .from('staff_details')
        .insert({ id: editingStaffId, ...detailsPayload });

      if (insertError) {
        setStaffError(insertError.message);
      } else {
        succeeded = true;
      }
    } else {
      // Editing an already-assigned staff member. full_name/phone_number can
      // be corrected here; email is locked since it's their login identity.
      const { error: staffUpdateError } = await supabase
        .from('staff')
        .update({
          full_name: staffForm.full_name,
          phone_number: staffForm.phone_number,
        })
        .eq('id', editingStaffId);

      if (!staffUpdateError) {
        const { error: detailsError } = await supabase
          .from('staff_details')
          .update({ ...detailsPayload, updated_at: new Date().toISOString() })
          .eq('id', editingStaffId);

        if (detailsError) {
          setStaffError(detailsError.message);
        } else {
          succeeded = true;
        }
      } else {
        setStaffError(staffUpdateError.message);
      }
    }

    setStaffSaving(false);
    if (succeeded) {
      closeStaffModal();
      fetchStaff();
      fetchStats();
    }
  }

  async function handleDeleteStaff(id: string) {
    if (!confirm('Remove this staff member? This cannot be undone.')) return;
    await supabase.from('staff').delete().eq('id', id);
    fetchStaff();
    fetchStats();
  }

  // ── Contact modal helpers ─────────────────────────
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
    }, 180);
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

    const { error: saveError } = editingContactId
      ? await supabase.from('family_contacts').update(payload).eq('id', editingContactId)
      : await supabase.from('family_contacts').insert(payload);

    setContactSaving(false);
    if (saveError) {
      setContactError(saveError.message);
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

  const filteredResidents = residents.filter((r) =>
    r.full_name.toLowerCase().includes(residentSearch.toLowerCase()),
  );

  const filteredStaff = staffList.filter((s) =>
    s.full_name.toLowerCase().includes(staffSearch.toLowerCase()),
  );

  const filteredContacts = contacts.filter(
    (c) =>
      c.full_name.toLowerCase().includes(contactSearch.toLowerCase()) ||
      (c.resident_name ?? '').toLowerCase().includes(contactSearch.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F7F5] via-[#FCF9F6] to-[#F5F3EF] flex font-sans">
      {/* Sidebar */}
      <aside
        className={`w-64 bg-white/80 backdrop-blur-sm border-r border-gray-200/50 flex flex-col py-6 px-4 shrink-0 shadow-sm transition-all duration-500 ease-out ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`}
      >
        <div className="flex items-center gap-3 px-2 mb-10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#4F9C8B] to-[#357366] flex items-center justify-center hover:scale-110 hover:rotate-6 transition-transform duration-300 shadow-md">
            <HeartHandshake className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-gray-600">ElderLink</p>
            <p className="text-[10px] text-gray-400">Care Management</p>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
                tab === id
                  ? 'bg-gradient-to-r from-[#4F9C8B] to-[#357366] text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-50/80 hover:translate-x-1'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{label}</span>
              {(id === 'residents' || id === 'staff') && (
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    tab === id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {id === 'residents' ? stats.totalResidents : stats.totalStaff}
                </span>
              )}
            </button>
          ))}
        </nav>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-gray-600 hover:bg-red-50/50 hover:text-red-500 transition-all duration-300 group"
        >
          <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
          Sign out
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 md:p-12 overflow-y-auto">
        <div key={tab} className="animate-[fadeUp_0.5s_ease-out]">
          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div className="max-w-7xl">
              <div className="mb-10">
                <h1 className="text-4xl font-extrabold bg-gradient-to-r from-[#357366] to-[#4F9C8B] bg-clip-text text-transparent mb-2">
                  Dashboard
                </h1>
                <p className="text-gray-500 text-lg">Real-time overview of your facility.</p>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
                <StatCard label="Total residents" value={stats.totalResidents} accent="#4F9C8B" delay={0} />
                <StatCard label="Active residents" value={stats.activeResidents} accent="#357366" delay={80} />
                <StatCard label="Staff members" value={stats.totalStaff} accent="#2D6A7B" delay={160} />
                <StatCard label="Family contacts" value={stats.familyContacts} accent="#8B5A2B" delay={240} />
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-6 shadow-sm hover:shadow-md transition-all duration-300">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="font-bold text-lg text-gray-900">Recent residents</h2>
                    <button
                      onClick={() => setTab('residents')}
                      className="text-xs font-bold text-[#4F9C8B] flex items-center gap-1.5 hover:gap-2 transition-all"
                    >
                      View all <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {residents.slice(0, 5).length === 0 ? (
                    <p className="text-sm text-gray-400">No residents yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {residents.slice(0, 5).map((r, i) => (
                        <Link
                          key={r.id}
                          href={`/admin/residents/${r.id}`}
                          className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50/80 transition-colors animate-[fadeUp_0.5s_ease-out_backwards]"
                          style={{ animationDelay: `${i * 80}ms` }}
                        >
                          <span className="font-semibold text-gray-900">{r.full_name}</span>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusStyles[r.status]}`}>
                            {r.status}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gradient-to-br from-[#4F9C8B] to-[#357366] rounded-2xl p-8 text-white shadow-lg">
                  <div className="mb-8">
                    <h2 className="font-bold text-xl mb-1">Quick actions</h2>
                    <p className="text-white/80 text-sm">Manage residents and staff from here.</p>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={openAddResident}
                      className="w-full flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 text-white font-semibold text-sm py-3 rounded-xl transition-all duration-300 backdrop-blur-sm"
                    >
                      <Plus className="w-4 h-4" /> Add resident
                    </button>
                    <button
                      onClick={() => setTab('residents')}
                      className="w-full flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 text-white font-semibold text-sm py-3 rounded-xl transition-all duration-300 backdrop-blur-sm"
                    >
                      <Users className="w-4 h-4" /> Manage residents
                    </button>
                    <button
                      onClick={() => setTab('staff')}
                      className="w-full flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 text-white font-semibold text-sm py-3 rounded-xl transition-all duration-300 backdrop-blur-sm"
                    >
                      <ClipboardList className="w-4 h-4" /> View staff
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── RESIDENTS ── */}
          {tab === 'residents' && (
            <div className="max-w-7xl">
              <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div>
                  <h1 className="text-3xl font-extrabold text-gray-900 mb-1">Residents</h1>
                  <p className="text-gray-500">Manage resident profiles and medical information.</p>
                </div>
                <button
                  onClick={openAddResident}
                  className="flex items-center gap-2 bg-gradient-to-r from-[#4F9C8B] to-[#357366] text-white font-bold text-sm px-6 py-3 rounded-full hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
                >
                  <Plus className="w-4 h-4" /> Add resident
                </button>
              </div>

              <div className="relative mb-6 max-w-sm">
                <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={residentSearch}
                  onChange={(e) => setResidentSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200/50 bg-white/60 backdrop-blur-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.1)] transition-all duration-200"
                />
              </div>

              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
                {residentsLoading ? (
                  <div className="flex items-center justify-center py-20 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
                  </div>
                ) : filteredResidents.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No residents found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50/80 border-b border-gray-200/50">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Room
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResidents.map((r, i) => (
                          <tr
                            key={r.id}
                            className="border-b border-gray-100/50 hover:bg-gray-50/50 transition-colors animate-[fadeUp_0.4s_ease-out_backwards] cursor-pointer"
                            style={{ animationDelay: `${i * 50}ms` }}
                            onClick={() => router.push(`/admin/residents/${r.id}`)}
                          >
                            <td className="px-6 py-4 font-semibold text-gray-900">
                              <Link
                                href={`/admin/residents/${r.id}`}
                                className="hover:text-[#357366] hover:underline transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {r.full_name}
                              </Link>
                            </td>
                            <td className="px-6 py-4 text-gray-600">{r.room_number || '—'}</td>
                            <td className="px-6 py-4">
                              <span className={`text-xs px-3 py-1 rounded-full font-semibold ${statusStyles[r.status]}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditResident(r);
                                  }}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition-all duration-200"
                                  title="Edit"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteResident(r.id);
                                  }}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all duration-200"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                                <ChevronRight className="w-4 h-4 text-gray-300 self-center" />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STAFF ── */}
          {tab === 'staff' && (
            <div className="max-w-7xl">
              <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div>
                  <h1 className="text-3xl font-extrabold text-gray-900 mb-1">Staff Management</h1>
                  <p className="text-gray-500">Manage staff schedules, assignments, and details.</p>
                </div>
              </div>

              {/* Pending signups — people who registered via the signup page and
                  chose "Staff", but haven't been assigned a role/shift yet. */}
              {pendingStaff.length > 0 && (
                <div className="bg-amber-50/60 border border-amber-200/60 rounded-2xl p-5 mb-8">
                  <div className="flex items-start gap-3 mb-4">
                    <Bell className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-900 text-sm">
                        {pendingStaff.length} pending signup{pendingStaff.length > 1 ? 's' : ''}
                      </p>
                      <p className="text-amber-800 text-xs">
                        These people signed up and chose "Staff" — assign their role to activate them.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {pendingStaff.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between bg-white/70 rounded-xl px-4 py-3 border border-amber-200/40"
                      >
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{s.full_name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                            <Mail className="w-3 h-3" /> {s.email}
                            {s.phone_number && (
                              <>
                                <span className="text-gray-300">·</span>
                                <Phone className="w-3 h-3" /> {s.phone_number}
                              </>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => openAssignStaff(s)}
                          className="flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#4F9C8B] to-[#357366] px-4 py-2 rounded-full hover:shadow-md active:scale-95 transition-all"
                        >
                          <Plus className="w-3.5 h-3.5" /> Assign role
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="relative mb-6 max-w-sm">
                <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200/50 bg-white/60 backdrop-blur-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.1)] transition-all duration-200"
                />
              </div>

              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
                {staffLoading ? (
                  <div className="flex items-center justify-center py-20 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
                  </div>
                ) : filteredStaff.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">
                      {pendingStaff.length > 0 ? 'No assigned staff yet — assign a pending signup above.' : 'No staff members yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50/80 border-b border-gray-200/50">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Position
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Shift
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Room Assigned
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStaff.map((s, i) => (
                          <tr
                            key={s.id}
                            className="border-b border-gray-100/50 hover:bg-gray-50/50 transition-colors animate-[fadeUp_0.4s_ease-out_backwards]"
                            style={{ animationDelay: `${i * 50}ms` }}
                          >
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-semibold text-gray-900">{s.full_name}</p>
                                <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                                  <Mail className="w-3 h-3" /> {s.email}
                                </p>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-1.5 text-gray-600">
                                <Briefcase className="w-3.5 h-3.5 text-gray-400" />
                                {s.position || '—'}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {s.shift_start && s.shift_end ? (
                                <div className="flex items-center gap-1.5 text-gray-600">
                                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                                  {s.shift_start} — {s.shift_end}
                                </div>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {s.room_no_assigned ? (
                                <div className="flex items-center gap-1.5 text-gray-600">
                                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                  {s.room_no_assigned}
                                </div>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-xs px-3 py-1 rounded-full font-semibold ${staffStatusStyles[s.status]}`}>
                                {s.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => openEditStaff(s)}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition-all duration-200"
                                  title="Edit"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteStaff(s.id)}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all duration-200"
                                  title="Delete"
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

              {pendingStaff.length === 0 && (
                <div className="mt-8 bg-blue-50/50 border border-blue-200/50 rounded-2xl p-6">
                  <p className="text-blue-700 text-sm font-semibold">
                    💡 New staff sign up themselves at the signup page and choose "Staff" — they'll show up here to be assigned.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── FAMILY CONTACTS ── */}
          {tab === 'family' && (
            <div className="max-w-7xl">
              <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div>
                  <h1 className="text-3xl font-extrabold text-gray-900 mb-1">Family Contacts</h1>
                  <p className="text-gray-500">Contacts who receive emergency SOS alerts.</p>
                </div>
                <button
                  onClick={() => openAddContact()}
                  className="flex items-center gap-2 bg-gradient-to-r from-[#4F9C8B] to-[#357366] text-white font-bold text-sm px-6 py-3 rounded-full hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
                >
                  <Plus className="w-4 h-4" /> Add contact
                </button>
              </div>

              <div className="bg-amber-50/50 border border-amber-200/50 rounded-2xl p-5 mb-6 flex items-start gap-3">
                <Bell className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-amber-900 text-sm mb-0.5">Primary Contact Alert</p>
                  <p className="text-amber-800 text-xs">The primary contact receives the SOS alert SMS. All others are backup records only.</p>
                </div>
              </div>

              <div className="relative mb-6 max-w-sm">
                <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search by name or resident..."
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200/50 bg-white/60 backdrop-blur-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.1)] transition-all duration-200"
                />
              </div>

              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
                {contactsLoading ? (
                  <div className="flex items-center justify-center py-20 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <UserCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No family contacts found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50/80 border-b border-gray-200/50">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Contact
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Resident
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Phone
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Primary
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredContacts.map((c, i) => (
                          <tr
                            key={c.id}
                            className="border-b border-gray-100/50 hover:bg-gray-50/50 transition-colors animate-[fadeUp_0.4s_ease-out_backwards]"
                            style={{ animationDelay: `${i * 50}ms` }}
                          >
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-semibold text-gray-900">{c.full_name}</p>
                                {c.relationship && (
                                  <p className="text-xs text-gray-400 mt-0.5">{c.relationship}</p>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <Link
                                href={`/admin/residents/${c.resident_id}`}
                                className="text-gray-600 hover:text-[#357366] hover:underline transition-colors"
                              >
                                {c.resident_name}
                              </Link>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-1.5 text-gray-600">
                                <Phone className="w-3.5 h-3.5 text-gray-400" />
                                {c.phone}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {c.is_primary ? (
                                <span className="text-xs px-3 py-1 rounded-full bg-[#E8F5E9] text-[#2E7D32] font-semibold">
                                  Primary
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => openEditContact(c)}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition-all duration-200"
                                  title="Edit"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteContact(c.id)}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all duration-200"
                                  title="Delete"
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
            </div>
          )}
        </div>
      </main>

      {/* ── RESIDENT MODAL ── */}
      {showResidentModal && (
        <Modal closing={residentModalClosing} onClose={closeResidentModal} title={editingResidentId ? 'Edit resident' : 'Add resident'}>
          <form onSubmit={handleSaveResident} className="space-y-4">
            <Field label="Full name" required>
              <input
                required
                value={residentForm.full_name}
                onChange={(e) => setResidentForm({ ...residentForm, full_name: e.target.value })}
                className={inputClass}
                placeholder="Resident's name"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date of birth">
                <input
                  type="date"
                  value={residentForm.dob}
                  onChange={(e) => setResidentForm({ ...residentForm, dob: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Room number">
                <input
                  value={residentForm.room_number}
                  onChange={(e) => setResidentForm({ ...residentForm, room_number: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. 204"
                />
              </Field>
            </div>
            <Field label="Address">
              <input
                value={residentForm.address}
                onChange={(e) => setResidentForm({ ...residentForm, address: e.target.value })}
                className={inputClass}
                placeholder="On-file address"
              />
            </Field>
            <Field label="Medical notes">
              <textarea
                value={residentForm.medical_notes}
                onChange={(e) => setResidentForm({ ...residentForm, medical_notes: e.target.value })}
                rows={2}
                className={inputClass + ' resize-none'}
                placeholder="Conditions, medications, allergies..."
              />
            </Field>
            <Field label="Dietary needs">
              <textarea
                value={residentForm.dietary_needs}
                onChange={(e) => setResidentForm({ ...residentForm, dietary_needs: e.target.value })}
                rows={2}
                className={inputClass + ' resize-none'}
                placeholder="Allergies, preferences, restrictions..."
              />
            </Field>
            <Field label="Status">
              <select
                value={residentForm.status}
                onChange={(e) => setResidentForm({ ...residentForm, status: e.target.value as ResidentStatus })}
                className={inputClass + ' bg-white'}
              >
                <option value="active">Active</option>
                <option value="discharged">Discharged</option>
                <option value="deceased">Deceased</option>
              </select>
            </Field>
            {residentError && <ErrorMessage msg={residentError} />}
            <ModalFooter onCancel={closeResidentModal} onSubmit={() => {}} saving={residentSaving} submitText={editingResidentId ? 'Save changes' : 'Add resident'} />
          </form>
        </Modal>
      )}

      {/* ── STAFF MODAL ── */}
      {showStaffModal && (
        <Modal closing={staffModalClosing} onClose={closeStaffModal} title={editingStaffId ? 'Edit staff' : 'Add staff'}>
          <form onSubmit={handleSaveStaff} className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full name" required>
                <input
                  required
                  value={staffForm.full_name}
                  onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                  className={inputClass}
                  placeholder="Staff name"
                />
              </Field>
              <Field label="Email" required>
                <input
                  required
                  type="email"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  className={inputClass}
                  placeholder="staff@example.com"
                  disabled={!!editingStaffId}
                />
                {!editingStaffId ? (
                  <p className="text-xs text-gray-400 mt-1">They'll get an email invite to set their password.</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">Login email can't be changed here — update it in Supabase Auth directly.</p>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone number" required>
                <input
                  required
                  value={staffForm.phone_number}
                  onChange={(e) => setStaffForm({ ...staffForm, phone_number: e.target.value })}
                  className={inputClass}
                  placeholder="+919876543210"
                />
              </Field>
              <Field label="Position">
                <input
                  value={staffForm.position}
                  onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Caregiver"
                />
              </Field>
            </div>

            <Field label="Department">
              <input
                value={staffForm.department}
                onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })}
                className={inputClass}
                placeholder="e.g. Care, Admin, Housekeeping"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Shift start">
                <input
                  type="time"
                  value={staffForm.shift_start}
                  onChange={(e) => setStaffForm({ ...staffForm, shift_start: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Shift end">
                <input
                  type="time"
                  value={staffForm.shift_end}
                  onChange={(e) => setStaffForm({ ...staffForm, shift_end: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Room assigned">
              <input
                value={staffForm.room_no_assigned}
                onChange={(e) => setStaffForm({ ...staffForm, room_no_assigned: e.target.value })}
                className={inputClass}
                placeholder="e.g. 204, 305"
              />
            </Field>

            <Field label="Status">
              <select
                value={staffForm.status}
                onChange={(e) => setStaffForm({ ...staffForm, status: e.target.value as StaffStatus })}
                className={inputClass + ' bg-white'}
              >
                <option value="active">Active</option>
                <option value="on_leave">On Leave</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>

            <div className="flex items-center gap-3 bg-[#E8F5E9] rounded-xl px-4 py-3">
              <input
                type="checkbox"
                id="phone_verified"
                checked={staffForm.phone_verified}
                onChange={(e) => setStaffForm({ ...staffForm, phone_verified: e.target.checked })}
                className="w-4 h-4 accent-[#2E7D32] cursor-pointer"
              />
              <label htmlFor="phone_verified" className="text-sm font-semibold text-[#2E7D32] cursor-pointer">
                Phone number verified
              </label>
            </div>

            <Field label="Notes">
              <textarea
                value={staffForm.notes}
                onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })}
                rows={2}
                className={inputClass + ' resize-none'}
                placeholder="Additional notes..."
              />
            </Field>

            {staffError && <ErrorMessage msg={staffError} />}
            <ModalFooter onCancel={closeStaffModal} onSubmit={() => {}} saving={staffSaving} submitText={editingStaffId ? 'Save changes' : 'Add staff'} />
          </form>
        </Modal>
      )}

      {/* ── CONTACT MODAL ── */}
      {showContactModal && (
        <Modal closing={contactModalClosing} onClose={closeContactModal} title={editingContactId ? 'Edit contact' : 'Add family contact'}>
          <form onSubmit={handleSaveContact} className="space-y-4">
            <Field label="Resident" required>
              <select
                required
                value={contactForm.resident_id}
                onChange={(e) => setContactForm({ ...contactForm, resident_id: e.target.value })}
                className={inputClass + ' bg-white'}
              >
                <option value="">Select a resident</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name} — Room {r.room_number || 'N/A'}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact name" required>
                <input
                  required
                  value={contactForm.full_name}
                  onChange={(e) => setContactForm({ ...contactForm, full_name: e.target.value })}
                  className={inputClass}
                  placeholder="Full name"
                />
              </Field>
              <Field label="Relationship">
                <input
                  value={contactForm.relationship}
                  onChange={(e) => setContactForm({ ...contactForm, relationship: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Daughter"
                />
              </Field>
            </div>

            <Field label="Phone number" required>
              <input
                required
                value={contactForm.phone}
                onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                className={inputClass}
                placeholder="+919876543210"
              />
            </Field>

            <Field label="Email">
              <input
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                className={inputClass}
                placeholder="contact@example.com"
              />
            </Field>

            <div className="flex items-center gap-3 bg-[#E8F5E9] rounded-xl px-4 py-3">
              <input
                type="checkbox"
                id="is_primary"
                checked={contactForm.is_primary}
                onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                className="w-4 h-4 accent-[#2E7D32] cursor-pointer"
              />
              <label htmlFor="is_primary" className="text-sm font-semibold text-[#2E7D32] cursor-pointer">
                Set as primary contact
              </label>
            </div>

            {contactError && <ErrorMessage msg={contactError} />}
            <ModalFooter onCancel={closeContactModal} onSubmit={() => {}} saving={contactSaving} submitText={editingContactId ? 'Save changes' : 'Add contact'} />
          </form>
        </Modal>
      )}

      <style jsx global>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.94) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Shared Components ─────────────────────────────────

const inputClass = 'mt-1.5 w-full rounded-xl border border-gray-200/50 bg-white/60 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.1)] transition-all duration-200 backdrop-blur-sm';

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function ErrorMessage({ msg }: { msg: string }) {
  return <p className="text-sm text-red-500 bg-red-50/50 border border-red-200/50 rounded-lg px-3 py-2">{msg}</p>;
}

function Modal({
  children,
  closing,
  onClose,
  title,
}: {
  children: React.ReactNode;
  closing: boolean;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className={`fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-6 z-50 transition-opacity duration-200 ${
        closing ? 'opacity-0' : 'opacity-100 animate-[fadeIn_0.2s_ease-out]'
      }`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto transition-all duration-200 border border-gray-200/50 ${
          closing ? 'opacity-0 scale-95 translate-y-2' : 'opacity-100 scale-100 translate-y-0 animate-[modalIn_0.25s_ease-out]'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 sticky top-0 bg-white/80 backdrop-blur-sm">
          <h2 className="font-bold text-lg text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:rotate-90 transition-all duration-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  onSubmit,
  saving,
  submitText,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  saving: boolean;
  submitText: string;
}) {
  return (
    <div className="flex gap-3 pt-4">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 py-2.5 rounded-lg border border-gray-200 font-semibold text-sm hover:bg-gray-50 active:scale-95 transition-all duration-150"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-[#4F9C8B] to-[#357366] text-white font-semibold text-sm hover:shadow-md active:scale-95 disabled:opacity-60 transition-all duration-150"
      >
        {saving ? 'Saving...' : submitText}
      </button>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  delay = 0,
}: {
  label: string;
  value: number;
  accent: string;
  delay?: number;
}) {
  return (
    <div
      className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 animate-[fadeUp_0.5s_ease-out_backwards]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{label}</p>
      <p className="text-4xl font-extrabold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}