import { formatTime } from '../game/race';
import type { Multiplayer } from '../net/multiplayer';
import { fetchTop10 } from '../net/supabase';

const NAME_KEY = 'galoppen.name';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignorer */
  }
}

/** Lobbyen: rumkode, navn, klar-knap og liste over spillere. */
export class Lobby {
  private el: HTMLDivElement;
  private busy = false;
  private error = '';

  constructor(
    private mp: Multiplayer,
    private onSolo: () => void,
  ) {
    this.el = document.getElementById('lobby') as HTMLDivElement;
    mp.onChange(() => this.render());
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).id === 'lobbyCode') void this.act('join');
    });
  }

  open(): void {
    this.el.hidden = false;
    this.render();
    (this.el.querySelector('#lobbyName') as HTMLInputElement | null)?.focus();
  }

  close(): void {
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  private nameValue(): string {
    const v = (this.el.querySelector('#lobbyName') as HTMLInputElement | null)?.value.trim() ?? '';
    if (v) saveName(v);
    return v || 'Spiller';
  }

  private async act(kind: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      switch (kind) {
        case 'create':
          await this.mp.createRoom(this.nameValue());
          break;
        case 'join': {
          const code = (this.el.querySelector('#lobbyCode') as HTMLInputElement).value;
          if (!/^[A-Za-z2-9]{4}$/.test(code.trim())) throw new Error('Rumkoden er 4 tegn');
          await this.mp.joinRoom(code, this.nameValue());
          break;
        }
        case 'ready':
          await this.mp.setReady(!this.mp.me?.ready);
          break;
        case 'start':
          await this.mp.start();
          break;
        case 'leave':
          await this.mp.leave();
          break;
        case 'close':
          this.close();
          break;
        case 'solo':
          if (this.mp.inRoom) await this.mp.leave();
          this.close();
          this.onSolo();
          break;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (btn) void this.act(btn.dataset.act!);
  }

  render(): void {
    if (this.el.hidden) return;
    const mp = this.mp;
    const room = mp.room;
    const card = this.el.querySelector('.lobby-body') as HTMLDivElement;
    const dis = this.busy ? 'disabled' : '';
    let html: string;

    if (!room) {
      html = `
        <h2>Spil med venner</h2>
        <p class="muted">Op til 4 spillere. Tomme pladser bliver computerheste.</p>
        <label class="field">Dit navn<input id="lobbyName" maxlength="16" autocomplete="nickname" value="${esc(loadName())}" placeholder="Fx Anna" /></label>
        <div class="row">
          <button class="btn primary" data-act="create" ${dis}>Opret rum</button>
        </div>
        <div class="divider"><span>eller deltag</span></div>
        <div class="row">
          <input id="lobbyCode" class="code-input" maxlength="4" placeholder="KODE" autocapitalize="characters" />
          <button class="btn" data-act="join" ${dis}>Deltag</button>
        </div>
        <button class="link" data-act="solo">Spil alene mod computeren</button>`;
    } else if (room.status === 'lobby') {
      const me = mp.me;
      const humans = mp.players.filter((p) => !p.is_ai);
      const allReady = humans.length > 0 && humans.every((p) => p.ready);
      const seats = [1, 2, 3, 4]
        .map((s) => {
          const p = mp.players.find((x) => x.seat === s);
          if (!p) return `<li class="seat empty"><span>Plads ${s}</span><em>Computer</em></li>`;
          const tag = p.user_id === room.host_id ? ' 👑' : '';
          return `<li class="seat${p.ready ? ' ready' : ''}${p.user_id === mp.userId ? ' me' : ''}">
            <span>${esc(p.name)}${tag}</span><em>${p.ready ? 'Klar ✓' : 'Venter …'}</em></li>`;
        })
        .join('');
      html = `
        <h2>Rum <span class="room-code">${room.code}</span></h2>
        <p class="muted">Del koden med dine venner. Værten starter, når alle er klar.</p>
        <ol class="seats">${seats}</ol>
        <div class="row">
          <button class="btn ${me?.ready ? '' : 'primary'}" data-act="ready" ${dis}>${me?.ready ? 'Ikke klar' : 'Klar'}</button>
          ${mp.isHost ? `<button class="btn primary" data-act="start" ${dis || (allReady ? '' : 'disabled')}>Start løbet</button>` : ''}
          <button class="btn" data-act="leave" ${dis}>Forlad</button>
        </div>`;
    } else {
      html = `<h2>Rum ${room.code}</h2><p class="muted">Løbet er i gang …</p>`;
    }
    if (this.error) html += `<p class="error" role="alert">${esc(this.error)}</p>`;
    // Bevar indtastning ved gen-tegning.
    const code = (this.el.querySelector('#lobbyCode') as HTMLInputElement | null)?.value ?? '';
    const name = (this.el.querySelector('#lobbyName') as HTMLInputElement | null)?.value;
    card.innerHTML = html;
    const codeEl = this.el.querySelector('#lobbyCode') as HTMLInputElement | null;
    if (codeEl) codeEl.value = code;
    const nameEl = this.el.querySelector('#lobbyName') as HTMLInputElement | null;
    if (nameEl && name !== undefined) nameEl.value = name;
  }
}

/** Global top 10 over de hurtigste vindertider. */
export async function renderTop10(list: HTMLOListElement): Promise<void> {
  try {
    const rows = await fetchTop10();
    list.innerHTML = rows.length
      ? rows.map((r) => `<li><span>${esc(r.player_name)}</span><b>${formatTime(r.time_ms)}</b></li>`).join('')
      : '<li class="muted">Ingen tider endnu – bliv den første!</li>';
  } catch {
    list.innerHTML = '<li class="muted">Kunne ikke hente top 10.</li>';
  }
}
