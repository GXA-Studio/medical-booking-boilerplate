'use client'
import type { ServiceOption, DoctorOption, InsuranceOption, SearchFilters, TimeOfDay } from './types'

interface Props {
  services:   (ServiceOption & { doctors: DoctorOption[] })[]
  insurances: InsuranceOption[]
  filters:    SearchFilters
  onChange:   (next: Partial<SearchFilters>) => void
}

const TIME_OPTS: { value: TimeOfDay; label: string }[] = [
  { value: 'morning',   label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'all',       label: 'Todo' },
]

const selectClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 ' +
  'focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer ' +
  'transition-colors hover:border-slate-300'

export function SearchBar({ services, insurances, filters, onChange }: Props) {
  const selectedService = services.find((s) => s.id === filters.serviceId)
  const doctors         = selectedService?.doctors ?? []
  const now             = new Date()
  const today           = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

        {/* Servicio / Especialidad */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            ¿Qué buscas?
          </label>
          <select
            value={filters.serviceId}
            onChange={(e) => onChange({ serviceId: e.target.value, doctorId: null })}
            className={selectClass}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Médico */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            ¿Con quién?
          </label>
          <select
            value={filters.doctorId ?? ''}
            onChange={(e) => onChange({ doctorId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">Cualquier profesional</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        {/* Fecha + franja horaria */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            ¿Cuándo?
          </label>
          <input
            type="date"
            value={filters.date}
            min={today}
            onChange={(e) =>
              onChange({ date: e.target.value || today })
            }
            className={selectClass}
          />
          <div className="flex rounded-lg border border-slate-200 overflow-hidden mt-1">
            {TIME_OPTS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ timeOfDay: opt.value })}
                className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                  filters.timeOfDay === opt.value
                    ? 'bg-primary text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mutua / Seguro */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Mutua / Seguro
          </label>
          <select
            value={filters.insuranceId ?? ''}
            onChange={(e) => onChange({ insuranceId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">Todas las mutuas</option>
            {insurances.map((ins) => (
              <option key={ins.id} value={ins.id}>{ins.name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
