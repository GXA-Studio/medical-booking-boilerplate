'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/toaster'

export function AdminShell({
  clinicName,
  userEmail,
  children,
}: {
  clinicName: string
  userEmail: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-30 transition-transform duration-200 ease-in-out',
          'md:relative md:flex md:shrink-0 md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Sidebar clinicName={clinicName} userEmail={userEmail} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-slate-100 md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5 text-slate-600" />
          </button>
          <div className="hidden h-4 w-px bg-slate-200 md:block" />
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500">Conectado</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>

      <Toaster />
    </div>
  )
}
