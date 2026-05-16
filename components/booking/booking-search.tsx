'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Loader2, SearchX, CheckCircle2, CalendarDays } from 'lucide-react'
import { Button }               from '@/components/ui/button'
import { SearchBar }            from './search-bar'
import { DoctorResultCard }     from './doctor-result-card'
import { WeeklyGrid }           from './weekly-grid'
import { BookingModal }         from './booking-modal'
import { DoctorSelectionModal } from './doctor-selection-modal'
import type {
  ClinicBookingData,
  DoctorOption,
  SearchFilters,
  WeekSlotsMap,
  ModalBookingState,
} from './types'

function todayString(): string {
  // Use local clock so the boundary is correct for users in UTC+ timezones
  // (UTC ISO would give "yesterday" during late evening in e.g. Spain UTC+2)
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  })
}

// ─── Week navigation bar ──────────────────────────────────────────────────────

function WeekNav({
  label,
  isPrevDisabled,
  onPrev,
  onNext,
}: {
  label:          string
  isPrevDisabled: boolean
  onPrev:         () => void
  onNext:         () => void
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        disabled={isPrevDisabled}
        onClick={onPrev}
        aria-label="Semana anterior"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="text-xs text-slate-500 font-medium px-0.5 min-w-[112px] text-center select-none">
        {label}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={onNext}
        aria-label="Semana siguiente"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ─── Success screen ───────────────────────────────────────────────────────────

function SuccessScreen({ patientName, onReset }: { patientName: string; onReset: () => void }) {
  return (
    <motion.div
      key="success"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center text-center gap-6 py-14"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
        className="relative"
      >
        <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 border-2 border-emerald-200">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="space-y-3 max-w-sm"
      >
        <h2 className="text-2xl font-bold text-slate-900">¡Cita reservada con éxito!</h2>
        <p className="text-slate-500 text-sm leading-relaxed">
          {patientName ? `${patientName}, h` : 'H'}emos enviado los detalles a tu WhatsApp.
          No olvides que puedes cancelar o gestionar tu cita directamente desde el mensaje que acabas de recibir.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button variant="outline" size="lg" onClick={onReset}>
          Reservar otra cita
        </Button>
      </motion.div>
    </motion.div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BookingSearch({ clinic }: { clinic: ClinicBookingData }) {
  const services   = clinic.services
  const insurances = clinic.insurances ?? []
  const doctorIns  = clinic.doctorInsurances ?? {}

  const initialFilters: SearchFilters = {
    serviceId:   services[0]?.id ?? '',
    doctorId:    null,
    date:        todayString(),
    timeOfDay:   'all',
    insuranceId: null,
  }

  const [filters, setFilters] = useState<SearchFilters>(initialFilters)
  const [weekSlots,    setWeekSlots]    = useState<WeekSlotsMap>({})
  const [dates,        setDates]        = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  const [modal, setModal] = useState<ModalBookingState>({
    open:          false,
    phase:         'patient',
    service:       null,
    doctor:        null,
    slotStart:     null,
    patientName:   '',
    patientPhone:  '',
    appointmentId: null,
  })

  const [doctorSelectionModal, setDoctorSelectionModal] = useState<{
    open:      boolean
    slotStart: string | null
    doctors:   DoctorOption[]
  }>({ open: false, slotStart: null, doctors: [] })

  const [isConfirmed,      setIsConfirmed]      = useState(false)
  const [confirmedPatient, setConfirmedPatient] = useState('')

  useEffect(() => {
    if (!filters.serviceId) return
    let cancelled = false
    setSlotsLoading(true)
    setWeekSlots({})
    setDates([])

    const params = new URLSearchParams({
      serviceId: filters.serviceId,
      startDate: filters.date,
    })
    if (filters.doctorId) params.set('doctorId', filters.doctorId)

    fetch(`/api/slots/week?${params}`)
      .then((r) => r.json())
      .then(({ dates: d, slots: s }) => {
        if (cancelled) return
        console.log('[BookingSearch] API /slots/week →', {
          url:          `/api/slots/week?${params}`,
          datesCount:   (d ?? []).length,
          doctorIds:    Object.keys(s ?? {}),
          slotsPerDoc:  Object.fromEntries(
            Object.entries(s ?? {}).map(([id, byDate]) => [
              id,
              Object.values(byDate as Record<string, unknown[]>).reduce((n, arr) => n + arr.length, 0),
            ])
          ),
        })
        setDates(d ?? [])
        setWeekSlots(s ?? {})
      })
      .catch((err) => {
        if (!cancelled) { setDates([]); setWeekSlots({}) }
        console.error('[BookingSearch] fetch /slots/week failed:', err)
      })
      .finally(() => { if (!cancelled) setSlotsLoading(false) })

    return () => { cancelled = true }
  }, [filters.serviceId, filters.doctorId, filters.date])

  const handleFilterChange = useCallback((next: Partial<SearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }))
  }, [])

  const selectedService = useMemo(
    () => services.find((s) => s.id === filters.serviceId) ?? services[0],
    [services, filters.serviceId]
  )

  // ─── Week pagination ──────────────────────────────────────────────────────
  const weekLabel = useMemo(() => {
    const start = parseISO(filters.date)
    const end   = addDays(start, 6)
    const fmt   = (d: Date) => format(d, 'd MMM', { locale: es })
    return `${fmt(start)} – ${fmt(end)}`
  }, [filters.date])

  const isPrevDisabled = filters.date <= todayString()

  function prevWeek() {
    handleFilterChange({ date: format(addDays(parseISO(filters.date), -7), 'yyyy-MM-dd') })
  }
  function nextWeek() {
    handleFilterChange({ date: format(addDays(parseISO(filters.date), 7), 'yyyy-MM-dd') })
  }

  // Doctors list filtered by insurance (and by specific doctor if selected).
  // Used both for the per-doctor card view and to look up which doctors
  // have a given aggregated slot.
  const doctorsToDisplay = useMemo(() => {
    if (!selectedService) return []
    let docs = selectedService.doctors

    if (filters.insuranceId) {
      docs = docs.filter((d) => (doctorIns[d.id] ?? []).includes(filters.insuranceId!))
    }
    if (filters.doctorId) {
      docs = docs.filter((d) => d.id === filters.doctorId)
    }

    return [...docs].sort((a, b) => {
      const aFirst = Object.values(weekSlots[a.id] ?? {}).flat().sort()[0] ?? '9999'
      const bFirst = Object.values(weekSlots[b.id] ?? {}).flat().sort()[0] ?? '9999'
      return aFirst.localeCompare(bFirst)
    })
  }, [selectedService, filters.doctorId, filters.insuranceId, doctorIns, weekSlots])

  // ─── FASE 1: Aggregated slots (union of all insurance-filtered doctors) ───
  const aggregatedSlots = useMemo((): Record<string, string[]> => {
    if (filters.doctorId !== null) return {}

    const byDate: Record<string, Set<string>> = {}

    if (filters.insuranceId) {
      // Insurance filter active: only include slots from doctors that pass it.
      // We match against doctorsToDisplay (which already applied the filter).
      const allowedIds = new Set(doctorsToDisplay.map((d) => d.id))
      for (const [doctorId, docSlots] of Object.entries(weekSlots)) {
        if (!allowedIds.has(doctorId)) continue
        for (const [date, isos] of Object.entries(docSlots)) {
          if (!byDate[date]) byDate[date] = new Set()
          for (const iso of isos) byDate[date].add(iso)
        }
      }
    } else {
      // No insurance filter: iterate weekSlots directly — no doctor-ID lookup needed.
      for (const docSlots of Object.values(weekSlots)) {
        for (const [date, isos] of Object.entries(docSlots)) {
          if (!byDate[date]) byDate[date] = new Set()
          for (const iso of isos) byDate[date].add(iso)
        }
      }
    }

    const result: Record<string, string[]> = {}
    for (const [date, set] of Object.entries(byDate)) {
      result[date] = [...set].sort()
    }

    console.log('Aggregated Slots:', result)
    return result
  }, [weekSlots, doctorsToDisplay, filters.doctorId, filters.insuranceId])

  // ─── Slot click handlers ──────────────────────────────────────────────────

  // Single-doctor mode: slot click from a DoctorResultCard
  function handleSlotClick(slotStart: string, doctor: DoctorOption) {
    if (!selectedService) return
    setModal({
      open:          true,
      phase:         'patient',
      service:       selectedService,
      doctor,
      slotStart,
      patientName:   '',
      patientPhone:  '',
      appointmentId: null,
    })
  }

  // ─── FASE 3: Aggregated mode slot click ──────────────────────────────────
  function handleAggregatedSlotClick(slotStart: string) {
    if (!selectedService) return

    // Find which displayed doctors actually have this exact slot
    const available = doctorsToDisplay.filter((doc) =>
      Object.values(weekSlots[doc.id] ?? {}).flat().includes(slotStart)
    )
    if (available.length === 0) return

    if (available.length === 1) {
      // Only one doctor free — skip selection modal, go straight to booking
      setModal({
        open:          true,
        phase:         'patient',
        service:       selectedService,
        doctor:        available[0],
        slotStart,
        patientName:   '',
        patientPhone:  '',
        appointmentId: null,
      })
    } else {
      setDoctorSelectionModal({ open: true, slotStart, doctors: available })
    }
  }

  function handleDoctorSelected(doctor: DoctorOption) {
    if (!selectedService || !doctorSelectionModal.slotStart) return
    setDoctorSelectionModal({ open: false, slotStart: null, doctors: [] })
    setModal({
      open:          true,
      phase:         'patient',
      service:       selectedService,
      doctor,
      slotStart:     doctorSelectionModal.slotStart,
      patientName:   '',
      patientPhone:  '',
      appointmentId: null,
    })
  }

  function handleConfirmed(patientName: string) {
    setConfirmedPatient(patientName)
    setIsConfirmed(true)
  }

  function handleReset() {
    setIsConfirmed(false)
    setConfirmedPatient('')
    setFilters(initialFilters)
    setWeekSlots({})
    setDates([])
  }

  return (
    <AnimatePresence mode="wait">
      {isConfirmed ? (
        <SuccessScreen
          key="success"
          patientName={confirmedPatient}
          onReset={handleReset}
        />
      ) : (
        <motion.div
          key="search"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <SearchBar
            services={services}
            insurances={insurances}
            filters={filters}
            onChange={handleFilterChange}
          />

          {slotsLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Buscando disponibilidad…</span>
            </div>
          ) : (
            // ─── FASE 2: Bifurcación del renderizado ─────────────────────────
            filters.doctorId === null ? (
              // ── Aggregated calendar (Cualquier profesional) ──────────────
              doctorsToDisplay.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center">
                  <SearchX className="h-8 w-8 text-slate-300" />
                  <div>
                    <p className="text-sm font-medium text-slate-600">
                      No hay profesionales disponibles con estos filtros
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Prueba a cambiar la mutua o la fecha
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-start gap-3 p-5 pb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                      <CalendarDays className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-900 text-base leading-tight">
                        Horarios disponibles en la clínica
                      </h3>
                      <p className="text-sm text-slate-500 mt-0.5">
                        Elige una hora. Si hay varios profesionales disponibles podrás escoger al que prefieras.
                      </p>
                    </div>
                    <WeekNav
                      label={weekLabel}
                      isPrevDisabled={isPrevDisabled}
                      onPrev={prevWeek}
                      onNext={nextWeek}
                    />
                  </div>

                  <div className="border-t border-slate-100 mx-5" />

                  <div className="p-4 pt-3">
                    <WeeklyGrid
                      slots={aggregatedSlots}
                      dates={dates}
                      timezone={clinic.timezone}
                      timeOfDay={filters.timeOfDay}
                      onSlotClick={handleAggregatedSlotClick}
                    />
                  </div>
                </div>
              )
            ) : (
              // ── Per-doctor cards (specific doctor selected) ──────────────
              <div className="space-y-4">
                <div className="flex justify-end pr-1">
                  <WeekNav
                    label={weekLabel}
                    isPrevDisabled={isPrevDisabled}
                    onPrev={prevWeek}
                    onNext={nextWeek}
                  />
                </div>
                {doctorsToDisplay.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center">
                    <SearchX className="h-8 w-8 text-slate-300" />
                    <div>
                      <p className="text-sm font-medium text-slate-600">
                        No hay médicos disponibles con estos filtros
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Prueba a cambiar la mutua, el profesional o la fecha
                      </p>
                    </div>
                  </div>
                ) : (
                  doctorsToDisplay.map((doctor) => (
                    <DoctorResultCard
                      key={doctor.id}
                      doctor={doctor}
                      service={selectedService!}
                      insuranceIds={doctorIns[doctor.id] ?? []}
                      allInsurances={insurances}
                      slots={weekSlots[doctor.id] ?? {}}
                      dates={dates}
                      timezone={clinic.timezone}
                      timeOfDay={filters.timeOfDay}
                      onSlotClick={handleSlotClick}
                    />
                  ))
                )}
              </div>
            )
          )}

          {/* ─── FASE 3: Doctor selection modal ─────────────────────────── */}
          {doctorSelectionModal.open && doctorSelectionModal.slotStart && (
            <DoctorSelectionModal
              open={doctorSelectionModal.open}
              onOpenChange={(open) =>
                setDoctorSelectionModal((prev) => ({ ...prev, open }))
              }
              slotLabel={formatTime(doctorSelectionModal.slotStart, clinic.timezone)}
              doctors={doctorSelectionModal.doctors}
              onSelect={handleDoctorSelected}
            />
          )}

          {/* ─── FASE 4: Booking modal (patient data form) ──────────────── */}
          {modal.open && modal.service && modal.doctor && modal.slotStart && (
            <BookingModal
              open={modal.open}
              onOpenChange={(open) => setModal((prev) => ({ ...prev, open }))}
              clinicId={clinic.id}
              timezone={clinic.timezone}
              service={modal.service}
              doctor={modal.doctor}
              slotStart={modal.slotStart}
              onConfirmed={handleConfirmed}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
