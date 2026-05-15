// TEST FIXTURE PAGE — serves static clinic data for E2E testing.
// No database connection required. Safe to deploy: returns only hardcoded
// mock data, no secrets, no user data exposed.

import { BookingWizard } from '@/components/booking/booking-wizard'
import type { ClinicBookingData } from '@/components/booking/types'

export const metadata = { title: 'Reservar cita — Clínica Demo (Test Fixture)' }

const FIXTURE_CLINIC: ClinicBookingData = {
  id:       '00000000-0000-0000-0000-000000000001',
  name:     'Clínica Demo',
  timezone: 'America/Mexico_City',
  services: [
    {
      id:               '00000000-0000-0000-0000-000000000010',
      name:             'Consulta General',
      duration_minutes: 30,
      price:            350,
      description:      'Evaluación médica general con diagnóstico y receta.',
      doctors: [
        { id: '00000000-0000-0000-0000-000000000020', name: 'Dra. Laura Martínez', specialty: 'Medicina General' },
        { id: '00000000-0000-0000-0000-000000000021', name: 'Dr. Carlos Pérez',    specialty: 'Medicina Familiar' },
      ],
    },
    {
      id:               '00000000-0000-0000-0000-000000000011',
      name:             'Cardiología',
      duration_minutes: 45,
      price:            800,
      description:      'Revisión cardiovascular con electrocardiograma.',
      doctors: [
        { id: '00000000-0000-0000-0000-000000000022', name: 'Dr. Miguel Torres', specialty: 'Cardiología' },
      ],
    },
  ],
}

export default function TestFixturePage() {
  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <BookingWizard clinic={FIXTURE_CLINIC} />
    </div>
  )
}
