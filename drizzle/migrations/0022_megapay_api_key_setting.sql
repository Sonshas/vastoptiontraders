-- The MegaPay API key is read only by the service role. Clients cannot select or change it.

DROP POLICY IF EXISTS "Public can read site settings" ON public.site_settings;
CREATE POLICY "Public can read site settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (
    key IS DISTINCT FROM 'practice_win_rate'
    AND key IS DISTINCT FROM 'real_win_rate'
    AND key IS DISTINCT FROM 'megapay_api_key'
  );

DROP POLICY IF EXISTS "Admins manage site settings" ON public.site_settings;
CREATE POLICY "Admins manage site settings" ON public.site_settings
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND key IS DISTINCT FROM 'megapay_api_key'
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND key IS DISTINCT FROM 'megapay_api_key'
  );
