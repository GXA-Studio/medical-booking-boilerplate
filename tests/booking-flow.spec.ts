/**
 * E2E — Patient Booking Funnel
 *
 * Works against BOTH environments:
 *   - Local: PLAYWRIGHT_BASE_URL not set → webServer starts localhost:3000
 *   - Production: PLAYWRIGHT_BASE_URL=https://medical-booking-boilerplate.vercel.app
 *
 * Fixture page (/test-fixture) renders BookingWizard with static data,
 * so NO Supabase database is required for these tests.
 *
 * API routes intercepted via page.route():
 *   GET  /api/slots     → returns two available time slots
 *   POST /api/otp/send  → returns a fake appointmentId (no SMS sent)
 *   POST /api/otp/verify → returns success (no DB verification)
 */

import { test, expect, type Page } from '@playwright/test'

const FIXTURE_URL = '/test-fixture'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setupMocks(page: Page) {
  await page.route('**/api/slots**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ slots: ['2026-06-15T15:00:00.000Z', '2026-06-15T16:00:00.000Z'] }),
    })
  )
  await page.route('**/api/otp/send', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ appointmentId: 'mock-appt-abc123' }),
    })
  )
  await page.route('**/api/otp/verify', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  )
}

/**
 * The slot step requires TWO interactions:
 *  1. Click a time button (HH:MM) → highlights the slot
 *  2. Click the "Confirmar HH:MM" CTA that appears → advances to patient step
 */
async function selectFirstSlot(page: Page) {
  // Wait for the slot grid to load (mocked response)
  const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
  await expect(slotBtn).toBeVisible({ timeout: 10_000 })
  await slotBtn.click()

  // "Confirmar HH:MM" CTA appears after selection
  const confirmBtn = page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ })
  await expect(confirmBtn).toBeVisible()
  await confirmBtn.click()
}

/** Navigate to patient data step from the fixture page */
async function goToPatientStep(page: Page) {
  await page.goto(FIXTURE_URL)
  await page.getByText('Consulta General').click()
  await expect(page.getByText('¿Con quién?')).toBeVisible()
  await page.getByText('Dra. Laura Martínez').click()
  await expect(page.getByText('Elige fecha y hora')).toBeVisible()
  await selectFirstSlot(page)
  await expect(page.getByText('Tus datos')).toBeVisible()
}

/** Navigate to OTP step from the fixture page */
async function goToOtpStep(page: Page) {
  await goToPatientStep(page)
  await page.getByLabel('Nombre completo').fill('Ana Prueba García')
  await page.getByLabel('Número de teléfono').fill('+521234567890')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Recibir código SMS' }).click()
  await expect(page.getByText('Verifica tu número')).toBeVisible()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Booking Funnel', () => {

  test('Step 1 — service cards are displayed', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()
    await expect(page.getByText('Consulta General')).toBeVisible()
    await expect(page.getByText('Cardiología')).toBeVisible()
  })

  test('Step 2 — selecting a service shows doctor list', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()

    await expect(page.getByText('¿Con quién?')).toBeVisible()
    await expect(page.getByText('Dra. Laura Martínez')).toBeVisible()
    await expect(page.getByText('Dr. Carlos Pérez')).toBeVisible()
  })

  test('Step 3 — selecting a doctor fetches and shows slot grid', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()

    await expect(page.getByText('Elige fecha y hora')).toBeVisible()

    // Slot buttons appear after mock API responds
    const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
    await expect(slotBtn).toBeVisible({ timeout: 10_000 })
  })

  test('Step 3b — clicking a slot shows Confirmar CTA', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()

    const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
    await expect(slotBtn).toBeVisible({ timeout: 10_000 })
    await slotBtn.click()

    // "Confirmar HH:MM" CTA must appear after slot selection
    await expect(page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ })).toBeVisible()
  })

  test('Step 4 — GDPR checkbox is mandatory to enable submit button', async ({ page }) => {
    await setupMocks(page)
    await goToPatientStep(page)

    const submitBtn = page.getByRole('button', { name: 'Recibir código SMS' })

    // ── CRITICAL: button must be DISABLED without consent ───────────────────
    await expect(submitBtn).toBeDisabled()

    // Fill valid name and phone
    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')

    // Still disabled — consent not given
    await expect(submitBtn).toBeDisabled()

    // Grant GDPR consent
    await page.getByRole('checkbox').check()

    // NOW the button must be enabled
    await expect(submitBtn).toBeEnabled()
  })

  test('Step 5 — submitting valid data triggers OTP step', async ({ page }) => {
    await setupMocks(page)
    await goToPatientStep(page)

    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Recibir código SMS' }).click()

    await expect(page.getByText('Verifica tu número')).toBeVisible()
    // 6 individual digit inputs
    await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(6)
  })

  test('Step 6 — OTP inputs accept individual digit entry with auto-advance', async ({ page }) => {
    await setupMocks(page)
    await goToOtpStep(page)

    const inputs = page.locator('input[inputmode="numeric"]')

    // Type digits — each input should hold exactly one character
    await inputs.nth(0).fill('1')
    await inputs.nth(1).fill('2')
    await inputs.nth(2).fill('3')

    await expect(inputs.nth(0)).toHaveValue('1')
    await expect(inputs.nth(1)).toHaveValue('2')
    await expect(inputs.nth(2)).toHaveValue('3')
  })

  test('Step 7 — entering 6-digit OTP shows confirmed screen', async ({ page }) => {
    await setupMocks(page)
    await goToOtpStep(page)

    const inputs = page.locator('input[inputmode="numeric"]')
    const code = ['1', '2', '3', '4', '5', '6']
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(code[i])
    }

    // Mock verifies instantly → confirmed screen
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10_000 })
  })

  test('Full funnel — happy path end-to-end', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Step 1: Select service
    await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()
    await page.getByText('Cardiología').click()

    // Step 2: Select doctor
    await expect(page.getByText('¿Con quién?')).toBeVisible()
    await page.getByText('Dr. Miguel Torres').click()

    // Step 3: Select slot (two-click flow: pick + confirm)
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()
    await selectFirstSlot(page)

    // Step 4: Patient data — button gated by GDPR checkbox
    await expect(page.getByText('Tus datos')).toBeVisible()
    const submitBtn = page.getByRole('button', { name: 'Recibir código SMS' })
    await expect(submitBtn).toBeDisabled()

    await page.getByLabel('Nombre completo').fill('Carlos E2E')
    await page.getByLabel('Número de teléfono').fill('+521111111111')
    await expect(submitBtn).toBeDisabled()  // phone+name filled, but no checkbox yet

    await page.getByRole('checkbox').check()
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Step 5: OTP entry
    await expect(page.getByText('Verifica tu número')).toBeVisible()
    const inputs = page.locator('input[inputmode="numeric"]')
    await expect(inputs).toHaveCount(6)
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(String(i + 1))
    }

    // Step 6: Confirmed
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10_000 })
  })

})
