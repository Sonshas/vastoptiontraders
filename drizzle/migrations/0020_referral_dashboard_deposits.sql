-- Show every referred deposit on the dashboard, including pending and rejected.
-- The wallet total remains the sum of 30% credits from completed deposits only.

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
                  'status', d.status,
                  'commission', c.commission_amount
                ) ORDER BY d.created_at DESC
              )
              FROM public.deposits d
              LEFT JOIN public.referral_commissions c ON c.deposit_id = d.id
              WHERE d.user_id = r.referred_user_id
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

NOTIFY pgrst, 'reload schema';
