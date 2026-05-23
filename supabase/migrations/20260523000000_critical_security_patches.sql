-- ============================================================================
-- Critical Security Patches — RPC validation hardening
-- File   : 20260523000000_critical_security_patches.sql
-- Audit  : Ultra-Review 2026-05-23
-- ============================================================================
--
-- Patches applied
-- ---------------
--   S-1 (P0007) — book_slot_confirmed did NOT verify the doctor-service
--                 relationship. An attacker calling /api/book directly could
--                 book Dr. X for a service Dr. X does not offer. Added an
--                 EXISTS check on doctor_services before the INSERT.
--
--   S-2 (P0008) — book_slot_confirmed did NOT verify that starts_at falls
--                 within the doctor's actual working hours. An attacker
--                 could craft a booking at 03:00 AM or on a day-off date.
--                 Added schedule + exception validation:
--                   1. Rejects if a full-day-off exception exists.
--                   2. Rejects if slot overlaps any partial block.
--                   3. Requires slot to fit inside a working window
--                      (custom exception window or weekly schedule).
--
--   S-3 (P0009/P0010) — reschedule_appointment did NOT enforce that the
--                       new_doctor_id belonged to the original appointment's
--                       clinic, nor that the new doctor offered the
--                       original service. Two new checks added:
--                         P0009 CROSS_TENANT_VIOLATION
--                         P0010 INVALID_SERVICE_FOR_NEW_DOCTOR
--
--   S-4 — All SECURITY DEFINER functions touched by this audit now declare
--         `SET search_path = pg_catalog, public` to mitigate
--         search_path hijacking (CVE-class).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) get_available_slots — search_path hardened (S-4)
--    Logic preserved verbatim from 20260520300000_filter_past_slots.sql.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  UUID,
  p_service_id UUID,
  p_date       DATE
)
RETURNS TABLE (slot_start TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_duration       INTEGER;
  v_timezone       TEXT;
  v_interval       INTERVAL;
  v_dow            SMALLINT;
  v_full_day_off   BOOLEAN;
  v_has_custom     BOOLEAN;
  r_window         RECORD;
  v_win_start      TIMESTAMPTZ;
  v_win_end        TIMESTAMPTZ;
  v_cursor         TIMESTAMPTZ;
  v_slot_end       TIMESTAMPTZ;
BEGIN
  SELECT svc.duration_minutes INTO v_duration
  FROM   public.services svc
  WHERE  svc.id = p_service_id AND svc.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  SELECT c.timezone INTO v_timezone
  FROM   public.clinics c
  JOIN   public.doctors d ON d.clinic_id = c.id
  WHERE  d.id = p_doctor_id AND d.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor % not found or inactive', p_doctor_id
      USING ERRCODE = 'P0004';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;

  SELECT EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NULL
  ) INTO v_full_day_off;
  IF v_full_day_off THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = TRUE
  ) INTO v_has_custom;

  FOR r_window IN
    SELECT ex.start_time, ex.end_time
    FROM   public.doctor_schedule_exceptions ex
    WHERE  v_has_custom
      AND  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = TRUE
    UNION ALL
    SELECT sch.start_time, sch.end_time
    FROM   public.schedules sch
    WHERE  NOT v_has_custom
      AND  sch.doctor_id   = p_doctor_id
      AND  sch.day_of_week = v_dow
      AND  sch.is_active   = TRUE
    ORDER  BY 1
  LOOP
    v_win_start := timezone(v_timezone, (p_date + r_window.start_time)::TIMESTAMP);
    v_win_end   := timezone(v_timezone, (p_date + r_window.end_time  )::TIMESTAMP);
    v_cursor    := v_win_start;

    WHILE v_cursor + v_interval <= v_win_end LOOP
      v_slot_end := v_cursor + v_interval;

      IF v_cursor < NOW() THEN
        v_cursor := v_slot_end;
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.appointments appt
        WHERE  appt.doctor_id = p_doctor_id
          AND  appt.status   <> 'cancelled'
          AND  tstzrange(appt.starts_at, appt.ends_at, '[)') &&
               tstzrange(v_cursor, v_slot_end, '[)')
      ) THEN
        v_cursor := v_slot_end;
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.doctor_schedule_exceptions ex
        WHERE  ex.doctor_id      = p_doctor_id
          AND  ex.exception_date = p_date
          AND  ex.is_working     = FALSE
          AND  ex.start_time     IS NOT NULL
          AND  tstzrange(
                 timezone(v_timezone, (p_date + ex.start_time)::TIMESTAMP),
                 timezone(v_timezone, (p_date + ex.end_time  )::TIMESTAMP),
                 '[)'
               ) && tstzrange(v_cursor, v_slot_end, '[)')
      ) THEN
        v_cursor := v_slot_end;
        CONTINUE;
      END IF;

      slot_start := v_cursor;
      RETURN NEXT;
      v_cursor := v_slot_end;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_slots TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2) get_slots_for_service — search_path hardened (S-4)
--    Logic preserved verbatim from 20260520300000_filter_past_slots.sql.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_slots_for_service(
  p_service_id UUID,
  p_date       DATE
)
RETURNS TABLE (
  slot_start       TIMESTAMPTZ,
  doctor_id        UUID,
  doctor_name      TEXT,
  doctor_specialty TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_duration       INTEGER;
  v_interval       INTERVAL;
  v_dow            SMALLINT;
  r_doc            RECORD;
  r_window         RECORD;
  v_full_day_off   BOOLEAN;
  v_has_custom     BOOLEAN;
  v_win_start      TIMESTAMPTZ;
  v_win_end        TIMESTAMPTZ;
  v_cursor         TIMESTAMPTZ;
  v_slot_end       TIMESTAMPTZ;
BEGIN
  SELECT svc.duration_minutes INTO v_duration
  FROM   public.services svc
  WHERE  svc.id = p_service_id AND svc.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;

  FOR r_doc IN
    SELECT
      d.id        AS doc_id,
      d.name      AS doc_name,
      d.specialty AS doc_specialty,
      c.timezone  AS doc_tz
    FROM   public.doctors         d
    JOIN   public.clinics         c  ON c.id        = d.clinic_id
    JOIN   public.doctor_services ds ON ds.doctor_id = d.id
    WHERE  ds.service_id = p_service_id
      AND  d.is_active   = TRUE
    ORDER  BY d.name
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.doctor_schedule_exceptions ex
      WHERE  ex.doctor_id      = r_doc.doc_id
        AND  ex.exception_date = p_date
        AND  ex.is_working     = FALSE
        AND  ex.start_time     IS NULL
    ) INTO v_full_day_off;
    IF v_full_day_off THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.doctor_schedule_exceptions ex
      WHERE  ex.doctor_id      = r_doc.doc_id
        AND  ex.exception_date = p_date
        AND  ex.is_working     = TRUE
    ) INTO v_has_custom;

    FOR r_window IN
      SELECT ex.start_time, ex.end_time
      FROM   public.doctor_schedule_exceptions ex
      WHERE  v_has_custom
        AND  ex.doctor_id      = r_doc.doc_id
        AND  ex.exception_date = p_date
        AND  ex.is_working     = TRUE
      UNION ALL
      SELECT sch.start_time, sch.end_time
      FROM   public.schedules sch
      WHERE  NOT v_has_custom
        AND  sch.doctor_id   = r_doc.doc_id
        AND  sch.day_of_week = v_dow
        AND  sch.is_active   = TRUE
      ORDER  BY 1
    LOOP
      v_win_start := timezone(r_doc.doc_tz, (p_date + r_window.start_time)::TIMESTAMP);
      v_win_end   := timezone(r_doc.doc_tz, (p_date + r_window.end_time  )::TIMESTAMP);
      v_cursor    := v_win_start;

      WHILE v_cursor + v_interval <= v_win_end LOOP
        v_slot_end := v_cursor + v_interval;

        IF v_cursor < NOW() THEN
          v_cursor := v_slot_end;
          CONTINUE;
        END IF;

        IF EXISTS (
          SELECT 1 FROM public.appointments appt
          WHERE  appt.doctor_id = r_doc.doc_id
            AND  appt.status   <> 'cancelled'
            AND  tstzrange(appt.starts_at, appt.ends_at, '[)') &&
                 tstzrange(v_cursor, v_slot_end, '[)')
        ) THEN
          v_cursor := v_slot_end;
          CONTINUE;
        END IF;

        IF EXISTS (
          SELECT 1 FROM public.doctor_schedule_exceptions ex
          WHERE  ex.doctor_id      = r_doc.doc_id
            AND  ex.exception_date = p_date
            AND  ex.is_working     = FALSE
            AND  ex.start_time     IS NOT NULL
            AND  tstzrange(
                   timezone(r_doc.doc_tz, (p_date + ex.start_time)::TIMESTAMP),
                   timezone(r_doc.doc_tz, (p_date + ex.end_time  )::TIMESTAMP),
                   '[)'
                 ) && tstzrange(v_cursor, v_slot_end, '[)')
        ) THEN
          v_cursor := v_slot_end;
          CONTINUE;
        END IF;

        slot_start       := v_cursor;
        doctor_id        := r_doc.doc_id;
        doctor_name      := r_doc.doc_name;
        doctor_specialty := r_doc.doc_specialty;
        RETURN NEXT;
        v_cursor := v_slot_end;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slots_for_service TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3) book_slot_confirmed — S-1, S-2, S-4 patches
-- ────────────────────────────────────────────────────────────────────────────
-- Layered validation pipeline executed in this exact order:
--   1) doctor ∈ clinic            (P0006, pre-existing from S-04)
--   2) doctor offers service      (P0007, NEW — S-1)
--   3) service active             (P0003, pre-existing)
--   4) starts_at > NOW()          (P0008 sub-case)
--   5) no full-day-off exception  (P0008 sub-case — S-2)
--   6) no partial-block overlap   (P0008 sub-case — S-2)
--   7) slot fits in a window      (P0008 final case — S-2)
--   8) INSERT (EXCLUDE constraint → P0001 SLOT_TAKEN on race)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_slot_confirmed(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,
  p_starts_at      TIMESTAMPTZ
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
  --    Uses tstzrange '[)' to mirror exactly the slot generator's semantics.
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
  --    Custom exception windows take precedence over the weekly schedule
  --    (legacy "custom window replaces weekly schedule" semantic).
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

  -- 8) Release expired-pending appointments (legacy compat — no-op since
  --    20260516_remove_pending_status forbids inserting 'pending', but kept
  --    for byte-for-byte parity with the prior RPC contract).
  UPDATE public.appointments
  SET    status = 'cancelled'
  WHERE  doctor_id       = p_doctor_id
    AND  status          = 'pending'
    AND  otp_expires_at <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') &&
         tstzrange(p_starts_at, v_ends_at,  '[)');

  -- 9) INSERT — EXCLUDE constraint is the final concurrency guard
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
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001',
            DETAIL  = 'The requested slot is no longer available';
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_slot_confirmed TO anon;


-- ────────────────────────────────────────────────────────────────────────────
-- 4) reschedule_appointment — S-3, S-4 patches
-- ────────────────────────────────────────────────────────────────────────────
-- Order of validation after the row lock succeeds:
--   1) p_new_starts_at > NOW()           (P0004, pre-existing)
--   2) new doctor ∈ original clinic      (P0009 CROSS_TENANT_VIOLATION — S-3)
--   3) new doctor offers original svc    (P0010 INVALID_SERVICE_FOR_NEW_DOCTOR — S-3)
--   4) service still active              (P0003, pre-existing)
--   5) UPDATE (EXCLUDE → P0001 SLOT_TAKEN on race)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reschedule_appointment(
  p_cancellation_token UUID,
  p_new_doctor_id      UUID,
  p_new_starts_at      TIMESTAMPTZ
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_appt        public.appointments;
  v_duration    INTEGER;
  v_new_ends_at TIMESTAMPTZ;
BEGIN
  -- Lock the row so concurrent reschedule calls on the same token serialise
  SELECT * INTO v_appt
  FROM   public.appointments
  WHERE  cancellation_token = p_cancellation_token
    AND  status             = 'confirmed'
    AND  starts_at          > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found, already cancelled, or in the past'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_new_starts_at <= NOW() THEN
    RAISE EXCEPTION 'New slot must be in the future'
      USING ERRCODE = 'P0004';
  END IF;

  -- S-3.a: new doctor must belong to the original appointment's clinic
  IF NOT EXISTS (
    SELECT 1 FROM public.doctors d
    WHERE  d.id        = p_new_doctor_id
      AND  d.clinic_id = v_appt.clinic_id
      AND  d.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_VIOLATION'
      USING ERRCODE = 'P0009',
            DETAIL  = 'New doctor does not belong to the original clinic';
  END IF;

  -- S-3.b: new doctor must offer the original service
  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_services ds
    WHERE  ds.doctor_id  = p_new_doctor_id
      AND  ds.service_id = v_appt.service_id
  ) THEN
    RAISE EXCEPTION 'INVALID_SERVICE_FOR_NEW_DOCTOR'
      USING ERRCODE = 'P0010',
            DETAIL  = 'New doctor does not offer the original service';
  END IF;

  -- Derive end time from the original service duration (service cannot change)
  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = v_appt.service_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found or inactive'
      USING ERRCODE = 'P0003';
  END IF;

  v_new_ends_at := p_new_starts_at + (v_duration * INTERVAL '1 minute');

  -- Atomic reschedule. The EXCLUDE constraint fires if the new slot
  -- conflicts with any OTHER confirmed appointment for the target doctor.
  -- Releasing the old time range happens atomically in the same UPDATE.
  UPDATE public.appointments
  SET    doctor_id = p_new_doctor_id,
         starts_at = p_new_starts_at,
         ends_at   = v_new_ends_at
  WHERE  id = v_appt.id
  RETURNING * INTO v_appt;

  RETURN v_appt;

EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001',
            DETAIL  = 'The new slot is already taken by another confirmed appointment';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment TO service_role;
