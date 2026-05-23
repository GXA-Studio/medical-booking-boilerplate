'use client'
import { useState, useTransition } from 'react'
import { createDoctor, updateDoctor, toggleDoctor } from '@/app/(admin)/admin/doctors/actions'
import { useGuestMode } from '@/components/admin/guest-mode-context'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Label }  from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge }  from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from '@/hooks/use-toast'
import { Plus, Pencil, Loader2 } from 'lucide-react'

interface DoctorRow {
  id: string
  name: string
  email: string | null
  specialty: string | null
  is_active: boolean
  doctor_services: { service_id: string }[]
}

interface ServiceOption { id: string; name: string }

export function DoctorsClient({ doctors: initial, services }: { doctors: DoctorRow[]; services: ServiceOption[] }) {
  const { notifyDemo } = useGuestMode()
  const [doctors,  setDoctors]  = useState(initial)
  const [open,     setOpen]     = useState(false)
  const [mode,     setMode]     = useState<'create' | 'edit'>('create')
  const [selected, setSelected] = useState<DoctorRow | null>(null)
  const [pending,  start]       = useTransition()

  function openCreate() { setMode('create'); setSelected(null); setOpen(true) }
  function openEdit(d: DoctorRow) { setMode('edit'); setSelected(d); setOpen(true) }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const result = mode === 'create' ? await createDoctor(fd) : await updateDoctor(selected!.id, fd)
      if ('demo' in result) { notifyDemo(); setOpen(false); return }
      if ('error' in result && result.error) {
        toast({ variant: 'destructive', title: 'Error', description: typeof result.error === 'string' ? result.error : 'Verifica los campos.' })
        return
      }
      toast({ variant: 'success', title: mode === 'create' ? 'Médico creado' : 'Médico actualizado' })
      setOpen(false)
    })
  }

  async function handleToggle(d: DoctorRow, checked: boolean) {
    setDoctors((prev) => prev.map((x) => x.id === d.id ? { ...x, is_active: checked } : x))
    const result = await toggleDoctor(d.id, checked)
    if (result && 'demo' in result) notifyDemo()
  }

  const selectedServiceIds = new Set(selected?.doctor_services.map((ds) => ds.service_id) ?? [])

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nuevo médico
        </Button>
      </div>

      <Card className="border-slate-200/70">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead>Médico</TableHead>
                <TableHead>Especialidad</TableHead>
                <TableHead>Servicios</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doctors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No hay médicos. Crea el primero.
                  </TableCell>
                </TableRow>
              ) : doctors.map((d) => (
                <TableRow key={d.id} className="border-slate-100">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {d.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{d.name}</p>
                        {d.email && <p className="text-xs text-muted-foreground">{d.email}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.specialty ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {d.doctor_services.slice(0, 2).map((ds) => {
                        const svc = services.find((s) => s.id === ds.service_id)
                        return svc ? <Badge key={ds.service_id} variant="secondary" className="text-xs">{svc.name}</Badge> : null
                      })}
                      {d.doctor_services.length > 2 && (
                        <Badge variant="outline" className="text-xs">+{d.doctor_services.length - 2}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch checked={d.is_active} onCheckedChange={(c) => handleToggle(d, c)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Nuevo médico' : 'Editar médico'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre completo *</Label>
              <Input id="name" name="name" required defaultValue={selected?.name ?? ''} placeholder="Dra. Ana García" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="specialty">Especialidad</Label>
                <Input id="specialty" name="specialty" defaultValue={selected?.specialty ?? ''} placeholder="Medicina General" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={selected?.email ?? ''} />
              </div>
            </div>
            {services.length > 0 && (
              <div className="space-y-2">
                <Label>Servicios que ofrece</Label>
                <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                  {services.map((svc) => (
                    <label key={svc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        name="service_ids"
                        value={svc.id}
                        defaultChecked={selectedServiceIds.has(svc.id)}
                        className="rounded border-slate-300"
                      />
                      {svc.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
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
