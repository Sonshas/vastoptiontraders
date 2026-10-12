-- Demo win rate is a percentage in site_settings. Only admins can read or change it.
-- place_practice_trade is SECURITY DEFINER, so settlement can still read the row.
-- Quoted payout stays priced at 90%. The setting decides whether the exit digit wins.
-- Unset or invalid values settle at 90.

CREATE OR REPLACE FUNCTION public.place_practice_trade(_market text, _contract text, _barrier int, _stake numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
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

  SELECT value INTO rate_text FROM public.site_settings WHERE key = 'practice_win_rate';
  win_pct := NULL;
  IF rate_text IS NOT NULL AND btrim(rate_text) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    win_pct := btrim(rate_text)::numeric;
  END IF;
  IF win_pct IS NULL OR win_pct < 0 OR win_pct > 100 THEN
    win_pct := 90;
  END IF;

  INSERT INTO practice_accounts(user_id) VALUES (uid) ON CONFLICT DO NOTHING;
  SELECT balance INTO bal FROM practice_accounts WHERE user_id = uid FOR UPDATE;
  IF bal < _stake THEN RAISE EXCEPTION 'Insufficient practice balance'; END IF;

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
  UPDATE practice_accounts SET balance = newbal, updated_at = now() WHERE user_id = uid;
  INSERT INTO practice_trades(user_id, market, contract_type, barrier, stake, payout, exit_digit, won, profit, balance_after)
  VALUES (uid, _market, _contract, CASE WHEN _contract IN ('EVEN','ODD') THEN NULL ELSE _barrier END, _stake, pay, d, w, prof, newbal);
  RETURN json_build_object('exit_digit', d, 'won', w, 'payout', pay, 'profit', prof, 'balance', newbal);
END $$;

DROP POLICY IF EXISTS "Public can read site settings" ON public.site_settings;
CREATE POLICY "Public can read site settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (key IS DISTINCT FROM 'practice_win_rate');
