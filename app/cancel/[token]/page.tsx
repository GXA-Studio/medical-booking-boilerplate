import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { CalendarDays, User, Clock, XCircle } from 'lucide-react'
import { CancelButton } from './cancel-button'
import { formatLocalDateTime } from '@/lib/utils'

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase  = createServiceClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, cancellation_token, patient_name,
      doctors  ( name, specialty ),
      services ( name, duration_minutes ),
      clinics  ( name, timezone )
    `)
    .eq('cancellation_token', token)
    .single()

  if (!appt) return notFound()

  const clinic  = appt.clinics  as { name: string; timezone: string } | null
  const doctor  = appt.doctors  as { name: string; specialty: string | null } | null
  const service = appt.services as { name: string; duration_minutes: number } | null

  const dateStr  = formatLocalDateTime(appt.starts_at, clinic?.timezone ?? 'Europe/Madrid')
  const isPast   = new Date(appt.starts_at) < new Date()
  const isActive = appt.status === 'confirmed' && !isPast

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-primary/5 border-b border-primary/20 px-6 py-5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
            {clinic?.name ?? 'Clínica'}
          </p>
          <h1 className="text-xl font-bold text-slate-900">Cancelar cita</h1>
        </div>

        {/* Appointment details */}
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <CalendarDays className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Fecha y hora</p>
              <p className="text-sm font-semibold text-slate-800 capitalize">{dateStr}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Especialista</p>
              <p className="text-sm font-semibold text-slate-800">{doctor?.name ?? '—'}</p>
              {doctor?.specialty && <p className="text-xs text-slate-500">{doctor.specialty}</p>}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Servicio</p>
              <p className="text-sm font-semibold text-slate-800">{service?.name ?? '—'}</p>
              {service && <p className="text-xs text-slate-500">{service.duration_minutes} min</p>}
            </div>
          </div>
        </div>

        {/* Action area */}
        <div className="px-6 pb-6">
          {isActive ? (
            <>
              <p className="text-xs text-slate-500 mb-4">
                Paciente: <span className="font-medium text-slate-700">{appt.patient_name}</span>.
                {' '}Al cancelar, el hueco quedará libre para otros pacientes.
              </p>
              <CancelButton token={token} />
            </>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <XCircle className="h-5 w-5 text-slate-400 shrink-0" />
              <p className="text-sm text-slate-600">
                {appt.status === 'cancelled'
                  ? 'Esta cita ya fue cancelada anteriormente.'
                  : 'Esta cita ya ha pasado y no puede cancelarse.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
