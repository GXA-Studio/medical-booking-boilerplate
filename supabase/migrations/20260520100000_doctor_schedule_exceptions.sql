-- ================================================================
-- Doctor Schedule Exceptions
-- File   : 20260520100000_doctor_schedule_exceptions.sql
-- ================================================================
-- Allows admins to override the recurring weekly schedule on a
-- per-date basis (vacations, holidays, modified hours).
--
-- Lookup precedence inside the slot RPCs:
--   1. doctor_schedule_exceptions(doctor_id, exception_date)
--        → if row found:
--            • is_working = false → 0 slots for that day
--            • is_working = true  → use start_time/end_time as the
--              ONLY window for the day (replaces weekly schedule)
--   2. otherwise → fall back to schedules(doctor_id, day_of_week)
-- ================================================================

-- ── Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doctor_schedule_exceptions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id       UUID        NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  exception_date  DATE        NOT NULL,
  is_working      BOOLEAN     NOT NULL DEFAULT FALSE,
  start_time      TIME,
  end_time        TIME,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doctor_schedule_exceptions_doctor_date_uq
    UNIQUE (doctor_id, exception_date),
  CONSTRAINT doctor_schedule_exceptions_working_window_chk
    CHECK (
      (is_working = FALSE)
      OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
    )
);

CREATE INDEX IF NOT EXISTS doctor_schedule_exceptions_doctor_date_idx
  ON public.doctor_schedule_exceptions (doctor_id, exception_date);


-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.doctor_schedule_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_doctor_schedule_exceptions"
  ON public.doctor_schedule_exceptions;
CREATE POLICY "public_read_doctor_schedule_exceptions"
  ON public.doctor_schedule_exceptions FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "admins_manage_doctor_schedule_exceptions"
  ON public.doctor_schedule_exceptions;
CREATE POLICY "admins_manage_doctor_schedule_exceptions"
  ON public.doctor_schedule_exceptions FOR ALL USING (
    doctor_id IN (
      SELECT d.id FROM public.doctors d
      JOIN   public.profiles p ON p.clinic_id = d.clinic_id
      WHERE  p.id = auth.uid()
    )
  );


-- ================================================================
-- RPC: get_available_slots (doctor-specific) — exception-aware
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  UUID,
  p_service_id UUID,
  p_date       DATE
)
RETURNS TABLE (slot_start TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_duration   INTEGER;
  v_timezone   TEXT;
  v_interval   INTERVAL;
  v_dow        SMALLINT;
  v_exception  RECORD;
  r_sched      RECORD;
  v_win_start  TIMESTAMPTZ;
  v_win_end    TIMESTAMPTZ;
  v_cursor     TIMESTAMPTZ;
  v_slot_end   TIMESTAMPTZ;
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

  -- ── Exception lookup ───────────────────────────────────────────
  SELECT ex.is_working, ex.start_time, ex.end_time
    INTO v_exception
  FROM   public.doctor_schedule_exceptions ex
  WHERE  ex.doctor_id      = p_doctor_id
    AND  ex.exception_date = p_date
  LIMIT  1;

  IF FOUND THEN
    -- Day is overridden by an exception
    IF NOT v_exception.is_working THEN
      RETURN;  -- 0 slots — day off
    END IF;

    -- Working with a custom window
    v_win_start := timezone(v_timezone, (p_date + v_exception.start_time)::TIMESTAMP);
    v_win_end   := timezone(v_timezone, (p_date + v_exception.end_time  )::TIMESTAMP);
    v_cursor    := v_win_start;

    WHILE v_cursor + v_interval <= v_win_end LOOP
      v_slot_end := v_cursor + v_interval;
      IF NOT EXISTS (
        SELECT 1 FROM public.appointments appt
        WHERE  appt.doctor_id = p_doctor_id
          AND  appt.status   <> 'cancelled'
          AND  tstzrange(appt.starts_at, appt.ends_at, '[)') &&
               tstzrange(v_cursor, v_slot_end, '[)')
      ) THEN
        slot_start := v_cursor;
        RETURN NEXT;
      END IF;
      v_cursor := v_slot_end;
    END LOOP;
    RETURN;
  END IF;

  -- ── Default path: weekly schedule ──────────────────────────────
  FOR r_sched IN
    SELECT sch.start_time, sch.end_time
    FROM   public.schedules sch
    WHERE  sch.doctor_id   = p_doctor_id
      AND  sch.day_of_week = v_dow
      AND  sch.is_active   = TRUE
    ORDER  BY sch.start_time
  LOOP
    v_win_start := timezone(v_timezone, (p_date + r_sched.start_time)::TIMESTAMP);
    v_win_end   := timezone(v_timezone, (p_date + r_sched.end_time  )::TIMESTAMP);
    v_cursor    := v_win_start;

    WHILE v_cursor + v_interval <= v_win_end LOOP
      v_slot_end := v_cursor + v_interval;
      IF NOT EXISTS (
        SELECT 1 FROM public.appointments appt
        WHERE  appt.doctor_id = p_doctor_id
          AND  appt.status   <> 'cancelled'
          AND  tstzrange(appt.starts_at, appt.ends_at, '[)') &&
               tstzrange(v_cursor, v_slot_end, '[)')
      ) THEN
        slot_start := v_cursor;
        RETURN NEXT;
      END IF;
      v_cursor := v_slot_end;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_slots TO anon, authenticated;


-- ================================================================
-- RPC: get_slots_for_service (any-doctor) — exception-aware
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
  v_duration   INTEGER;
  v_interval   INTERVAL;
  v_dow        SMALLINT;
  r_doc        RECORD;
  r_sched      RECORD;
  v_exception  RECORD;
  v_win_start  TIMESTAMPTZ;
  v_win_end    TIMESTAMPTZ;
  v_cursor     TIMESTAMPTZ;
  v_slot_end   TIMESTAMPTZ;
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
    -- ── Exception lookup (per doctor, per date) ─────────────────
    SELECT ex.is_working, ex.start_time, ex.end_time
      INTO v_exception
    FROM   public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = r_doc.doc_id
      AND  ex.exception_date = p_date
    LIMIT  1;

    IF FOUND THEN
      IF NOT v_exception.is_working THEN
        CONTINUE;  -- this doctor has the day off; skip
      END IF;

      v_win_start := timezone(r_doc.doc_tz, (p_date + v_exception.start_time)::TIMESTAMP);
      v_win_end   := timezone(r_doc.doc_tz, (p_date + v_exception.end_time  )::TIMESTAMP);
      v_cursor    := v_win_start;

      WHILE v_cursor + v_interval <= v_win_end LOOP
        v_slot_end := v_cursor + v_interval;
        IF NOT EXISTS (
          SELECT 1 FROM public.appointments appt
          WHERE  appt.doctor_id = r_doc.doc_id
            AND  appt.status   <> 'cancelled'
            AND  tstzrange(appt.starts_at, appt.ends_at, '[)') &&
                 tstzrange(v_cursor, v_slot_end, '[)')
        ) THEN
          slot_start       := v_cursor;
          doctor_id        := r_doc.doc_id;
          doctor_name      := r_doc.doc_name;
          doctor_specialty := r_doc.doc_specialty;
          RETURN NEXT;
        END IF;
        v_cursor := v_slot_end;
      END LOOP;
      CONTINUE;  -- exception consumed; skip weekly schedule for this doctor
    END IF;

    -- ── Default path: weekly schedule for this doctor ────────────
    FOR r_sched IN
      SELECT sch.start_time, sch.end_time
      FROM   public.schedules sch
      WHERE  sch.doctor_id   = r_doc.doc_id
        AND  sch.day_of_week = v_dow
        AND  sch.is_active   = TRUE
      ORDER  BY sch.start_time
    LOOP
      v_win_start := timezone(r_doc.doc_tz, (p_date + r_sched.start_time)::TIMESTAMP);
      v_win_end   := timezone(r_doc.doc_tz, (p_date + r_sched.end_time  )::TIMESTAMP);
      v_cursor    := v_win_start;

      WHILE v_cursor + v_interval <= v_win_end LOOP
        v_slot_end := v_cursor + v_interval;
        IF NOT EXISTS (
          SELECT 1 FROM public.appointments appt
          WHERE  appt.doctor_id = r_doc.doc_id
            AND  appt.status   <> 'cancelled'
            AND  tstzrange(appt.starts_at, appt.ends_at, '[)') &&
                 tstzrange(v_cursor, v_slot_end, '[)')
        ) THEN
          slot_start       := v_cursor;
          doctor_id        := r_doc.doc_id;
          doctor_name      := r_doc.doc_name;
          doctor_specialty := r_doc.doc_specialty;
          RETURN NEXT;
        END IF;
        v_cursor := v_slot_end;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slots_for_service TO anon, authenticated;
