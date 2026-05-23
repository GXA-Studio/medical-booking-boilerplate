-- Migration: Drop legacy OTP-based booking RPCs
--
-- Both functions belong to the pre-WhatsApp OTP flow that was retired by
-- 20260516_remove_pending_status.sql (which forbade the 'pending' status they
-- both rely on). They remain in the DB only as dead code, still GRANTed to
-- anon — meaning any anonymous client can invoke them and trigger a
-- CHECK-constraint violation (chk_appointments_status), causing noisy errors.
--
-- The live booking path is public.book_slot_confirmed, which is kept intact.

DROP FUNCTION IF EXISTS public.book_slot(
  uuid, uuid, uuid, text, text, timestamptz, text
);

DROP FUNCTION IF EXISTS public.confirm_appointment(
  uuid, text
);
