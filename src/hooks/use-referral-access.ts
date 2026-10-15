import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/session-context';
import { supabase } from '@/integrations/supabase/client';

export function useCanOpenReferralDashboard() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['can-open-referral-dashboard', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_open_referral_dashboard');
      if (error) throw error;
      return data === true;
    },
  });
}
