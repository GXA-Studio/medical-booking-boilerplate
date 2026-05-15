-- =============================================================
-- Medical Booking Boilerplate — WhatsApp Instant Booking
-- Version: 003
-- =============================================================
-- * cancellation_token — unique link for 1-click cancellation
-- * reminder_sent      — flag for the 24h cron reminder
-- * book_slot_confirmed — instant booking RPC (no OTP challenge)
-- =============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS cancellation_token UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT false;

-- Unique index for fast cancellation token lookups (cancel page + inbound webhook)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_cancellation_token
  ON public.appointments (cancellation_token);

-- Index to accelerate the 24h reminder cron query
CREATE INDEX IF NOT EXISTS idx_appt_reminder
  ON public.appointments (starts_at, reminder_sent)
  WHERE status = 'confirmed' AND reminder_sent = false;

-- -------------------------------------------------------------
-- book_slot_confirmed
--
-- Friction-free variant of book_slot: inserts the appointment
-- directly as 'confirmed' (no OTP challenge). The EXCLUDE USING
-- gist constraint on appointments still prevents double-booking
-- under concurrent requests.
--
-- Caller contract: validate + rate-limit in the Route Handler,
-- then fire WhatsApp confirmation after this RPC returns.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_slot_confirmed(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,        -- E.164 format
  p_starts_at      TIMESTAMPTZ  -- UTC
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_duration    INTEGER;
  v_ends_at     TIMESTAMPTZ;
  v_appointment public.appointments;
BEGIN
  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = p_service_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  v_ends_at := p_starts_at + (v_duration * INTERVAL '1 minute');

  -- Release expired-pending appointments blocking this slot (atomic with INSERT)
  UPDATE public.appointments
  SET    status = 'cancelled'
  WHERE  doctor_id       = p_doctor_id
    AND  status          = 'pending'
    AND  otp_expires_at  <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') &&
         tstzrange(p_starts_at, v_ends_at,  '[)');

  -- Insert directly as confirmed — EXCLUDE constraint is the true safety net
  INSERT INTO public.appointments (
    clinic_id,      doctor_id,      service_id,
    patient_name,   patient_phone,
    starts_at,      ends_at,
    status
  ) VALUES (
    p_clinic_id,    p_doctor_id,    p_service_id,
    p_patient_name, p_patient_phone,
    p_starts_at,    v_ends_at,
    'confirmed'
  )
  RETURNING * INTO v_appointment;

  RETURN v_appointment;

EXCEPTION
  WHEN exclusion_violation THEN  -- SQLSTATE 23P01
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001',
            DETAIL  = 'The requested slot is no longer available';
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_slot_confirmed TO anon;
