'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  CalendarDays, UserRound, Layers, Clock,
  LogOut, Stethoscope, ChevronRight,
} from 'lucide-react'

const navItems = [
  { href: '/admin/appointments', label: 'Citas',     icon: CalendarDays },
  { href: '/admin/services',     label: 'Servicios', icon: Layers },
  { href: '/admin/doctors',      label: 'Médicos',   icon: UserRound },
  { href: '/admin/schedules',    label: 'Horarios',  icon: Clock },
]

interface SidebarProps {
  clinicName?: string
  userEmail?: string
}

export function Sidebar({ clinicName = 'Mi Clínica', userEmail = '' }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-200 bg-slate-950 text-slate-100">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shrink-0">
          <Stethoscope className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{clinicName}</p>
          <p className="text-[11px] text-slate-400">Panel Admin</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              )}
            >
              <item.icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-slate-500 group-hover:text-slate-300')} />
              {item.label}
              {active && <ChevronRight className="ml-auto h-3.5 w-3.5 text-primary" />}
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200 shrink-0">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <p className="truncate text-xs text-slate-400">{userEmail}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
