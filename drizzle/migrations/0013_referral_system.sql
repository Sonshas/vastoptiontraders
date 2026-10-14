-- Referral links, one referrer per user, and a 30% commission ledger.
-- Existing completed deposits are not backfilled. Commission is recorded only when
-- a deposit becomes completed after this migration. Clients cannot write these tables.

CREATE TABLE public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{10}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9]{10}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.referral_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid NOT NULL UNIQUE REFERENCES public.deposits(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL,
  referrer_admin_id uuid NOT NULL,
  deposit_amount numeric(14,2) NOT NULL CHECK (deposit_amount > 0),
  commission_amount numeric(14,2) NOT NULL CHECK (commission_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX referral_commissions_referrer_idx ON public.referral_commissions (referrer_admin_id, referred_user_id);
CREATE INDEX referrals_referrer_idx ON public.referrals (referrer_admin_id);

REVOKE ALL ON TABLE public.referral_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referrals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referral_commissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.referral_codes TO authenticated;
GRANT SELECT ON TABLE public.referrals TO authenticated;
GRANT SELECT ON TABLE public.referral_commissions TO authenticated;
GRANT ALL ON TABLE public.referral_codes TO service_role;
GRANT ALL ON TABLE public.referrals TO service_role;
GRANT ALL ON TABLE public.referral_commissions TO service_role;

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  candidate text;
  attempts int := 0;
BEGIN
  LOOP
    candidate := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = candidate);
    attempts := attempts + 1;
    IF attempts >= 25 THEN
      RAISE EXCEPTION 'Could not generate a referral code';
    END IF;
  END LOOP;
  RETURN candidate;
END $$;

REVOKE ALL ON FUNCTION public.generate_referral_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_referral_code() TO postgres;

CREATE OR REPLACE FUNCTION public.ensure_admin_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    INSERT INTO public.referral_codes (admin_id, code)
    VALUES (NEW.user_id, public.generate_referral_code())
    ON CONFLICT (admin_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER on_user_role_ensure_referral_code
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_admin_referral_code();

CREATE OR REPLACE FUNCTION public.capture_signup_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code text;
  admin_id uuid;
BEGIN
  raw_code := lower(btrim(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')));
  IF raw_code = '' OR raw_code !~ '^[a-z0-9]{10}$' THEN
    RETURN NEW;
  END IF;
  SELECT rc.admin_id INTO admin_id
  FROM public.referral_codes rc
  WHERE rc.code = raw_code AND public.has_role(rc.admin_id, 'admin');
  IF admin_id IS NULL OR admin_id = NEW.id THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.referrals (referred_user_id, referrer_admin_id, code)
  VALUES (NEW.id, admin_id, raw_code)
  ON CONFLICT (referred_user_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created_capture_referral
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.capture_signup_referral();

CREATE OR REPLACE FUNCTION public.record_referral_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer uuid;
  commission numeric(14,2);
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  SELECT r.referrer_admin_id INTO referrer
  FROM public.referrals r
  WHERE r.referred_user_id = NEW.user_id;
  IF referrer IS NULL OR referrer = NEW.user_id THEN
    RETURN NEW;
  END IF;
  commission := round(NEW.amount * 0.30, 2);
  INSERT INTO public.referral_commissions (
    deposit_id, referred_user_id, referrer_admin_id, deposit_amount, commission_amount
  ) VALUES (
    NEW.id, NEW.user_id, referrer, NEW.amount, commission
  )
  ON CONFLICT (deposit_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_deposit_completed_referral_commission
  AFTER INSERT OR UPDATE OF status ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.record_referral_commission();

CREATE OR REPLACE FUNCTION public.referral_admin_snapshot(_admin_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'email', u.email::text,
    'code', rc.code,
    'commission_total', COALESCE((
      SELECT round(sum(c.commission_amount), 2)
      FROM public.referral_commissions c
      WHERE c.referrer_admin_id = _admin_id
    ), 0),
    'referred_users', COALESCE((
      SELECT jsonb_agg(s.user_row ORDER BY s.joined_at DESC)
      FROM (
        SELECT r.created_at AS joined_at,
          jsonb_build_object(
            'email', ru.email::text,
            'joined_at', r.created_at,
            'deposit_total', COALESCE((
              SELECT round(sum(d.amount), 2)
              FROM public.deposits d
              WHERE d.user_id = r.referred_user_id AND d.status = 'completed'
            ), 0),
            'commission_total', COALESCE((
              SELECT round(sum(c.commission_amount), 2)
              FROM public.referral_commissions c
              WHERE c.referrer_admin_id = _admin_id AND c.referred_user_id = r.referred_user_id
            ), 0),
            'completed_deposits', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'amount', d.amount,
                  'completed_at', d.created_at,
                  'commission', c.commission_amount
                ) ORDER BY d.created_at DESC
              )
              FROM public.deposits d
              LEFT JOIN public.referral_commissions c ON c.deposit_id = d.id
              WHERE d.user_id = r.referred_user_id AND d.status = 'completed'
            ), '[]'::jsonb)
          ) AS user_row
        FROM public.referrals r
        JOIN auth.users ru ON ru.id = r.referred_user_id
        WHERE r.referrer_admin_id = _admin_id
      ) s
    ), '[]'::jsonb)
  )
  FROM public.referral_codes rc
  JOIN auth.users u ON u.id = rc.admin_id
  WHERE rc.admin_id = _admin_id
$$;

REVOKE ALL ON FUNCTION public.referral_admin_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_admin_snapshot(uuid) TO postgres;

CREATE OR REPLACE FUNCTION public.get_referral_dashboard(_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  normalized text := lower(btrim(COALESCE(_code, '')));
  target uuid;
  is_super boolean;
  own_code text;
BEGIN
  IF caller IS NULL OR NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  is_super := public.is_super_admin(caller);
  SELECT rc.code INTO own_code FROM public.referral_codes rc WHERE rc.admin_id = caller;

  IF normalized = '' THEN
    IF is_super THEN
      RETURN jsonb_build_object(
        'scope', 'all',
        'is_super_admin', true,
        'own_code', own_code,
        'admins', COALESCE((
          SELECT jsonb_agg(public.referral_admin_snapshot(rc.admin_id) ORDER BY u.email)
          FROM public.referral_codes rc
          JOIN auth.users u ON u.id = rc.admin_id
        ), '[]'::jsonb)
      );
    END IF;
    IF own_code IS NULL THEN
      RAISE EXCEPTION 'No referral code';
    END IF;
    RETURN jsonb_build_object(
      'scope', 'one',
      'is_super_admin', false,
      'own_code', own_code,
      'admin', public.referral_admin_snapshot(caller)
    );
  END IF;

  IF normalized !~ '^[a-z0-9]{10}$' THEN
    RAISE EXCEPTION 'Referral code not found';
  END IF;

  SELECT rc.admin_id INTO target FROM public.referral_codes rc WHERE rc.code = normalized;
  IF target IS NULL THEN
    RAISE EXCEPTION 'Referral code not found';
  END IF;
  IF target <> caller AND NOT is_super THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN jsonb_build_object(
    'scope', 'one',
    'is_super_admin', is_super,
    'own_code', own_code,
    'admin', public.referral_admin_snapshot(target)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_referral_dashboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_dashboard(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.referral_link_access(_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  normalized text := lower(btrim(COALESCE(_code, '')));
  target uuid;
BEGIN
  IF caller IS NULL OR normalized !~ '^[a-z0-9]{10}$' THEN
    RETURN 'none';
  END IF;
  SELECT rc.admin_id INTO target FROM public.referral_codes rc WHERE rc.code = normalized;
  IF target IS NULL THEN
    RETURN 'none';
  END IF;
  IF target = caller AND public.has_role(caller, 'admin') THEN
    RETURN 'owner';
  END IF;
  IF public.is_super_admin(caller) THEN
    RETURN 'super';
  END IF;
  RETURN 'none';
END $$;

REVOKE ALL ON FUNCTION public.referral_link_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_link_access(text) TO authenticated;

DO $$
DECLARE
  admin_row record;
BEGIN
  FOR admin_row IN SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.referral_codes (admin_id, code)
    VALUES (admin_row.user_id, public.generate_referral_code())
    ON CONFLICT (admin_id) DO NOTHING;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
