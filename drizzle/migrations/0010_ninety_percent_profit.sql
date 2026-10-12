-- Every winning trade pays a flat 90% profit on demo and real accounts,
-- for every volatility and every contract. A 10 stake stores payout 19 and
-- credits profit 9. A loss still loses the stake.
-- Win rates stay independent. 100 wins every new trade and 0 loses every
-- new trade. Values in between use random() < win_pct / 100.0.

CREATE OR REPLACE FUNCTION public.place_practice_trade(_market text, _contract text, _barrier int, _stake numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  bal numeric;
  pay numeric;
  d int;
  w boolean;
  prof numeric;
  newbal numeric;
  rate_text text;
  win_pct numeric;
  candidates int[];
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _stake IS NULL OR _stake < 0.35 OR _stake > 5000 THEN RAISE EXCEPTION 'Stake must be between 0.35 and 5000'; END IF;
  _stake := round(_stake, 2);
  IF _market NOT IN ('R_10','R_25','R_50','R_75','R_100') THEN RAISE EXCEPTION 'Unknown market'; END IF;
  IF _contract NOT IN ('EVEN','ODD','MATCHES','DIFFERS','OVER','UNDER') THEN RAISE EXCEPTION 'Unknown contract'; END IF;
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

  pay := _stake + round(_stake * 0.90, 2);
  IF win_pct >= 100 THEN
    w := true;
  ELSIF win_pct <= 0 THEN
    w := false;
  ELSIF random() < (win_pct / 100.0) THEN
    w := true;
  ELSE
    w := false;
  END IF;

  candidates := ARRAY[]::int[];
  FOR cand IN 0..9 LOOP
    IF (
      CASE _contract
        WHEN 'EVEN' THEN (cand % 2 = 0)
        WHEN 'ODD' THEN (cand % 2 = 1)
        WHEN 'MATCHES' THEN (cand = _barrier)
        WHEN 'DIFFERS' THEN (cand <> _barrier)
        WHEN 'OVER' THEN (cand > _barrier)
        WHEN 'UNDER' THEN (cand < _barrier)
        ELSE false
      END
    ) = w THEN
      candidates := candidates || cand;
    END IF;
  END LOOP;
  IF array_length(candidates, 1) IS NULL THEN
    d := floor(random() * 10)::int;
    w := COALESCE(
      CASE _contract
        WHEN 'EVEN' THEN (d % 2 = 0)
        WHEN 'ODD' THEN (d % 2 = 1)
        WHEN 'MATCHES' THEN (d = _barrier)
        WHEN 'DIFFERS' THEN (d <> _barrier)
        WHEN 'OVER' THEN (d > _barrier)
        WHEN 'UNDER' THEN (d < _barrier)
        ELSE false
      END,
      false
    );
  ELSE
    d := candidates[1 + floor(random() * array_length(candidates, 1))::int];
  END IF;

  prof := CASE WHEN w THEN pay - _stake ELSE -_stake END;
  newbal := bal + prof;
  UPDATE practice_accounts SET balance = newbal, updated_at = now() WHERE user_id = uid;
  INSERT INTO practice_trades(user_id, market, contract_type, barrier, stake, payout, exit_digit, won, profit, balance_after)
  VALUES (uid, _market, _contract, CASE WHEN _contract IN ('EVEN','ODD') THEN NULL ELSE _barrier END, _stake, pay, d, w, prof, newbal);
  RETURN json_build_object('exit_digit', d, 'won', w, 'payout', pay, 'profit', prof, 'balance', newbal);
END $$;

REVOKE EXECUTE ON FUNCTION public.place_practice_trade(text, text, int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_practice_trade(text, text, int, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.place_real_trade(_market text, _contract text, _barrier int, _stake numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  deposited numeric;
  withdrawn numeric;
  trade_pnl numeric;
  bal numeric;
  pay numeric;
  d int;
  w boolean;
  prof numeric;
  newbal numeric;
  rate_text text;
  win_pct numeric;
  candidates int[];
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _stake IS NULL OR _stake < 0.35 OR _stake > 5000 THEN RAISE EXCEPTION 'Stake must be between 0.35 and 5000'; END IF;
  _stake := round(_stake, 2);
  IF _market NOT IN ('R_10','R_25','R_50','R_75','R_100') THEN RAISE EXCEPTION 'Unknown market'; END IF;
  IF _contract NOT IN ('EVEN','ODD','MATCHES','DIFFERS','OVER','UNDER') THEN RAISE EXCEPTION 'Unknown contract'; END IF;
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

  pay := _stake + round(_stake * 0.90, 2);
  IF win_pct >= 100 THEN
    w := true;
  ELSIF win_pct <= 0 THEN
    w := false;
  ELSIF random() < (win_pct / 100.0) THEN
    w := true;
  ELSE
    w := false;
  END IF;

  candidates := ARRAY[]::int[];
  FOR cand IN 0..9 LOOP
    IF (
      CASE _contract
        WHEN 'EVEN' THEN (cand % 2 = 0)
        WHEN 'ODD' THEN (cand % 2 = 1)
        WHEN 'MATCHES' THEN (cand = _barrier)
        WHEN 'DIFFERS' THEN (cand <> _barrier)
        WHEN 'OVER' THEN (cand > _barrier)
        WHEN 'UNDER' THEN (cand < _barrier)
        ELSE false
      END
    ) = w THEN
      candidates := candidates || cand;
    END IF;
  END LOOP;
  IF array_length(candidates, 1) IS NULL THEN
    d := floor(random() * 10)::int;
    w := COALESCE(
      CASE _contract
        WHEN 'EVEN' THEN (d % 2 = 0)
        WHEN 'ODD' THEN (d % 2 = 1)
        WHEN 'MATCHES' THEN (d = _barrier)
        WHEN 'DIFFERS' THEN (d <> _barrier)
        WHEN 'OVER' THEN (d > _barrier)
        WHEN 'UNDER' THEN (d < _barrier)
        ELSE false
      END,
      false
    );
  ELSE
    d := candidates[1 + floor(random() * array_length(candidates, 1))::int];
  END IF;

  prof := CASE WHEN w THEN pay - _stake ELSE -_stake END;
  newbal := bal + prof;
  INSERT INTO public.real_trades(user_id, market, contract_type, barrier, stake, payout, exit_digit, won, profit, balance_after)
  VALUES (uid, _market, _contract, CASE WHEN _contract IN ('EVEN','ODD') THEN NULL ELSE _barrier END, _stake, pay, d, w, prof, newbal);
  RETURN json_build_object('exit_digit', d, 'won', w, 'payout', pay, 'profit', prof, 'balance', newbal);
END $$;

REVOKE EXECUTE ON FUNCTION public.place_real_trade(text, text, int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_real_trade(text, text, int, numeric) TO authenticated;
