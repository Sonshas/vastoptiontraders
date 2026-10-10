import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn(() => ({
  auth: { signInWithPassword: vi.fn() },
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

describe('supabase client configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete (import.meta as any).env.VITE_SUPABASE_URL;
    delete (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete (import.meta as any).env.NEXT_PUBLIC_SUPABASE_URL;
    delete (import.meta as any).env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  });

  it('uses the real Supabase client when credentials are configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    (import.meta as any).env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';

    const { createSupabaseClient } = await import('@/integrations/supabase/client');
    createSupabaseClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to demo auth when no live credentials are configured', async () => {
    delete (import.meta as any).env.VITE_SUPABASE_URL;
    delete (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const { createSupabaseClient } = await import('@/integrations/supabase/client');
    const client = createSupabaseClient();

    expect(createClientMock).not.toHaveBeenCalled();
    expect(client.auth.signInWithPassword).toBeTypeOf('function');
  });
});
