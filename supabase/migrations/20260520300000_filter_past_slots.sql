-- ================================================================
-- Filter past slots — get_available_slots & get_slots_for_service
-- File   : 20260520300000_filter_past_slots.sql
-- ================================================================
-- When p_date equals today, slots whose start time has already passed
-- are excluded.  v_cursor is TIMESTAMPTZ, NOW() is TIMESTAMPTZ, so the
-- comparison is DST-safe across all clinic timezones.
-- Future dates are unaffected: all their slots satisfy v_cursor >= NOW().
-- ================================================================


-- ================================================================
-- RPC: get_available_slots — exception-aware (partial blocks) + past filter
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

      -- Skip slots that have already started
      IF v_cursor < NOW() THEN
        v_cursor := v_slot_end;
        CONTINUE;
      END IF;

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
-- RPC: get_slots_for_service — exception-aware (partial blocks) + past filter
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

        -- Skip slots that have already started
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
