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
  const [doctorId,     setDoctorId]     = useState('')
  const [serviceId,    setServiceId]    = useState('')
  const [date,         setDate]         = useState(todayLocalDate())
  const [slotStart,    setSlotStart]    = useState('')

  const [slots,        setSlots]        = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [searchingNext,   startNextTransition] = useTransition()
  const [noNextAvailable, setNoNextAvailable]  = useState(false)

  const dialogOpen = isControlled ? (controlledOpen ?? false) : selfOpen

  // ── Derived values ────────────────────────────────────────────────────────────
  const doctorServices   = doctors.find((d) => d.id === doctorId)?.doctor_services ?? []
  const serviceIds       = new Set(doctorServices.map((ds) => ds.service_id))
  const filteredServices = doctorId ? services.filter((s) => serviceIds.has(s.id)) : services
  const selectedService  = services.find((s) => s.id === serviceId)
  const selectedDoctor   = doctors.find((d) => d.id === doctorId)
  const timezone         = Intl.DateTimeFormat().resolvedOptions().timeZone
  const canFetchSlots    = !!(doctorId && serviceId && date)

  // ── Apply prefill when controlled dialog opens ────────────────────────────────
  const prevOpen = useRef(false)
  useEffect(() => {
    if (!isControlled) return
    const justOpened = controlledOpen && !prevOpen.current
    prevOpen.current = controlledOpen ?? false
    if (!justOpened || !prefill) return
    if (prefill.doctorId) setDoctorId(prefill.doctorId)
    if (prefill.date)     setDate(prefill.date)
    // slotStart is applied after slots load (see below)
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
    setSlots([])
    setNoNextAvailable(false)
  }, [doctorId])

  // ── Reset slot when service or date changes ───────────────────────────────────
  useEffect(() => {
    setSlotStart('')
    setSlots([])
    setNoNextAvailable(false)
  }, [serviceId, date])

  // ── Fetch available slots ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!canFetchSlots) return
    setLoadingSlots(true)
    fetch(`/api/slots?doctorId=${doctorId}&serviceId=${serviceId}&date=${date}`)
      .then(r => r.json())
      .then(body => setSlots(body.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [doctorId, serviceId, date, canFetchSlots])

  // ── Form helpers ──────────────────────────────────────────────────────────────
  function resetForm() {
    setPatientName('')
    setPatientPhone('')
    setDoctorId('')
    setServiceId('')
    setDate(todayLocalDate())
    setSlotStart('')
    setSlots([])
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

  function handleFindNext() {
    setNoNextAvailable(false)
    // Start the scan from the day immediately after the currently selected date
    const base = new Date(date + 'T00:00:00Z')
    base.setUTCDate(base.getUTCDate() + 1)
    const startDate = base.toISOString().slice(0, 10)

    startNextTransition(async () => {
      const found = await findNextAvailableDate(serviceId, doctorId || null, startDate)
      if (found) {
        setDate(found)   // triggers slot-reset + re-fetch via existing useEffects
      } else {
        setNoNextAvailable(true)
      }
    })
  }

  function handleSubmit() {
    if (!patientName.trim() || !patientPhone || !doctorId || !serviceId || !slotStart) {
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
        doctorId,
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
              ) : slots.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 py-5 text-center">
                  <CalendarX className="h-8 w-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">
                    Sin disponibilidad este día
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
                  {slots.map(iso => (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSlotStart(iso)}
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
          {slotStart && selectedDoctor && selectedService && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="font-medium">{selectedDoctor.name}</span> · {selectedService.name} ·{' '}
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
            disabled={pending || !patientName || !patientPhone || !slotStart}
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
