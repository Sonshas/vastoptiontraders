import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('local auth fallback', () => {
  beforeEach(() => {
    vi.resetModules();
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
    localStorage.clear();
  });

  it('allows sign in with any email and password when no external auth is configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');

    const { supabase } = await import('@/integrations/supabase/client');
    const result = await supabase.auth.signInWithPassword({
      email: 'demo-user@example.com',
      password: 'any-password',
    });

    expect(result.error).toBeNull();
    expect(result.data.session).not.toBeNull();
    expect(result.data.user?.email).toBe('demo-user@example.com');
  });
});
