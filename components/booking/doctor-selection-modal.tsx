'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { DoctorOption } from './types'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  slotLabel:    string
  doctors:      DoctorOption[]
  onSelect:     (doctor: DoctorOption) => void
}

function DoctorAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="h-10 w-10 rounded-full object-cover border border-slate-100 shrink-0"
      />
    )
  }
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0 border border-primary/20">
      {initials}
    </div>
  )
}

export function DoctorSelectionModal({ open, onOpenChange, slotLabel, doctors, onSelect }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">¿A quién prefieres?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-500 -mt-1">
          Varios profesionales disponibles a las{' '}
          <span className="font-semibold text-slate-700">{slotLabel}</span>.
          Elige el que prefieras.
        </p>

        <div className="space-y-2 mt-1">
          {doctors.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onSelect(doc)}
              className="w-full flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10 transition-all duration-150"
            >
              <DoctorAvatar name={doc.name} avatarUrl={doc.avatar_url} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{doc.name}</p>
                {doc.specialty && (
                  <p className="text-xs text-slate-500 truncate">{doc.specialty}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
