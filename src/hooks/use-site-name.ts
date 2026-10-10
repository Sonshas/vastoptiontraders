import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_SITE_NAME = 'Option Market Traders';

export function useSiteName() {
  const query = useQuery({
    queryKey: ['site-name'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('site_settings').select('value').eq('key', 'site_name').maybeSingle();
      if (error) throw error;
      return data?.value?.trim() || DEFAULT_SITE_NAME;
    },
  });
  return query.data ?? DEFAULT_SITE_NAME;
}
