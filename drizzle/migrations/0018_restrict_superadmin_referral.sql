-- Super-admin referral access is sonshasopunga@gmail.com only.
-- Other admins keep has_role('admin') for the admin panel and can read only their own referral wallet.
-- Codes, commissions, balances, role grants, and trading rules are untouched.

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = _user_id AND lower(email) = 'sonshasopunga@gmail.com'
  )
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

REVOKE ALL ON TABLE public.referral_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referrals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referral_commissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.referral_codes TO authenticated;
GRANT SELECT ON TABLE public.referrals TO authenticated;
GRANT SELECT ON TABLE public.referral_commissions TO authenticated;

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('referral_codes', 'referrals', 'referral_commissions')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

CREATE POLICY "Admins read own referral codes"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (admin_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "Read own referral relationships"
  ON public.referrals FOR SELECT TO authenticated
  USING (
    referred_user_id = auth.uid()
    OR referrer_admin_id = auth.uid()
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Read own referral commissions"
  ON public.referral_commissions FOR SELECT TO authenticated
  USING (
    referred_user_id = auth.uid()
    OR referrer_admin_id = auth.uid()
    OR public.is_super_admin(auth.uid())
  );

NOTIFY pgrst, 'reload schema';
