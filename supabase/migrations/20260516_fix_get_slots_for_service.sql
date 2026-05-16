-- =============================================================
-- Fix: Ambiguous column reference in get_slots_for_service
-- =============================================================
-- Root cause: RETURNS TABLE declares an OUT column named "doctor_id".
-- Inside the function, PL/pgSQL creates a variable also called
-- "doctor_id". The inner FOR loop did `SELECT * FROM schedules
-- WHERE doctor_id = r_doc.id` — Postgres could not tell whether
-- "doctor_id" referred to the OUT variable or schedules.doctor_id
-- → ERROR 42702 column reference "doctor_id" is ambiguous.
--
-- Fix: alias all table columns explicitly so no bare identifier
-- can collide with OUT-parameter variable names.
-- Also: simplified the NOT EXISTS check to remove the dead
-- "status = 'pending'" branch (pending is blocked by CHECK
-- constraint since migration 20260516_remove_pending_status).
-- =============================================================

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

  -- Alias selected columns to names that cannot shadow the OUT params
  -- (doc_id, doc_name, doc_specialty, doc_tz instead of id, name, etc.)
  FOR r_doc IN
    SELECT
      d.id        AS doc_id,
      d.name      AS doc_name,
      d.specialty AS doc_specialty,
      c.timezone  AS doc_tz
    FROM   public.doctors         d
    JOIN   public.clinics         c  ON c.id         = d.clinic_id
    JOIN   public.doctor_services ds ON ds.doctor_id  = d.id
    WHERE  ds.service_id = p_service_id
      AND  d.is_active   = TRUE
    ORDER  BY d.name
  LOOP
    -- Table alias sch: qualify every column to avoid the "doctor_id" shadow
    FOR r_sched IN
      SELECT sch.start_time, sch.end_time
      FROM   public.schedules sch
      WHERE  sch.doctor_id   = r_doc.doc_id
        AND  sch.day_of_week = v_dow
        AND  sch.is_active   = TRUE
      ORDER  BY sch.start_time
    LOOP
      v_win_start := timezone(r_doc.doc_tz, (p_date + r_sched.start_time)::TIMESTAMP);
      v_win_end   := timezone(r_doc.doc_tz, (p_date + r_sched.end_time)::TIMESTAMP);
      v_cursor    := v_win_start;

      WHILE v_cursor + v_interval <= v_win_end LOOP
        v_slot_end := v_cursor + v_interval;

        -- Alias appt: avoids any future column-name collisions
        IF NOT EXISTS (
          SELECT 1
          FROM   public.appointments appt
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
