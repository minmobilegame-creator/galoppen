import type { RealtimeChannel } from '@supabase/supabase-js';
import { aiDelay, aiThrow, TARGET_POINTS, type Race, type Racer } from '../game/race';
import { ensureSignedIn, supabase } from './supabase';

export interface RoomRow {
  id: string;
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  host_id: string;
  target: number;
  started_at: string | null;
  winner_seat: number | null;
  winner_name: string | null;
  finished_ms: number | null;
}

export interface PlayerRow {
  id: string;
  room_id: string;
  user_id: string | null;
  seat: number;
  name: string;
  is_ai: boolean;
  ready: boolean;
  score: number;
}

/** AI-færdighed pr. plads (værten slår for computerspillerne). */
const AI_SKILL: Record<number, number> = { 1: 0.5, 2: 0.55, 3: 0.5, 4: 0.45 };

/**
 * Et online rum. Hver klient spiller på sit eget bræt; kun point går over nettet.
 * Serveren (record_score) validerer alle point og afgør vinderen.
 */
export class Multiplayer {
  room: RoomRow | null = null;
  players: PlayerRow[] = [];
  userId = '';
  /** Serverens ur minus vores (ms), så alle viser samme løbstid. */
  private clockOffset = 0;
  private channel: RealtimeChannel | null = null;
  private aiNext = new Map<number, number>();
  private aiBusy = false;
  private listeners = new Set<() => void>();
  private refreshTimer: number | undefined;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get me(): PlayerRow | undefined {
    return this.players.find((p) => p.user_id === this.userId);
  }

  get isHost(): boolean {
    return !!this.room && this.room.host_id === this.userId;
  }

  get inRoom(): boolean {
    return !!this.room;
  }

  async connect(): Promise<void> {
    this.userId = await ensureSignedIn();
    const t0 = Date.now();
    const { data } = await supabase().rpc('server_time');
    if (data) this.clockOffset = new Date(data as string).getTime() - (t0 + Date.now()) / 2;
  }

  async createRoom(name: string): Promise<string> {
    await this.connect();
    const { data, error } = await supabase().rpc('create_room', { p_name: name });
    if (error) throw new Error(error.message);
    await this.enter(data as string);
    return data as string;
  }

  async joinRoom(code: string, name: string): Promise<void> {
    await this.connect();
    const { error } = await supabase().rpc('join_room', { p_code: code, p_name: name });
    if (error) throw new Error(error.message);
    await this.enter(code.toUpperCase().trim());
  }

  private async enter(code: string): Promise<void> {
    const { data, error } = await supabase().from('rooms').select('*').eq('code', code).single();
    if (error || !data) throw new Error(error?.message ?? 'Rummet findes ikke');
    this.room = data as RoomRow;
    await this.refresh();
    this.subscribe();
  }

  /** Lyt på ændringer i rummet og dets spillere (Supabase Realtime). */
  private subscribe(): void {
    if (!this.room) return;
    const id = this.room.id;
    this.channel?.unsubscribe();
    this.channel = supabase()
      .channel(`room-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${id}` }, () =>
        this.scheduleRefresh(),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, (msg) => {
        this.room = { ...(this.room as RoomRow), ...(msg.new as RoomRow) };
        this.scheduleRefresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.scheduleRefresh();
      });
  }

  /** Saml flere hurtige ændringer til én genindlæsning. */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), 60);
  }

  async refresh(): Promise<void> {
    if (!this.room) return;
    const sb = supabase();
    const [room, players] = await Promise.all([
      sb.from('rooms').select('*').eq('id', this.room.id).single(),
      sb.from('players').select('*').eq('room_id', this.room.id).order('seat'),
    ]);
    if (room.data) this.room = room.data as RoomRow;
    if (players.data) this.players = players.data as PlayerRow[];
    this.emit();
  }

  async setReady(ready: boolean): Promise<void> {
    const me = this.me;
    if (!me) return;
    // RLS tillader kun at opdatere sin egen række (og kun navn/klar).
    const { error } = await supabase().from('players').update({ ready }).eq('id', me.id);
    if (error) throw new Error(error.message);
    await this.refresh();
  }

  async start(): Promise<void> {
    if (!this.room) return;
    const { error } = await supabase().rpc('start_game', { p_room: this.room.id });
    if (error) throw new Error(error.message);
    this.aiNext.clear();
    await this.refresh();
  }

  async reset(): Promise<void> {
    if (!this.room) return;
    const { error } = await supabase().rpc('reset_room', { p_room: this.room.id });
    if (error) throw new Error(error.message);
    await this.refresh();
  }

  async leave(): Promise<void> {
    const me = this.me;
    this.channel?.unsubscribe();
    this.channel = null;
    if (me) await supabase().from('players').delete().eq('id', me.id);
    this.room = null;
    this.players = [];
    this.emit();
  }

  /** Send egne point til serveren, som validerer dem. */
  async reportScore(points: number): Promise<void> {
    if (this.room?.status !== 'playing') return;
    const { error } = await supabase().rpc('record_score', { p_room: this.room.id, p_points: points });
    if (error) console.warn('Point afvist:', error.message);
  }

  /** Løbstid i ms ud fra serverens starttid. */
  elapsed(): number {
    const r = this.room;
    if (!r?.started_at) return 0;
    if (r.status === 'finished' && r.finished_ms != null) return r.finished_ms;
    return Math.max(0, Date.now() + this.clockOffset - new Date(r.started_at).getTime());
  }

  /** Værten "kaster" for computerspillerne. */
  tickAI(): void {
    if (!this.isHost || this.room?.status !== 'playing' || this.aiBusy) return;
    const t = this.elapsed();
    for (const p of this.players) {
      if (!p.is_ai) continue;
      if (!this.aiNext.has(p.seat)) this.aiNext.set(p.seat, t + aiDelay(Math.random));
      if (t < this.aiNext.get(p.seat)!) continue;
      this.aiNext.set(p.seat, t + aiDelay(Math.random));
      const pts = aiThrow(AI_SKILL[p.seat] ?? 0.5, Math.random);
      if (pts === 0) continue;
      this.aiBusy = true;
      void supabase()
        .rpc('record_score', { p_room: this.room.id, p_points: pts, p_seat: p.seat })
        .then(({ error }) => {
          if (error) console.warn('AI-point afvist:', error.message);
        })
        .then(() => {
          this.aiBusy = false;
        });
      break;
    }
  }

  /** Spillets tilstand i samme form som det lokale væddeløb (til scoretavlen). Din bane øverst. */
  toRace(): Race {
    const ordered = [...this.players].sort((a, b) => {
      const am = a.user_id === this.userId ? 0 : 1;
      const bm = b.user_id === this.userId ? 0 : 1;
      return am - bm || a.seat - b.seat;
    });
    const racers: Racer[] = ordered.map((p) => ({
      id: p.seat,
      name: p.user_id === this.userId ? `${p.name} (dig)` : p.is_ai ? `${p.name} 🤖` : p.name,
      human: p.user_id === this.userId,
      score: p.score,
      nextThrowAt: Infinity,
      skill: 0,
    }));
    const status = this.room?.status === 'playing' ? 'running' : this.room?.status === 'finished' ? 'finished' : 'ready';
    const winner = racers.find((r) => r.id === this.room?.winner_seat) ?? null;
    return { racers, status, elapsed: this.elapsed(), winner, target: this.room?.target ?? TARGET_POINTS };
  }
}
