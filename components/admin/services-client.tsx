'use client'
import { useState, useTransition, useOptimistic } from 'react'
import type { Service } from '@/lib/supabase/types'
import { createService, updateService, toggleService } from '@/app/(admin)/admin/services/actions'
import { useGuestMode } from '@/components/admin/guest-mode-context'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Label }  from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch }   from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  APPOINTMENT_COLOR_KEYS, COLOR_LABELS, COLOR_HEX,
  type AppointmentColor,
} from '@/lib/constants/colors'
import { Plus, Pencil, Clock, DollarSign, Loader2 } from 'lucide-react'

type FormMode = 'create' | 'edit'

// Optimistic actions applied to the services list on top of the server-side
// `initial` prop. The reducer is a pure function — keeps the optimistic state
// reproducible and lets useOptimistic discard the patch once revalidatePath
// finishes and a fresh `initial` arrives.
type OptimisticAction =
  | { type: 'patch'; service: Service }
  | { type: 'toggle'; id: string; isActive: boolean }

function applyOptimistic(state: Service[], action: OptimisticAction): Service[] {
  switch (action.type) {
    case 'patch':
      return state.map((s) => (s.id === action.service.id ? { ...s, ...action.service } : s))
    case 'toggle':
      return state.map((s) => (s.id === action.id ? { ...s, is_active: action.isActive } : s))
  }
}

export function ServicesClient({ services: initial }: { services: Service[] }) {
  const { notifyDemo } = useGuestMode()
  const [open,        setOpen]        = useState(false)
  const [mode,        setMode]        = useState<FormMode>('create')
  const [selected,    setSelected]    = useState<Service | null>(null)
  const [formColor,   setFormColor]   = useState<AppointmentColor>('blue')
  const [pending,     startTransition] = useTransition()

  // Source of truth: server-component `initial`. revalidatePath('/admin/services')
  // re-flows fresh data into this prop; useOptimistic layers in-flight edits.
  const [services, dispatchOptimistic] = useOptimistic(initial, applyOptimistic)

  function openCreate() {
    setMode('create')
    setSelected(null)
    setFormColor('blue')
    setOpen(true)
  }

  function openEdit(svc: Service) {
    setMode('edit')
    setSelected(svc)
    setFormColor((svc.color ?? 'blue') as AppointmentColor)
    setOpen(true)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      // Optimistic patch for the edit case — applies the new color (and other
      // fields) to the row immediately so the user sees the change before the
      // server round-trip finishes. For 'create' we wait for revalidation since
      // we don't have an ID yet.
      if (mode === 'edit' && selected) {
        dispatchOptimistic({
          type:    'patch',
          service: {
            ...selected,
            name:             String(fd.get('name') ?? selected.name),
            duration_minutes: Number(fd.get('duration_minutes') ?? selected.duration_minutes),
            price:            fd.get('price') ? Number(fd.get('price')) : selected.price,
            description:      (fd.get('description') as string) || null,
            color:            formColor,
          },
        })
      }

      const result = mode === 'create'
        ? await createService(fd)
        : await updateService(selected!.id, fd)

      if ('demo' in result) { notifyDemo(); setOpen(false); return }
      if ('error' in result && result.error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: typeof result.error === 'string' ? result.error : 'Verifica los campos.',
        })
        return
      }

      toast({
        variant: 'success',
        title: mode === 'create' ? 'Servicio creado' : 'Servicio actualizado',
      })
      setOpen(false)
    })
  }

  function handleToggle(svc: Service, checked: boolean) {
    startTransition(async () => {
      dispatchOptimistic({ type: 'toggle', id: svc.id, isActive: checked })
      const result = await toggleService(svc.id, checked)
      if (result && 'demo' in result) notifyDemo()
    })
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nuevo servicio
        </Button>
      </div>

      <Card className="border-slate-200/70">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead>Nombre</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Duración</TableHead>
                <TableHead>Precio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No hay servicios. Crea el primero.
                  </TableCell>
                </TableRow>
              ) : (
                services.map((svc) => {
                  const colorKey = (svc.color ?? 'blue') as AppointmentColor
                  return (
                    <TableRow key={svc.id} className="border-slate-100">
                      <TableCell>
                        <p className="font-medium">{svc.name}</p>
                        {svc.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {svc.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-3.5 w-3.5 rounded-full border border-black/5"
                            style={{ backgroundColor: COLOR_HEX[colorKey] }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {COLOR_LABELS[colorKey]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {svc.duration_minutes} min
                        </div>
                      </TableCell>
                      <TableCell>
                        {svc.price ? (
                          <div className="flex items-center gap-1 text-sm">
                            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                            {Number(svc.price).toFixed(2)}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={svc.is_active}
                          onCheckedChange={(checked) => handleToggle(svc, checked)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(svc)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Nuevo servicio' : 'Editar servicio'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input id="name" name="name" required defaultValue={selected?.name ?? ''} placeholder="Consulta general" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration_minutes">Duración (min) *</Label>
                <Input id="duration_minutes" name="duration_minutes" type="number" min={5} max={480} required
                  defaultValue={selected?.duration_minutes ?? 30} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Precio (opcional)</Label>
                <Input id="price" name="price" type="number" min={0} step="0.01"
                  defaultValue={selected?.price ?? ''} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea id="description" name="description" rows={3}
                defaultValue={selected?.description ?? ''} placeholder="Descripción breve del servicio…" />
            </div>
            <div className="space-y-2">
              <Label>Color en la agenda</Label>
              <div className="flex flex-wrap gap-2.5">
                {APPOINTMENT_COLOR_KEYS.map(c => {
                  const isActive = formColor === c
                  return (
                    <button
                      key={c}
                      type="button"
                      title={COLOR_LABELS[c]}
                      onClick={() => setFormColor(c)}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-all',
                        isActive
                          ? 'border-slate-700 bg-slate-50 font-semibold shadow-sm'
                          : 'border-slate-200 hover:border-slate-400'
                      )}
                    >
                      <span
                        className={cn(
                          'h-4 w-4 rounded-full flex-shrink-0 border border-black/10',
                          isActive && 'ring-2 ring-offset-1 ring-slate-400'
                        )}
                        style={{ backgroundColor: COLOR_HEX[c] }}
                      />
                      <span className="text-slate-700">{COLOR_LABELS[c]}</span>
                    </button>
                  )
                })}
              </div>
              <input type="hidden" name="color" value={formColor} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>
                {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
