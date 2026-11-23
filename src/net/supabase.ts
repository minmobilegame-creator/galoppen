import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Projektets offentlige URL og publishable key. De er beregnet til at ligge i browseren;
 * al adgang styres af Row Level Security og funktionerne i supabase/migrations.
 */
export const SUPABASE_URL = 'https://qzdnixtubrrcgcqeknsf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_j9BwuVKr6dfjgw-S2BZApw_SvM9-tI4';

function tabStorage(): Storage | undefined {
  try {
    // Pr. fane, så to faner i samme browser er to forskellige spillere.
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storage: tabStorage(), persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

/** Log ind som anonym spiller (en gang pr. fane). Returnerer bruger-id. */
export async function ensureSignedIn(): Promise<string> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signIn, error } = await sb.auth.signInAnonymously();
  if (error || !signIn.user) {
    if (error && /anonymous/i.test(error.message)) {
      throw new Error('Anonyme logins er ikke slået til i Supabase-projektet.');
    }
    throw new Error(error?.message ?? 'Kunne ikke logge ind');
  }
  return signIn.user.id;
}

export interface HighscoreRow {
  player_name: string;
  time_ms: number;
  created_at: string;
}

export async function fetchTop10(): Promise<HighscoreRow[]> {
  const { data, error } = await supabase()
    .from('highscores')
    .select('player_name,time_ms,created_at')
    .order('time_ms', { ascending: true })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}
