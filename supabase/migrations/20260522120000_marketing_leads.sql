-- ================================================================
-- Marketing Leads — landing page contact form capture
-- File   : 20260522120000_marketing_leads.sql
-- Version: 2026-05-22
-- ================================================================
--
-- PURPOSE
-- -------
-- Stores leads captured from the /api/leads endpoint (form on the
-- marketing landing at "/"). This table is INTERNAL to the
-- GXA Studio team — it has no relation to a specific clinic and
-- intentionally lives outside the booking domain.
--
-- ACCESS MODEL
-- ------------
-- RLS is enabled with NO policies = deny by default. All access
-- happens via the service role from server-side code:
--   - INSERT  → app/api/leads (capture)
--   - SELECT  → manual via Supabase Dashboard SQL editor (review)
--   - UPDATE  → manual to mark status changes ('contacted', etc.)
-- ================================================================


CREATE TABLE public.marketing_leads (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  clinic       TEXT        NOT NULL,         -- free text: "Clínica X — Valencia"
  message      TEXT,                          -- optional notes from the prospect
  source       TEXT        NOT NULL DEFAULT 'landing',  -- 'landing' | 'prospecting-engine' | …
  ip           TEXT,                          -- captured for spam analysis
  user_agent   TEXT,
  status       TEXT        NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'contacted', 'demo_scheduled', 'closed_won', 'closed_lost', 'spam')),
  notes        TEXT                           -- internal team annotations
);

CREATE INDEX marketing_leads_created_at_idx ON public.marketing_leads (created_at DESC);
CREATE INDEX marketing_leads_status_idx     ON public.marketing_leads (status);
CREATE INDEX marketing_leads_email_idx      ON public.marketing_leads (email);

-- RLS: deny-by-default for anon and authenticated.
-- Service role bypasses RLS by design, so server-side code (api/leads) has full access.
ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;

-- Explicit grants (anon/authenticated remain blocked by absent policies, but the grant
-- is needed for service_role to bypass without errors).
GRANT SELECT, INSERT, UPDATE ON public.marketing_leads TO service_role;

COMMENT ON TABLE public.marketing_leads IS
  'Captura de leads desde la landing de venta (POST /api/leads). Solo accesible vía service role.';
