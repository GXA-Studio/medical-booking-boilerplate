'use client'
import { useState, useTransition, useEffect, useRef } from 'react'
import { Plus, Loader2, CalendarDays, User, Phone, Stethoscope, Clock, CalendarX, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { bookAppointmentManual } from '@/app/(admin)/admin/appointments/actions'
import { useGuestMode } from '@/components/admin/guest-mode-context'
import { findNextAvailableDate } from '@/app/(booking)/[clinicSlug]/actions'

interface Doctor {
  id: string
  name: string
  specialty: string | null
  doctor_services: { service_id: string }[]
}

interface Service {
  id: string
  name: string
  duration_minutes: number
}

interface Prefill {
  doctorId?: string
  date?: string
  /** UTC ISO — nearest available slot is auto-selected when slots load */
  startsAt?: string
}

interface Props {
  doctors: Doctor[]
  services: Service[]
  /** If provided, dialog is controlled externally (no trigger button rendered). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  prefill?: Prefill
}

type TimeFilter = 'any' | 'morning' | 'afternoon'

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  any:       'Indiferente',
  morning:   'Mañanas',
  afternoon: 'Tardes',
}

function formatTimeLabel(isoUtc: string, timezone: string) {
  return new Date(isoUtc).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function todayLocalDate() {
  return new Intl.DateTimeFormat('en-CA').format(new Date())
}

function slotLocalHour(iso: string, tz: string): number {
  return parseInt(
    new Intl.DateTimeFormat('es-ES', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso)),
    10,
  )
}

function matchesTimeFilter(iso: string, tz: string, filter: TimeFilter): boolean {
  if (filter === 'any') return true
  const h = slotLocalHour(iso, tz)
  return filter === 'morning' ? h < 14 : h >= 14
}

export function NewAppointmentDialog({
  doctors,
  services,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  prefill,
}: Props) {
  const [selfOpen, setSelfOpen] = useState(false)
  const { notifyDemo } = useGuestMode()
  const [pending, start]        = useTransition()
  const isControlled            = controlledOpen !== undefined

  const [patientName,  setPatientName]  = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  // doctorId can be '' | 'any' | <uuid>
  const [doctorId,     setDoctorId]     = useState('')
  const [serviceId,    setServiceId]    = useState('')
  const [date,         setDate]         = useState(todayLocalDate())
  const [slotStart,    setSlotStart]    = useState('')
  const [timeFilter,   setTimeFilter]   = useState<TimeFilter>('any')

  const [slots,            setSlots]           = useState<string[]>([])
  // Mode B only: maps slot ISO start → available doctors at that time
  const [slotDoctorsMap,   setSlotDoctorsMap]   = useState<Record<string, { id: string; name: string; specialty: string | null }[]>>({})
  // Resolved when user picks a slot in 'any' mode (first doctor from that slot)
  const [resolvedDoctorId, setResolvedDoctorId] = useState('')
  const [loadingSlots,     setLoadingSlots]     = useState(false)

  const [searchingNext,   startNextTransition] = useTransition()
  const [noNextAvailable, setNoNextAvailable]  = useState(false)

  const dialogOpen = isControlled ? (controlledOpen ?? false) : selfOpen

  // ── Derived values ────────────────────────────────────────────────────────────
  const isAnyDoctor      = doctorId === 'any'
  const doctorServices   = isAnyDoctor ? [] : (doctors.find((d) => d.id === doctorId)?.doctor_services ?? [])
  const serviceIds       = new Set(doctorServices.map((ds) => ds.service_id))
  // In any-mode show all services; with a specific doctor filter; with no doctor show all
  const filteredServices = (isAnyDoctor || !doctorId) ? services : services.filter((s) => serviceIds.has(s.id))
  const selectedService  = services.find((s) => s.id === serviceId)
  // The UUID used for booking — derived from the slot selection in any-mode
  const bookingDoctorId  = isAnyDoctor ? resolvedDoctorId : doctorId
  const selectedDoctor   = doctors.find((d) => d.id === bookingDoctorId)
  // In any-mode the doctor name comes from the slot API response (same clinic, may not be pre-fetched)
  const anyModeDoctorName = isAnyDoctor && slotStart ? slotDoctorsMap[slotStart]?.[0]?.name : null
  const displayDoctorName = anyModeDoctorName ?? selectedDoctor?.name
  const timezone          = Intl.DateTimeFormat().resolvedOptions().timeZone
  // 'any' is truthy so this works for the any-doctor case too
  const canFetchSlots     = !!(doctorId && serviceId && date)

  const filteredSlots = slots.filter((iso) => matchesTimeFilter(iso, timezone, timeFilter))

  // ── Apply prefill when controlled dialog opens ────────────────────────────────
  const prevOpen = useRef(false)
  useEffect(() => {
    if (!isControlled) return
    const justOpened = controlledOpen && !prevOpen.current
    prevOpen.current = controlledOpen ?? false
    if (!justOpened || !prefill) return
    if (prefill.doctorId) setDoctorId(prefill.doctorId)
    if (prefill.date)     setDate(prefill.date)
  }, [controlledOpen, isControlled, prefill])

  // ── Auto-select nearest available slot when prefill.startsAt is set ───────────
  useEffect(() => {
    if (!prefill?.startsAt || slots.length === 0 || slotStart) return
    const target = new Date(prefill.startsAt).getTime()
    const nearest = slots.reduce((best, s) =>
      Math.abs(new Date(s).getTime() - target) < Math.abs(new Date(best).getTime() - target)
        ? s
        : best
    )
    setSlotStart(nearest)
  // We intentionally only re-run when `slots` changes (after each fetch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots])

  // ── Reset service + slot when doctor changes ──────────────────────────────────
  useEffect(() => {
    setServiceId('')
    setSlotStart('')
    setResolvedDoctorId('')
    setSlots([])
    setSlotDoctorsMap({})
    setNoNextAvailable(false)
  }, [doctorId])

  // ── Reset slot when service or date changes ───────────────────────────────────
  useEffect(() => {
    setSlotStart('')
    setResolvedDoctorId('')
    setSlots([])
    setSlotDoctorsMap({})
    setNoNextAvailable(false)
  }, [serviceId, date])

  // ── Reset slot selection when time filter changes (re-filter existing slots) ──
  useEffect(() => {
    setSlotStart('')
    setResolvedDoctorId('')
    setNoNextAvailable(false)
  }, [timeFilter])

  // ── Fetch available slots ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!canFetchSlots) return
    setLoadingSlots(true)
    setSlotDoctorsMap({})
    // Mode B (any-doctor): omit doctorId → /api/slots uses get_slots_for_service
    // Mode A (specific doctor): include doctorId → /api/slots uses get_available_slots
    const url = isAnyDoctor
      ? `/api/slots?serviceId=${serviceId}&date=${date}`
      : `/api/slots?doctorId=${doctorId}&serviceId=${serviceId}&date=${date}`

    fetch(url)
      .then(r => r.json())
      .then(body => {
        if (isAnyDoctor) {
          type ModeB = { start: string; doctors: { id: string; name: string; specialty: string | null }[] }
          const raw = (body.slots ?? []) as ModeB[]
          setSlots(raw.map(s => s.start))
          const map: Record<string, { id: string; name: string; specialty: string | null }[]> = {}
          raw.forEach(s => { map[s.start] = s.doctors })
          setSlotDoctorsMap(map)
        } else {
          setSlots(body.slots ?? [])
        }
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  // isAnyDoctor is derived from doctorId which is already in deps; listing it
  // explicitly prevents stale-closure issues if the derivation ever changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, serviceId, date, canFetchSlots, isAnyDoctor])

  // ── Form helpers ──────────────────────────────────────────────────────────────
  function resetForm() {
    setPatientName('')
    setPatientPhone('')
    setDoctorId('')
    setServiceId('')
    setDate(todayLocalDate())
    setSlotStart('')
    setSlots([])
    setSlotDoctorsMap({})
    setResolvedDoctorId('')
    setTimeFilter('any')
    prevOpen.current = false
  }

  function handleOpenChange(value: boolean) {
    if (isControlled) {
      if (!value) resetForm()
      controlledOnOpenChange?.(value)
    } else {
      setSelfOpen(value)
      if (!value) resetForm()
    }
  }

  function selectSlot(iso: string) {
    setSlotStart(iso)
    if (isAnyDoctor) {
      setResolvedDoctorId(slotDoctorsMap[iso]?.[0]?.id ?? '')
    }
  }

  function handleFindNext() {
    setNoNextAvailable(false)
    const base = new Date(date + 'T00:00:00Z')
    base.setUTCDate(base.getUTCDate() + 1)
    let searchFrom       = base.toISOString().slice(0, 10)
    const searchDoctorId = isAnyDoctor ? null : doctorId

    startNextTransition(async () => {
      // Up to 10 iterations: each finds the next date with ANY slot, then
      // checks client-side whether it has slots matching the active time filter.
      // In practice this terminates in 1–2 iterations for morning/afternoon filters.
      for (let i = 0; i < 10; i++) {
        const found = await findNextAvailableDate(serviceId, searchDoctorId, searchFrom)
        if (!found) { setNoNextAvailable(true); return }

        if (timeFilter === 'any') {
          setDate(found)
          return
        }

        // Probe the candidate date for slots matching the time filter
        const url = searchDoctorId
          ? `/api/slots?doctorId=${searchDoctorId}&serviceId=${serviceId}&date=${found}`
          : `/api/slots?serviceId=${serviceId}&date=${found}`

        try {
          const resp      = await fetch(url)
          const body      = await resp.json()
          const daySlots: string[] = searchDoctorId
            ? (body.slots ?? [])
            : (body.slots ?? []).map((s: { start: string }) => s.start)

          if (daySlots.some(iso => matchesTimeFilter(iso, timezone, timeFilter))) {
            setDate(found)
            return
          }
        } catch {
          // Fail open: accept the date rather than looping endlessly
          setDate(found)
          return
        }

        // This day has no matching-turno slots; advance past it and retry
        const next = new Date(found + 'T00:00:00Z')
        next.setUTCDate(next.getUTCDate() + 1)
        searchFrom = next.toISOString().slice(0, 10)
      }

      setNoNextAvailable(true)
    })
  }

  function handleSubmit() {
    const effectiveDoctorId = isAnyDoctor ? resolvedDoctorId : doctorId
    if (!patientName.trim() || !patientPhone || !effectiveDoctorId || !serviceId || !slotStart) {
      toast({
        variant: 'destructive',
        title: 'Campos incompletos',
        description: 'Rellena todos los campos antes de continuar.',
      })
      return
    }

    start(async () => {
      const result = await bookAppointmentManual({
        patientName:  patientName.trim(),
        patientPhone: patientPhone.trim(),
        doctorId:     effectiveDoctorId,
        serviceId,
        startsAt: slotStart,
      })

      if ('demo' in result) { notifyDemo(); return }
      if ('error' in result && result.error) {
        toast({ variant: 'destructive', title: 'Error al crear cita', description: result.error })
        return
      }

      toast({
        variant: 'success',
        title: 'Cita creada',
        description: 'El paciente recibirá un WhatsApp de confirmación.',
      })
      handleOpenChange(false)
    })
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      {/* Trigger button only rendered in standalone (uncontrolled) mode */}
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nueva cita
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear cita manualmente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Patient info */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="na-name" className="flex items-center gap-1.5 text-xs font-medium">
                <User className="h-3.5 w-3.5 text-muted-foreground" /> Nombre del paciente
              </Label>
              <Input
                id="na-name"
                placeholder="Ana García López"
                value={patientName}
                onChange={e => setPatientName(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="na-phone" className="flex items-center gap-1.5 text-xs font-medium">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Teléfono (WhatsApp)
              </Label>
              <Input
                id="na-phone"
                placeholder="+34612345678"
                value={patientPhone}
                onChange={e => setPatientPhone(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          {/* Doctor + Service */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" /> Médico
              </Label>
              <Select value={doctorId} onValueChange={setDoctorId} disabled={pending}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona médico" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Cualquier profesional</SelectItem>
                  {doctors.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}{d.specialty ? ` · ${d.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Servicio</Label>
              <Select value={serviceId} onValueChange={setServiceId} disabled={!doctorId || pending}>
                <SelectTrigger>
                  <SelectValue placeholder={doctorId ? 'Selecciona servicio' : 'Elige médico primero'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredServices.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.duration_minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="na-date" className="flex items-center gap-1.5 text-xs font-medium">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> Fecha
            </Label>
            <Input
              id="na-date"
              type="date"
              value={date}
              min={todayLocalDate()}
              onChange={e => setDate(e.target.value)}
              disabled={pending}
            />
          </div>

          {/* Time-of-day filter — appears once doctor + service + date are all set */}
          {canFetchSlots && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Turno</Label>
              <div className="flex gap-1.5">
                {(['any', 'morning', 'afternoon'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setTimeFilter(f)}
                    disabled={pending}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      timeFilter === f
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-slate-50'
                    }`}
                  >
                    {TIME_FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time slots */}
          {canFetchSlots && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Horario disponible
              </Label>
              {loadingSlots ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando horarios…
                </div>
              ) : filteredSlots.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 py-5 text-center">
                  <CalendarX className="h-8 w-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">
                    {slots.length > 0
                      ? `Sin huecos de ${timeFilter === 'morning' ? 'mañana' : 'tarde'} este día`
                      : 'Sin disponibilidad este día'}
                  </p>
                  {noNextAvailable ? (
                    <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                      No encontramos disponibilidad en los próximos 45 días
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={searchingNext}
                      onClick={handleFindNext}
                      className="gap-2"
                    >
                      {searchingNext ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Buscando…
                        </>
                      ) : (
                        <>
                          <Search className="h-3.5 w-3.5" />
                          Buscar próximo hueco libre
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {filteredSlots.map(iso => (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => selectSlot(iso)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        slotStart === iso
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-slate-200 bg-white hover:border-primary/50 hover:bg-slate-50'
                      }`}
                      disabled={pending}
                    >
                      {formatTimeLabel(iso, timezone)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {slotStart && displayDoctorName && selectedService && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="font-medium">{displayDoctorName}</span> · {selectedService.name} ·{' '}
              {new Date(slotStart).toLocaleString('es-ES', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: timezone,
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || !patientName || !patientPhone || !slotStart || (isAnyDoctor && !resolvedDoctorId)}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Creando…
              </>
            ) : (
              'Crear cita'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
