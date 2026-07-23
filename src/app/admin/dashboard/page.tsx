'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type ResidentStatus = 'active' | 'discharged' | 'deceased';

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

type Tab = 'overview' | 'residents' | 'staff';

const emptyForm = {
  full_name: '',
  dob: '',
  address: '',
  room_number: '',
  medical_notes: '',
  dietary_needs: '',
  status: 'active' as ResidentStatus,
};

const NAV_ITEMS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'residents', label: 'Residents', icon: Users },
  { id: 'staff', label: 'Staff', icon: ClipboardList },
];

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>('overview');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [stats, setStats] = useState({
    totalResidents: 0,
    activeResidents: 0,
    familyContacts: 0,
    openAlerts: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchResidents = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('residents')
      .select('*')
      .order('created_at', { ascending: false });

    if (!fetchError && data) setResidents(data as Resident[]);
    setLoading(false);
  }, [supabase]);

  const fetchStats = useCallback(async () => {
    const [residentsRes, activeRes, familyRes, alertsRes] = await Promise.all([
      supabase.from('residents').select('id', { count: 'exact', head: true }),
      supabase.from('residents').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('family_contacts').select('id', { count: 'exact', head: true }),
      supabase.from('emergency_alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

    setStats({
      totalResidents: residentsRes.count ?? 0,
      activeResidents: activeRes.count ?? 0,
      familyContacts: familyRes.count ?? 0,
      openAlerts: alertsRes.count ?? 0,
    });
  }, [supabase]);

  useEffect(() => {
    fetchResidents();
    fetchStats();
  }, [fetchResidents, fetchStats]);

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
    setModalClosing(false);
  }

  function openEditModal(resident: Resident) {
    setEditingId(resident.id);
    setForm({
      full_name: resident.full_name,
      dob: resident.dob ?? '',
      address: resident.address ?? '',
      room_number: resident.room_number ?? '',
      medical_notes: resident.medical_notes ?? '',
      dietary_needs: resident.dietary_needs ?? '',
      status: resident.status,
    });
    setError('');
    setShowModal(true);
    setModalClosing(false);
  }

  function closeModal() {
    setModalClosing(true);
    setTimeout(() => {
      setShowModal(false);
      setModalClosing(false);
    }, 180);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      full_name: form.full_name,
      dob: form.dob || null,
      address: form.address || null,
      room_number: form.room_number || null,
      medical_notes: form.medical_notes || null,
      dietary_needs: form.dietary_needs || null,
      status: form.status,
    };

    const { error: saveError } = editingId
      ? await supabase.from('residents').update(payload).eq('id', editingId)
      : await supabase.from('residents').insert(payload);

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    closeModal();
    fetchResidents();
    fetchStats();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this resident? This cannot be undone.')) return;
    await supabase.from('residents').delete().eq('id', id);
    fetchResidents();
    fetchStats();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const filteredResidents = residents.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const statusStyles: Record<ResidentStatus, string> = {
    active: 'bg-[#EAF4F1] text-[#357366]',
    discharged: 'bg-[#F3EEE6] text-[#8A6D3B]',
    deceased: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex">
      {/* Sidebar */}
      <aside
        className={`w-64 bg-white border-r border-gray-100 flex flex-col py-6 px-4 shrink-0 transition-all duration-500 ease-out ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`}
      >
        <div className="flex items-center gap-2 px-2 mb-8">
          <div className="w-8 h-8 rounded-xl bg-[#EAF4F1] flex items-center justify-center transition-transform duration-300 hover:scale-110 hover:rotate-6">
            <HeartHandshake className="w-4 h-4 text-[#357366]" />
          </div>
          <span className="font-bold text-lg">ElderLink</span>
        </div>

        <nav className="flex-1 space-y-1 relative">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                tab === id
                  ? 'bg-[#EAF4F1] text-[#357366]'
                  : 'text-gray-500 hover:bg-gray-50 hover:translate-x-0.5'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {tab === id && (
                <span className="absolute right-3 w-1.5 h-1.5 rounded-full bg-[#357366] animate-[pulseDot_2s_ease-in-out_infinite]" />
              )}
            </button>
          ))}
        </nav>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-500 transition-all duration-200"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 md:p-10 overflow-y-auto">
        <div
          key={tab}
          className="animate-[fadeUp_0.4s_ease-out]"
        >
          {tab === 'overview' && (
            <div>
              <h1 className="text-2xl font-bold mb-1">Overview</h1>
              <p className="text-gray-500 mb-8">A quick look at how things stand today.</p>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                <StatCard label="Total residents" value={stats.totalResidents} accent="#4F9C8B" delay={0} />
                <StatCard label="Active residents" value={stats.activeResidents} accent="#357366" delay={80} />
                <StatCard label="Family contacts" value={stats.familyContacts} accent="#3B5C8A" delay={160} />
                <StatCard
                  label="Open alerts"
                  value={stats.openAlerts}
                  accent="#D8654F"
                  icon={<Bell className="w-4 h-4" />}
                  delay={240}
                  pulse={stats.openAlerts > 0}
                />
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 p-6 transition-shadow duration-300 hover:shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold">Recently added residents</h2>
                  <button
                    onClick={() => setTab('residents')}
                    className="text-xs font-semibold text-[#4F9C8B] flex items-center gap-1 hover:gap-1.5 transition-all"
                  >
                    View all <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                {residents.slice(0, 5).length === 0 ? (
                  <p className="text-sm text-gray-400">No residents added yet.</p>
                ) : (
                  <div className="space-y-1">
                    {residents.slice(0, 5).map((r, i) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between text-sm px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-all duration-200 animate-[fadeUp_0.4s_ease-out_backwards]"
                        style={{ animationDelay: `${i * 60}ms` }}
                      >
                        <span className="font-medium">{r.full_name}</span>
                        <span className={`text-xs px-2 py-1 rounded-full ${statusStyles[r.status]}`}>
                          {r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'residents' && (
            <div>
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h1 className="text-2xl font-bold mb-1">Residents</h1>
                  <p className="text-gray-500">Manage resident profiles and care details.</p>
                </div>
                <button
                  onClick={openAddModal}
                  className="flex items-center gap-2 bg-[#4F9C8B] text-white font-semibold text-sm px-4 py-2.5 rounded-full hover:bg-[#438a7a] active:scale-95 transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  <Plus className="w-4 h-4" />
                  Add resident
                </button>
              </div>

              <div className="relative mb-5 max-w-sm group">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 transition-colors group-focus-within:text-[#4F9C8B]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search residents..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200"
                />
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden transition-shadow duration-300 hover:shadow-md">
                {loading ? (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading residents...
                  </div>
                ) : filteredResidents.length === 0 ? (
                  <div className="text-center py-16 text-gray-400 text-sm">
                    No residents found. Add your first resident to get started.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-gray-400 text-xs uppercase tracking-wide">
                        <th className="px-6 py-3 font-medium">Name</th>
                        <th className="px-6 py-3 font-medium">Room</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                        <th className="px-6 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResidents.map((r, i) => (
                        <tr
                          key={r.id}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-all duration-200 animate-[fadeUp_0.35s_ease-out_backwards]"
                          style={{ animationDelay: `${i * 40}ms` }}
                        >
                          <td className="px-6 py-4 font-medium">{r.full_name}</td>
                          <td className="px-6 py-4 text-gray-500">{r.room_number || '—'}</td>
                          <td className="px-6 py-4">
                            <span className={`text-xs px-2 py-1 rounded-full ${statusStyles[r.status]}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => openEditModal(r)}
                                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150"
                                aria-label="Edit resident"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(r.id)}
                                className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 active:scale-90 transition-all duration-150"
                                aria-label="Delete resident"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {tab === 'staff' && (
            <div>
              <h1 className="text-2xl font-bold mb-1">Staff</h1>
              <p className="text-gray-500 mb-8">Manage staff accounts and access.</p>
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center transition-shadow duration-300 hover:shadow-md">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                  <ClipboardList className="w-6 h-6 text-gray-300" />
                </div>
                <p className="font-medium text-gray-600 mb-1">Staff accounts coming soon</p>
                <p className="text-sm text-gray-400 max-w-sm mx-auto">
                  Staff role support isn&rsquo;t wired up in the database yet — this section will
                  activate once that&rsquo;s added back in.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Add/Edit Resident Modal */}
      {showModal && (
        <div
          className={`fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50 transition-opacity duration-200 ${
            modalClosing ? 'opacity-0' : 'opacity-100 animate-[fadeIn_0.2s_ease-out]'
          }`}
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div
            className={`bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto transition-all duration-200 ${
              modalClosing
                ? 'opacity-0 scale-95 translate-y-2'
                : 'opacity-100 scale-100 translate-y-0 animate-[modalIn_0.25s_ease-out]'
            }`}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-semibold text-lg">
                {editingId ? 'Edit resident' : 'Add resident'}
              </h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 hover:rotate-90 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500">Full name</label>
                <input
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200"
                  placeholder="Resident's name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500">Date of birth</label>
                  <input
                    type="date"
                    value={form.dob}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500">Room number</label>
                  <input
                    value={form.room_number}
                    onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200"
                    placeholder="e.g. 204"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200"
                  placeholder="On-file address"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">Medical notes</label>
                <textarea
                  value={form.medical_notes}
                  onChange={(e) => setForm({ ...form, medical_notes: e.target.value })}
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200 resize-none"
                  placeholder="Conditions, medications, allergies..."
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">Dietary needs</label>
                <textarea
                  value={form.dietary_needs}
                  onChange={(e) => setForm({ ...form, dietary_needs: e.target.value })}
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200 resize-none"
                  placeholder="Allergies, preferences, restrictions..."
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ResidentStatus })}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all duration-200 bg-white"
                >
                  <option value="active">Active</option>
                  <option value="discharged">Discharged</option>
                  <option value="deceased">Deceased</option>
                </select>
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 animate-[fadeUp_0.25s_ease-out]">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-full border border-gray-200 font-semibold text-sm hover:bg-gray-50 active:scale-95 transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-full bg-[#4F9C8B] text-white font-semibold text-sm hover:bg-[#438a7a] active:scale-95 disabled:opacity-60 transition-all duration-150 shadow-sm hover:shadow-md"
                >
                  {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add resident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.94) translateY(12px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes softPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(216, 101, 79, 0.15); }
          50% { box-shadow: 0 0 0 6px rgba(216, 101, 79, 0); }
        }
      `}</style>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  icon,
  delay = 0,
  pulse = false,
}: {
  label: string;
  value: number;
  accent: string;
  icon?: React.ReactNode;
  delay?: number;
  pulse?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 p-5 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 animate-[fadeUp_0.5s_ease-out_backwards] ${
        pulse ? 'animate-[softPulse_2.5s_ease-in-out_infinite]' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {label}
        </span>
        {icon && <span style={{ color: accent }}>{icon}</span>}
      </div>
      <p className="text-3xl font-extrabold transition-all duration-500" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}