CREATE POLICY "Users request own deposits" ON public.deposits
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');