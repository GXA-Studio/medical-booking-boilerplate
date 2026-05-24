'use client'
import { useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { StepPatient } from './step-patient'
import type { ServiceOption, DoctorOption, PatientFormState } from './types'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  clinicId:     string
  timezone:     string
  service:      ServiceOption
  doctor:       DoctorOption
  slotStart:    string
  onConfirmed:  (patientName: string) => void
  // UX-A7: patient form state lives in the parent so a confirmed booking can
  // reset only the slot/service/doctor without clearing name/phone/consent.
  patientForm:        PatientFormState
  onPatientFormChange: (next: PatientFormState) => void
}

export function BookingModal({
  open, onOpenChange, clinicId, timezone, service, doctor, slotStart, onConfirmed,
  patientForm, onPatientFormChange,
}: Props) {
  const [isLoading,    setIsLoading]    = useState(false)
  const [patientError, setPatientError] = useState<string | null>(null)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setIsLoading(false)
      setPatientError(null)
    }
    onOpenChange(nextOpen)
  }

  async function bookInstant(name: string, phone: string, consented: boolean) {
    setIsLoading(true)
    setPatientError(null)
    try {
      const res = await fetch('/api/book', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          clinicId,
          doctorId:        doctor.id,
          serviceId:       service.id,
          startsAt:        slotStart,
          patientName:     name,
          patientPhone:    phone,
          consentAccepted: consented,
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
      // Close modal first, then notify parent — parent handles the success screen
      handleOpenChange(false)
      onConfirmed(name)
    } catch {
      setPatientError('Error de red. Revisa tu conexión.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <StepPatient
          service={service}
          doctor={doctor}
          timezone={timezone}
          slotStart={slotStart}
          onSubmit={bookInstant}
          onBack={() => handleOpenChange(false)}
          isLoading={isLoading}
          error={patientError}
          patientForm={patientForm}
          onPatientFormChange={onPatientFormChange}
        />
      </DialogContent>
    </Dialog>
  )
}
