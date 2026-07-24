'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  Phone,
  Mail,
  Home,
  Calendar,
  Info,
  Pencil,
  Trash2,
  Loader2,
  X,
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
}

interface FamilyContact {
  id: string;
  full_name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

const statusStyles: Record<ResidentStatus, string> = {
  active: 'bg-[#CFE6DD] text-[#1E5C4C] font-semibold',
  discharged: 'bg-[#E9DDC2] text-[#6B4E1E] font-semibold',
  deceased: 'bg-[#DCDCDC] text-[#4B4B4B] font-semibold',
};

export default function ResidentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [resident, setResident] = useState<Resident | null>(null);
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Resident | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchResident = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('residents').select('*').eq('id', id).single();
    if (data) {
      setResident(data as Resident);
      setForm(data as Resident);
      setPhotoPreview(data.photo_url);
    }

    const { data: contactsData } = await supabase
      .from('family_contacts')
      .select('*')
      .eq('resident_id', id)
      .order('is_primary', { ascending: false });

    setContacts((contactsData as FamilyContact[]) || []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    fetchResident();
  }, [fetchResident]);

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
    fetchResident();
  }

  async function handleDelete() {
    if (!confirm('Remove this resident? This cannot be undone.')) return;
    await supabase.from('residents').delete().eq('id', id);
    router.push('/admin/dashboard');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#DEDAD0] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#6B695F]" />
      </div>
    );
  }

  if (!resident || !form) {
    return (
      <div className="min-h-screen bg-[#DEDAD0] flex flex-col items-center justify-center gap-4">
        <p className="text-[#5C5A54] font-medium">Resident not found.</p>
        <button
          onClick={() => router.push('/admin/dashboard')}
          className="text-sm font-semibold text-[#2F6F63] hover:underline"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#DEDAD0]">
      <div className="max-w-3xl mx-auto p-6 md:p-10">
        <button
          onClick={() => router.push('/admin/dashboard')}
          className="flex items-center gap-2 text-sm font-semibold text-[#5C5A54] hover:text-[#2A2A28] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to residents
        </button>

        <div className="bg-[#F5F3EC] rounded-3xl border border-[#C9C4B6] shadow-sm overflow-hidden animate-[fadeUp_0.4s_ease-out]">
          {/* Header banner (no photo cropped into it) */}
          <div className="bg-gradient-to-br from-[#2F6F63] to-[#1E5C4C] px-8 pt-8 pb-14" />

          {/* Photo overlaps the banner in its own frame — full image always visible */}
          <div className="px-8 -mt-14 flex items-end gap-5">
            <div className="relative shrink-0">
              {photoPreview ? (
                <div className="w-28 h-28 rounded-2xl border-4 border-[#F5F3EC] shadow-md bg-white overflow-hidden">
                  <img
                    src={photoPreview}
                    alt={resident.full_name}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-28 h-28 rounded-2xl bg-[#DEDAD0] border-4 border-[#F5F3EC] shadow-md flex items-center justify-center text-3xl font-bold text-[#5C5A54]">
                  {resident.full_name.charAt(0)}
                </div>
              )}
              {editing && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-[#2F6F63] shadow-md flex items-center justify-center hover:scale-110 transition-transform"
                >
                  <Camera className="w-4 h-4 text-white" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
            </div>

            <div className="pb-2">
              <h1 className="text-2xl font-extrabold text-[#1F1F1D]">{resident.full_name}</h1>
              <span className={`inline-block mt-2 text-xs px-2.5 py-1 rounded-full ${statusStyles[resident.status]}`}>
                {resident.status}
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="p-8 pt-6">
            {!editing ? (
              <>
                <div className="grid sm:grid-cols-2 gap-4 mb-5">
                  <InfoRow icon={Calendar} label="Date of birth" value={resident.dob || 'Not set'} />
                  <InfoRow icon={Home} label="Room" value={resident.room_number || 'Not set'} />
                </div>

                {resident.address && (
                  <InfoRow icon={Home} label="Address" value={resident.address} className="mb-5" />
                )}

                {resident.medical_notes && (
                  <NoteBlock label="Medical notes" value={resident.medical_notes} />
                )}
                {resident.dietary_needs && (
                  <NoteBlock label="Dietary needs" value={resident.dietary_needs} />
                )}

                <div className="mt-6">
                  <p className="text-xs font-bold text-[#5C5A54] uppercase tracking-wide mb-3">
                    Family contacts
                  </p>
                  {contacts.length === 0 ? (
                    <p className="text-sm text-[#6B695F]">No family contacts linked yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map((c) => (
                        <div key={c.id} className="bg-white rounded-xl p-3 border border-[#C9C4B6] text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-[#2A2A28]">{c.full_name}</span>
                            {c.is_primary && (
                              <span className="text-[10px] bg-[#CFE6DD] text-[#1E5C4C] font-bold px-2 py-0.5 rounded-full">
                                PRIMARY
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#6B695F] mb-1">{c.relationship}</p>
                          <div className="flex flex-col gap-0.5 text-xs text-[#5C5A54]">
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
                </div>

                <div className="flex gap-3 pt-8">
                  <button
                    onClick={() => setEditing(true)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full bg-[#2F6F63] text-white font-semibold text-sm hover:bg-[#265a50] active:scale-95 transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit resident
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-full border border-[#E0AFA5] text-[#B23B2A] font-semibold text-sm hover:bg-[#F3D9D3] active:scale-95 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSave} className="space-y-4 pt-4">
                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Full name</label>
                  <input
                    required
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[#5C5A54]">Date of birth</label>
                    <input
                      type="date"
                      value={form.dob ?? ''}
                      onChange={(e) => setForm({ ...form, dob: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#5C5A54]">Room number</label>
                    <input
                      value={form.room_number ?? ''}
                      onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Address</label>
                  <input
                    value={form.address ?? ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Medical notes</label>
                  <textarea
                    rows={2}
                    value={form.medical_notes ?? ''}
                    onChange={(e) => setForm({ ...form, medical_notes: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Dietary needs</label>
                  <textarea
                    rows={2}
                    value={form.dietary_needs ?? ''}
                    onChange={(e) => setForm({ ...form, dietary_needs: e.target.value })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#5C5A54]">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ResidentStatus })}
                    className="mt-1.5 w-full rounded-xl border border-[#C9C4B6] bg-white px-3.5 py-2.5 text-sm text-[#2A2A28] outline-none focus:border-[#2F6F63] focus:shadow-[0_0_0_3px_rgba(47,111,99,0.18)] transition-all"
                  >
                    <option value="active">Active</option>
                    <option value="discharged">Discharged</option>
                    <option value="deceased">Deceased</option>
                  </select>
                </div>

                {error && (
                  <p className="text-sm text-[#B23B2A] font-medium bg-[#F3D9D3] border border-[#E0AFA5] rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setForm(resident);
                      setPhotoPreview(resident.photo_url);
                      setPhotoFile(null);
                    }}
                    className="flex-1 py-2.5 rounded-full border border-[#C9C4B6] font-semibold text-sm text-[#2A2A28] hover:bg-[#DEDAD0] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-full bg-[#2F6F63] text-white font-semibold text-sm hover:bg-[#265a50] disabled:opacity-60 transition-all"
                  >
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  className = '',
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2 text-sm ${className}`}>
      <Icon className="w-4 h-4 text-[#6B695F] mt-0.5" />
      <div>
        <p className="text-xs text-[#6B695F] font-semibold">{label}</p>
        <p className="text-[#2A2A28] font-medium">{value}</p>
      </div>
    </div>
  );
}

function NoteBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-3 border border-[#C9C4B6] mb-3">
      <p className="text-xs font-semibold text-[#6B695F] mb-1 flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="text-sm text-[#2A2A28]">{value}</p>
    </div>
  );
}