-- Designated referrers get a stable referral code and their own dashboard.
-- They are not site admins and not the super admin. A referral code is the
-- referrer flag. The referral wallet is the sum of 30% commission rows.
-- Existing completed deposits are not backfilled. Clients cannot write balances.

CREATE OR REPLACE FUNCTION public.is_referrer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.referral_codes WHERE admin_id = _user_id
  )
$$;

REVOKE ALL ON FUNCTION public.is_referrer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_referrer(uuid) TO postgres;

CREATE OR REPLACE FUNCTION public.can_open_referral_dashboard()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_referrer(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
$$;

REVOKE ALL ON FUNCTION public.can_open_referral_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_open_referral_dashboard() TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_signup_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code text;
  referrer_id uuid;
BEGIN
  raw_code := lower(btrim(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')));
  IF raw_code = '' OR raw_code !~ '^[a-z0-9]{10}$' THEN
    RETURN NEW;
  END IF;
  SELECT rc.admin_id INTO referrer_id
  FROM public.referral_codes rc
  WHERE rc.code = raw_code;
  IF referrer_id IS NULL OR referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.referrals (referred_user_id, referrer_admin_id, code)
  VALUES (NEW.id, referrer_id, raw_code)
  ON CONFLICT (referred_user_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_designated_referrer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) IN (
    'cleverserugo@gmail.com',
    'gipsonotengo@gmail.com'
  ) THEN
    INSERT INTO public.referral_codes (admin_id, code)
    VALUES (NEW.id, public.generate_referral_code())
    ON CONFLICT (admin_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.ensure_designated_referrer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_ensure_referrer ON auth.users;
CREATE TRIGGER on_auth_user_created_ensure_referrer
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ensure_designated_referrer();

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
    'commission_total', wallet.balance,
    'wallet_balance', wallet.balance,
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
  CROSS JOIN LATERAL (
    SELECT COALESCE((
      SELECT round(sum(c.commission_amount), 2)
      FROM public.referral_commissions c
      WHERE c.referrer_admin_id = _admin_id
    ), 0) AS balance
  ) wallet
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
  IF caller IS NULL OR NOT (
    public.is_referrer(caller) OR public.has_role(caller, 'admin')
  ) THEN
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
  IF target = caller THEN
    RETURN 'owner';
  END IF;
  IF public.is_super_admin(caller) THEN
    RETURN 'super';
  END IF;
  RETURN 'none';
END $$;

REVOKE ALL ON FUNCTION public.referral_link_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_link_access(text) TO authenticated;

INSERT INTO public.referral_codes (admin_id, code)
SELECT u.id, public.generate_referral_code()
FROM auth.users u
WHERE lower(u.email) IN (
  'cleverserugo@gmail.com',
  'gipsonotengo@gmail.com'
)
ON CONFLICT (admin_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
