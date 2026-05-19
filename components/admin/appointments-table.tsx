'use client'
import { useState, useTransition, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { cancelAppointment } from '@/app/(admin)/admin/appointments/actions'
import { Button } from '@/components/ui/button'
import { Badge }  from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { XCircle, Loader2, CalendarDays, Phone, User, Stethoscope, Search } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type AppointmentStatus = 'confirmed' | 'cancelled'

interface AppointmentRow {
  id: string
  patient_name: string
  patient_phone: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  created_at: string
  notes: string | null
  doctors: { id: string; name: string; specialty: string | null } | null
  services: { id: string; name: string; duration_minutes: number } | null
}

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
}

const STATUS_VARIANTS: Record<AppointmentStatus, 'secondary' | 'success' | 'destructive'> = {
  confirmed: 'success',
  cancelled: 'destructive',
}

function formatDateTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  })
}

export function AppointmentsTable({
  appointments: initial,
  timezone,
}: {
  appointments: AppointmentRow[]
  timezone: string
}) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [cancelId, setCancelId] = useState<string | null>(null)
  const [pending,  start]       = useTransition()

  const statusFilter = searchParams.get('status') ?? 'all'
  const dateFilter   = searchParams.get('date') ?? ''
  const searchQuery  = searchParams.get('q') ?? ''

  const [inputValue,  setInputValue]  = useState(searchQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function handleSearch(value: string) {
    setInputValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      const trimmed = value.trim()
      if (trimmed) params.set('q', trimmed)
      else params.delete('q')
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    }, 300)
  }

  function handleCancel() {
    if (!cancelId) return
    start(async () => {
      const result = await cancelAppointment(cancelId)
      setCancelId(null)
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: result.error })
        return
      }
      toast({ variant: 'success', title: 'Cita cancelada' })
    })
  }

  const stats = {
    total:     initial.length,
    confirmed: initial.filter((a) => a.status === 'confirmed').length,
    cancelled: initial.filter((a) => a.status === 'cancelled').length,
  }

  return (
    <>
      {/* Stats strip — 2 cols on mobile, 3 on sm+ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {([
          { label: 'Total',       value: stats.total,     color: 'text-slate-700' },
          { label: 'Confirmadas', value: stats.confirmed, color: 'text-emerald-600' },
          { label: 'Canceladas',  value: stats.cancelled, color: 'text-rose-600' },
        ] as const).map((s) => (
          <Card key={s.label} className="border-slate-200/70">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar por nombre o teléfono..."
          value={inputValue}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={(v) => updateFilter('status', v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="confirmed">Confirmadas</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-44"
          value={dateFilter}
          onChange={(e) => updateFilter('date', e.target.value)}
        />
        {(statusFilter !== 'all' || dateFilter || inputValue) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInputValue('')
              router.push(pathname, { scroll: false })
            }}
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Mobile card view (< md) */}
      <div className="md:hidden">
        {initial.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            No hay citas para los filtros seleccionados.
          </div>
        ) : (
          <div className="space-y-3">
            {initial.map((a) => (
              <Card key={a.id} className="border-slate-200/70">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium text-sm truncate">{a.patient_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <Phone className="h-3 w-3 shrink-0" />
                        {a.patient_phone}
                      </div>
                    </div>
                    <Badge variant={STATUS_VARIANTS[a.status]} className="shrink-0">
                      {STATUS_LABELS[a.status]}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Stethoscope className="h-3.5 w-3.5 shrink-0" />
                      <span>{a.doctors?.name ?? '—'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatDateTime(a.starts_at, timezone)}</span>
                    </div>
                    {a.services && (
                      <Badge variant="outline" className="text-xs font-normal">
                        {a.services.name} · {a.services.duration_minutes} min
                      </Badge>
                    )}
                  </div>

                  {a.status !== 'cancelled' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-rose-200 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => setCancelId(a.id)}
                      disabled={pending}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Cancelar cita
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Desktop table view (>= md) */}
      <Card className="hidden md:block border-slate-200/70">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead>Paciente</TableHead>
                <TableHead>Médico / Servicio</TableHead>
                <TableHead>Fecha y hora</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initial.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No hay citas para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : initial.map((a) => (
                <TableRow key={a.id} className="border-slate-100">
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm">{a.patient_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        {a.patient_phone}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-sm">
                        <Stethoscope className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {a.doctors?.name ?? '—'}
                      </div>
                      {a.services && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {a.services.name} · {a.services.duration_minutes} min
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      {formatDateTime(a.starts_at, timezone)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[a.status]}>
                      {STATUS_LABELS[a.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {a.status !== 'cancelled' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => setCancelId(a.id)}
                        disabled={pending}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta cita?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El paciente no recibirá notificación automática.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={pending}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sí, cancelar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
