// This file is intentionally local-first so the app can run without Lovable or Supabase credentials.
import { createClient } from '@supabase/supabase-js';
import { winningProfit } from '@/lib/payout';
import { digitsMatchingOutcome } from '@/lib/practice-win-rate';
import type { Database } from './types';

const DEMO_SESSION_KEY = 'demo-supabase-session';

function createDemoUser(email: string) {
  const normalizedEmail = email.trim();
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    email: normalizedEmail,
    app_metadata: { provider: 'demo' },
    user_metadata: { full_name: normalizedEmail.split('@')[0] },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
  } as any;
}

function readDemoSession() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as { access_token: string; refresh_token: string; expires_at: number; user: any } | null;
  } catch {
    window.localStorage.removeItem(DEMO_SESSION_KEY);
    return null;
  }
}

function writeDemoSession(session: { access_token: string; refresh_token: string; expires_at: number; user: any }) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
}

function clearDemoSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DEMO_SESSION_KEY);
}

function createDemoAuth() {
  const listeners = new Set<(event: string, session: any) => void>();

  const emit = (event: string, session: any) => {
    for (const listener of listeners) listener(event, session);
  };

  const getSession = async () => {
    const session = readDemoSession();
    return { data: { session }, error: null };
  };

  const getUser = async () => {
    const session = readDemoSession();
    return { data: { user: session?.user ?? null }, error: null };
  };

  const signInWithPassword = async ({ email, password }: { email: string; password: string }) => {
    const sanitizedEmail = email?.trim();
    if (!sanitizedEmail || !password) {
      return {
        data: { user: null, session: null },
        error: { message: 'Email and password are required.', name: 'AuthApiError' },
      };
    }

    const user = createDemoUser(sanitizedEmail);
    const timestamp = Date.now() / 1000;
    const session = {
      access_token: `demo-access-token-${timestamp}`,
      refresh_token: `demo-refresh-token-${timestamp}`,
      expires_in: 3600,
      expires_at: timestamp + 3600,
      token_type: 'bearer',
      user,
    };

    writeDemoSession(session);
    emit('SIGNED_IN', session);
    return { data: { user, session }, error: null };
  };

  const signUp = async ({ email, password }: { email: string; password: string }) => signInWithPassword({ email, password });

  const signOut = async () => {
    clearDemoSession();
    emit('SIGNED_OUT', null);
    return { error: null };
  };

  const updateUser = async ({ password }: { password?: string }) => {
    const session = readDemoSession();
    if (!session?.user) {
      return { data: { user: null }, error: null };
    }

    const user = { ...session.user, updated_at: new Date().toISOString() };
    const nextSession = { ...session, user };
    writeDemoSession(nextSession);
    emit('USER_UPDATED', nextSession);
    return { data: { user }, error: null };
  };

  const resetPasswordForEmail = async () => ({ data: {}, error: null });

  return {
    getSession,
    getUser,
    signInWithPassword,
    signUp,
    signOut,
    resetPasswordForEmail,
    updateUser,
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      listeners.add(callback);
      const initialSession = readDemoSession();
      callback('INITIAL_SESSION', initialSession);
      return {
        data: {
          subscription: {
            unsubscribe: () => listeners.delete(callback),
          },
        },
      };
    },
    setSession: async (nextSession: any) => {
      if (!nextSession) {
        clearDemoSession();
        emit('SIGNED_OUT', null);
        return { data: { session: null }, error: null };
      }
      writeDemoSession(nextSession);
      emit('SIGNED_IN', nextSession);
      return { data: { session: nextSession }, error: null };
    },
    getClaims: async () => ({ data: null, error: null }),
  };
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function serverSupabaseUrl(publicUrl: string, supabaseKey: string): string | undefined {
  if (typeof window !== 'undefined' || typeof process === 'undefined') return undefined;
  const serverUrl = process.env['SUPABASE_URL']?.replace(/\/+$/, '');
  if (!serverUrl || serverUrl === publicUrl || process.env['SUPABASE_PUBLISHABLE_KEY'] !== supabaseKey) return undefined;
  return serverUrl;
}

function createSupabaseFetch(supabaseUrl: string, supabaseKey: string): typeof fetch {
  const publicUrl = supabaseUrl.replace(/\/+$/, '');
  const serverUrl = serverSupabaseUrl(publicUrl, supabaseKey);
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    if (serverUrl) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(`${publicUrl}/`)) {
        const target = serverUrl + url.slice(publicUrl.length);
        const request = typeof input === 'string' || input instanceof URL ? target : new Request(target, input);
        return fetch(request, { ...init, headers });
      }
    }
    return fetch(input, { ...init, headers });
  };
}

let demoPracticeBalance = 10000;

function emptyDemoQuery() {
  const result = Promise.resolve({ data: [] as unknown[], error: null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: result.then.bind(result),
  };
  return chain;
}

function settleDemoTrade(fnName: string, args?: Record<string, unknown>) {
  const stake = Number(args?._stake);
  const real = fnName === 'place_real_trade';
  if (!Number.isFinite(stake) || stake < 0.35 || stake > 5000) {
    return { data: null, error: { message: 'Stake must be between 0.35 and 5000' } };
  }
  const balance = real ? 0 : demoPracticeBalance;
  if (balance < stake) {
    return { data: null, error: { message: real ? 'Insufficient real balance' : 'Insufficient practice balance' } };
  }
  const contract = String(args?._contract ?? '');
  const barrier = Number(args?._barrier ?? 0);
  const won = args?._force_win === true ? true : Math.random() < 0.9;
  const matching = digitsMatchingOutcome(contract, barrier, won);
  const exitDigit = matching.length ? matching[Math.floor(Math.random() * matching.length)]! : Math.floor(Math.random() * 10);
  const profit = won ? winningProfit(stake) : -Number(stake.toFixed(2));
  const nextBalance = Math.round((balance + profit) * 100) / 100;
  if (!real) demoPracticeBalance = nextBalance;
  return {
    data: { exit_digit: exitDigit, won, payout: stake + winningProfit(stake), profit, balance: nextBalance },
    error: null,
  };
}

function createDemoSupabaseClient() {
  const demoAuth = createDemoAuth();
  return {
    auth: demoAuth,
    from: () => emptyDemoQuery(),
    rpc: async (fnName: string, args?: Record<string, unknown>) => {
      if (fnName === 'has_role') {
        const session = readDemoSession();
        return { data: Boolean(session?.user), error: null };
      }
      if (fnName === 'get_practice_account') return { data: demoPracticeBalance, error: null };
      if (fnName === 'reset_practice_account') {
        demoPracticeBalance = 10000;
        return { data: demoPracticeBalance, error: null };
      }
      if (fnName === 'place_practice_trade' || fnName === 'place_real_trade') return settleDemoTrade(fnName, args);
      return { data: null, error: null };
    },
  } as any;
}

export function createSupabaseClient() {
  const SUPABASE_URL =
    import.meta.env['VITE_SUPABASE_URL'] ||
    import.meta.env['NEXT_PUBLIC_SUPABASE_URL'] ||
    process.env['SUPABASE_URL'] ||
    process.env['NEXT_PUBLIC_SUPABASE_URL'];

  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ||
    import.meta.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ||
    process.env['SUPABASE_PUBLISHABLE_KEY'] ||
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return createDemoSupabaseClient();
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY),
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  });
}

let _supabase: any;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

