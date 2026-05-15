-- ================================================================
-- Medical Booking Boilerplate — Security Patches
-- File   : 20260515300000_security_patches.sql
-- Patches: S-03 — Validate doctor belongs to clinic in book_slot
--          S-04 — Same validation in book_slot_confirmed
-- ================================================================
-- VULNERABILITY: Both RPCs accepted p_clinic_id as an untrusted
-- parameter without verifying that p_doctor_id belongs to it.
-- An attacker could book appointments under a different clinic_id
-- than the one the doctor belongs to, corrupting multi-clinic data.
-- ================================================================

CREATE OR REPLACE FUNCTION public.book_slot(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,
  p_starts_at      TIMESTAMPTZ,
  p_otp_code_hash  TEXT
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_duration    INTEGER;
  v_ends_at     TIMESTAMPTZ;
  v_appointment public.appointments;
BEGIN
  -- S-03 FIX: Verify doctor belongs to the specified clinic
  IF NOT EXISTS (
    SELECT 1 FROM public.doctors
    WHERE id = p_doctor_id AND clinic_id = p_clinic_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Doctor % does not belong to clinic %', p_doctor_id, p_clinic_id
      USING ERRCODE = 'P0006';
  END IF;

  SELECT duration_minutes INTO v_duration
  FROM   public.services WHERE id = p_service_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id USING ERRCODE = 'P0003';
  END IF;

  v_ends_at := p_starts_at + (v_duration * INTERVAL '1 minute');

  UPDATE public.appointments SET status = 'cancelled'
  WHERE  doctor_id = p_doctor_id AND status = 'pending'
    AND  otp_expires_at <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');

  INSERT INTO public.appointments (
    clinic_id, doctor_id, service_id, patient_name, patient_phone,
    starts_at, ends_at, status, otp_code_hash, otp_expires_at
  ) VALUES (
    p_clinic_id, p_doctor_id, p_service_id, p_patient_name, p_patient_phone,
    p_starts_at, v_ends_at, 'pending', p_otp_code_hash, NOW() + INTERVAL '5 minutes'
  )
  RETURNING * INTO v_appointment;

  RETURN v_appointment;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001', DETAIL = 'The requested slot is no longer available';
END;
$$;


CREATE OR REPLACE FUNCTION public.book_slot_confirmed(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,
  p_starts_at      TIMESTAMPTZ
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_duration    INTEGER;
  v_ends_at     TIMESTAMPTZ;
  v_appointment public.appointments;
BEGIN
  -- S-04 FIX: Verify doctor belongs to the specified clinic
  IF NOT EXISTS (
    SELECT 1 FROM public.doctors
    WHERE id = p_doctor_id AND clinic_id = p_clinic_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Doctor % does not belong to clinic %', p_doctor_id, p_clinic_id
      USING ERRCODE = 'P0006';
  END IF;

  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = p_service_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  v_ends_at := p_starts_at + (v_duration * INTERVAL '1 minute');

  UPDATE public.appointments
  SET    status = 'cancelled'
  WHERE  doctor_id       = p_doctor_id
    AND  status          = 'pending'
    AND  otp_expires_at  <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') &&
         tstzrange(p_starts_at, v_ends_at,  '[)');

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

GRANT EXECUTE ON FUNCTION public.book_slot           TO anon;
GRANT EXECUTE ON FUNCTION public.book_slot_confirmed TO anon;
