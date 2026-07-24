'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  Camera,
  UserCircle2,
  Sparkles,
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

const emptyStaffForm = { full_name: '', email: '', phone: '' };

const NAV_ITEMS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'residents', label: 'Residents', icon: Users },
  { id: 'staff', label: 'Staff', icon: ClipboardList },
];

const statusStyles: Record<ResidentStatus, string> = {
  active: 'bg-[#CFE6DD] text-[#1E5C4C]',
  discharged: 'bg-[#E9DDC2] text-[#6B4E1E]',
  deceased: 'bg-[#DCDCDC] text-[#4B4B4B]',
};

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('overview');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(false);
  const [adminName, setAdminName] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [staffMessage, setStaffMessage] = useState('');

  const [stats, setStats] = useState({
    totalResidents: 0,
    activeResidents: 0,
    familyContacts: 0,
    openAlerts: 0,
  });

  useEffect(() => {
    setMounted(true);
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', data.user.id)
          .single();
        if (profile?.full_name) setAdminName(profile.full_name.split(' ')[0]);
      }
    })();
  }, [supabase]);

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
    setPhotoFile(null);
    setPhotoPreview(null);
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
    setPhotoFile(null);
    setPhotoPreview(resident.photo_url);
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

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function uploadPhoto(residentId: string): Promise<string | null> {
    if (!photoFile) return null;
    setUploadingPhoto(true);
    const fileExt = photoFile.name.split('.').pop();
    const filePath = `${residentId}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('resident-photos')
      .upload(filePath, photoFile, { upsert: true });
    setUploadingPhoto(false);
    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      setError(`Photo upload failed: ${uploadError.message}`);
      return null;
    }
    const { data } = supabase.storage.from('resident-photos').getPublicUrl(filePath);
    return data.publicUrl;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    let photoUrl: string | null = editingId
      ? residents.find((r) => r.id === editingId)?.photo_url ?? null
      : null;

    const payload = {
      full_name: form.full_name,
      dob: form.dob || null,
      address: form.address || null,
      room_number: form.room_number || null,
      medical_notes: form.medical_notes || null,
      dietary_needs: form.dietary_needs || null,
      status: form.status,
    };

    if (editingId) {
      if (photoFile) {
        const uploaded = await uploadPhoto(editingId);
        if (uploaded) photoUrl = uploaded;
      }
      const { error: saveError } = await supabase
        .from('residents')
        .update({ ...payload, photo_url: photoUrl })
        .eq('id', editingId);
      setSaving(false);
      if (saveError) {
        setError(saveError.message);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('residents')
        .insert(payload)
        .select()
        .single();
      if (insertError || !inserted) {
        setSaving(false);
        setError(insertError?.message || 'Could not create resident.');
        return;
      }
      if (photoFile) {
        const uploaded = await uploadPhoto(inserted.id);
        if (uploaded) {
          await supabase.from('residents').update({ photo_url: uploaded }).eq('id', inserted.id);
        }
      }
      setSaving(false);
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

  function handleStaffSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStaffMessage(
      'Staff account creation is ready in the UI but needs the dual-role database setup to actually work.'
    );
  }

  const filteredResidents = residents.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="min-h-screen bg-[#DEDAD0] flex font-sans text-[#2A2A28]">
      {/* Sidebar */}
      <aside
        className={`w-64 bg-[#F5F3EC] border-r border-[#C9C4B6] flex flex-col py-6 px-4 shrink-0 transition-all duration-500 ease-out ${
          mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`}
      >
        <div className="flex items-center gap-2 px-2 mb-8">
          <div className="w-8 h-8 rounded-xl bg-[#2F6F63] flex items-center justify-center transition-transform duration-300 hover:scale-110 hover:rotate-6">
            <HeartHandshake className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-[#1F1F1D]">ElderLink</span>
        </div>

        <nav className="flex-1 space-y-1 relative">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                tab === id
                  ? 'bg-[#2F6F63] text-white shadow-sm'
                  : 'text-[#4B4A46] hover:bg-[#E9E5D9] hover:translate-x-0.5'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {id === 'residents' && stats.totalResidents > 0 && (
                <span
                  className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    tab === id ? 'bg-white/20 text-white' : 'bg-[#DEDAD0] text-[#5C5A54]'
                  }`}
                >
                  {stats.totalResidents}
                </span>
              )}
              {id === 'staff' && (
                <span
                  className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                    tab === id ? 'bg-white/20 text-white' : 'bg-[#E9DDC2] text-[#6B4E1E]'
                  }`}
                >
                  soon
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="border-t border-[#C9C4B6] pt-4 mt-4">
          {adminName && (
            <div className="flex items-center gap-2 px-3 mb-2">
              <div className="w-7 h-7 rounded-full bg-[#2F6F63] text-white flex items-center justify-center text-xs font-bold">
                {adminName.charAt(0)}
              </div>
              <span className="text-sm font-semibold text-[#2A2A28]">{adminName}</span>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-[#4B4A46] hover:bg-[#F3D9D3] hover:text-[#B23B2A] transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 md:p-10">
          <div key={tab} className="animate-[fadeUp_0.4s_ease-out]">
            {tab === 'overview' && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-5 h-5 text-[#2F6F63]" />
                  <h1 className="text-2xl font-extrabold text-[#1F1F1D] tracking-tight">
                    {greeting}{adminName ? `, ${adminName}` : ''}
                  </h1>
                </div>
                <p className="text-[#5C5A54] mb-8">Here's how things stand today.</p>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                  <StatCard label="Total residents" value={stats.totalResidents} accent="#2F6F63" delay={0} icon={<Users className="w-4 h-4" />} />
                  <StatCard label="Active residents" value={stats.activeResidents} accent="#1E5C4C" delay={80} icon={<UserCircle2 className="w-4 h-4" />} />
                  <StatCard label="Family contacts" value={stats.familyContacts} accent="#33517A" delay={160} icon={<Users className="w-4 h-4" />} />
                  <StatCard
                    label="Open alerts"
                    value={stats.openAlerts}
                    accent="#B23B2A"
                    icon={<Bell className="w-4 h-4" />}
                    delay={240}
                    pulse={stats.openAlerts > 0}
                  />
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-[#F5F3EC] rounded-2xl border border-[#C9C4B6] p-6 transition-shadow duration-300 hover:shadow-md">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-bold text-[#1F1F1D]">Recently added residents</h2>
                      <button
                        onClick={() => setTab('residents')}
                        className="text-xs font-bold text-[#2F6F63] flex items-center gap-1 hover:gap-1.5 transition-all"
                      >
                        View all <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {residents.slice(0, 5).length === 0 ? (
                      <EmptyState
                        icon={<Users className="w-6 h-6" />}
                        title="No residents yet"
                        subtitle="Add your first resident to see them here."
                      />
                    ) : (
                      <div className="space-y-1">
                        {residents.slice(0, 5).map((r, i) => (
                          <button
                            key={r.id}
                            onClick={() => router.push(`/admin/residents/${r.id}`)}
                            className="w-full flex items-center gap-3 text-sm px-3 py-2.5 rounded-xl hover:bg-[#EBE8DD] transition-all duration-200 animate-[fadeUp_0.4s_ease-out_backwards] text-left"
                            style={{ animationDelay: `${i * 60}ms` }}
                          >
                            {r.photo_url ? (
                              <img src={r.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-[#DEDAD0] flex items-center justify-center text-xs font-bold text-[#6B695F]">
                                {r.full_name.charAt(0)}
                              </div>
                            )}
                            <span className="font-semibold text-[#2A2A28] flex-1">{r.full_name}</span>
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusStyles[r.status]}`}>
                              {r.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-gradient-to-br from-[#2F6F63] to-[#1E5C4C] rounded-2xl p-6 text-white flex flex-col justify-between">
                    <div>
                      <h2 className="font-bold mb-2">Quick add</h2>
                      <p className="text-sm text-white/80 mb-6">
                        Add a new resident profile in seconds.
                      </p>
                    </div>
                    <button
                      onClick={openAddModal}
                      className="flex items-center justify-center gap-2 bg-white text-[#1E5C4C] font-semibold text-sm py-2.5 rounded-full hover:bg-white/90 active:scale-95 transition-all"
                    >
                      <Plus className="w-4 h-4" />
                      Add resident
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'residents' && (
              <div>
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <div>
                    <h1 className="text-2xl font-extrabold mb-1 text-[#1F1F1D] tracking-tight">Residents</h1>
                    <p className="text-[#5C5A54]">Manage resident profiles and care details.</p>
                  </div>
                  <button
                    onClick={openAddModal}
                    className="flex items-center gap-2 bg-[#2F6F63] text-white font-semibold text-sm px-4 py-2.5 rounded-full hover:bg-[#265a50] active:scale-95 transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    Add resident
                  </button>
                </div>

                <div className="relative mb-5 max-w-sm group">
                  <Search className="w-4 h-4 text-[#6B695F] absolute left-3 top-1/2 -translate-y-1/2 transition-colors group-focus-within:text-[#2F6F63]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search residents..."
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#C9C4B6] bg-[#F5F3EC] text-sm text-[#2A2A28] placeholder:text-[#8A8878] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  />
                </div>

                <div className="bg-[#F5F3EC] rounded-2xl border border-[#C9C4B6] overflow-hidden transition-shadow duration-300 hover:shadow-md">
                  {loading ? (
                    <div className="flex items-center justify-center py-16 text-[#6B695F]">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Loading residents...
                    </div>
                  ) : filteredResidents.length === 0 ? (
                    <EmptyState
                      icon={<Users className="w-6 h-6" />}
                      title="No residents found"
                      subtitle="Add your first resident to get started."
                      className="py-16"
                    />
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#C9C4B6] text-left text-[#5C5A54] text-xs uppercase tracking-wide">
                          <th className="px-6 py-3 font-bold">Name</th>
                          <th className="px-6 py-3 font-bold">Room</th>
                          <th className="px-6 py-3 font-bold">Status</th>
                          <th className="px-6 py-3 font-bold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResidents.map((r, i) => (
                          <tr
                            key={r.id}
                            onClick={() => router.push(`/admin/residents/${r.id}`)}
                            className="border-b border-[#DEDAD0] last:border-0 hover:bg-[#EBE8DD] transition-all duration-200 animate-[fadeUp_0.35s_ease-out_backwards] cursor-pointer group"
                            style={{ animationDelay: `${i * 40}ms` }}
                          >
                            <td className="px-6 py-4 font-semibold text-[#2A2A28]">
                              <div className="flex items-center gap-3">
                                {r.photo_url ? (
                                  <img src={r.photo_url} alt={r.full_name} className="w-9 h-9 rounded-full object-cover" />
                                ) : (
                                  <div className="w-9 h-9 rounded-full bg-[#DEDAD0] flex items-center justify-center text-xs font-bold text-[#6B695F]">
                                    {r.full_name.charAt(0)}
                                  </div>
                                )}
                                {r.full_name}
                                <ChevronRight className="w-3.5 h-3.5 text-[#C9C4B6] opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all" />
                              </div>
                            </td>
                            <td className="px-6 py-4 text-[#5C5A54]">{r.room_number || '—'}</td>
                            <td className="px-6 py-4">
                              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusStyles[r.status]}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => openEditModal(r)}
                                  className="p-2 rounded-lg text-[#6B695F] hover:bg-[#DEDAD0] hover:text-[#2A2A28] active:scale-90 transition-all duration-150"
                                  aria-label="Edit resident"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(r.id)}
                                  className="p-2 rounded-lg text-[#6B695F] hover:bg-[#F3D9D3] hover:text-[#B23B2A] active:scale-90 transition-all duration-150"
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
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <div>
                    <h1 className="text-2xl font-extrabold mb-1 text-[#1F1F1D] tracking-tight">Staff</h1>
                    <p className="text-[#5C5A54]">Manage staff accounts and access.</p>
                  </div>
                  <button
                    onClick={() => {
                      setStaffForm(emptyStaffForm);
                      setStaffMessage('');
                      setShowStaffModal(true);
                    }}
                    className="flex items-center gap-2 bg-[#2F6F63] text-white font-semibold text-sm px-4 py-2.5 rounded-full hover:bg-[#265a50] active:scale-95 transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    Add staff
                  </button>
                </div>

                <div className="bg-[#F5F3EC] rounded-2xl border border-[#C9C4B6] p-10 text-center transition-shadow duration-300 hover:shadow-md">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#E9DDC2] to-[#D8C193] flex items-center justify-center mx-auto mb-4">
                    <ClipboardList className="w-7 h-7 text-[#6B4E1E]" />
                  </div>
                  <p className="font-semibold text-[#2A2A28] mb-1">Staff accounts launching soon</p>
                  <p className="text-sm text-[#6B695F] max-w-sm mx-auto">
                    The interface is ready — staff account creation activates once the
                    dual-role system is added back to the database.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Add/Edit Resident Modal */}
      {showModal && (
        <div
          className={`fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50 transition-opacity duration-200 ${
            modalClosing ? 'opacity-0' : 'opacity-100 animate-[fadeIn_0.2s_ease-out]'
          }`}
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div
            className={`bg-[#F5F3EC] rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto transition-all duration-200 ${
              modalClosing
                ? 'opacity-0 scale-95 translate-y-2'
                : 'opacity-100 scale-100 translate-y-0 animate-[modalIn_0.25s_ease-out]'
            }`}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#C9C4B6] sticky top-0 bg-[#F5F3EC] z-10">
              <h2 className="font-bold text-lg text-[#1F1F1D]">
                {editingId ? 'Edit resident' : 'Add resident'}
              </h2>
              <button
                onClick={closeModal}
                className="text-[#6B695F] hover:text-[#2A2A28] hover:rotate-90 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" className="w-16 h-16 rounded-2xl object-cover border border-[#C9C4B6]" />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-white border border-[#C9C4B6] flex items-center justify-center text-[#6B695F]">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm font-semibold text-[#2F6F63] hover:underline"
                  >
                    {photoPreview ? 'Change photo' : 'Upload photo'}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
                  <p className="text-xs text-[#8A8878] mt-0.5">JPG or PNG, up to a few MB</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Full name</label>
                <input
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] placeholder:text-[#8A8878] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  placeholder="Resident's name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Date of birth</label>
                  <input
                    type="date"
                    value={form.dob}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Room number</label>
                  <input
                    value={form.room_number}
                    onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] placeholder:text-[#8A8878] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                    placeholder="e.g. 204"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] placeholder:text-[#8A8878] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  placeholder="On-file address"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Medical notes</label>
                <textarea
                  value={form.medical_notes}
                  onChange={(e) => setForm({ ...form, medical_notes: e.target.value })}
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] placeholder:text-[#8A8878] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200 resize-none"
                  placeholder="Conditions, medications, allergies..."
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Dietary needs</label>
                <textarea
                  value={form.dietary_needs}
                  onChange={(e) => setForm({ ...form, dietary_needs: e.target.value })}
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] placeholder:text-[#8A8878] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200 resize-none"
                  placeholder="Allergies, preferences, restrictions..."
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ResidentStatus })}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200 bg-white"
                >
                  <option value="active">Active</option>
                  <option value="discharged">Discharged</option>
                  <option value="deceased">Deceased</option>
                </select>
              </div>

              {error && (
                <p className="text-sm text-[#B23B2A] font-medium bg-[#F3D9D3] border border-[#E0AFA5] rounded-lg px-3 py-2 animate-[fadeUp_0.25s_ease-out]">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-full border border-[#C9C4B6] font-semibold text-sm text-[#2A2A28] hover:bg-[#DEDAD0] active:scale-95 transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingPhoto}
                  className="flex-1 py-2.5 rounded-full bg-[#2F6F63] text-white font-semibold text-sm hover:bg-[#265a50] active:scale-95 disabled:opacity-60 transition-all duration-150 shadow-sm hover:shadow-md"
                >
                  {saving || uploadingPhoto ? 'Saving...' : editingId ? 'Save changes' : 'Add resident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showStaffModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50 animate-[fadeIn_0.2s_ease-out]"
          onClick={(e) => e.target === e.currentTarget && setShowStaffModal(false)}
        >
          <div className="bg-[#F5F3EC] rounded-3xl shadow-2xl w-full max-w-md animate-[modalIn_0.25s_ease-out]">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#C9C4B6]">
              <h2 className="font-bold text-lg text-[#1F1F1D]">Add staff</h2>
              <button
                onClick={() => setShowStaffModal(false)}
                className="text-[#6B695F] hover:text-[#2A2A28] hover:rotate-90 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStaffSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Full name</label>
                <input
                  required
                  value={staffForm.full_name}
                  onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  placeholder="Staff member's name"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Email</label>
                <input
                  type="email"
                  required
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  placeholder="staff@example.com"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#5C5A54]">Phone</label>
                <input
                  value={staffForm.phone}
                  onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all duration-200"
                  placeholder="+34 600 000 000"
                />
              </div>

              {staffMessage && (
                <p className="text-sm text-[#6B4E1E] bg-[#E9DDC2] border border-[#D8C193] rounded-lg px-3 py-2">
                  {staffMessage}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  className="flex-1 py-2.5 rounded-full border border-[#C9C4B6] font-semibold text-sm hover:bg-[#DEDAD0] active:scale-95 transition-all duration-150"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-full bg-[#2F6F63] text-white font-semibold text-sm hover:bg-[#265a50] active:scale-95 transition-all duration-150 shadow-sm hover:shadow-md"
                >
                  Add staff
                </button>
              </div>
            </form>
          </div>
        </div>
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
        @keyframes softPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(178, 59, 42, 0.18); }
          50% { box-shadow: 0 0 0 6px rgba(178, 59, 42, 0); }
        }
      `}</style>
    </div>
  );
}

function StatCard({
  label, value, accent, icon, delay = 0, pulse = false,
}: {
  label: string; value: number; accent: string; icon?: React.ReactNode; delay?: number; pulse?: boolean;
}) {
  return (
    <div
      className={`bg-[#F5F3EC] rounded-2xl border border-[#C9C4B6] p-5 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 animate-[fadeUp_0.5s_ease-out_backwards] ${
        pulse ? 'animate-[softPulse_2.5s_ease-in-out_infinite]' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-[#5C5A54] uppercase tracking-wide">{label}</span>
        {icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: accent, backgroundColor: `${accent}1A` }}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="text-3xl font-extrabold transition-all duration-500" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  icon, title, subtitle, className = '',
}: {
  icon: React.ReactNode; title: string; subtitle: string; className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-[#DEDAD0] flex items-center justify-center text-[#6B695F] mb-3">
        {icon}
      </div>
      <p className="font-semibold text-[#2A2A28] mb-0.5">{title}</p>
      <p className="text-sm text-[#6B695F]">{subtitle}</p>
    </div>
  );
}