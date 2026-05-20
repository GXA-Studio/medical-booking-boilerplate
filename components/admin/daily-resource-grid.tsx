'use client'

import { useState, useMemo } from 'react'
import { fromZonedTime } from 'date-fns-tz'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { APPOINTMENT_COLORS, type AppointmentColor } from '@/lib/constants/colors'
import { NewAppointmentDialog } from '@/components/admin/new-appointment-dialog'
import {
  EditAppointmentDialog,
  type AppointmentForEdit,
} from '@/components/admin/edit-appointment-dialog'

// ─── Grid constants ────────────────────────────────────────────────────────────
const GRID_START_HOUR   = 8
const GRID_END_HOUR     = 21
const SLOT_MINUTES      = 30
const SLOT_HEIGHT_PX    = 52
const TIME_COL_W        = 64
const DOCTOR_COL_MIN_W  = 172
const TOTAL_SLOTS       = (GRID_END_HOUR - GRID_START_HOUR) * (60 / SLOT_MINUTES) // 26

// ─── Public Types ──────────────────────────────────────────────────────────────
export interface GridDoctor {
  id: string
  name: string
  specialty: string | null
  doctor_services: { service_id: string }[]
}

export interface GridSchedule {
  id: string
  doctor_id: string
  day_of_week: number
  start_time: string   // "HH:MM" clinic local TZ
  end_time: string     // "HH:MM" clinic local TZ
  is_active: boolean
}

export interface GridAppointment {
  id: string
  doctor_id: string
  service_id: string
  cancellation_token: string
  patient_name: string
  patient_phone: string
  starts_at: string    // UTC ISO
  ends_at: string      // UTC ISO
  status: string
  color: string | null
  services: { name: string; duration_minutes: number; color: string | null } | null
}

export interface GridService {
  id: string
  name: string
  duration_minutes: number
  color: string | null
}

export interface GridException {
  id: string
  doctor_id: string
  exception_date: string       // YYYY-MM-DD clinic local
  is_working: boolean
  start_time: string | null    // "HH:MM:SS" clinic local TZ (null = full-day)
  end_time: string | null
}

interface Props {
  date: string       // YYYY-MM-DD clinic local
  timezone: string
  doctors: GridDoctor[]
  schedules: GridSchedule[]
  appointments: GridAppointment[]
  services: GridService[]
  exceptions: GridException[]
}

// Stripe backgrounds for exception overlays. Tailwind can't generate
// arbitrary gradients dynamically, so we inline these as style objects.
const FULL_DAY_BG = 'rgba(244, 63, 94, 0.45)' // rose-500 @ 45%
const PARTIAL_BG  = 'rgba(245, 158, 11, 0.45)' // amber-500 @ 45%

const stripedBackground = (base: string) => ({
  backgroundColor: base,
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(255,255,255,0.45), rgba(255,255,255,0.45) 8px, transparent 8px, transparent 16px)',
})

// ─── Helpers ───────────────────────────────────────────────────────────────────
function getLocalHM(utcIso: string, tz: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(utcIso))
  return {
    h: parseInt(parts.find(p => p.type === 'hour')!.value),
    m: parseInt(parts.find(p => p.type === 'minute')!.value),
  }
}

function slotIndexToUtcIso(date: string, slotIndex: number, tz: string): string {
  const totalMins = GRID_START_HOUR * 60 + slotIndex * SLOT_MINUTES
  const h  = Math.floor(totalMins / 60)
  const m  = totalMins % 60
  return fromZonedTime(
    `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
    tz,
  ).toISOString()
}

function isSlotWorking(
  slotIndex: number,
  blocks: GridSchedule[],
  ex?: { fullDay: boolean; partials: GridException[] },
): boolean {
  if (ex?.fullDay) return false
  const slotStart = slotIndex * SLOT_MINUTES
  const slotEnd   = slotStart + SLOT_MINUTES
  const insideSchedule = blocks.some(b => {
    const [bh, bm] = b.start_time.split(':').map(Number)
    const [eh, em] = b.end_time.split(':').map(Number)
    const blockStart = (bh - GRID_START_HOUR) * 60 + bm
    const blockEnd   = (eh - GRID_START_HOUR) * 60 + em
    return slotStart >= blockStart && slotStart < blockEnd
  })
  if (!insideSchedule) return false
  // Reject if slot overlaps any partial-block exception
  const inPartial = (ex?.partials ?? []).some(p => {
    if (!p.start_time || !p.end_time) return false
    const [bh, bm] = p.start_time.split(':').map(Number)
    const [eh, em] = p.end_time.split(':').map(Number)
    const blockStart = (bh - GRID_START_HOUR) * 60 + bm
    const blockEnd   = (eh - GRID_START_HOUR) * 60 + em
    return slotStart < blockEnd && slotEnd > blockStart
  })
  return !inPartial
}

const SLOTS = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
  const totalMins = GRID_START_HOUR * 60 + i * SLOT_MINUTES
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  return { h, m, isHour: m === 0, label: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` }
})

// ─── Component ─────────────────────────────────────────────────────────────────
export function DailyResourceGrid({
  date, timezone, doctors, schedules, appointments, services, exceptions,
}: Props) {
  // Dialog state — create new appointment (empty cell click)
  const [createPrefill, setCreatePrefill] = useState<null | {
    doctorId: string; date: string; startsAt: string
  }>(null)

  // Dialog state — edit existing appointment (card click)
  const [editTarget, setEditTarget] = useState<AppointmentForEdit | null>(null)

  // ── Derived maps ──────────────────────────────────────────────────────────────
  const schedulesByDoctor = useMemo(() => {
    const map = new Map<string, GridSchedule[]>()
    for (const s of schedules) {
      if (!s.is_active) continue
      if (!map.has(s.doctor_id)) map.set(s.doctor_id, [])
      map.get(s.doctor_id)!.push(s)
    }
    return map
  }, [schedules])

  const apptsByDoctor = useMemo(() => {
    const map = new Map<string, GridAppointment[]>()
    for (const a of appointments) {
      if (a.status === 'cancelled') continue
      if (!map.has(a.doctor_id)) map.set(a.doctor_id, [])
      map.get(a.doctor_id)!.push(a)
    }
    return map
  }, [appointments])

  const exceptionsByDoctor = useMemo(() => {
    const map = new Map<string, { fullDay: boolean; partials: GridException[] }>()
    for (const ex of exceptions) {
      const existing = map.get(ex.doctor_id) ?? { fullDay: false, partials: [] }
      // Full-day off rows have NULL hours and is_working=false.
      // Partial blocks have hours and is_working=false.
      // Legacy custom-windows (is_working=true) are NOT rendered as exceptions —
      // they are the working windows themselves.
      if (!ex.is_working && ex.start_time === null) {
        existing.fullDay = true
      } else if (!ex.is_working && ex.start_time !== null && ex.end_time !== null) {
        existing.partials.push(ex)
      }
      map.set(ex.doctor_id, existing)
    }
    return map
  }, [exceptions])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function handleEmptyCellClick(doctorId: string, slotIndex: number) {
    setCreatePrefill({
      doctorId,
      date,
      startsAt: slotIndexToUtcIso(date, slotIndex, timezone),
    })
  }

  function handleAppointmentClick(appt: GridAppointment, e: React.MouseEvent) {
    e.stopPropagation()  // prevent cell click from firing
    setEditTarget({
      id:            appt.id,
      doctor_id:     appt.doctor_id,
      service_id:    appt.service_id,
      patient_name:  appt.patient_name,
      patient_phone: appt.patient_phone,
      starts_at:     appt.starts_at,
      ends_at:       appt.ends_at,
      color:         appt.color,
      services:      appt.services,
    })
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (doctors.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white">
        <p className="text-sm text-muted-foreground">No hay médicos activos para mostrar.</p>
      </div>
    )
  }

  const totalGridHeight = TOTAL_SLOTS * SLOT_HEIGHT_PX
  const minGridWidth    = TIME_COL_W + doctors.length * DOCTOR_COL_MIN_W

  return (
    <>
      {/* ── Single scroll container ─────────────────────────────────────────── */}
      <div
        className="overflow-auto rounded-lg border border-slate-200 bg-white"
        style={{ maxHeight: 'calc(100svh - 11rem)' }}
      >
        <div style={{ minWidth: `${minGridWidth}px` }}>

          {/* ── Sticky header row ────────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-white shadow-sm">
            {/* Top-left corner — sticky in both axes */}
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-slate-200 bg-white"
              style={{ width: TIME_COL_W }}
            />
            {doctors.map(doc => {
              const hasSchedule = (schedulesByDoctor.get(doc.id) ?? []).length > 0
              return (
                <div
                  key={doc.id}
                  className="flex flex-col justify-center border-r border-slate-200 px-3 py-2.5 last:border-r-0"
                  style={{ minWidth: DOCTOR_COL_MIN_W, flex: 1 }}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{doc.name}</p>
                      {doc.specialty && (
                        <p className="truncate text-[11px] text-slate-400">{doc.specialty}</p>
                      )}
                    </div>
                  </div>
                  {!hasSchedule && (
                    <p className="mt-0.5 pl-9 text-[10px] text-amber-500">Sin horario este día</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Grid body ─────────────────────────────────────────────────────── */}
          <div className="flex">
            {/* Sticky time column */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-slate-50"
              style={{ width: TIME_COL_W, height: totalGridHeight }}
            >
              {SLOTS.map((slot, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-start justify-end border-b pr-2 pt-1',
                    slot.isHour ? 'border-slate-200' : 'border-slate-100'
                  )}
                  style={{ height: SLOT_HEIGHT_PX }}
                >
                  {slot.isHour ? (
                    <span className="text-[11px] font-medium tabular-nums text-slate-500">{slot.label}</span>
                  ) : (
                    <span className="text-[10px] text-slate-300">·</span>
                  )}
                </div>
              ))}
            </div>

            {/* Doctor columns */}
            {doctors.map(doc => {
              const docSchedules = schedulesByDoctor.get(doc.id) ?? []
              const docAppts     = apptsByDoctor.get(doc.id) ?? []
              const docExceptions = exceptionsByDoctor.get(doc.id)

              return (
                <div
                  key={doc.id}
                  className="relative border-r border-slate-200 last:border-r-0"
                  style={{ minWidth: DOCTOR_COL_MIN_W, flex: 1, height: totalGridHeight }}
                >
                  {/* Background / click cells */}
                  {SLOTS.map((slot, i) => {
                    const working = isSlotWorking(i, docSchedules, docExceptions)
                    return (
                      <div
                        key={i}
                        className={cn(
                          'absolute inset-x-0 border-b transition-colors',
                          slot.isHour ? 'border-slate-200' : 'border-slate-100',
                          working
                            ? 'cursor-pointer bg-white hover:bg-blue-50/60 active:bg-blue-100/70'
                            : 'cursor-default'
                        )}
                        style={{
                          top: i * SLOT_HEIGHT_PX,
                          height: SLOT_HEIGHT_PX,
                          ...(!working && {
                            backgroundColor: 'rgb(241 245 249)',
                            backgroundImage:
                              'repeating-linear-gradient(45deg,transparent,transparent 6px,rgba(148,163,184,0.15) 6px,rgba(148,163,184,0.15) 12px)',
                          }),
                        }}
                        onClick={() => working && handleEmptyCellClick(doc.id, i)}
                      />
                    )
                  })}

                  {/* Exception overlays (rendered above background, below appointments) */}
                  {docExceptions?.fullDay && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-[5] flex items-center justify-center rounded-md border border-rose-300 text-center"
                      style={{
                        top: 2,
                        height: totalGridHeight - 4,
                        ...stripedBackground(FULL_DAY_BG),
                      }}
                      title="Día No Disponible"
                    >
                      <div className="rotate-[-15deg] rounded-md bg-white/80 px-3 py-1.5 shadow-sm">
                        <p className="text-xs font-bold uppercase tracking-wider text-rose-700">
                          Día No Disponible
                        </p>
                      </div>
                    </div>
                  )}

                  {!docExceptions?.fullDay && (docExceptions?.partials ?? []).map(p => {
                    const [sh, sm] = p.start_time!.split(':').map(Number)
                    const [eh, em] = p.end_time!.split(':').map(Number)
                    const startMins = (sh - GRID_START_HOUR) * 60 + sm
                    const endMins   = (eh - GRID_START_HOUR) * 60 + em
                    // Clamp the visible range to the grid window
                    const visStart  = Math.max(0, startMins)
                    const visEnd    = Math.min(TOTAL_SLOTS * SLOT_MINUTES, endMins)
                    if (visEnd <= visStart) return null

                    const topPx     = (visStart / SLOT_MINUTES) * SLOT_HEIGHT_PX
                    const heightPx  = ((visEnd - visStart) / SLOT_MINUTES) * SLOT_HEIGHT_PX

                    return (
                      <div
                        key={p.id}
                        className="pointer-events-none absolute inset-x-1 z-[5] flex flex-col items-center justify-center rounded-md border border-amber-400"
                        style={{
                          top: topPx + 1,
                          height: Math.max(20, heightPx - 2),
                          ...stripedBackground(PARTIAL_BG),
                        }}
                        title={`Bloqueo horario ${p.start_time!.slice(0,5)}–${p.end_time!.slice(0,5)}`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
                          Bloqueo Horario
                        </p>
                        {heightPx > 36 && (
                          <p className="text-[10px] font-mono text-amber-900/80">
                            {p.start_time!.slice(0,5)}–{p.end_time!.slice(0,5)}
                          </p>
                        )}
                      </div>
                    )
                  })}

                  {/* Appointment cards */}
                  {docAppts.map(appt => {
                    const { h: sh, m: sm } = getLocalHM(appt.starts_at, timezone)
                    const { h: eh, m: em } = getLocalHM(appt.ends_at,   timezone)
                    const startMins = (sh - GRID_START_HOUR) * 60 + sm
                    const durMins   = (eh - GRID_START_HOUR) * 60 + em - startMins
                    const topPx     = (startMins / SLOT_MINUTES) * SLOT_HEIGHT_PX
                    const heightPx  = Math.max(SLOT_HEIGHT_PX * 0.85, (durMins / SLOT_MINUTES) * SLOT_HEIGHT_PX - 4)
                    const isPast    = new Date(appt.starts_at) < new Date()

                    // Resolve color: appointment override → service default → 'blue'
                    const colorKey = (appt.color ?? appt.services?.color ?? 'blue') as AppointmentColor
                    const palette  = APPOINTMENT_COLORS[colorKey]

                    return (
                      <button
                        key={appt.id}
                        type="button"
                        onClick={e => handleAppointmentClick(appt, e)}
                        className={cn(
                          'absolute left-1 right-1 z-10 overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm',
                          'transition-all hover:shadow-md hover:ring-1',
                          isPast
                            ? 'border-slate-200 bg-slate-50 hover:ring-slate-300'
                            : cn(palette.bg, palette.border, palette.hover)
                        )}
                        style={{ top: topPx + 2, height: heightPx }}
                        title={`${appt.patient_name} — clic para editar`}
                      >
                        <p className={cn(
                          'truncate text-[11px] font-semibold leading-tight',
                          isPast ? 'text-slate-500' : palette.text
                        )}>
                          {String(sh).padStart(2,'0')}:{String(sm).padStart(2,'0')} · {appt.patient_name}
                        </p>
                        {heightPx > 36 && appt.services?.name && (
                          <p className={cn(
                            'truncate text-[10px] leading-tight',
                            isPast ? 'text-slate-400' : palette.textSub
                          )}>
                            {appt.services.name}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Create dialog (empty cell) ──────────────────────────────────────── */}
      {createPrefill && (
        <NewAppointmentDialog
          doctors={doctors as Parameters<typeof NewAppointmentDialog>[0]['doctors']}
          services={services}
          open={true}
          onOpenChange={open => { if (!open) setCreatePrefill(null) }}
          prefill={createPrefill}
        />
      )}

      {/* ── Edit dialog (appointment card) ─────────────────────────────────── */}
      {editTarget && (
        <EditAppointmentDialog
          appointment={editTarget}
          doctors={doctors}
          services={services}
          timezone={timezone}
          open={true}
          onOpenChange={open => { if (!open) setEditTarget(null) }}
        />
      )}
    </>
  )
}
