-- ================================================================
-- Partial time blocks for doctor_schedule_exceptions
-- File   : 20260520200000_partial_time_blocks.sql
-- ================================================================
-- Allows admins to block specific time ranges within a day instead
-- of only the full day. Multiple rows per (doctor_id, exception_date)
-- are now permitted to support several blocks per day (morning + afternoon).
--
-- Row semantics:
--   is_working=FALSE, hours NULL          → FULL DAY OFF
--   is_working=FALSE, hours NOT NULL      → PARTIAL BLOCK
--   is_working=TRUE,  hours NOT NULL      → CUSTOM WINDOW (legacy)
--
-- RPC behaviour:
--   1. If any FULL DAY OFF row exists → return 0 slots / skip doctor
--   2. Collect PARTIAL BLOCKS as ranges to subtract
--   3. If any CUSTOM WINDOW row exists, generate slots ONLY inside
--      those windows; otherwise use the weekly `schedules` for this DOW
--   4. Skip slots whose [start, end) overlaps with ANY partial block
-- ================================================================

-- ── Drop the now-too-strict constraints ──────────────────────────
ALTER TABLE public.doctor_schedule_exceptions
  DROP CONSTRAINT IF EXISTS doctor_schedule_exceptions_doctor_date_uq;

ALTER TABLE public.doctor_schedule_exceptions
  DROP CONSTRAINT IF EXISTS doctor_schedule_exceptions_working_window_chk;


-- ── Re-add a window check that supports the 3 row shapes ─────────
ALTER TABLE public.doctor_schedule_exceptions
  ADD CONSTRAINT doctor_schedule_exceptions_window_chk CHECK (
    -- Full day off
    (is_working = FALSE AND start_time IS NULL     AND end_time IS NULL)
    OR
    -- Partial block (range of unavailability)
    (is_working = FALSE AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
    OR
    -- Custom working window (legacy: replaces the weekly schedule)
    (is_working = TRUE  AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  );


-- ── Prevent literal duplicate rows (same doctor, date, range) ────
-- Coalesce NULLs so multiple full-day-off rows still collide and
-- a partial block can co-exist with a full day off only via app-level
-- validation.
DROP INDEX IF EXISTS doctor_schedule_exceptions_unique_row_idx;
CREATE UNIQUE INDEX doctor_schedule_exceptions_unique_row_idx
  ON public.doctor_schedule_exceptions (
    doctor_id,
    exception_date,
    is_working,
    COALESCE(start_time, TIME '00:00:00'),
    COALESCE(end_time,   TIME '00:00:00')
  );


-- ================================================================
-- RPC: get_available_slots — exception-aware (partial blocks)
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  UUID,
  p_service_id UUID,
  p_date       DATE
)
RETURNS TABLE (slot_start TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
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
  -- Service duration
  SELECT svc.duration_minutes INTO v_duration
  FROM   public.services svc
  WHERE  svc.id = p_service_id AND svc.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  -- Clinic timezone via the doctor
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

  -- ── 1. Full day off? ────────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NULL
  ) INTO v_full_day_off;
  IF v_full_day_off THEN RETURN; END IF;

  -- ── 2. Determine the working windows for the day ────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = TRUE
  ) INTO v_has_custom;

  -- Cursor over each working window (custom or weekly schedule)
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

      -- Skip slot if it collides with an existing appointment
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

      -- Skip slot if it overlaps a PARTIAL BLOCK
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


-- ================================================================
-- RPC: get_slots_for_service — exception-aware (partial blocks)
-- ================================================================
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
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
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
    -- 1. Full day off?
    SELECT EXISTS (
      SELECT 1 FROM public.doctor_schedule_exceptions ex
      WHERE  ex.doctor_id      = r_doc.doc_id
        AND  ex.exception_date = p_date
        AND  ex.is_working     = FALSE
        AND  ex.start_time     IS NULL
    ) INTO v_full_day_off;
    IF v_full_day_off THEN CONTINUE; END IF;

    -- 2. Custom windows present?
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
