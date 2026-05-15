'use client'
import { motion } from 'framer-motion'
import { CheckCircle2, CalendarDays, User, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ServiceOption, DoctorOption } from './types'

interface Props {
  service:   ServiceOption
  doctor:    DoctorOption
  slotStart: string
  timezone:  string
  patientName: string
}

function formatConfirmed(iso: string, timezone: string) {
  return new Date(iso).toLocaleString('es-ES', {
    timeZone:  timezone,
    weekday:   'long',
    day:       'numeric',
    month:     'long',
    hour:      '2-digit',
    minute:    '2-digit',
    hour12:    false,
  })
}

export function StepConfirmed({ service, doctor, slotStart, timezone, patientName }: Props) {
  return (
    <motion.div
      key="step-confirmed"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="text-center space-y-6 py-4"
    >
      {/* Success icon with ring animation */}
      <div className="flex justify-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
          className="relative"
        >
          <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 border-2 border-emerald-200">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="space-y-2"
      >
        <h2 className="text-2xl font-bold text-slate-900">¡Cita confirmada!</h2>
        <p className="text-slate-500 text-sm">
          {patientName}, tu cita ha sido reservada. Recibirás un WhatsApp con los detalles y el enlace de cancelación.
        </p>
      </motion.div>

      {/* Summary card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="rounded-2xl border border-slate-200 bg-white p-5 text-left space-y-3"
      >
        <div className="flex items-start gap-3">
          <CalendarDays className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Fecha y hora</p>
            <p className="text-sm font-semibold text-slate-800 capitalize">{formatConfirmed(slotStart, timezone)}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <User className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Médico</p>
            <p className="text-sm font-semibold text-slate-800">{doctor.name}</p>
            {doctor.specialty && <p className="text-xs text-slate-500">{doctor.specialty}</p>}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Servicio</p>
            <p className="text-sm font-semibold text-slate-800">{service.name}</p>
            <p className="text-xs text-slate-500">{service.duration_minutes} min</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <Button
          variant="outline"
          className="w-full"
          onClick={() => window.location.reload()}
        >
          Reservar otra cita
        </Button>
      </motion.div>
    </motion.div>
  )
}
