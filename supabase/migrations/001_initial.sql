-- =============================================================
-- Medical Booking Boilerplate — Initial Schema
-- Version: 001
-- =============================================================

-- =============================================================
-- EXTENSIONS
-- =============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- btree_gist: enables EXCLUDE constraints mixing btree types (UUID, SMALLINT)
-- with range types (tstzrange) in the same GiST index.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- =============================================================
-- ENUMS
-- =============================================================
CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled');

-- =============================================================
-- TABLES
-- =============================================================

-- clinics — one row per tenant
CREATE TABLE public.clinics (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,         -- URL-safe identifier, e.g. "clinica-salud"
  phone       TEXT,
  address     TEXT,
  timezone    TEXT        NOT NULL DEFAULT 'UTC',  -- IANA tz, e.g. "America/Mexico_City"
  settings    JSONB       NOT NULL DEFAULT '{}',   -- Extensible config (logo_url, accent_color, …)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- profiles — admin/staff users linked to Supabase Auth
CREATE TABLE public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id   UUID        REFERENCES public.clinics(id) ON DELETE SET NULL,
  full_name   TEXT,
  role        TEXT        NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin', 'staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- services — what a clinic offers (determines slot duration)
CREATE TABLE public.services (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id        UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  duration_minutes INTEGER     NOT NULL
                               CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  price            NUMERIC(10, 2),
  description      TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- doctors — practitioners belonging to a clinic
CREATE TABLE public.doctors (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id   UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  email       TEXT,
  specialty   TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- doctor_services — many-to-many: which doctors offer which services
CREATE TABLE public.doctor_services (
  doctor_id   UUID NOT NULL REFERENCES public.doctors(id)  ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, service_id)
);

-- schedules — recurring weekly availability blocks
--
-- DESIGN: Multiple rows allowed per (doctor, day_of_week).
-- A doctor can have a morning shift (09:00–13:00) AND an afternoon shift (16:00–20:00)
-- on the same day. Overlapping blocks for the same doctor/day are prevented by
-- the fn_check_schedule_overlap trigger below.
--
-- Times are stored in the clinic's LOCAL timezone (resolved from clinics.timezone
-- at query time by get_available_slots). This correctly handles DST transitions
-- without storing UTC offsets that would silently drift.
CREATE TABLE public.schedules (
  id           UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id    UUID     NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday … 6=Saturday
  start_time   TIME     NOT NULL,
  end_time     TIME     NOT NULL CHECK (end_time > start_time),
  is_active    BOOLEAN  NOT NULL DEFAULT TRUE
  -- NOTE: no UNIQUE(doctor_id, day_of_week) — multiple blocks per day are supported.
  -- Overlap enforcement is handled by the trg_check_schedule_overlap trigger.
);

-- appointments — core booking table
CREATE TABLE public.appointments (
  id              UUID                       PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id       UUID                       NOT NULL REFERENCES public.clinics(id)   ON DELETE RESTRICT,
  doctor_id       UUID                       NOT NULL REFERENCES public.doctors(id)   ON DELETE RESTRICT,
  service_id      UUID                       NOT NULL REFERENCES public.services(id)  ON DELETE RESTRICT,
  patient_name    TEXT                       NOT NULL,
  patient_phone   TEXT                       NOT NULL,  -- E.164, e.g. "+521554001234"
  starts_at       TIMESTAMPTZ                NOT NULL,  -- Always UTC
  ends_at         TIMESTAMPTZ                NOT NULL,  -- Always UTC; = starts_at + service.duration_minutes
  status          public.appointment_status  NOT NULL DEFAULT 'pending',
  otp_code_hash   TEXT,                                 -- SHA-256 hex of the OTP (cleared after confirm)
  otp_expires_at  TIMESTAMPTZ,                          -- 5-minute TTL from creation
  notes           TEXT,
  created_at      TIMESTAMPTZ                NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ends_after_starts CHECK (ends_at > starts_at),

  -- ================================================================
  -- DOUBLE-BOOKING PREVENTION (race-condition proof)
  --
  -- PostgreSQL GiST EXCLUDE constraint. For any two non-cancelled
  -- appointments of the same doctor, their half-open time ranges
  -- [starts_at, ends_at) must NOT overlap (&&).
  --
  -- Concurrency guarantee: PostgreSQL serializes concurrent INSERTs
  -- via predicate locks on the GiST index. Two transactions attempting
  -- the same slot at the exact same millisecond: one succeeds, the
  -- other receives exclusion_violation (SQLSTATE 23P01) and is caught
  -- in the book_slot RPC as SLOT_TAKEN.
  --
  -- Half-open [) intervals: 09:00–09:30 and 09:30–10:00 do NOT
  -- conflict — back-to-back appointments work correctly.
  -- ================================================================
  EXCLUDE USING gist (
    doctor_id                              WITH =,
    tstzrange(starts_at, ends_at, '[)')    WITH &&
  ) WHERE (status <> 'cancelled')
);

-- =============================================================
-- INDEXES
-- =============================================================

-- Primary lookup: doctor's upcoming non-cancelled appointments
CREATE INDEX idx_appt_doctor_time
  ON public.appointments (doctor_id, starts_at)
  WHERE status <> 'cancelled';

-- Admin calendar: clinic view by status
CREATE INDEX idx_appt_clinic_status
  ON public.appointments (clinic_id, status, starts_at);

-- OTP expiry sweep (used in book_slot to cancel expired pending slots)
CREATE INDEX idx_appt_otp_expiry
  ON public.appointments (otp_expires_at)
  WHERE status = 'pending';

-- Patient history lookup
CREATE INDEX idx_appt_patient_phone
  ON public.appointments (patient_phone);

-- Schedule lookup (hot path in get_available_slots)
CREATE INDEX idx_schedules_doctor_dow
  ON public.schedules (doctor_id, day_of_week, start_time)
  WHERE is_active = TRUE;

-- Active services per clinic
CREATE INDEX idx_services_clinic
  ON public.services (clinic_id)
  WHERE is_active = TRUE;

-- Active doctors per clinic
CREATE INDEX idx_doctors_clinic
  ON public.doctors (clinic_id)
  WHERE is_active = TRUE;

-- =============================================================
-- TRIGGERS
-- =============================================================

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Schedule overlap prevention
-- Fires on INSERT and UPDATE; rejects active blocks that overlap another
-- active block for the same doctor on the same weekday.
-- Uses PostgreSQL's built-in OVERLAPS operator with half-open [start, end)
-- semantics: morning shift (09:00, 13:00) and afternoon (13:00, 17:00) do NOT conflict.
CREATE OR REPLACE FUNCTION public.fn_check_schedule_overlap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = FALSE THEN
    RETURN NEW;  -- Deactivating a block never creates conflicts
  END IF;

  IF EXISTS (
    SELECT 1
    FROM   public.schedules
    WHERE  doctor_id   = NEW.doctor_id
      AND  day_of_week = NEW.day_of_week
      AND  is_active   = TRUE
      AND  id         <> NEW.id   -- Exclude the current row on UPDATE
      AND  (start_time, end_time) OVERLAPS (NEW.start_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_OVERLAP'
      USING ERRCODE = 'P0005',
            DETAIL  = 'This schedule block overlaps with an existing active block for the same doctor and day';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_schedule_overlap
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_schedule_overlap();

-- =============================================================
-- RPC FUNCTIONS
-- =============================================================

-- -------------------------------------------------------------
-- get_available_slots
--
-- Returns UTC slot-start timestamps that are free for a given
-- doctor + service on a local calendar date.
--
-- Supports MULTIPLE schedule blocks per day (e.g., morning and
-- afternoon shifts). Iterates over all active blocks for the
-- requested day and generates slots for each.
--
-- A slot is occupied when ANY non-cancelled appointment overlaps
-- it AND is either confirmed OR a still-valid pending (OTP not yet
-- expired). Expired-pending appointments are skipped here (they
-- will be cancelled atomically inside book_slot).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  UUID,
  p_service_id UUID,
  p_date       DATE   -- Local calendar date in clinic's timezone (caller is aware of tz)
)
RETURNS TABLE (slot_start TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_duration  INTEGER;
  v_timezone  TEXT;
  v_interval  INTERVAL;
  v_dow       SMALLINT;
  v_schedule  public.schedules%ROWTYPE;
  v_win_start TIMESTAMPTZ;
  v_win_end   TIMESTAMPTZ;
  v_cursor    TIMESTAMPTZ;
  v_slot_end  TIMESTAMPTZ;
BEGIN
  -- Resolve service duration
  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = p_service_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  -- Resolve clinic timezone via doctor
  SELECT c.timezone INTO v_timezone
  FROM   public.clinics  c
  JOIN   public.doctors  d ON d.clinic_id = c.id
  WHERE  d.id = p_doctor_id AND d.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor % not found or inactive', p_doctor_id
      USING ERRCODE = 'P0004';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;  -- 0=Sunday … 6=Saturday

  -- -------------------------------------------------------
  -- Iterate over ALL active schedule blocks for this day.
  -- Supports split shifts: morning + afternoon, etc.
  -- -------------------------------------------------------
  FOR v_schedule IN
    SELECT *
    FROM   public.schedules
    WHERE  doctor_id   = p_doctor_id
      AND  day_of_week = v_dow
      AND  is_active   = TRUE
    ORDER  BY start_time
  LOOP
    -- Convert local schedule times → UTC using clinic timezone.
    -- timezone(tz, local_ts) interprets the timestamp as being IN tz and returns UTC.
    -- Correctly handles DST: a 09:00 slot in 'America/Mexico_City' resolves to the
    -- right UTC offset whether DST is active or not.
    v_win_start := timezone(v_timezone, (p_date + v_schedule.start_time)::TIMESTAMP);
    v_win_end   := timezone(v_timezone, (p_date + v_schedule.end_time)::TIMESTAMP);

    v_cursor := v_win_start;

    WHILE v_cursor + v_interval <= v_win_end LOOP
      v_slot_end := v_cursor + v_interval;

      IF NOT EXISTS (
        SELECT 1
        FROM   public.appointments
        WHERE  doctor_id = p_doctor_id
          AND  status   <> 'cancelled'
          AND (
                status = 'confirmed'
            OR (status = 'pending' AND otp_expires_at > NOW())
              )
          AND  tstzrange(starts_at, ends_at, '[)') &&
               tstzrange(v_cursor, v_slot_end,  '[)')
      ) THEN
        slot_start := v_cursor;
        RETURN NEXT;
      END IF;

      v_cursor := v_slot_end;
    END LOOP;
  END LOOP;
END;
$$;


-- -------------------------------------------------------------
-- book_slot
--
-- Atomically:
--   1. Cancels expired-pending appointments that block this slot
--      (same transaction as INSERT → fully atomic).
--   2. Inserts a new PENDING appointment with OTP hash + 5-min TTL.
--
-- If the slot is still occupied after step 1, the EXCLUDE
-- constraint raises exclusion_violation (23P01) → rethrown as
-- P0001 (SLOT_TAKEN) for clean handling in the Route Handler.
--
-- Caller (Next.js Route Handler) contract:
--   a. Generate plaintext OTP  → generateOTP()
--   b. Hash it (SHA-256)       → hashOTP(otp)
--   c. Call this RPC with the HASH, never the plaintext
--   d. Send plaintext OTP to patient via Twilio AFTER this returns
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_slot(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,        -- E.164 format
  p_starts_at      TIMESTAMPTZ, -- UTC
  p_otp_code_hash  TEXT         -- SHA-256 hex of the plaintext OTP
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

  -- Step 1: Release expired-pending appointments blocking this slot.
  -- Runs in the same transaction as the INSERT → atomic.
  UPDATE public.appointments
  SET    status = 'cancelled'
  WHERE  doctor_id       = p_doctor_id
    AND  status          = 'pending'
    AND  otp_expires_at  <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') &&
         tstzrange(p_starts_at, v_ends_at,  '[)');

  -- Step 2: Claim the slot. The EXCLUDE constraint is the true safety net:
  -- if two concurrent requests reach this INSERT simultaneously, one will
  -- succeed and the other will receive exclusion_violation.
  INSERT INTO public.appointments (
    clinic_id,      doctor_id,      service_id,
    patient_name,   patient_phone,
    starts_at,      ends_at,
    status,         otp_code_hash,  otp_expires_at
  ) VALUES (
    p_clinic_id,    p_doctor_id,    p_service_id,
    p_patient_name, p_patient_phone,
    p_starts_at,    v_ends_at,
    'pending',      p_otp_code_hash, NOW() + INTERVAL '5 minutes'
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


-- -------------------------------------------------------------
-- confirm_appointment
--
-- Verifies OTP hash, transitions status → confirmed, and clears
-- the OTP fields to prevent replay attacks.
-- Raises P0002 (INVALID_OR_EXPIRED_OTP) on mismatch or expiry.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_appointment_id UUID,
  p_otp_code_hash  TEXT  -- SHA-256 hex of what the patient typed
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_appointment public.appointments;
BEGIN
  UPDATE public.appointments
  SET
    status         = 'confirmed',
    otp_code_hash  = NULL,   -- Prevent replay
    otp_expires_at = NULL
  WHERE id             = p_appointment_id
    AND status         = 'pending'
    AND otp_code_hash  = p_otp_code_hash
    AND otp_expires_at > NOW()
  RETURNING * INTO v_appointment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_OR_EXPIRED_OTP'
      USING ERRCODE = 'P0002',
            DETAIL  = 'OTP is invalid, already used, or has expired';
  END IF;

  RETURN v_appointment;
END;
$$;


-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_admins_select" ON public.clinics
  FOR SELECT USING (
    id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );
CREATE POLICY "clinic_admins_update" ON public.clinics
  FOR UPDATE USING (
    id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile_select" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "own_profile_update" ON public.profiles FOR UPDATE USING (id = auth.uid());

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_services" ON public.services
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "admins_manage_services" ON public.services
  FOR ALL USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_doctors" ON public.doctors
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "admins_manage_doctors" ON public.doctors
  FOR ALL USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_schedules" ON public.schedules
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "admins_manage_schedules" ON public.schedules
  FOR ALL USING (
    doctor_id IN (
      SELECT d.id FROM public.doctors d
      JOIN   public.profiles p ON p.clinic_id = d.clinic_id
      WHERE  p.id = auth.uid()
    )
  );

ALTER TABLE public.doctor_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_doctor_services" ON public.doctor_services
  FOR SELECT USING (TRUE);
CREATE POLICY "admins_manage_doctor_services" ON public.doctor_services
  FOR ALL USING (
    doctor_id IN (
      SELECT d.id FROM public.doctors d
      JOIN   public.profiles p ON p.clinic_id = d.clinic_id
      WHERE  p.id = auth.uid()
    )
  );

-- Patients never access appointments directly.
-- All patient writes go through SECURITY DEFINER RPCs.
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_clinic_appts" ON public.appointments
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );
CREATE POLICY "admins_update_clinic_appts" ON public.appointments
  FOR UPDATE USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

-- =============================================================
-- GRANTS — allow anon role to call the public-facing RPCs
-- (Functions are SECURITY DEFINER so they run as postgres owner)
-- =============================================================
GRANT EXECUTE ON FUNCTION public.get_available_slots TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_slot           TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment TO anon;
