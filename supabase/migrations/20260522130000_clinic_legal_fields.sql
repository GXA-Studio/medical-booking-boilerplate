-- ================================================================
-- Clinic legal fields — required for white-label privacy policy
-- File   : 20260522130000_clinic_legal_fields.sql
-- Version: 2026-05-22
-- ================================================================
--
-- PURPOSE
-- -------
-- The privacy policy (/privacidad) must dynamically show each clinic's
-- legal data when accessed in the clinic context (?slug=…). Without
-- these columns the page falls back to a generic placeholder.
--
-- `address` already exists on `clinics` (initial schema). This
-- migration adds the two missing fields required by RGPD art. 13
-- and LSSI-CE art. 10 for identifying the data controller:
--
--   legal_name  — official registered name (may differ from `name`)
--   cif         — Spanish tax ID / NIF — required for legal contact
--
-- All columns are NULLABLE: existing clinics continue to work with
-- the fallback placeholder until their data is populated.
-- ================================================================


ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS cif        TEXT;

COMMENT ON COLUMN public.clinics.legal_name IS
  'Razón social oficial registrada (puede diferir de name). Usada en la política de privacidad.';

COMMENT ON COLUMN public.clinics.cif IS
  'NIF / CIF español. Requerido en la política de privacidad para identificar al Responsable del Tratamiento (RGPD art. 13).';
