CREATE TABLE public.practice_accounts (
  user_id uuid PRIMARY KEY,
  balance numeric(14,2) NOT NULL DEFAULT 10000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.practice_accounts TO authenticated;
GRANT ALL ON public.practice_accounts TO service_role;
ALTER TABLE public.practice_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own practice account" ON public.practice_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.practice_trades (
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
CREATE INDEX practice_trades_user_idx ON public.practice_trades(user_id, created_at DESC);
GRANT SELECT ON public.practice_trades TO authenticated;
GRANT ALL ON public.practice_trades TO service_role;
ALTER TABLE public.practice_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own practice trades" ON public.practice_trades FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_practice_account()
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO practice_accounts(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO b FROM practice_accounts WHERE user_id = auth.uid();
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION public.reset_practice_account()
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO practice_accounts(user_id) VALUES (auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET balance = 10000, updated_at = now();
  RETURN 10000;
END $$;

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

  INSERT INTO practice_accounts(user_id) VALUES (uid) ON CONFLICT DO NOTHING;
  SELECT balance INTO bal FROM practice_accounts WHERE user_id = uid FOR UPDATE;
  IF bal < _stake THEN RAISE EXCEPTION 'Insufficient practice balance'; END IF;

  pay := round(_stake * 0.95 / prob, 2);
  d := floor(random() * 10)::int;
  IF random() < 0.9 THEN
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

REVOKE EXECUTE ON FUNCTION public.get_practice_account() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.reset_practice_account() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.place_practice_trade(text,text,int,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_practice_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_practice_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_practice_trade(text,text,int,numeric) TO authenticated;