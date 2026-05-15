/**
 * E2E — Booking flow + WhatsApp debug
 *
 * Uses /test-fixture (static clinic data, no DB required).
 * Mocks /api/available-days and /api/slots so the calendar works.
 * Intercepts /api/book to:
 *   a) Capture and log the exact payload the UI sends (verify phone format)
 *   b) Fulfill with a mock 201 so the confirmation screen renders
 *
 * Run against local dev server (default):
 *   npx playwright test tests/booking-whatsapp.spec.ts --headed
 *
 * To hit the REAL /api/book and trigger an actual Twilio call, set the env var:
 *   REAL_BOOK=1 npx playwright test tests/booking-whatsapp.spec.ts --headed
 * Then watch the Next.js terminal for [Twilio WA] log lines.
 */

import { test, expect, type Page, type Route } from '@playwright/test'

const FIXTURE_URL   = '/test-fixture'
const PATIENT_NAME  = 'Test Playwright Debug'
const PATIENT_PHONE = '+34674953541'

// A slot far in the future so the 15-min grace-period filter never cuts it
const FUTURE_SLOT_ISO = '2027-06-15T09:00:00.000Z'

// Fixture IDs that match /test-fixture data exactly
const FIXTURE_SERVICE_CARDIO = '00000000-0000-0000-0000-000000000011'  // Cardiología (1 doctor → skips doctor step)
const FIXTURE_DOCTOR_TORRES  = { id: '00000000-0000-0000-0000-000000000022', name: 'Dr. Miguel Torres', specialty: 'Cardiología', avatar_url: null }

// ─── Mocks ───────────────────────────────────────────────────────────────────

async function mockSlotApis(page: Page) {
  // All weekdays have availability
  await page.route('**/api/available-days**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ activeDow: [1, 2, 3, 4, 5] }),
    })
  )

  // Return one future slot with the fixture Cardiology doctor
  await page.route('**/api/slots**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slots: [
          { start: FUTURE_SLOT_ISO, doctors: [FIXTURE_DOCTOR_TORRES] },
        ],
      }),
    })
  )
}

async function mockBookApi(page: Page, capturedPayloads: unknown[]) {
  await page.route('**/api/book', async (route: Route) => {
    const request = route.request()
    let body: unknown = null
    try { body = await request.postDataJSON() } catch { /* ignore */ }

    // Log the payload so we can inspect the phone format in the test output
    console.log('\n[TEST] /api/book intercepted → payload:', JSON.stringify(body, null, 2))
    capturedPayloads.push(body)

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ appointmentId: 'mock-appt-whatsapp-debug' }),
    })
  })
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

async function selectService(page: Page) {
  await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()
  // Cardiología has only 1 doctor → wizard skips StepDoctor entirely
  await page.getByText('Cardiología').click()
  await expect(page.getByText('Elige fecha y hora')).toBeVisible()
}

async function selectSlot(page: Page) {
  // Pick the first non-disabled day in the calendar
  const dayButton = page.locator('td[role="gridcell"] button:not([disabled])').first()
  await expect(dayButton).toBeVisible({ timeout: 10_000 })
  await dayButton.click()

  // Wait for slot grid to appear (mocked response is instant)
  const slotButton = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
  await expect(slotButton).toBeVisible({ timeout: 10_000 })
  await slotButton.click()

  // "Confirmar HH:MM" CTA appears after slot selection
  const confirmSlotBtn = page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ })
  await expect(confirmSlotBtn).toBeVisible()
  await confirmSlotBtn.click()

  await expect(page.getByText('Tus datos')).toBeVisible()
}

async function fillPatientForm(page: Page) {
  await page.getByLabel('Nombre completo').fill(PATIENT_NAME)

  // Clear the pre-filled "+34" prefix and type the full E.164 number
  const phoneInput = page.getByLabel('Número de teléfono')
  await phoneInput.clear()
  await phoneInput.fill(PATIENT_PHONE)

  await page.getByRole('checkbox').check()

  // Button must now be enabled
  const submitBtn = page.getByRole('button', { name: 'Confirmar cita' })
  await expect(submitBtn).toBeEnabled()
  return submitBtn
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('WhatsApp Debug — Booking Flow', () => {

  test('Full funnel reaches confirmation screen', async ({ page }) => {
    const captured: unknown[] = []

    await mockSlotApis(page)
    await mockBookApi(page, captured)
    await page.goto(FIXTURE_URL)

    await selectService(page)
    await selectSlot(page)
    const submitBtn = await fillPatientForm(page)
    await submitBtn.click()

    // ── Assert confirmation screen ──────────────────────────────────────────
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(PATIENT_NAME)).toBeVisible()

    // ── Assert /api/book received correct phone format ──────────────────────
    expect(captured).toHaveLength(1)
    const payload = captured[0] as Record<string, string>

    console.log('\n[TEST] Phone sent to /api/book:', payload.patientPhone)

    // Must be strict E.164: +34 followed by 9 digits
    expect(payload.patientPhone).toMatch(/^\+34\d{9}$/)
    expect(payload.patientName).toBe(PATIENT_NAME)
    expect(payload.patientPhone).toBe(PATIENT_PHONE)
  })

  test('GDPR checkbox gates the submit button', async ({ page }) => {
    const captured: unknown[] = []

    await mockSlotApis(page)
    await mockBookApi(page, captured)
    await page.goto(FIXTURE_URL)

    await selectService(page)
    await selectSlot(page)

    await page.getByLabel('Nombre completo').fill(PATIENT_NAME)
    const phoneInput = page.getByLabel('Número de teléfono')
    await phoneInput.clear()
    await phoneInput.fill(PATIENT_PHONE)

    const submitBtn = page.getByRole('button', { name: 'Confirmar cita' })
    // Disabled without consent even with valid name+phone
    await expect(submitBtn).toBeDisabled()

    await page.getByRole('checkbox').check()
    await expect(submitBtn).toBeEnabled()
  })

  test('Invalid phone format keeps submit disabled', async ({ page }) => {
    await mockSlotApis(page)
    await page.goto(FIXTURE_URL)

    await selectService(page)
    await selectSlot(page)

    await page.getByLabel('Nombre completo').fill(PATIENT_NAME)

    // Only digits, no country prefix — invalid
    const phoneInput = page.getByLabel('Número de teléfono')
    await phoneInput.clear()
    await phoneInput.fill('674953541')

    await page.getByRole('checkbox').check()

    const submitBtn = page.getByRole('button', { name: 'Confirmar cita' })
    await expect(submitBtn).toBeDisabled()
  })

})
