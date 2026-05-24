// ─── Tipos heredados (compatibilidad con BookingWizard + test-fixture) ────────

export interface ServiceOption {
  id: string
  name: string
  duration_minutes: number
  price: number | null
  description: string | null
}

export interface DoctorOption {
  id: string
  name: string
  specialty: string | null
  avatar_url?: string | null
}

export interface SlotWithDoctors {
  start:   string
  doctors: DoctorOption[]
}

export interface BookingState {
  step:          number
  service:       ServiceOption | null
  slotStart:     string | null
  slotDoctors:   DoctorOption[]
  doctor:        DoctorOption | null
  anySpecialist: boolean  // true when patient chose "Cualquier especialista" in DOCTOR_PRE
  patientName:   string
  patientPhone:  string
  appointmentId: string | null
}

// ─── Mutuas / Seguros ─────────────────────────────────────────────────────────

export interface InsuranceOption {
  id:       string
  name:     string
  logo_url: string | null
}

// ─── Datos de la clínica (campos nuevos son opcionales para retrocompat) ──────

export interface ClinicBookingData {
  id:       string
  name:     string
  timezone: string
  services: (ServiceOption & { doctors: DoctorOption[] })[]
  // Campos del nuevo motor de búsqueda (ausentes en test-fixture, siempre presentes en DB)
  insurances?:       InsuranceOption[]
  doctorInsurances?: Record<string, string[]>  // doctorId → insuranceId[]
}

// ─── Tipos del nuevo motor de búsqueda Doctoralia-style ──────────────────────

export type TimeOfDay = 'all' | 'morning' | 'afternoon'

export interface SearchFilters {
  serviceId:   string
  doctorId:    string | null   // null = "Cualquier profesional"
  date:        string           // YYYY-MM-DD (inicio de la ventana de 7 días)
  timeOfDay:   TimeOfDay
  insuranceId: string | null
}

// slots[doctorId][fecha_YYYY-MM-DD] = ISO UTC starts[]
export type WeekSlotsMap = Record<string, Record<string, string[]>>

export type ModalPhase = 'patient' | 'confirmed'

export interface ModalBookingState {
  open:          boolean
  phase:         ModalPhase
  service:       ServiceOption | null
  doctor:        DoctorOption | null
  slotStart:     string | null
  patientName:   string
  patientPhone:  string
  appointmentId: string | null
}

// UX-A7: held in the parent (BookingSearch) so a confirmed booking can reset
// service/doctor/date while keeping name + phone + consent ready for the
// patient's next reservation — no friction on the second booking.
export interface PatientFormState {
  name:      string
  phone:     string
  consented: boolean
}
