'use client'
import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StepService }     from './step-service'
import { StepDoctorPre }   from './step-doctor-pre'
import { StepSlot }        from './step-slot'
import { StepDoctor }      from './step-doctor'
import { StepPatient }     from './step-patient'
import { StepConfirmed }   from './step-confirmed'
import type { ClinicBookingData, ServiceOption, DoctorOption, SlotWithDoctors, BookingState } from './types'

// Flow:
//   SERVICE → DOCTOR_PRE (pick specific or "any") → SLOT → [DOCTOR_POST if "any" + >1] → PATIENT → CONFIRMED
const STEPS = {
  SERVICE:     0,
  DOCTOR_PRE:  1,  // pre-slot: choose specific doctor OR "Cualquier especialista"
  SLOT:        2,
  DOCTOR_POST: 3,  // post-slot: only for "any" path when >1 doctors are free at the chosen time
  PATIENT:     4,
  CONFIRMED:   5,
}

const TOTAL_STEPS  = 4
const STEP_LABELS  = ['Servicio', 'Médico', 'Fecha', 'Datos']

// DOCTOR_POST shares the SLOT position in the progress bar (it's a sub-step)
function toProgressStep(step: number): number {
  if (step === STEPS.DOCTOR_POST) return 2
  if (step >= STEPS.PATIENT)      return 3
  return step
}

function ProgressBar({ current }: { current: number }) {
  const progress = toProgressStep(current)
  const scaleX   = progress / TOTAL_STEPS
  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 items-center">
          {STEP_LABELS.map((label, i) => (
            <span
              key={i}
              className={`text-[11px] font-medium transition-colors ${
                i < progress ? 'text-primary' : i === progress ? 'text-slate-700' : 'text-slate-300'
              }`}
            >
              {label}
              {i < STEP_LABELS.length - 1 && (
                <span className="text-slate-200 mx-1">›</span>
              )}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-slate-400 tabular-nums">{progress + 1}/{TOTAL_STEPS}</span>
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
    anySpecialist: false,
    patientName:   '',
    patientPhone:  '',
    appointmentId: null,
  })

  const [patientError, setPatientError] = useState<string | null>(null)
  const [isLoading,    setIsLoading]    = useState(false)

  // ─── Step handlers ────────────────────────────────────────────

  const selectService = useCallback((service: ServiceOption) => {
    setState((s) => ({
      ...s,
      step:          STEPS.DOCTOR_PRE,
      service,
      slotStart:     null,
      slotDoctors:   [],
      doctor:        null,
      anySpecialist: false,
    }))
  }, [])

  // Pre-slot doctor selection: null = "Cualquier especialista", DoctorOption = specific
  const selectDoctorPre = useCallback((doctor: DoctorOption | null) => {
    setState((s) => ({
      ...s,
      step:          STEPS.SLOT,
      doctor,
      anySpecialist: doctor === null,
      slotStart:     null,
      slotDoctors:   [],
    }))
  }, [])

  const selectSlot = useCallback((slot: SlotWithDoctors) => {
    setState((s) => {
      if (!s.anySpecialist) {
        // Specific doctor path: skip DOCTOR_POST, go straight to PATIENT
        return { ...s, step: STEPS.PATIENT, slotStart: slot.start, slotDoctors: slot.doctors }
      }
      // "Cualquier especialista" path
      if (slot.doctors.length <= 1) {
        // Auto-assign the only available doctor
        return {
          ...s,
          step:        STEPS.PATIENT,
          slotStart:   slot.start,
          slotDoctors: slot.doctors,
          doctor:      slot.doctors[0] ?? null,
        }
      }
      // Multiple doctors available → let patient choose
      return {
        ...s,
        step:        STEPS.DOCTOR_POST,
        slotStart:   slot.start,
        slotDoctors: slot.doctors,
        doctor:      null,
      }
    })
  }, [])

  // Post-slot doctor selection (only for "any specialist" path with >1 doctors)
  const selectDoctorPost = useCallback((doctor: DoctorOption) => {
    setState((s) => ({ ...s, step: STEPS.PATIENT, doctor }))
  }, [])

  const goBack = useCallback(() => {
    setState((s) => {
      switch (s.step) {
        case STEPS.DOCTOR_PRE:  return { ...s, step: STEPS.SERVICE }
        case STEPS.SLOT:        return { ...s, step: STEPS.DOCTOR_PRE }
        case STEPS.DOCTOR_POST: return { ...s, step: STEPS.SLOT }
        case STEPS.PATIENT:
          // "any specialist" + saw DOCTOR_POST → go back there
          if (s.anySpecialist && s.slotDoctors.length > 1) return { ...s, step: STEPS.DOCTOR_POST }
          return { ...s, step: STEPS.SLOT }
        default: return { ...s, step: Math.max(0, s.step - 1) }
      }
    })
  }, [])

  async function bookInstant(name: string, phone: string, consented: boolean) {
    setIsLoading(true)
    setPatientError(null)
    if (consented !== true) {
      setPatientError('Debes aceptar la política de privacidad para confirmar tu cita.')
      setIsLoading(false)
      return
    }
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
          consentAccepted: true,
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

        {state.step === STEPS.DOCTOR_PRE && state.service && (
          <StepDoctorPre
            key="doctor-pre"
            service={state.service}
            doctors={clinic.services.find((s) => s.id === state.service!.id)?.doctors ?? []}
            onSelect={selectDoctorPre}
            onBack={goBack}
          />
        )}

        {state.step === STEPS.SLOT && state.service && (
          <StepSlot
            key="slot"
            service={state.service}
            doctor={state.anySpecialist ? null : state.doctor}
            timezone={clinic.timezone}
            onSelect={selectSlot}
            onBack={goBack}
          />
        )}

        {state.step === STEPS.DOCTOR_POST && state.service && state.slotStart && (
          <StepDoctor
            key="doctor-post"
            service={state.service}
            slotStart={state.slotStart}
            timezone={clinic.timezone}
            doctors={state.slotDoctors}
            onSelect={selectDoctorPost}
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
