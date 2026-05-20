'use client'
import { useState, useTransition, useOptimistic } from 'react'
import {
  createSchedule, deleteSchedule, toggleSchedule,
  createScheduleException, deleteScheduleException,
} from '@/app/(admin)/admin/schedules/actions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Plus, Trash2, Loader2, Clock, CalendarOff, CalendarCheck, Ban,
} from 'lucide-react'

const DAYS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

interface ScheduleRow {
  id: string
  doctor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
}

interface ExceptionRow {
  id: string
  doctor_id: string
  exception_date: string
  is_working: boolean
  start_time: string | null
  end_time: string | null
}

interface DoctorWithSchedules {
  id: string
  name: string
  specialty: string | null
  is_active: boolean
  schedules: ScheduleRow[]
  exceptions: ExceptionRow[]
}

function formatTime(t: string | null) {
  if (!t) return ''
  return t.slice(0, 5)
}

function formatDateEs(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function todayLocal() {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

// Each exception row in the new model is a "block":
//   start_time === null  → full day off
//   start_time !== null  → partial range block
type ExceptionKind = 'full-day' | 'partial'

function exceptionKind(ex: ExceptionRow): ExceptionKind {
  return ex.start_time === null ? 'full-day' : 'partial'
}

// ─── Optimistic reducer ──────────────────────────────────────────────────────
type OptimisticAction =
  | { type: 'toggle-schedule'; id: string; active: boolean }
  | { type: 'delete-schedule'; id: string }
  | { type: 'delete-exception'; id: string }

function applyOptimistic(state: DoctorWithSchedules[], action: OptimisticAction): DoctorWithSchedules[] {
  return state.map((doc) => {
    switch (action.type) {
      case 'toggle-schedule':
        return {
          ...doc,
          schedules: doc.schedules.map((s) =>
            s.id === action.id ? { ...s, is_active: action.active } : s
          ),
        }
      case 'delete-schedule':
        return { ...doc, schedules: doc.schedules.filter((s) => s.id !== action.id) }
      case 'delete-exception':
        return { ...doc, exceptions: doc.exceptions.filter((e) => e.id !== action.id) }
    }
  })
}

// ─── Component ───────────────────────────────────────────────────────────────
export function ScheduleEditor({ doctors: initialDoctors }: { doctors: DoctorWithSchedules[] }) {
  const [activeDoctorId, setActiveDoctorId] = useState<string>(initialDoctors[0]?.id ?? '')
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false)
  const [addDay, setAddDay] = useState<string>('1')

  // Exception dialog state
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false)
  const [excKind, setExcKind] = useState<ExceptionKind>('full-day')
  const [excDate, setExcDate] = useState(todayLocal())
  const [excStart, setExcStart] = useState('14:00')
  const [excEnd, setExcEnd] = useState('16:00')

  const [pending, start] = useTransition()
  const [optimisticDoctors, dispatchOptimistic] =
    useOptimistic(initialDoctors, applyOptimistic)

  const activeDoctor = optimisticDoctors.find((d) => d.id === activeDoctorId)

  const schedulesByDay = (activeDoctor?.schedules ?? []).reduce<Record<number, ScheduleRow[]>>((acc, s) => {
    if (!acc[s.day_of_week]) acc[s.day_of_week] = []
    acc[s.day_of_week].push(s)
    return acc
  }, {})

  // ── Weekly schedule handlers ───────────────────────────────────────────────
  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('doctor_id', activeDoctorId)
    start(async () => {
      const result = await createSchedule(fd)
      if (result.error) {
        const msg = typeof result.error === 'string' ? result.error : 'Verifica los campos.'
        toast({ variant: 'destructive', title: 'Error', description: msg })
        return
      }
      toast({ variant: 'success', title: 'Turno agregado' })
      setShiftDialogOpen(false)
    })
  }

  function handleDeleteSchedule(id: string) {
    start(async () => {
      dispatchOptimistic({ type: 'delete-schedule', id })
      await deleteSchedule(id)
    })
  }

  function handleToggleSchedule(id: string, checked: boolean) {
    start(async () => {
      dispatchOptimistic({ type: 'toggle-schedule', id, active: checked })
      await toggleSchedule(id, checked)
    })
  }

  // ── Exception handlers ─────────────────────────────────────────────────────
  function openExceptionDialog() {
    setExcKind('full-day')
    setExcDate(todayLocal())
    setExcStart('14:00')
    setExcEnd('16:00')
    setExceptionDialogOpen(true)
  }

  function handleSaveException(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    start(async () => {
      const input =
        excKind === 'full-day'
          ? { doctor_id: activeDoctorId, exception_date: excDate, kind: 'full-day' as const }
          : {
              doctor_id:      activeDoctorId,
              exception_date: excDate,
              kind:           'partial' as const,
              start_time:     excStart,
              end_time:       excEnd,
            }
      const result = await createScheduleException(input)
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error })
        return
      }
      toast({
        variant: 'success',
        title: 'Excepción guardada',
        description:
          excKind === 'full-day'
            ? `Día libre el ${formatDateEs(excDate)}.`
            : `Bloqueo de ${excStart} a ${excEnd} el ${formatDateEs(excDate)}.`,
      })
      setExceptionDialogOpen(false)
    })
  }

  function handleDeleteException(id: string) {
    start(async () => {
      dispatchOptimistic({ type: 'delete-exception', id })
      await deleteScheduleException(id)
    })
  }

  if (initialDoctors.length === 0) {
    return (
      <Card className="border-slate-200/70">
        <CardContent className="h-40 flex items-center justify-center text-muted-foreground text-sm">
          No hay médicos activos. Activa o crea médicos primero.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* ── Doctor tabs ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {optimisticDoctors.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDoctorId(d.id)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              d.id === activeDoctorId
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            {d.name}
            {d.specialty && <span className="ml-1.5 opacity-60 text-xs">· {d.specialty}</span>}
          </button>
        ))}
      </div>

      {/* ── Weekly schedule list ─────────────────────────────────────────── */}
      <Card className="border-slate-200/70">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold">Horario semanal</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeDoctor?.name}
              {activeDoctor?.specialty && ` · ${activeDoctor.specialty}`}
            </p>
          </div>
          <Button size="sm" onClick={() => setShiftDialogOpen(true)} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Añadir turno
          </Button>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {WEEK_ORDER.map((idx) => {
            const blocks = (schedulesByDay[idx] ?? [])
              .slice()
              .sort((a, b) => a.start_time.localeCompare(b.start_time))

            return (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/40 px-3 py-2.5 transition-colors hover:bg-slate-50"
              >
                <div className="w-24 shrink-0 pt-0.5">
                  <p className="text-sm font-semibold text-slate-700">{DAYS_FULL[idx]}</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    {DAYS_SHORT[idx]}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  {blocks.length === 0 ? (
                    <p className="text-xs text-slate-400 italic pt-1">Sin turnos</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {blocks.map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            'group inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-all',
                            s.is_active
                              ? 'border-slate-200 bg-white text-slate-700'
                              : 'border-slate-100 bg-slate-50 text-slate-400 line-through'
                          )}
                        >
                          <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="font-mono">
                            {formatTime(s.start_time)}–{formatTime(s.end_time)}
                          </span>
                          <Switch
                            checked={s.is_active}
                            onCheckedChange={(c) => handleToggleSchedule(s.id, c)}
                            className="scale-75 -my-1"
                            disabled={pending}
                          />
                          <button
                            onClick={() => handleDeleteSchedule(s.id)}
                            disabled={pending}
                            className="p-0.5 text-rose-400 hover:text-rose-600 transition-colors"
                            aria-label="Eliminar turno"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── Exceptions ───────────────────────────────────────────────────── */}
      <Card className="border-slate-200/70">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarOff className="h-4 w-4 text-slate-500" />
              Días Específicos / Excepciones
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bloquea un día entero o un tramo horario concreto (vacaciones, reuniones, descansos).
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={openExceptionDialog}
            className="gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" /> Añadir excepción
          </Button>
        </CardHeader>
        <CardContent>
          {(activeDoctor?.exceptions ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CalendarCheck className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">No hay excepciones programadas.</p>
              <p className="text-xs text-slate-400">
                Añade un día libre o un bloqueo horario para una fecha concreta.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {activeDoctor!.exceptions.map((ex) => {
                const kind = exceptionKind(ex)
                return (
                  <li
                    key={ex.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      kind === 'full-day'
                        ? 'border-rose-200 bg-rose-50/40'
                        : 'border-amber-200 bg-amber-50/40'
                    )}
                  >
                    <div
                      className={cn(
                        'h-9 w-9 shrink-0 rounded-md flex items-center justify-center',
                        kind === 'full-day' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                      )}
                    >
                      {kind === 'full-day'
                        ? <CalendarOff className="h-4 w-4" />
                        : <Ban className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 capitalize">
                        {formatDateEs(ex.exception_date)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {kind === 'full-day'
                          ? 'Día Completo Libre'
                          : <>Bloqueo de <span className="font-mono">{formatTime(ex.start_time)}–{formatTime(ex.end_time)}</span></>}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteException(ex.id)}
                      disabled={pending}
                      className="shrink-0 p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-100/50 rounded-md transition-colors"
                      aria-label="Eliminar excepción"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Add shift dialog ─────────────────────────────────────────────── */}
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Añadir turno — {activeDoctor?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <input type="hidden" name="doctor_id" value={activeDoctorId} />
            <div className="space-y-2">
              <Label>Día de la semana</Label>
              <Select name="day_of_week" value={addDay} onValueChange={setAddDay}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_ORDER.map((i) => (
                    <SelectItem key={i} value={String(i)}>{DAYS_FULL[i]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">Inicio</Label>
                <Input id="start_time" name="start_time" type="time" required defaultValue="08:00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">Fin</Label>
                <Input id="end_time" name="end_time" type="time" required defaultValue="14:00" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShiftDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>
                {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add exception dialog ─────────────────────────────────────────── */}
      <Dialog open={exceptionDialogOpen} onOpenChange={setExceptionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva excepción — {activeDoctor?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveException} className="space-y-4">
            {/* Kind selector — two big tappable cards */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExcKind('full-day')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
                  excKind === 'full-day'
                    ? 'border-rose-300 bg-rose-50 ring-2 ring-rose-200'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                )}
              >
                <CalendarOff className={cn(
                  'h-4 w-4',
                  excKind === 'full-day' ? 'text-rose-600' : 'text-slate-400'
                )} />
                <span className="text-sm font-semibold text-slate-800">Día Completo Libre</span>
                <span className="text-[11px] text-slate-500 leading-tight">
                  El día entero queda bloqueado. No se ofrecerán huecos.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setExcKind('partial')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
                  excKind === 'partial'
                    ? 'border-amber-300 bg-amber-50 ring-2 ring-amber-200'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                )}
              >
                <Ban className={cn(
                  'h-4 w-4',
                  excKind === 'partial' ? 'text-amber-600' : 'text-slate-400'
                )} />
                <span className="text-sm font-semibold text-slate-800">Bloqueo Horario Parcial</span>
                <span className="text-[11px] text-slate-500 leading-tight">
                  Solo se bloquea la franja indicada del día.
                </span>
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exc_date">Fecha</Label>
              <Input
                id="exc_date"
                type="date"
                value={excDate}
                min={todayLocal()}
                onChange={(e) => setExcDate(e.target.value)}
                required
              />
            </div>

            {excKind === 'partial' && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="space-y-2">
                  <Label htmlFor="exc_start">Inicio del bloqueo</Label>
                  <Input
                    id="exc_start"
                    type="time"
                    value={excStart}
                    onChange={(e) => setExcStart(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exc_end">Fin del bloqueo</Label>
                  <Input
                    id="exc_end"
                    type="time"
                    value={excEnd}
                    onChange={(e) => setExcEnd(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExceptionDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : 'Guardar excepción'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
