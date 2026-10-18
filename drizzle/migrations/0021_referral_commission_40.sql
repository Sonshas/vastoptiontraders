-- Referral commission is 40% of a completed USD deposit.
-- Existing commission rows are updated to the same rate. Pending and rejected deposits stay unpaid.

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
  commission := round(NEW.amount * 0.40, 2);
  INSERT INTO public.referral_commissions (
    deposit_id, referred_user_id, referrer_admin_id, deposit_amount, commission_amount
  ) VALUES (
    NEW.id, NEW.user_id, referrer, NEW.amount, commission
  )
  ON CONFLICT (deposit_id) DO NOTHING;
  RETURN NEW;
END $$;

UPDATE public.referral_commissions
SET commission_amount = round(deposit_amount * 0.40, 2)
WHERE commission_amount IS DISTINCT FROM round(deposit_amount * 0.40, 2);
