'use client'

import { createContext, useContext, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { Eye } from 'lucide-react'

interface GuestModeContextValue {
  isGuest: boolean
  notifyDemo: () => void
}

const GuestModeContext = createContext<GuestModeContextValue>({
  isGuest:    false,
  notifyDemo: () => {},
})

export function useGuestMode() {
  return useContext(GuestModeContext)
}

export function GuestModeProvider({
  isGuest,
  children,
}: {
  isGuest: boolean
  children: React.ReactNode
}) {
  const { toast } = useToast()

  const notifyDemo = useCallback(() => {
    toast({
      title:       'Modo demo',
      description: 'En una instalación real este cambio se guardaría. Aquí estás explorando sin modificar nada.',
      duration:    4000,
    })
  }, [toast])

  return (
    <GuestModeContext.Provider value={{ isGuest, notifyDemo }}>
      {isGuest && <GuestBanner />}
      {children}
    </GuestModeContext.Provider>
  )
}

function GuestBanner() {
  return (
    <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 shrink-0">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>Modo demo</strong> — Estás explorando el panel de gestión. Los cambios no se guardan.
      </span>
    </div>
  )
}
