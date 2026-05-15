'use client'
import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StepService }   from './step-service'
import { StepSlot }      from './step-slot'
import { StepDoctor }    from './step-doctor'
import { StepPatient }   from './step-patient'
import { StepConfirmed } from './step-confirmed'
import type { ClinicBookingData, ServiceOption, DoctorOption, SlotWithDoctors, BookingState } from './types'

// Time-First flow: Service → Slot (calendar) → Doctor (if >1) → Patient → Confirmed
const STEPS = { SERVICE: 0, SLOT: 1, DOCTOR: 2, PATIENT: 3, CONFIRMED: 4 }

const TOTAL_STEPS = 4
const STEP_LABELS = ['Servicio', 'Fecha', 'Médico', 'Datos']

function ProgressBar({ current }: { current: number }) {
  const scaleX = current / TOTAL_STEPS
  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 items-center">
          {STEP_LABELS.map((label, i) => (
            <span
              key={i}
              className={`text-[11px] font-medium transition-colors ${
                i < current ? 'text-primary' : i === current ? 'text-slate-700' : 'text-slate-300'
              }`}
            >
              {label}
              {i < STEP_LABELS.length - 1 && (
                <span className="text-slate-200 mx-1">›</span>
              )}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-slate-400 tabular-nums">{current + 1}/{TOTAL_STEPS}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
        <motion.div
          className="h-full w-full rounded-full bg-primary origin-left"
          initial={false}
          animate={{ scaleX }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        />
      </div>
    </div>
  )
}

export function BookingWizard({ clinic }: { clinic: ClinicBookingData }) {
  const [state, setState] = useState<BookingState>({
    step:          STEPS.SERVICE,
    service:       null,
    slotStart:     null,
    slotDoctors:   [],
    doctor:        null,
    patientName:   '',
    patientPhone:  '',
    appointmentId: null,
  })

  const [patientError, setPatientError] = useState<string | null>(null)
  const [isLoading,    setIsLoading]    = useState(false)

  // ─── Step handlers ────────────────────────────────────────────

  const selectService = useCallback((service: ServiceOption) => {
    setState((s) => ({ ...s, step: STEPS.SLOT, service, slotStart: null, slotDoctors: [], doctor: null }))
  }, [])

  const selectSlot = useCallback((slot: SlotWithDoctors) => {
    if (slot.doctors.length === 1) {
      setState((s) => ({
        ...s,
        step:        STEPS.PATIENT,
        slotStart:   slot.start,
        slotDoctors: slot.doctors,
        doctor:      slot.doctors[0],
      }))
    } else {
      setState((s) => ({
        ...s,
        step:        STEPS.DOCTOR,
        slotStart:   slot.start,
        slotDoctors: slot.doctors,
        doctor:      null,
      }))
    }
  }, [])

  const selectDoctor = useCallback((doctor: DoctorOption) => {
    setState((s) => ({ ...s, step: STEPS.PATIENT, doctor }))
  }, [])

  const goBack = useCallback(() => {
    setState((s) => {
      if (s.step === STEPS.PATIENT && s.slotDoctors.length <= 1) {
        return { ...s, step: STEPS.SLOT }
      }
      return { ...s, step: Math.max(0, s.step - 1) }
    })
  }, [])

  async function bookInstant(name: string, phone: string) {
    setIsLoading(true)
    setPatientError(null)
    try {
      const res = await fetch('/api/book', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          clinicId:     clinic.id,
          doctorId:     state.doctor!.id,
          serviceId:    state.service!.id,
          startsAt:     state.slotStart!,
          patientName:  name,
          patientPhone: phone,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setPatientError('Este horario ya no está disponible. Por favor elige otro.')
          setState((s) => ({ ...s, step: STEPS.SLOT }))
          return
        }
        if (res.status === 429) {
          setPatientError('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')
          return
        }
        setPatientError(body.error ?? 'No se pudo confirmar la cita. Inténtalo de nuevo.')
        return
      }
      setState((s) => ({
        ...s,
        step:          STEPS.CONFIRMED,
        patientName:   name,
        patientPhone:  phone,
        appointmentId: body.appointmentId,
      }))
    } catch {
      setPatientError('Error de red. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────

  const showProgress = state.step < STEPS.CONFIRMED

  return (
    <div className="w-full">
      {showProgress && <ProgressBar current={state.step} />}

      <AnimatePresence mode="wait">
        {state.step === STEPS.SERVICE && (
          <StepService
            key="service"
            services={clinic.services}
            onSelect={selectService}
          />
        )}

        {state.step === STEPS.SLOT && state.service && (
          <StepSlot
            key="slot"
            service={state.service}
            timezone={clinic.timezone}
            onSelect={selectSlot}
            onBack={goBack}
          />
        )}

        {state.step === STEPS.DOCTOR && state.service && state.slotStart && (
          <StepDoctor
            key="doctor"
            service={state.service}
            slotStart={state.slotStart}
            timezone={clinic.timezone}
            doctors={state.slotDoctors}
            onSelect={selectDoctor}
            onBack={goBack}
          />
        )}

        {state.step === STEPS.PATIENT && state.service && state.doctor && state.slotStart && (
          <StepPatient
            key="patient"
            service={state.service}
            doctor={state.doctor}
            timezone={clinic.timezone}
            slotStart={state.slotStart}
            onSubmit={bookInstant}
            onBack={goBack}
            isLoading={isLoading}
            error={patientError}
          />
        )}

        {state.step === STEPS.CONFIRMED && state.service && state.doctor && state.slotStart && (
          <StepConfirmed
            key="confirmed"
            service={state.service}
            doctor={state.doctor}
            slotStart={state.slotStart}
            timezone={clinic.timezone}
            patientName={state.patientName}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
