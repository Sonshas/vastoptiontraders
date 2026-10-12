-- Real win rate is a percentage in site_settings. Only admins can read or change it.
-- place_real_trade is SECURITY DEFINER, so settlement can still read the row.
-- Quoted payout stays priced at 90%. The setting decides whether the exit digit wins.
-- Unset or invalid values settle at 90. 0 loses every new trade; 100 wins every new trade.
-- Available balance is completed deposits minus completed withdrawals plus settled trade profit.
-- The client never writes balances or trade rows.

CREATE TABLE public.real_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  market text NOT NULL,
  contract_type text NOT NULL,
  barrier int,
  stake numeric(14,2) NOT NULL,
  payout numeric(14,2) NOT NULL,
  exit_digit int NOT NULL,
  won boolean NOT NULL,
  profit numeric(14,2) NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX real_trades_user_idx ON public.real_trades(user_id, created_at DESC);

REVOKE ALL ON TABLE public.real_trades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.real_trades TO authenticated;
GRANT ALL ON TABLE public.real_trades TO service_role;

ALTER TABLE public.real_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own real trades" ON public.real_trades
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.place_real_trade(_market text, _contract text, _barrier int, _stake numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  deposited numeric;
  withdrawn numeric;
  trade_pnl numeric;
  bal numeric;
  prob numeric;
  pay numeric;
  d int;
  w boolean;
  prof numeric;
  newbal numeric;
  rate_text text;
  win_pct numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _stake IS NULL OR _stake < 0.35 OR _stake > 5000 THEN RAISE EXCEPTION 'Stake must be between 0.35 and 5000'; END IF;
  _stake := round(_stake, 2);
  IF _market NOT IN ('R_10','R_25','R_50','R_75','R_100') THEN RAISE EXCEPTION 'Unknown market'; END IF;
  IF _contract IN ('EVEN','ODD','MATCHES','DIFFERS','OVER','UNDER') THEN
    prob := 0.9;
  ELSE RAISE EXCEPTION 'Unknown contract';
  END IF;
  IF _contract IN ('MATCHES','DIFFERS') AND (_barrier IS NULL OR _barrier < 0 OR _barrier > 9) THEN RAISE EXCEPTION 'Prediction must be 0-9'; END IF;

  SELECT value INTO rate_text FROM public.site_settings WHERE key = 'real_win_rate';
  win_pct := NULL;
  IF rate_text IS NOT NULL AND btrim(rate_text) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    win_pct := btrim(rate_text)::numeric;
  END IF;
  IF win_pct IS NULL OR win_pct < 0 OR win_pct > 100 THEN
    win_pct := 90;
  END IF;

  PERFORM pg_advisory_xact_lock(87421, hashtext(uid::text));
  PERFORM 1 FROM public.deposits WHERE user_id = uid FOR UPDATE;
  PERFORM 1 FROM public.withdrawal_requests WHERE user_id = uid FOR UPDATE;
  PERFORM 1 FROM public.real_trades WHERE user_id = uid FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO deposited
  FROM public.deposits
  WHERE user_id = uid AND status = 'completed';

  SELECT COALESCE(SUM(amount), 0) INTO withdrawn
  FROM public.withdrawal_requests
  WHERE user_id = uid AND status = 'completed';

  SELECT COALESCE(SUM(profit), 0) INTO trade_pnl
  FROM public.real_trades
  WHERE user_id = uid;

  bal := deposited - withdrawn + trade_pnl;
  IF bal < _stake THEN RAISE EXCEPTION 'Insufficient real balance'; END IF;

  pay := round(_stake * 0.95 / prob, 2);
  d := floor(random() * 10)::int;
  IF random() < (win_pct / 100) THEN
    w := CASE _contract
      WHEN 'EVEN' THEN d % 2 = 0
      WHEN 'ODD' THEN d % 2 = 1
      WHEN 'MATCHES' THEN d = _barrier
      WHEN 'DIFFERS' THEN d <> _barrier
      WHEN 'OVER' THEN d > _barrier
      WHEN 'UNDER' THEN d < _barrier END;
  ELSE
    w := CASE _contract
      WHEN 'EVEN' THEN d % 2 = 1
      WHEN 'ODD' THEN d % 2 = 0
      WHEN 'MATCHES' THEN d <> _barrier
      WHEN 'DIFFERS' THEN d = _barrier
      WHEN 'OVER' THEN d <= _barrier
      WHEN 'UNDER' THEN d >= _barrier END;
  END IF;
  prof := CASE WHEN w THEN pay - _stake ELSE -_stake END;
  newbal := bal + prof;
  INSERT INTO public.real_trades(user_id, market, contract_type, barrier, stake, payout, exit_digit, won, profit, balance_after)
  VALUES (uid, _market, _contract, CASE WHEN _contract IN ('EVEN','ODD') THEN NULL ELSE _barrier END, _stake, pay, d, w, prof, newbal);
  RETURN json_build_object('exit_digit', d, 'won', w, 'payout', pay, 'profit', prof, 'balance', newbal);
END $$;

REVOKE EXECUTE ON FUNCTION public.place_real_trade(text, text, int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_real_trade(text, text, int, numeric) TO authenticated;

DROP POLICY IF EXISTS "Public can read site settings" ON public.site_settings;
CREATE POLICY "Public can read site settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (
    key IS DISTINCT FROM 'practice_win_rate'
    AND key IS DISTINCT FROM 'real_win_rate'
  );
