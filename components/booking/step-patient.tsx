'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import Link   from 'next/link'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Label }  from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { ServiceOption, DoctorOption, PatientFormState } from './types'

interface Props {
  service:     ServiceOption
  doctor:      DoctorOption
  timezone:    string
  slotStart:   string
  // L-A9: `consented` is propagated upstream so the wizard cannot accidentally
  // submit a booking without explicit GDPR consent — the server still
  // re-validates this flag and the DB constraint is the last line of defence.
  onSubmit:    (name: string, phone: string, consented: boolean) => Promise<void>
  onBack:      () => void
  isLoading:   boolean
  error:       string | null
  // UX-A7: optional controlled patient form. When provided, the component
  // becomes controlled so the parent can persist values across modal closes
  // (e.g., to let the patient book a second slot without re-typing).
  patientForm?:        PatientFormState
  onPatientFormChange?: (next: PatientFormState) => void
}

function formatSlotHuman(iso: string, timezone: string) {
  return new Date(iso).toLocaleString('es-ES', {
    timeZone:   timezone,
    weekday:    'long',
    day:        'numeric',
    month:      'long',
    hour:       '2-digit',
    minute:     '2-digit',
    hour12:     false,
  })
}

export function StepPatient({
  service, doctor, timezone, slotStart, onSubmit, onBack, isLoading, error,
  patientForm, onPatientFormChange,
}: Props) {
  const [internalForm, setInternalForm] = useState<PatientFormState>(
    () => patientForm ?? { name: '', phone: '+34', consented: false },
  )
  const form     = patientForm ?? internalForm
  const setForm  = (next: PatientFormState) => {
    if (onPatientFormChange) onPatientFormChange(next)
    else setInternalForm(next)
  }
  const { name, phone, consented } = form
  const setName      = (value: string)  => setForm({ ...form, name: value })
  const setPhone     = (value: string)  => setForm({ ...form, phone: value })
  const setConsented = (value: boolean) => setForm({ ...form, consented: value })

  const [touched, setTouched] = useState({ name: false, phone: false })

  const nameValid  = name.trim().length >= 2
  const phoneValid = /^\+[1-9]\d{7,14}$/.test(phone.trim())
  const canSubmit  = nameValid && phoneValid && consented && !isLoading

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched({ name: true, phone: true })
    // L-A9: defence-in-depth. Even if a future refactor weakens `canSubmit`,
    // this guard ensures we never invoke `onSubmit` without explicit consent.
    if (!nameValid || !phoneValid || !consented || isLoading) return
    onSubmit(name.trim(), phone.trim(), consented)
  }

  return (
    <motion.div
      key="step-patient"
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      className="space-y-5"
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 -ml-1" disabled={isLoading}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Tus datos</h2>
          <p className="text-sm text-slate-500 mt-0.5">Recibirás la confirmación por WhatsApp al instante.</p>
        </div>
      </div>

      {/* Booking summary */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
        <p className="text-xs text-primary font-semibold uppercase tracking-wide mb-3">Resumen de tu cita</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="font-semibold text-slate-500">Tipo de cita</dt>
          <dd className="font-medium text-slate-900">{service.name}</dd>

          <dt className="font-semibold text-slate-500">Profesional</dt>
          <dd className="font-medium text-slate-900">
            {doctor.name}
            {doctor.specialty && (
              <span className="font-normal text-slate-500"> · {doctor.specialty}</span>
            )}
          </dd>

          <dt className="font-semibold text-slate-500">Fecha y hora</dt>
          <dd className="font-medium text-slate-900 capitalize">{formatSlotHuman(slotStart, timezone)}</dd>
        </dl>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="patient-name">Nombre completo</Label>
          <Input
            id="patient-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, name: true }))}
            placeholder="Ej. María García López"
            className={cn(touched.name && !nameValid && 'border-destructive focus-visible:ring-destructive')}
          />
          {touched.name && !nameValid && (
            <p className="text-xs text-destructive">Introduce tu nombre completo.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patient-phone">Número de teléfono</Label>
          <Input
            id="patient-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
            placeholder="+34612345678"
            className={cn(
              'font-mono',
              touched.phone && !phoneValid && 'border-destructive focus-visible:ring-destructive'
            )}
          />
          {touched.phone && !phoneValid ? (
            <p className="text-xs text-destructive">Usa formato internacional, ej. +34612345678.</p>
          ) : (
            <p className="text-xs text-slate-400">Formato internacional con prefijo de país (+34 para España).</p>
          )}
        </div>

        {/* RGPD consent — Ley Orgánica 3/2018 (LOPDGDD) + RGPD */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            <strong className="text-slate-700">Información básica sobre protección de datos.</strong>{' '}
            Los datos facilitados (nombre y teléfono) serán tratados por esta clínica con la finalidad
            exclusiva de gestionar tu cita y enviarte la confirmación por WhatsApp. No se cederán
            a terceros. Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición,
            limitación y portabilidad contactando directamente con la clínica, de conformidad con el{' '}
            <strong>Reglamento (UE) 2016/679 (RGPD)</strong> y la{' '}
            <strong>Ley Orgánica 3/2018 (LOPDGDD)</strong>.
          </p>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-primary cursor-pointer"
            />
            <span className="text-xs text-slate-700 font-medium">
              He leído y acepto la{' '}
              <Link
                href="/privacidad"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 text-primary hover:text-primary/80 transition-colors"
              >
                política de privacidad
              </Link>{' '}
              y el tratamiento de mis datos personales para la gestión de esta cita.{' '}
              <span className="text-destructive">*</span>
            </span>
          </label>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
          >
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </motion.div>
        )}

        <Button type="submit" className="w-full" size="lg" disabled={!canSubmit}>
          {isLoading ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" />Reservando…</>
          ) : (
            'Confirmar cita'
          )}
        </Button>
      </form>
    </motion.div>
  )
}
