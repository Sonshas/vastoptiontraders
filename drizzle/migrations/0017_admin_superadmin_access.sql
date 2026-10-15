-- Every site admin gets the same referral-dashboard access as the original super admin.
-- Future admins created by assign_admin_role follow the same rule.
-- Non-admin referrers stay on their own wallet. Codes, commissions, and balances are untouched.

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
