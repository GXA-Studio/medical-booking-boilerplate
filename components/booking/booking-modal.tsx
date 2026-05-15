'use client'
import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { StepPatient }   from './step-patient'
import { StepConfirmed } from './step-confirmed'
import type { ServiceOption, DoctorOption, ModalPhase } from './types'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  clinicId:     string
  timezone:     string
  service:      ServiceOption
  doctor:       DoctorOption
  slotStart:    string
}

export function BookingModal({
  open, onOpenChange, clinicId, timezone, service, doctor, slotStart,
}: Props) {
  const [phase,        setPhase]        = useState<ModalPhase>('patient')
  const [patientName,  setPatientName]  = useState('')
  const [isLoading,    setIsLoading]    = useState(false)
  const [patientError, setPatientError] = useState<string | null>(null)

  function resetState() {
    setPhase('patient')
    setPatientName('')
    setIsLoading(false)
    setPatientError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  async function bookInstant(name: string, phone: string) {
    setIsLoading(true)
    setPatientError(null)
    try {
      const res = await fetch('/api/book', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          clinicId,
          doctorId:     doctor.id,
          serviceId:    service.id,
          startsAt:     slotStart,
          patientName:  name,
          patientPhone: phone,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setPatientError('Este horario ya no está disponible. Por favor elige otro.')
          handleOpenChange(false)
          return
        }
        if (res.status === 429) {
          setPatientError('Demasiados intentos. Espera unos minutos.')
          return
        }
        setPatientError(body.error ?? 'No se pudo confirmar la cita. Inténtalo de nuevo.')
        return
      }
      setPatientName(name)
      setPhase('confirmed')
    } catch {
      setPatientError('Error de red. Revisa tu conexión.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <AnimatePresence mode="wait">
          {phase === 'patient' && (
            <StepPatient
              key="patient"
              service={service}
              doctor={doctor}
              timezone={timezone}
              slotStart={slotStart}
              onSubmit={bookInstant}
              onBack={() => handleOpenChange(false)}
              isLoading={isLoading}
              error={patientError}
            />
          )}
          {phase === 'confirmed' && (
            <StepConfirmed
              key="confirmed"
              service={service}
              doctor={doctor}
              slotStart={slotStart}
              timezone={timezone}
              patientName={patientName}
            />
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
