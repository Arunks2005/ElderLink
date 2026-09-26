'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Bot,
  Sparkles,
  Upload,
  FileText,
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
  medical_report_path: string | null;
  medical_report_name: string | null;
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
  role_id: string | null;
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

interface Role {
  id: string;
  name: string;
  created_at: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
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
  role_id: '',
  department: '',
  status: 'active' as StaffStatus,
  phone_verified: false,
  notes: '',
};

const emptyResidentFamilyForm = {
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

// The chatbot is always launched with ?new=1 so every entry point starts
// a fresh conversation instead of resuming whatever was last open.
const BEHAVIORAL_AI_NEW_CHAT_PATH = '/admin/behavioral-trends?new=1';

// Rotating tips shown in the floating assistant's speech bubble.
const AI_TIPS = [
  'Ask me: "How is everyone doing today?"',
  'Try: "Summarize this week\'s care logs"',
  'Ask: "Any residents I should check on?"',
  'Attach a document and I can turn it into a presentation.',
  "I'm not just for resident data — ask me anything.",
];

// Accepted file types for medical report uploads.
const MEDICAL_REPORT_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.heic';
const MEDICAL_REPORTS_BUCKET = 'medical-reports';

// Reusable input field classes to guarantee visible fonts across all browsers/themes
const INPUT_CLASS =
  'w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 font-semibold placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all text-sm';
const SELECT_CLASS =
  'w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 font-semibold outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all text-sm';

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

// Groups residents by created_at into the last 7 calendar days, oldest
// first — feeds the "New residents" mini bar chart on the overview tab.
function computeNewResidentsLast7Days(residents: Resident[]) {
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const counts = days.map((day) => {
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    return residents.filter((r) => {
      const created = new Date(r.created_at);
      return created >= day && created < next;
    }).length;
  });
  const labels = days.map((d) => d.toLocaleDateString('en-US', { weekday: 'short' }));
  return { labels, counts };
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

  // Medical report file upload state — kept separate from residentForm
  // since it's a File object, not a plain text field that maps 1:1 to a
  // column, and needs its own "existing file" / "remove" bookkeeping.
  const [residentFile, setResidentFile] = useState<File | null>(null);
  const [existingReportPath, setExistingReportPath] = useState<string | null>(null);
  const [existingReportName, setExistingReportName] = useState<string | null>(null);
  const [removeExistingReport, setRemoveExistingReport] = useState(false);
  const [reportOpening, setReportOpening] = useState<string | null>(null);

  // Staff state
  const [staffList, setStaffList] = useState<(StaffMember & StaffDetails)[]>([]);
  const [pendingStaff, setPendingStaff] = useState<StaffMember[]>([]);
  const [isNewAssignment, setIsNewAssignment] = useState(false);
  const [isNewStaffCreation, setIsNewStaffCreation] = useState(false);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffSearch, setStaffSearch] = useState('');
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffModalClosing, setStaffModalClosing] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError, setStaffError] = useState('');

  // Roles state — backs the staff "Position" dropdown. Admins manage this
  // list from the Staff tab; staff assignment just picks from it.
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [addingRole, setAddingRole] = useState(false);
  const [roleError, setRoleError] = useState('');

  // Family contacts state
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState('');

  // Family details are entered directly inside the Add/Edit Resident form.
  // residentFamilyContactId tracks the existing linked contact when a resident
  // is edited, so the same single form can update both database tables.
  const [residentFamilyForm, setResidentFamilyForm] = useState(emptyResidentFamilyForm);
  const [residentFamilyContactId, setResidentFamilyContactId] = useState<string | null>(null);

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

  // ── Sign-out safety net against the browser back/forward cache ────────────
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) {
            router.replace('/login');
          }
        });
      }
    }

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [supabase, router]);

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

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    const { data } = await supabase.from('roles').select('*').order('name');
    setRoles((data as Role[]) || []);
    setRolesLoading(false);
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
    fetchRoles();
    fetchContacts();
    fetchStats();
  }, [fetchResidents, fetchStaff, fetchRoles, fetchContacts, fetchStats]);

  // ── Derived chart data ──────────────────────────────────────────────────────
  const residentStatusData = useMemo(() => {
    const counts: Record<ResidentStatus, number> = { active: 0, discharged: 0, deceased: 0 };
    residents.forEach((r) => {
      if (r.status in counts) counts[r.status]++;
    });
    return [
      { label: 'Active', value: counts.active, color: '#10b981' },
      { label: 'Discharged', value: counts.discharged, color: '#f59e0b' },
      { label: 'Deceased', value: counts.deceased, color: '#94a3b8' },
    ];
  }, [residents]);

  const staffStatusData = useMemo(
    () => [
      { label: 'Active', value: staffList.filter((s) => s.status === 'active').length, color: '#10b981' },
      { label: 'On leave', value: staffList.filter((s) => s.status === 'on_leave').length, color: '#f59e0b' },
      { label: 'Inactive', value: staffList.filter((s) => s.status === 'inactive').length, color: '#94a3b8' },
    ],
    [staffList]
  );

  const newResidentsChart = useMemo(() => computeNewResidentsLast7Days(residents), [residents]);

  // Room numbers are sourced directly from residents.room_number.
  // Duplicate room numbers are collapsed so each room appears only once
  // in the staff assignment dropdown. Multiple staff can select the same
  // room; their shift_start / shift_end values determine the coverage.
  const roomOptions = useMemo(() => {
    return Array.from(
      new Set(
        residents
          .map((r) => r.room_number?.trim())
          .filter((room): room is string => Boolean(room))
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [residents]);

  // Looks up a role's display name by id, for populating the legacy
  // denormalized `position` text column when saving staff details.
  function getRoleName(roleId: string | null | undefined) {
    if (!roleId) return null;
    return roles.find((r) => r.id === roleId)?.name ?? null;
  }

  // ── Resident helpers ───────────────────────────────────────────────────────
  function resetResidentFamilyForm() {
    setResidentFamilyForm({ ...emptyResidentFamilyForm });
    setResidentFamilyContactId(null);
  }

  async function loadResidentFamilyContact(residentId: string) {
    const { data, error } = await supabase
      .from('family_contacts')
      .select('*')
      .eq('resident_id', residentId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('Error loading resident family contact:', error);
      setResidentFamilyForm({ ...emptyResidentFamilyForm });
      setResidentFamilyContactId(null);
      return;
    }

    const contact = data?.[0] as FamilyContact | undefined;
    if (!contact) {
      setResidentFamilyForm({ ...emptyResidentFamilyForm });
      setResidentFamilyContactId(null);
      return;
    }

    setResidentFamilyContactId(contact.id);
    setResidentFamilyForm({
      full_name: contact.full_name ?? '',
      relationship: contact.relationship ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      is_primary: Boolean(contact.is_primary),
    });
  }

  function openAddResident() {
    setEditingResidentId(null);
    setResidentForm(emptyResidentForm);
    setResidentError('');
    setResidentModalClosing(false);
    setResidentFile(null);
    setExistingReportPath(null);
    setExistingReportName(null);
    setRemoveExistingReport(false);
    resetResidentFamilyForm();
    setShowResidentModal(true);
  }

  async function openEditResident(r: Resident) {
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
    setResidentFile(null);
    setExistingReportPath(r.medical_report_path ?? null);
    setExistingReportName(r.medical_report_name ?? null);
    setRemoveExistingReport(false);
    resetResidentFamilyForm();

    // Load the existing linked family contact into the same form.
    await loadResidentFamilyContact(r.id);
    setShowResidentModal(true);
  }

  async function openEditResidentFromFamily(c: FamilyContact) {
    const resident = residents.find((r) => r.id === c.resident_id);
    if (!resident) {
      alert('The resident linked to this family contact could not be found.');
      return;
    }
    setTab('residents');
    await openEditResident(resident);
  }

  function closeResidentModal() {
    setResidentModalClosing(true);
    setTimeout(() => {
      setShowResidentModal(false);
      setResidentModalClosing(false);
      setResidentFile(null);
      setExistingReportPath(null);
      setExistingReportName(null);
      setRemoveExistingReport(false);
      resetResidentFamilyForm();
    }, 200);
  }

  async function handleSaveResident(e: React.FormEvent) {
    e.preventDefault();
    setResidentSaving(true);
    setResidentError('');

    const familyName = residentFamilyForm.full_name.trim();
    const familyPhone = residentFamilyForm.phone.trim();
    const hasAnyFamilyDetails = Boolean(
      familyName ||
        familyPhone ||
        residentFamilyForm.relationship.trim() ||
        residentFamilyForm.email.trim() ||
        residentFamilyForm.is_primary
    );

    // Keep the same required fields as the original family-contact form when
    // any family information is being entered. This also allows a resident to
    // be saved without a contact when no family information is provided.
    if (hasAnyFamilyDetails && (!familyName || !familyPhone)) {
      setResidentSaving(false);
      setResidentError('For a family contact, Contact Full Name and Phone Number are required.');
      return;
    }

    const payload: Record<string, unknown> = {
      full_name: residentForm.full_name.trim(),
      dob: residentForm.dob || null,
      address: residentForm.address || null,
      room_number: residentForm.room_number || null,
      medical_notes: residentForm.medical_notes || null,
      dietary_needs: residentForm.dietary_needs || null,
      status: residentForm.status,
    };

    if (removeExistingReport && !residentFile) {
      payload.medical_report_path = null;
      payload.medical_report_name = null;
    }

    const { data: savedResident, error } = editingResidentId
      ? await supabase.from('residents').update(payload).eq('id', editingResidentId).select().single()
      : await supabase.from('residents').insert(payload).select().single();

    if (error || !savedResident) {
      setResidentSaving(false);
      setResidentError(error?.message ?? 'Could not save resident.');
      return;
    }

    if (residentFile) {
      const safeName = residentFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storagePath = `${savedResident.id}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(MEDICAL_REPORTS_BUCKET)
        .upload(storagePath, residentFile, { upsert: true });

      if (uploadError) {
        setResidentSaving(false);
        setResidentError(`Resident saved, but the file upload failed: ${uploadError.message}`);
        fetchResidents();
        return;
      }

      const { error: linkError } = await supabase
        .from('residents')
        .update({ medical_report_path: storagePath, medical_report_name: residentFile.name })
        .eq('id', savedResident.id);

      if (linkError) {
        setResidentSaving(false);
        setResidentError(`File uploaded, but linking it to the resident failed: ${linkError.message}`);
        fetchResidents();
        return;
      }
    }

    // Save the family contact only from this combined Resident form.
    if (hasAnyFamilyDetails) {
      const familyPayload = {
        resident_id: savedResident.id,
        full_name: familyName,
        relationship: residentFamilyForm.relationship.trim() || null,
        phone: familyPhone,
        email: residentFamilyForm.email.trim() || null,
        is_primary: residentFamilyForm.is_primary,
      };

      // Keep one primary contact for a resident when the checkbox is selected.
      if (familyPayload.is_primary) {
        const primaryQuery = supabase
          .from('family_contacts')
          .update({ is_primary: false })
          .eq('resident_id', savedResident.id);

        if (residentFamilyContactId) {
          primaryQuery.neq('id', residentFamilyContactId);
        }

        const { error: primaryError } = await primaryQuery;
        if (primaryError) {
          setResidentSaving(false);
          setResidentError(`Resident saved, but the family contact could not be updated: ${primaryError.message}`);
          fetchResidents();
          fetchContacts();
          fetchStats();
          return;
        }
      }

      const contactResult = residentFamilyContactId
        ? await supabase
            .from('family_contacts')
            .update(familyPayload)
            .eq('id', residentFamilyContactId)
        : await supabase.from('family_contacts').insert(familyPayload);

      if (contactResult.error) {
        setResidentSaving(false);
        setResidentError(
          `Resident saved, but the family contact could not be saved: ${contactResult.error.message}`
        );
        fetchResidents();
        fetchContacts();
        fetchStats();
        return;
      }
    }

    setResidentSaving(false);
    closeResidentModal();
    fetchResidents();
    fetchContacts();
    fetchStats();
  }

  async function handleDeleteResident(id: string) {
    if (!confirm('Remove this resident? This cannot be undone.')) return;
    await supabase.from('residents').delete().eq('id', id);
    fetchResidents();
    fetchContacts();
    fetchStats();
  }

  async function handleViewReport(path: string) {
    setReportOpening(path);
    const { data, error } = await supabase.storage
      .from(MEDICAL_REPORTS_BUCKET)
      .createSignedUrl(path, 60);
    setReportOpening(null);

    if (error || !data?.signedUrl) {
      alert('Could not open the medical report. Please try again.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  // ── Staff helpers ──────────────────────────────────────────────────────────
  function openAddStaff() {
    setIsNewStaffCreation(true);
    setIsNewAssignment(false);
    setEditingStaffId(null);
    setStaffForm(emptyStaffForm);
    setStaffError('');
    setStaffModalClosing(false);
    setShowStaffModal(true);
  }

  function openAssignStaff(s: StaffMember) {
    setIsNewAssignment(true);
    setIsNewStaffCreation(false);
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
    setIsNewStaffCreation(false);
    setIsNewAssignment(false);
    setEditingStaffId(s.id);
    setStaffForm({
      full_name: s.full_name,
      email: s.email,
      phone_number: s.phone_number || '',
      room_no_assigned: s.room_no_assigned ?? '',
      shift_start: s.shift_start ?? '',
      shift_end: s.shift_end ?? '',
      role_id: s.role_id ?? '',
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
    setStaffSaving(true);
    setStaffError('');

    // New staff creation (create staff + details in one go)
    if (isNewStaffCreation) {
      if (!staffForm.email || !staffForm.full_name) {
        setStaffError('Full name and email are required.');
        setStaffSaving(false);
        return;
      }

      const { data: staffData, error: staffErr } = await supabase
        .from('staff')
        .insert({
          full_name: staffForm.full_name,
          email: staffForm.email,
          phone_number: staffForm.phone_number || null,
        })
        .select()
        .single();

      if (staffErr) {
        setStaffError(staffErr.message);
        setStaffSaving(false);
        return;
      }

      const staffId = staffData.id;

      // Room assignments must come from residents.room_number.
      // Multiple staff may use the same room as long as their shifts
      // are recorded separately.
      if (staffForm.room_no_assigned && !roomOptions.includes(staffForm.room_no_assigned)) {
        setStaffError('Please select a valid room from the residents room list.');
        setStaffSaving(false);
        return;
      }

      // Insert staff details. role_id is the real FK to `roles`; position
      // stays as a denormalized copy of the role's name for anything that
      // still reads/searches it as plain text.
      const detailsPayload = {
        id: staffId,
        room_no_assigned: staffForm.room_no_assigned || null,
        shift_start: staffForm.shift_start || null,
        shift_end: staffForm.shift_end || null,
        role_id: staffForm.role_id || null,
        position: getRoleName(staffForm.role_id),
        department: staffForm.department || null,
        status: staffForm.status,
        phone_verified: staffForm.phone_verified,
        notes: staffForm.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: detailsErr } = await supabase
        .from('staff_details')
        .insert(detailsPayload);

      setStaffSaving(false);

      if (detailsErr) {
        setStaffError(detailsErr.message);
        return;
      }

      closeStaffModal();
      fetchStaff();
      fetchStats();
      return;
    }

    // Existing staff update
    if (!editingStaffId) {
      setStaffError('No staff account selected.');
      setStaffSaving(false);
      return;
    }

    // Room assignments must come from residents.room_number.
    // This prevents manually entered room numbers that do not exist in
    // the residents table.
    if (staffForm.room_no_assigned && !roomOptions.includes(staffForm.room_no_assigned)) {
      setStaffError('Please select a valid room from the residents room list.');
      setStaffSaving(false);
      return;
    }

    const { error: staffErr } = await supabase
      .from('staff')
      .update({
        full_name: staffForm.full_name,
        email: staffForm.email,
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
      role_id: staffForm.role_id || null,
      position: getRoleName(staffForm.role_id),
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

  // ── Role helpers ───────────────────────────────────────────────────────────
  // Roles are managed from the Staff tab (see the "Staff Roles" card) so
  // admins can add or remove them without leaving the page, and the
  // staff-assignment modal's Position dropdown just reads from this list.
  async function handleAddRole(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAddingRole(true);
    setRoleError('');
    const { error } = await supabase.from('roles').insert({ name: trimmed });
    setAddingRole(false);
    if (error) {
      setRoleError(error.message);
      return;
    }
    setNewRoleName('');
    fetchRoles();
  }

  async function handleDeleteRole(id: string) {
    if (
      !confirm(
        'Delete this role? Staff currently assigned this role will show no role until reassigned.'
      )
    )
      return;
    await supabase.from('roles').delete().eq('id', id);
    fetchRoles();
    fetchStaff();
  }

  // ── Family contact helpers ─────────────────────────────────────────────────
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
      className="h-screen overflow-hidden flex font-sans antialiased text-slate-900"
      style={{ background: 'linear-gradient(135deg, #eef3f1 0%, #f4f7f6 45%, #eaf2ee 100%)' }}
    >
      {/* ── SIDEBAR ──────────────────────────────────────────────────────────── */}
      <aside
        className={`w-72 shrink-0 h-full flex flex-col border-r border-emerald-100/60 transition-all duration-500 ease-out ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-6'
        }`}
        style={{ background: 'linear-gradient(180deg, #fbfdfc 0%, #eef3f1 100%)' }}
      >
        <div className="px-6 pt-7 pb-6 border-b border-emerald-100/60 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200/60 hover:scale-110 hover:rotate-6 transition-transform duration-300"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              <HeartHandshake className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">ElderLink</p>
              <p className="text-[10px] font-bold text-emerald-600 tracking-widest uppercase">
                Care Management
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon, desc }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-left transition-all duration-200 group ${
                  active
                    ? 'text-white shadow-lg shadow-emerald-200/50'
                    : 'text-slate-700 hover:bg-emerald-50/80 hover:text-emerald-700'
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
                      : 'bg-slate-100 group-hover:bg-emerald-100 group-hover:scale-105'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-slate-600 group-hover:text-emerald-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-900'}`}>{label}</p>
                  <p className={`text-[10px] truncate ${active ? 'text-white/80' : 'text-slate-500'}`}>{desc}</p>
                </div>
                {(id === 'residents' || id === 'staff') && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
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

        <div className="px-4 pb-6 shrink-0">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all duration-200 group"
          >
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center group-hover:bg-red-100 transition-colors">
              <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </div>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <main className="flex-1 h-full overflow-y-auto">
        <div key={tab} className="min-h-full p-8 xl:p-10 animate-[fadeUp_0.4s_ease-out]">

          {/* ════ OVERVIEW ════════════════════════════════════════════════════ */}
          {tab === 'overview' && (
            <div className="max-w-6xl mx-auto">
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-1">Good morning</h1>
                <p className="text-slate-600 font-medium">Here's what's happening at your facility today.</p>
              </div>

              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
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

              <div className="grid lg:grid-cols-2 gap-5 mb-6">
                <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm p-5 animate-[fadeUp_0.4s_ease-out_backwards]" style={{ animationDelay: '220ms' }}>
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <Users className="w-4 h-4 text-emerald-700" />
                    </div>
                    <h2 className="font-bold text-slate-900 text-sm">Resident status breakdown</h2>
                  </div>
                  <DonutChart data={residentStatusData} totalLabel="Total residents" />
                </div>

                <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm p-5 animate-[fadeUp_0.4s_ease-out_backwards]" style={{ animationDelay: '260ms' }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-teal-100 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-teal-700" />
                      </div>
                      <h2 className="font-bold text-slate-900 text-sm">New residents (7 days)</h2>
                    </div>
                    <span className="text-xs font-bold text-slate-500">
                      {newResidentsChart.counts.reduce((a, b) => a + b, 0)} total
                    </span>
                  </div>
                  <MiniBarChart labels={newResidentsChart.labels} values={newResidentsChart.counts} />
                </div>
              </div>

              <div className="grid lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-emerald-700" />
                      </div>
                      <h2 className="font-bold text-slate-900">Recent residents</h2>
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
                              <p className="font-bold text-slate-900 text-sm truncate group-hover:text-emerald-700 transition-colors">
                                {r.full_name}
                              </p>
                              <p className="text-xs text-slate-500 font-medium">
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

                <div className="lg:col-span-2 flex flex-col gap-5">
                  <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm p-5">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-blue-700" />
                      </div>
                      <h2 className="font-bold text-slate-900 text-sm">Staff snapshot</h2>
                    </div>
                    <DonutChart data={staffStatusData} totalLabel="Total staff" size={112} strokeWidth={14} />
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
                    style={{ background: 'linear-gradient(135deg, #10b981, #0d9488)' }}
                  >
                    <p className="font-bold text-white text-sm mb-3">Quick actions</p>
                    <div className="space-y-2">
                      {[
                        { label: 'Add resident', icon: Plus, action: openAddResident },
                        { label: 'View staff', icon: ClipboardList, action: () => setTab('staff') },
                        { label: 'Behavioral AI insights', icon: Bot, action: () => router.push(BEHAVIORAL_AI_NEW_CHAT_PATH) },
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
                  <h1 className="text-2xl font-bold text-slate-900 mb-1">Residents</h1>
                  <p className="text-slate-600 text-sm font-medium">
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
                  <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={residentSearch}
                    onChange={(e) => setResidentSearch(e.target.value)}
                    placeholder="Search residents..."
                    className={INPUT_CLASS + ' pl-11'}
                  />
                </div>
                <div className="flex bg-slate-200/70 rounded-xl p-1">
                  {(['grid', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setResidentView(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        residentView === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
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
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredResidents.map((r) => {
                    const age = getAge(r.dob);
                    return (
                      <div
                        key={r.id}
                        className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm hover:shadow-md p-5 flex flex-col justify-between transition-all duration-300 group"
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
                                <h3 className="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition-colors">
                                  {r.full_name}
                                </h3>
                                <p className="text-xs font-medium text-slate-500">
                                  {r.room_number ? `Room ${r.room_number}` : 'No room'}
                                  {age ? ` · ${age} yrs` : ''}
                                </p>
                              </div>
                            </div>
                            <ResidentStatusBadge status={r.status} />
                          </div>

                          <div className="space-y-2 mb-4 text-xs font-medium text-slate-700">
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
                            {r.medical_report_path && (
                              <button
                                onClick={() => handleViewReport(r.medical_report_path!)}
                                disabled={reportOpening === r.medical_report_path}
                                className="w-full flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2 text-blue-800 border border-blue-200/60 hover:bg-blue-100 transition-colors disabled:opacity-60"
                              >
                                {reportOpening === r.medical_report_path ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                ) : (
                                  <FileText className="w-3.5 h-3.5 shrink-0" />
                                )}
                                <span className="truncate">
                                  {r.medical_report_name || 'View medical report'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                          <button
                            onClick={() => router.push(`/admin/residents/${r.id}`)}
                            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                          >
                            View details <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEditResident(r)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteResident(r.id)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
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
                <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-100/70 text-slate-700 font-bold text-xs uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4">Resident</th>
                        <th className="px-6 py-4">Room</th>
                        <th className="px-6 py-4">Age / DOB</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredResidents.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-900">{r.full_name}</td>
                          <td className="px-6 py-4 font-medium">{r.room_number ? `Room ${r.room_number}` : 'Unassigned'}</td>
                          <td className="px-6 py-4 font-medium">{getAge(r.dob) ? `${getAge(r.dob)} yrs (${r.dob})` : r.dob || '—'}</td>
                          <td className="px-6 py-4"><ResidentStatusBadge status={r.status} /></td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {r.medical_report_path && (
                                <button
                                  onClick={() => handleViewReport(r.medical_report_path!)}
                                  disabled={reportOpening === r.medical_report_path}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                                  title="View medical report"
                                >
                                  {reportOpening === r.medical_report_path ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <FileText className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                              <button
                                onClick={() => openEditResident(r)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteResident(r.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50"
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
                  <h1 className="text-2xl font-bold text-slate-900 mb-1">Family Contacts</h1>
                  <p className="text-slate-600 text-sm font-medium">{stats.familyContacts} emergency contacts connected</p>
                </div>
              </div>

              <div className="mb-6 max-w-sm">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
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
                <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-100/70 text-slate-700 font-bold text-xs uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4">Contact Name</th>
                        <th className="px-6 py-4">Relationship</th>
                        <th className="px-6 py-4">Resident</th>
                        <th className="px-6 py-4">Phone / Email</th>
                        <th className="px-6 py-4">Primary</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredContacts.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-900">{c.full_name}</td>
                          <td className="px-6 py-4 font-medium capitalize">{c.relationship || '—'}</td>
                          <td className="px-6 py-4 font-bold text-emerald-800">{c.resident_name}</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-900">{c.phone}</div>
                            {c.email && <div className="text-xs text-slate-500 font-medium">{c.email}</div>}
                          </td>
                          <td className="px-6 py-4">
                            {c.is_primary ? (
                              <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-bold">
                                Primary
                              </span>
                            ) : (
                              <span className="text-slate-500 font-medium text-xs">Secondary</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => { void openEditResidentFromFamily(c); }}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteContact(c.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50"
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
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 mb-1">Staff Management</h1>
                  <p className="text-slate-600 text-sm font-medium">{stats.totalStaff} staff members registered</p>
                </div>
                <button
                  onClick={openAddStaff}
                  className="flex items-center gap-2 text-white font-bold text-sm px-5 py-2.5 rounded-2xl shadow-lg shadow-emerald-200/50 hover:shadow-xl active:scale-95 transition-all duration-200"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                >
                  <Plus className="w-4 h-4" /> Add staff
                </button>
              </div>

              {/* Staff Roles — admin-managed list backing the Position dropdown
                  in the staff assignment modal below. */}
              <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
                      <Briefcase className="w-4 h-4 text-violet-700" />
                    </div>
                    <h2 className="font-bold text-slate-900 text-sm">Staff Roles</h2>
                  </div>
                  <span className="text-xs text-slate-400 font-medium">
                    {roles.length} role{roles.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {rolesLoading ? (
                    <span className="text-xs text-slate-400 font-medium">Loading roles...</span>
                  ) : roles.length === 0 ? (
                    <span className="text-xs text-slate-400 font-medium">
                      No roles yet — add one below, e.g. "Nurse" or "Housekeeping".
                    </span>
                  ) : (
                    roles.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full"
                      >
                        {r.name}
                        <button
                          type="button"
                          onClick={() => handleDeleteRole(r.id)}
                          className="text-slate-400 hover:text-rose-600 transition-colors"
                          title={`Delete ${r.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                <div className="flex gap-2 max-w-sm">
                  <input
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="Add a new role, e.g. Nurse"
                    className={INPUT_CLASS}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRole(newRoleName);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddRole(newRoleName)}
                    disabled={addingRole || !newRoleName.trim()}
                    className="px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                  >
                    {addingRole && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Add
                  </button>
                </div>
                {roleError && <p className="text-[11px] text-rose-600 font-semibold mt-2">{roleError}</p>}
              </div>

              {pendingStaff.length > 0 && (
                <div className="bg-amber-50/90 backdrop-blur-sm border border-amber-300 rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <Bell className="w-5 h-5 text-amber-600" />
                    <h2 className="font-bold text-amber-950 text-base">
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
                          <p className="font-bold text-slate-900 text-sm">{s.full_name}</p>
                          <p className="text-xs text-slate-500 font-medium">{s.email}</p>
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
                  <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
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
                <div className="bg-white/85 backdrop-blur-sm rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-100/70 text-slate-700 font-bold text-xs uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4">Staff Member</th>
                        <th className="px-6 py-4">Position / Dept</th>
                        <th className="px-6 py-4">Assigned Room</th>
                        <th className="px-6 py-4">Shift</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStaff.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900">{s.full_name}</p>
                              {s.phone_verified && (
                                <span title="Phone Verified" className="text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 font-medium">{s.email}</p>
                            {s.phone_number && <p className="text-[11px] text-slate-500 font-medium">{s.phone_number}</p>}
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-900">{s.position || '—'}</p>
                            <p className="text-xs text-slate-500 font-medium">{s.department || '—'}</p>
                          </td>
                          <td className="px-6 py-4 font-medium">
                            {s.room_no_assigned ? `Room ${s.room_no_assigned}` : 'Unassigned'}
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-800">
                            {s.shift_start && s.shift_end
                              ? `${formatTime(s.shift_start)} - ${formatTime(s.shift_end)}`
                              : '—'}
                          </td>
                          <td className="px-6 py-4"><StaffStatusBadge status={s.status} /></td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEditStaff(s)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                                title="Edit staff details"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteStaff(s.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50"
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
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-200 ${
            residentModalClosing ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">
                {editingResidentId ? 'Edit Resident' : 'Add New Resident'}
              </h2>
              <button
                onClick={closeResidentModal}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100"
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
                <label className="block text-xs font-bold text-slate-900 mb-1">Full Name *</label>
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
                  <label className="block text-xs font-bold text-slate-900 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={residentForm.dob}
                    onChange={(e) => setResidentForm({ ...residentForm, dob: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Room Number</label>
                  <input
                    value={residentForm.room_number}
                    onChange={(e) => setResidentForm({ ...residentForm, room_number: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="e.g. 104-B"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Status</label>
                <select
                  value={residentForm.status}
                  onChange={(e) => setResidentForm({ ...residentForm, status: e.target.value as ResidentStatus })}
                  className={SELECT_CLASS}
                >
                  <option value="active" className="bg-white text-slate-900 font-medium py-1.5">Active</option>
                  <option value="discharged" className="bg-white text-slate-900 font-medium py-1.5">Discharged</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Address / Prior Location</label>
                <input
                  value={residentForm.address}
                  onChange={(e) => setResidentForm({ ...residentForm, address: e.target.value })}
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Medical Notes</label>
                <textarea
                  rows={2}
                  value={residentForm.medical_notes}
                  onChange={(e) => setResidentForm({ ...residentForm, medical_notes: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Allergies, conditions, medications..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Medical Report (file)</label>

                {existingReportPath && !removeExistingReport && (
                  <div className="flex items-center justify-between gap-2 mb-2 px-3.5 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50">
                    <button
                      type="button"
                      onClick={() => handleViewReport(existingReportPath)}
                      disabled={reportOpening === existingReportPath}
                      className="flex items-center gap-2 text-xs font-bold text-emerald-800 hover:text-emerald-900 min-w-0 disabled:opacity-60"
                    >
                      {reportOpening === existingReportPath ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4 shrink-0" />
                      )}
                      <span className="truncate">{existingReportName || 'View current report'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveExistingReport(true)}
                      className="text-[11px] font-bold text-rose-600 hover:text-rose-700 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                )}

                {removeExistingReport && (
                  <div className="flex items-center justify-between gap-2 mb-2 px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50">
                    <span className="text-xs font-bold text-rose-800">
                      Current report will be removed when you save.
                    </span>
                    <button
                      type="button"
                      onClick={() => setRemoveExistingReport(false)}
                      className="text-[11px] font-bold text-rose-700 hover:text-rose-800 shrink-0"
                    >
                      Undo
                    </button>
                  </div>
                )}

                <label className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-600 truncate">
                    {residentFile ? residentFile.name : 'Upload a PDF, image, or document'}
                  </span>
                  <input
                    type="file"
                    accept={MEDICAL_REPORT_ACCEPT}
                    className="hidden"
                    onChange={(e) => setResidentFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {residentFile && (
                  <button
                    type="button"
                    onClick={() => setResidentFile(null)}
                    className="mt-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700"
                  >
                    Clear selected file
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Dietary Needs</label>
                <textarea
                  rows={2}
                  value={residentForm.dietary_needs}
                  onChange={(e) => setResidentForm({ ...residentForm, dietary_needs: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Low sodium, diabetic, pureed..."
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="mb-3">
                  <h3 className="text-sm font-bold text-slate-900">Family / Emergency Contact</h3>
                  <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                    These details are saved to the Family Contacts section and linked to this resident.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Contact Full Name</label>
                  <input
                    required={Boolean(
                      residentFamilyForm.phone.trim() ||
                        residentFamilyForm.relationship.trim() ||
                        residentFamilyForm.email.trim() ||
                        residentFamilyForm.is_primary
                    )}
                    value={residentFamilyForm.full_name}
                    onChange={(e) =>
                      setResidentFamilyForm({ ...residentFamilyForm, full_name: e.target.value })
                    }
                    className={INPUT_CLASS}
                    placeholder="e.g. John Smith"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">Relationship</label>
                    <input
                      value={residentFamilyForm.relationship}
                      onChange={(e) =>
                        setResidentFamilyForm({ ...residentFamilyForm, relationship: e.target.value })
                      }
                      className={INPUT_CLASS}
                      placeholder="e.g. Son, Daughter"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">Phone Number</label>
                    <input
                      required={Boolean(
                        residentFamilyForm.full_name.trim() ||
                          residentFamilyForm.relationship.trim() ||
                          residentFamilyForm.email.trim() ||
                          residentFamilyForm.is_primary
                      )}
                      value={residentFamilyForm.phone}
                      onChange={(e) =>
                        setResidentFamilyForm({ ...residentFamilyForm, phone: e.target.value })
                      }
                      className={INPUT_CLASS}
                      placeholder="e.g. +1 555 123 4567"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-bold text-slate-900 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={residentFamilyForm.email}
                    onChange={(e) =>
                      setResidentFamilyForm({ ...residentFamilyForm, email: e.target.value })
                    }
                    className={INPUT_CLASS}
                    placeholder="family@example.com"
                  />
                </div>

                <div className="flex items-center gap-2 pt-3">
                  <input
                    type="checkbox"
                    id="resident_family_is_primary"
                    checked={residentFamilyForm.is_primary}
                    onChange={(e) =>
                      setResidentFamilyForm({ ...residentFamilyForm, is_primary: e.target.checked })
                    }
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <label
                    htmlFor="resident_family_is_primary"
                    className="text-xs font-bold text-slate-900 cursor-pointer"
                  >
                    Set as primary emergency contact
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeResidentModal}
                  className="px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl"
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
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-200 ${
            staffModalClosing ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">
                {isNewStaffCreation ? 'Add New Staff Member' : isNewAssignment ? 'Assign Staff Details' : 'Edit Staff Details'}
              </h2>
              <button
                onClick={closeStaffModal}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100"
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
                  <label className="block text-xs font-bold text-slate-900 mb-1">Full Name *</label>
                  <input
                    required
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="Thomas"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={staffForm.email}
                    onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                    className={INPUT_CLASS}
                    placeholder="thomas@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Phone Number</label>
                <input
                  value={staffForm.phone_number}
                  onChange={(e) => setStaffForm({ ...staffForm, phone_number: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="1234567890"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-900">Position / Role</label>
                  </div>
                  <select
                    value={staffForm.role_id}
                    onChange={(e) => setStaffForm({ ...staffForm, role_id: e.target.value })}
                    className={SELECT_CLASS}
                  >
                    <option value="">-- Select Role --</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {roles.length === 0 && !rolesLoading && (
                    <p className="text-[11px] text-slate-400 font-medium mt-1">
                      No roles yet — add one from the "Staff Roles" section on the Staff tab.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Department</label>
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
                  <label className="block text-xs font-bold text-slate-900 mb-1">Room Assigned</label>
                  <select
                    value={staffForm.room_no_assigned}
                    onChange={(e) => setStaffForm({ ...staffForm, room_no_assigned: e.target.value })}
                    className={SELECT_CLASS}
                  >
                    <option value="" className="bg-white text-slate-900 font-medium py-1.5">
                      -- Select Room --
                    </option>
                    {roomOptions.map((roomNumber) => (
                      <option
                        key={roomNumber}
                        value={roomNumber}
                        className="bg-white text-slate-900 font-medium py-1.5"
                      >
                        Room {roomNumber}
                      </option>
                    ))}
                  </select>
                  {roomOptions.length === 0 ? (
                    <p className="text-[11px] text-amber-600 font-semibold mt-1">
                      No room numbers are available yet. Add a room number to a resident first.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400 font-medium mt-1">
                      Rooms are taken directly from residents.room_number. The same room can be
                      assigned to multiple staff members for different shifts.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Shift Start</label>
                  <input
                    type="time"
                    value={staffForm.shift_start}
                    onChange={(e) => setStaffForm({ ...staffForm, shift_start: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">Shift End</label>
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
                  <label className="block text-xs font-bold text-slate-900 mb-1">Status</label>
                  <select
                    value={staffForm.status}
                    onChange={(e) => setStaffForm({ ...staffForm, status: e.target.value as StaffStatus })}
                    className={SELECT_CLASS}
                  >
                    <option value="active" className="bg-white text-slate-900 font-medium py-1.5">Active</option>
                    <option value="on_leave" className="bg-white text-slate-900 font-medium py-1.5">On Leave</option>
                    <option value="inactive" className="bg-white text-slate-900 font-medium py-1.5">Inactive</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={staffForm.phone_verified}
                      onChange={(e) => setStaffForm({ ...staffForm, phone_verified: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                    />
                    <span className="text-xs font-bold text-slate-900">Phone Verified</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-900 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={staffForm.notes}
                  onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Additional observations or administrative notes..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeStaffModal}
                  className="px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={staffSaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md flex items-center gap-2"
                >
                  {staffSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isNewStaffCreation ? 'Create Staff' : 'Save Staff Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ FLOATING AI ASSISTANT BUTTON ═══════════════════════════════════ */}
      <FloatingAIButton onClick={() => router.push(BEHAVIORAL_AI_NEW_CHAT_PATH)} />
    </div>
  );
}

// ─── Subcomponents & Helpers ───────────────────────────────────────────────────

function ResidentStatusBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'Active' },
    discharged: { cls: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Discharged' },
    deceased: { cls: 'bg-slate-200 text-slate-800 border-slate-300', label: 'Deceased' },
  };

  const normalized = (status || '').toLowerCase().trim();
  const badge = map[normalized] ?? {
    cls: 'bg-slate-100 text-slate-800 border-slate-300',
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
    cls: 'bg-slate-100 text-slate-800 border-slate-300',
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
  const COLOR_MAP: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700',
    teal: 'bg-teal-100 text-teal-700',
    blue: 'bg-blue-100 text-blue-700',
    violet: 'bg-violet-100 text-violet-700',
  };

  return (
    <div
      className="bg-white/85 backdrop-blur-sm rounded-3xl p-5 border border-slate-200/70 shadow-sm hover:shadow-md transition-shadow duration-300 animate-[fadeUp_0.4s_ease-out_backwards]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${COLOR_MAP[color] ?? 'bg-emerald-100 text-emerald-700'}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs font-semibold text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

// ─── Real-time-computed charts (pure SVG, no chart library needed) ────────────

function DonutChart({
  data,
  totalLabel,
  size = 132,
  strokeWidth = 16,
}: {
  data: { label: string; value: number; color: string }[];
  totalLabel: string;
  size?: number;
  strokeWidth?: number;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offsetAcc = 0;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EEF2E9" strokeWidth={strokeWidth} />
        {total > 0 &&
          data
            .filter((d) => d.value > 0)
            .map((d, i) => {
              const fraction = d.value / total;
              const dash = fraction * circumference;
              const gap = circumference - dash;
              const strokeDashoffset = -offsetAcc;
              offsetAcc += dash;
              return (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-700 ease-out"
                />
              );
            })}
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-tight">{total}</p>
        <p className="text-[11px] text-slate-500 font-medium mb-2">{totalLabel}</p>
        <div className="space-y-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="text-slate-600 font-medium flex-1 truncate">{d.label}</span>
              <span className="text-slate-900 font-bold">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniBarChart({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end justify-between gap-2 h-28">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
          <span className="text-[10px] font-bold text-slate-500">{v > 0 ? v : ''}</span>
          <div className="w-full h-[72px] flex items-end justify-center">
            <div
              className="w-full max-w-[26px] rounded-t-lg bg-gradient-to-t from-emerald-500 to-teal-400 transition-all duration-700 ease-out"
              style={{ height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%` }}
              title={`${labels[i]}: ${v}`}
            />
          </div>
          <span className="text-[10px] font-semibold text-slate-400">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Floating AI assistant launcher ───────────────────────────────────────────
function FloatingAIButton({ onClick }: { onClick: () => void }) {
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);
  const [bubbleDismissed, setBubbleDismissed] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex((i) => (i + 1) % AI_TIPS.length);
        setTipVisible(true);
      }, 250);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3 transition-all duration-500 ease-out ${
        entered ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-90'
      }`}
    >
      {!bubbleDismissed && (
        <div
          className={`relative max-w-[230px] bg-white border border-slate-200 rounded-2xl rounded-br-sm shadow-lg px-4 py-3 pr-6 transition-all duration-300 ${
            tipVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          }`}
        >
          <button
            onClick={() => setBubbleDismissed(true)}
            className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            title="Dismiss"
          >
            <X className="w-2.5 h-2.5 text-slate-500" />
          </button>
          <p className="text-xs font-medium text-slate-700 leading-snug">{AI_TIPS[tipIndex]}</p>
        </div>
      )}

      <button
        onClick={onClick}
        title="Ask Behavioral AI — starts a new chat"
        className="relative w-16 h-16 rounded-full flex items-center justify-center shadow-xl shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-transform duration-200"
        style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)' }}
      >
        <span className="absolute inset-0 rounded-full bg-indigo-400/40 animate-ping" style={{ animationDuration: '2.4s' }} />
        <Bot className="w-7 h-7 text-white relative z-10" />
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-sm">
          <Sparkles className="w-3 h-3 text-indigo-600" />
        </span>
      </button>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof Users; message: string }) {
  return (
    <div className="py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-200/80 text-slate-500 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-sm font-bold text-slate-600">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="py-20 text-center flex flex-col items-center justify-center gap-2">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
      <p className="text-xs font-bold text-slate-500">Loading data...</p>
    </div>
  );
}