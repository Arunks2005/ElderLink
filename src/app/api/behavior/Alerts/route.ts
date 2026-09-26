// app/api/behavior/alerts/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createClient()
  const { data, error } = await (await supabase)
    .from('behavior_alerts')
    .select('*')
    .eq('resolved', false)
    .order('severity', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}