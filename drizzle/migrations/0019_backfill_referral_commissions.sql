-- Link any signup that already stored a referral code, then record the missing
-- 30% for completed deposits. Rejected and pending deposits are not credited.

INSERT INTO public.referrals (referred_user_id, referrer_admin_id, code)
SELECT u.id, rc.admin_id, rc.code
FROM auth.users u
JOIN public.referral_codes rc
  ON rc.code = lower(btrim(COALESCE(u.raw_user_meta_data->>'referral_code', '')))
WHERE rc.code ~ '^[a-z0-9]{10}$'
  AND rc.admin_id <> u.id
ON CONFLICT (referred_user_id) DO NOTHING;

INSERT INTO public.referral_commissions (
  deposit_id, referred_user_id, referrer_admin_id, deposit_amount, commission_amount
)
SELECT d.id, d.user_id, r.referrer_admin_id, d.amount, round(d.amount * 0.30, 2)
FROM public.deposits d
JOIN public.referrals r ON r.referred_user_id = d.user_id
WHERE d.status = 'completed'
  AND d.amount > 0
  AND r.referrer_admin_id <> d.user_id
ON CONFLICT (deposit_id) DO NOTHING;
