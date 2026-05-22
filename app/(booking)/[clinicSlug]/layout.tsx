import { createClient } from '@/lib/supabase/server'
import { Stethoscope } from 'lucide-react'

export default async function BookingLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ clinicSlug: string }>
}) {
  const { clinicSlug } = await params
  const supabase = await createClient()
  const { data: clinic } = await supabase
    .from('clinics').select('name').eq('slug', clinicSlug).single()

  const clinicName = clinic?.name ?? 'Reservas'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary shrink-0">
            <Stethoscope className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="font-semibold text-slate-900 text-sm">{clinicName}</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 pb-28">{children}</main>
      <footer className="border-t border-slate-100 bg-white/60 py-4">
        <div className="max-w-5xl mx-auto px-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          <a href={`/privacidad?slug=${clinicSlug}`} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Privacidad</a>
          <a href="/aviso-legal"  className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Aviso Legal</a>
          <a href="/cookies"      className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Cookies</a>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-xs text-slate-400">Gestionado por GXA Studio</span>
        </div>
      </footer>
    </div>
  )
}
