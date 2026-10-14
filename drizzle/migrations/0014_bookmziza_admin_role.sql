CREATE OR REPLACE FUNCTION public.assign_admin_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) IN (
    'domondi797@gmail.com',
    'sonshasopunga@gmail.com',
    'jdey6396@gmail.com',
    'modifrayk@gmail.com',
    'bookmzizafamily254@gmail.com'
  ) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users
WHERE lower(email) = 'bookmzizafamily254@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.referral_codes (admin_id, code)
SELECT u.id, public.generate_referral_code()
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'admin'
WHERE lower(u.email) = 'bookmzizafamily254@gmail.com'
ON CONFLICT (admin_id) DO NOTHING;
