'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Camera,
  Phone,
  Mail,
  Home,
  Cake,
  Pencil,
  Trash2,
  Loader2,
  X,
  Stethoscope,
  UtensilsCrossed,
  Users,
  ClipboardList,
  AlertTriangle,
  Siren,
  CheckCircle2,
  Clock,
  Bed,
  Star,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type ResidentStatus = 'active' | 'discharged' | 'deceased';
type AlertStatus = 'active' | 'resolved';

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
}

interface FamilyContact {
  id: string;
  full_name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

interface CareLog {
  id: string;
  created_at: string;
  meals: string | null;
  fluids: string | null;
  mood: string | null;
  mobility: string | null;
  medication_status: string | null;
  notes: string | null;
  staff: { full_name: string } | null;
}

interface IncidentRow {
  id: string;
  created_at: string;
  description: string | null;
  staff: { full_name: string } | null;
}

interface EmergencyAlertRow {
  id: string;
  created_at: string;
  resolved_at: string | null;
  type: string | null;
  status: AlertStatus;
  staff: { full_name: string } | null;
}

type TimelineKind = 'care_log' | 'incident' | 'emergency_alert';

interface TimelineItem {
  kind: TimelineKind;
  id: string;
  created_at: string;
  staffName: string;
  data: CareLog | IncidentRow | EmergencyAlertRow;
}

const statusStyles: Record<ResidentStatus, string> = {
  active: 'bg-[#E8F5E9] text-[#2E7D32]',
  discharged: 'bg-[#FFF3E0] text-[#E65100]',
  deceased: 'bg-[#F5F5F5] text-[#616161]',
};

const filterOptions: { id: 'all' | TimelineKind; label: string }[] = [
  { id: 'all', label: 'All activity' },
  { id: 'care_log', label: 'Care logs' },
  { id: 'incident', label: 'Incidents' },
  { id: 'emergency_alert', label: 'Alerts' },
];

function calcAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + `, ${time}`;
}

export default function ResidentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [resident, setResident] = useState<Resident | null>(null);
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [careLogs, setCareLogs] = useState<CareLog[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [alerts, setAlerts] = useState<EmergencyAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [timelineFilter, setTimelineFilter] = useState<'all' | TimelineKind>('all');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Resident | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const [residentRes, contactsRes, careLogsRes, incidentsRes, alertsRes] = await Promise.all([
      supabase.from('residents').select('*').eq('id', id).single(),
      supabase.from('family_contacts').select('*').eq('resident_id', id).order('is_primary', { ascending: false }),
      supabase
        .from('care_logs')
        .select('*, staff:staff_id(full_name)')
        .eq('resident_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('incidents')
        .select('*, staff:staff_id(full_name)')
        .eq('resident_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('emergency_alerts')
        .select('*, staff:raised_by(full_name)')
        .eq('resident_id', id)
        .order('created_at', { ascending: false }),
    ]);

    if (residentRes.data) {
      setResident(residentRes.data as Resident);
      setForm(residentRes.data as Resident);
      setPhotoPreview(residentRes.data.photo_url);
    }
    setContacts((contactsRes.data as FamilyContact[]) || []);
    setCareLogs((careLogsRes.data as unknown as CareLog[]) || []);
    setIncidents((incidentsRes.data as unknown as IncidentRow[]) || []);
    setAlerts((alertsRes.data as unknown as EmergencyAlertRow[]) || []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [
      ...careLogs.map((c) => ({
        kind: 'care_log' as const,
        id: c.id,
        created_at: c.created_at,
        staffName: c.staff?.full_name ?? 'Unknown staff',
        data: c,
      })),
      ...incidents.map((i) => ({
        kind: 'incident' as const,
        id: i.id,
        created_at: i.created_at,
        staffName: i.staff?.full_name ?? 'Unknown staff',
        data: i,
      })),
      ...alerts.map((a) => ({
        kind: 'emergency_alert' as const,
        id: a.id,
        created_at: a.created_at,
        staffName: a.staff?.full_name ?? 'Unknown staff',
        data: a,
      })),
    ];
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return timelineFilter === 'all' ? items : items.filter((it) => it.kind === timelineFilter);
  }, [careLogs, incidents, alerts, timelineFilter]);

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');

    let photoUrl = form.photo_url;

    if (photoFile) {
      const fileExt = photoFile.name.split('.').pop();
      const filePath = `${id}-${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('resident-photos')
        .upload(filePath, photoFile, { upsert: true });

      if (uploadError) {
        setError(`Photo upload failed: ${uploadError.message}`);
        setSaving(false);
        return;
      }

      const { data } = supabase.storage.from('resident-photos').getPublicUrl(filePath);
      photoUrl = data.publicUrl;
    }

    const { error: saveError } = await supabase
      .from('residents')
      .update({
        full_name: form.full_name,
        dob: form.dob || null,
        address: form.address || null,
        room_number: form.room_number || null,
        medical_notes: form.medical_notes || null,
        dietary_needs: form.dietary_needs || null,
        status: form.status,
        photo_url: photoUrl,
      })
      .eq('id', id);

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setPhotoFile(null);
    setEditing(false);
    fetchAll();
  }

  async function handleDelete() {
    if (!confirm('Remove this resident? This cannot be undone.')) return;
    await supabase.from('residents').delete().eq('id', id);
    router.push('/admin/dashboard');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F7F5] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#6B695F]" />
      </div>
    );
  }

  if (!resident || !form) {
    return (
      <div className="min-h-screen bg-[#F8F7F5] flex flex-col items-center justify-center gap-4">
        <p className="text-[#5C5A54] font-medium">Resident not found.</p>
        <Link href="/admin/dashboard" className="text-sm font-semibold text-[#2F6F63] hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const age = calcAge(resident.dob);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F7F5] via-[#FCF9F6] to-[#F5F3EF]">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 backdrop-blur-md bg-white/70 border-b border-gray-200/50">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Residents
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 text-sm font-semibold text-white bg-gradient-to-r from-[#4F9C8B] to-[#357366] px-4 py-2 rounded-full hover:shadow-md active:scale-95 transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 text-sm font-semibold text-[#B23B2A] border border-[#E0AFA5] px-4 py-2 rounded-full hover:bg-[#F3D9D3] active:scale-95 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8">
        {/* Hero */}
        <div className="flex items-center gap-5 mb-10 animate-[fadeUp_0.4s_ease-out]">
          {photoPreview ? (
            <div className="w-20 h-20 rounded-2xl border-2 border-white shadow-md bg-white overflow-hidden shrink-0">
              <img src={photoPreview} alt={resident.full_name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#4F9C8B] to-[#357366] shadow-md flex items-center justify-center text-2xl font-bold text-white shrink-0">
              {resident.full_name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-extrabold text-gray-900 truncate">{resident.full_name}</h1>
              <span className={`text-xs px-3 py-1 rounded-full font-semibold ${statusStyles[resident.status]}`}>
                {resident.status}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500 flex-wrap">
              {age !== null && (
                <span className="flex items-center gap-1.5">
                  <Cake className="w-3.5 h-3.5" /> {age} years old
                </span>
              )}
              {resident.room_number && (
                <span className="flex items-center gap-1.5">
                  <Bed className="w-3.5 h-3.5" /> Room {resident.room_number}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid lg:grid-cols-[320px_1fr] gap-6 items-start">
          {/* Sidebar */}
          <div className="space-y-5 lg:sticky lg:top-24">
            <SidebarCard title="Details" icon={Stethoscope}>
              <DetailRow label="Date of birth" value={resident.dob ?? 'Not set'} />
              <DetailRow label="Address" value={resident.address ?? 'Not set'} />
              {resident.medical_notes && (
                <div className="pt-2 mt-2 border-t border-gray-100">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Medical notes</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{resident.medical_notes}</p>
                </div>
              )}
            </SidebarCard>

            {resident.dietary_needs && (
              <SidebarCard title="Dietary needs" icon={UtensilsCrossed}>
                <p className="text-sm text-gray-700 leading-relaxed">{resident.dietary_needs}</p>
              </SidebarCard>
            )}

            <SidebarCard title="Family contacts" icon={Users}>
              {contacts.length === 0 ? (
                <p className="text-sm text-gray-400">No family contacts linked yet.</p>
              ) : (
                <div className="space-y-3">
                  {contacts.map((c) => (
                    <div key={c.id} className="pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-semibold text-sm text-gray-900">{c.full_name}</span>
                        {c.is_primary && <Star className="w-3 h-3 text-[#E8934A] fill-[#E8934A]" />}
                      </div>
                      {c.relationship && <p className="text-xs text-gray-400 mb-1">{c.relationship}</p>}
                      <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                        {c.phone && (
                          <span className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3" /> {c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="flex items-center gap-1.5">
                            <Mail className="w-3 h-3" /> {c.email}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SidebarCard>
          </div>

          {/* Timeline */}
          <div>
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              {filterOptions.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTimelineFilter(f.id)}
                  className={`text-xs font-semibold px-3.5 py-2 rounded-full transition-all ${
                    timelineFilter === f.id
                      ? 'bg-gray-900 text-white'
                      : 'bg-white/70 text-gray-600 border border-gray-200/70 hover:bg-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {timeline.length === 0 ? (
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/50 py-16 text-center text-gray-400">
                <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No activity recorded yet.</p>
              </div>
            ) : (
              <div className="relative pl-8">
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gray-200" />
                <div className="space-y-5">
                  {timeline.map((item) => (
                    <TimelineEntry key={`${item.kind}-${item.id}`} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit drawer */}
      {editing && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]"
            onClick={() => {
              setEditing(false);
              setForm(resident);
              setPhotoPreview(resident.photo_url);
              setPhotoFile(null);
              setError('');
            }}
          />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl animate-[slideIn_0.25s_ease-out]">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
              <h2 className="font-bold text-lg text-gray-900">Edit resident</h2>
              <button
                onClick={() => {
                  setEditing(false);
                  setForm(resident);
                  setPhotoPreview(resident.photo_url);
                  setPhotoFile(null);
                  setError('');
                }}
                className="text-gray-400 hover:text-gray-600 hover:rotate-90 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  {photoPreview ? (
                    <div className="w-16 h-16 rounded-2xl border border-gray-200 shadow-sm bg-white overflow-hidden">
                      <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-xl font-bold text-gray-400">
                      {form.full_name.charAt(0) || '?'}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#2F6F63] shadow-md flex items-center justify-center hover:scale-110 transition-transform"
                  >
                    <Camera className="w-3 h-3 text-white" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-gray-400">Tap the camera icon to change photo</p>
              </div>

              <Field label="Full name">
                <input
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Date of birth">
                  <input
                    type="date"
                    value={form.dob ?? ''}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Room number">
                  <input
                    value={form.room_number ?? ''}
                    onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Address">
                <input
                  value={form.address ?? ''}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <Field label="Medical notes">
                <textarea
                  rows={3}
                  value={form.medical_notes ?? ''}
                  onChange={(e) => setForm({ ...form, medical_notes: e.target.value })}
                  className={inputClass + ' resize-none'}
                />
              </Field>

              <Field label="Dietary needs">
                <textarea
                  rows={3}
                  value={form.dietary_needs ?? ''}
                  onChange={(e) => setForm({ ...form, dietary_needs: e.target.value })}
                  className={inputClass + ' resize-none'}
                />
              </Field>

              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ResidentStatus })}
                  className={inputClass + ' bg-white'}
                >
                  <option value="active">Active</option>
                  <option value="discharged">Discharged</option>
                  <option value="deceased">Deceased</option>
                </select>
              </Field>

              {error && (
                <p className="text-sm text-[#B23B2A] font-medium bg-[#F3D9D3] border border-[#E0AFA5] rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-2 pb-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setForm(resident);
                    setPhotoPreview(resident.photo_url);
                    setPhotoFile(null);
                    setError('');
                  }}
                  className="flex-1 py-2.5 rounded-full border border-gray-200 font-semibold text-sm text-gray-700 hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-full bg-gradient-to-r from-[#4F9C8B] to-[#357366] text-white font-semibold text-sm hover:shadow-md disabled:opacity-60 transition-all"
                >
                  {saving ? 'Saving...' : 'Save changes'}
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
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────

const inputClass =
  'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.15)] transition-all';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function SidebarCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Stethoscope;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-[#4F9C8B]" />
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{title}</p>
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-800 font-medium text-right">{value}</span>
    </div>
  );
}

function TimelineEntry({ item }: { item: TimelineItem }) {
  if (item.kind === 'care_log') {
    const d = item.data as CareLog;
    return (
      <TimelineRow icon={ClipboardList} color="#4F9C8B" label="Care log" when={item.created_at} staff={item.staffName}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mt-1.5">
          {d.mood && <span><b className="text-gray-800">Mood:</b> {d.mood}</span>}
          {d.mobility && <span><b className="text-gray-800">Mobility:</b> {d.mobility}</span>}
          {d.meals && <span><b className="text-gray-800">Meals:</b> {d.meals}</span>}
          {d.fluids && <span><b className="text-gray-800">Fluids:</b> {d.fluids}</span>}
          {d.medication_status && <span className="col-span-2"><b className="text-gray-800">Medication:</b> {d.medication_status}</span>}
        </div>
        {d.notes && <p className="text-sm text-gray-700 mt-2">{d.notes}</p>}
      </TimelineRow>
    );
  }

  if (item.kind === 'incident') {
    const d = item.data as IncidentRow;
    return (
      <TimelineRow icon={AlertTriangle} color="#E65100" label="Incident" when={item.created_at} staff={item.staffName}>
        {d.description && <p className="text-sm text-gray-700 mt-1.5">{d.description}</p>}
      </TimelineRow>
    );
  }

  const d = item.data as EmergencyAlertRow;
  const resolved = d.status === 'resolved';
  return (
    <TimelineRow
      icon={resolved ? CheckCircle2 : Siren}
      color={resolved ? '#2E7D32' : '#C62828'}
      label={`Emergency alert${d.type ? ` — ${d.type}` : ''}`}
      when={item.created_at}
      staff={item.staffName}
    >
      <span
        className={`inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full font-semibold ${
          resolved ? 'bg-[#E8F5E9] text-[#2E7D32]' : 'bg-[#FDECEA] text-[#C62828]'
        }`}
      >
        {resolved ? `Resolved${d.resolved_at ? ` · ${formatWhen(d.resolved_at)}` : ''}` : 'Active'}
      </span>
    </TimelineRow>
  );
}

function TimelineRow({
  icon: Icon,
  color,
  label,
  when,
  staff,
  children,
}: {
  icon: typeof ClipboardList;
  color: string;
  label: string;
  when: string;
  staff: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative animate-[fadeUp_0.35s_ease-out_backwards]">
      <div
        className="absolute -left-8 top-0.5 w-[23px] h-[23px] rounded-full flex items-center justify-center border-2 border-[#F8F7F5]"
        style={{ backgroundColor: `${color}1A` }}
      >
        <Icon className="w-3 h-3" style={{ color }} />
      </div>
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-bold text-gray-900">{label}</span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Clock className="w-3 h-3" /> {formatWhen(when)}
          </span>
        </div>
        {children}
        <p className="text-xs text-gray-400 mt-2">Logged by {staff}</p>
      </div>
    </div>
  );
}