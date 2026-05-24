-- ============================================================================
-- L-A9 — GDPR consent logging
-- File   : 20260524000000_consent_logging.sql
-- Audit  : Ultra-Review 2026-05-24
-- ============================================================================
--
-- Adds an auditable record of the moment the patient (or the receptionist on
-- the patient's behalf) granted consent to the data treatment described in
-- the privacy notice. Without this column the booking flow could not prove
-- when consent was obtained, breaching art. 7.1 RGPD ("the controller shall
-- be able to demonstrate that the data subject has consented").
--
-- Backfill: existing rows receive NOW() because consent was a precondition
-- of every prior booking (the patient checked the box on the public form
-- and the receptionist obtained verbal consent in the admin flow). We use
-- NOT NULL to forbid future inserts that bypass the RPC.
-- ============================================================================

-- ─── 1. Add the column ───────────────────────────────────────────────────
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.appointments.consent_at IS
  'Timestamp at which the patient granted GDPR consent (art. 7.1 RGPD).';

-- ─── 2. Re-create book_slot_confirmed with a mandatory p_consent_at ──────
-- Changing the signature requires dropping the prior definition first.
DROP FUNCTION IF EXISTS public.book_slot_confirmed(
  UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.book_slot_confirmed(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,
  p_starts_at      TIMESTAMPTZ,
  p_consent_at     TIMESTAMPTZ
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_duration       INTEGER;
  v_timezone       TEXT;
  v_interval       INTERVAL;
  v_ends_at        TIMESTAMPTZ;
  v_appointment    public.appointments;
  v_local_ts       TIMESTAMP;
  v_local_date     DATE;
  v_dow            SMALLINT;
  v_has_custom     BOOLEAN;
  v_in_window      BOOLEAN;
BEGIN
  -- 0) L-A9: GDPR consent is mandatory. A NULL or future timestamp would
  --    leave the controller unable to demonstrate when consent was granted.
  IF p_consent_at IS NULL OR p_consent_at > NOW() THEN
    RAISE EXCEPTION 'GDPR_CONSENT_REQUIRED'
      USING ERRCODE = 'P0011',
            DETAIL  = 'Booking requires a valid GDPR consent timestamp';
  END IF;

  -- 1) Pre-existing: doctor must belong to the specified clinic
  IF NOT EXISTS (
    SELECT 1 FROM public.doctors
    WHERE id = p_doctor_id AND clinic_id = p_clinic_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Doctor % does not belong to clinic %', p_doctor_id, p_clinic_id
      USING ERRCODE = 'P0006';
  END IF;

  -- 2) S-1: doctor must offer this service
  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_services
    WHERE doctor_id = p_doctor_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'DOCTOR_DOES_NOT_OFFER_SERVICE'
      USING ERRCODE = 'P0007',
            DETAIL  = 'The selected doctor does not offer this service';
  END IF;

  -- 3) Service must be active (also yields its duration)
  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = p_service_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_ends_at  := p_starts_at + v_interval;

  -- 4) S-2 sub-case: cannot book a past slot
  IF p_starts_at <= NOW() THEN
    RAISE EXCEPTION 'INVALID_OR_UNAVAILABLE_SLOT'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Cannot book a slot in the past';
  END IF;

  -- Resolve clinic timezone for schedule/exception validation
  SELECT c.timezone INTO v_timezone
  FROM   public.clinics c
  JOIN   public.doctors d ON d.clinic_id = c.id
  WHERE  d.id = p_doctor_id;

  v_local_ts   := (p_starts_at AT TIME ZONE v_timezone);
  v_local_date := v_local_ts::DATE;
  v_dow        := EXTRACT(DOW FROM v_local_date)::SMALLINT;

  -- 5) S-2 sub-case: full-day-off exception → reject
  IF EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = v_local_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_UNAVAILABLE_SLOT'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Doctor is not working on this date (full day off)';
  END IF;

  -- 6) S-2 sub-case: partial block overlap → reject
  IF EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = v_local_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NOT NULL
      AND  tstzrange(
             timezone(v_timezone, (v_local_date + ex.start_time)::TIMESTAMP),
             timezone(v_timezone, (v_local_date + ex.end_time  )::TIMESTAMP),
             '[)'
           ) && tstzrange(p_starts_at, v_ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_UNAVAILABLE_SLOT'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Slot falls within a partial time block';
  END IF;

  -- 7) S-2 main case: slot must fit in a working window
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = v_local_date
      AND  ex.is_working     = TRUE
  ) INTO v_has_custom;

  IF v_has_custom THEN
    SELECT EXISTS (
      SELECT 1 FROM public.doctor_schedule_exceptions ex
      WHERE  ex.doctor_id      = p_doctor_id
        AND  ex.exception_date = v_local_date
        AND  ex.is_working     = TRUE
        AND  timezone(v_timezone, (v_local_date + ex.start_time)::TIMESTAMP) <= p_starts_at
        AND  timezone(v_timezone, (v_local_date + ex.end_time  )::TIMESTAMP) >= v_ends_at
    ) INTO v_in_window;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.schedules sch
      WHERE  sch.doctor_id   = p_doctor_id
        AND  sch.day_of_week = v_dow
        AND  sch.is_active   = TRUE
        AND  timezone(v_timezone, (v_local_date + sch.start_time)::TIMESTAMP) <= p_starts_at
        AND  timezone(v_timezone, (v_local_date + sch.end_time  )::TIMESTAMP) >= v_ends_at
    ) INTO v_in_window;
  END IF;

  IF NOT v_in_window THEN
    RAISE EXCEPTION 'INVALID_OR_UNAVAILABLE_SLOT'
      USING ERRCODE = 'P0008',
            DETAIL  = 'Slot falls outside the doctor working hours';
  END IF;

  -- 8) INSERT — EXCLUDE constraint is the final concurrency guard
  INSERT INTO public.appointments (
    clinic_id,      doctor_id,      service_id,
    patient_name,   patient_phone,
    starts_at,      ends_at,
    status,         consent_at
  ) VALUES (
    p_clinic_id,    p_doctor_id,    p_service_id,
    p_patient_name, p_patient_phone,
    p_starts_at,    v_ends_at,
    'confirmed',    p_consent_at
  )
  RETURNING * INTO v_appointment;

  RETURN v_appointment;

EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001',
            DETAIL  = 'The requested slot is no longer available';
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_slot_confirmed(
  UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO anon, authenticated;
