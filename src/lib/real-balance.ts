import { supabase } from '@/integrations/supabase/client';
import { calculateAvailableRealBalance } from '@/lib/funds';

/** Available real balance: completed deposits minus completed withdrawals, plus settled trade profit. */
export async function loadAvailableRealBalance(userId: string): Promise<number> {
  const [{ data: deposits, error: depositsError }, { data: withdrawals, error: withdrawalsError }, { data: trades, error: tradesError }] = await Promise.all([
    supabase.from('deposits').select('amount, status').eq('user_id', userId),
    supabase.from('withdrawal_requests').select('amount, status').eq('user_id', userId),
    supabase.from('real_trades').select('profit').eq('user_id', userId),
  ]);
  if (depositsError) throw depositsError;
  if (withdrawalsError) throw withdrawalsError;
  if (tradesError) throw tradesError;
  return calculateAvailableRealBalance(deposits ?? [], withdrawals ?? [], trades ?? []);
}
