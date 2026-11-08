import type { NetLink, NetMsg } from './types';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function onlineConfigured(): boolean {
  return !!URL && !!KEY;
}

const WORDS = ['DUSK', 'MESA', 'COLT', 'SAGE', 'DUST', 'BELL', 'SPUR', 'MULE', 'CROW', 'TUMB', 'NOON', 'GULCH'];
export function makeRoomCode(): string {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${w}-${String(10 + Math.floor(Math.random() * 90))}`;
}
export function normalizeCode(s: string): string {
  const t = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = t.match(/^([A-Z]+)(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : t;
}

export type RoomStatus = 'connecting' | 'waiting' | 'ready' | 'full' | 'lost' | 'error';

export interface Room extends NetLink {
  code: string;
  role: 'host' | 'guest';
  status: RoomStatus;
  onStatus(f: (s: RoomStatus) => void): () => void;
  leave(): void;
}

/**
 * One duel room = one Supabase Realtime broadcast channel. No database tables.
 * Presence tells us when the rival is here; messages are tiny JSON broadcasts.
 */
export async function openRoom(code: string, role: 'host' | 'guest'): Promise<Room> {
  if (!onlineConfigured()) throw new Error('Online unavailable: no server configured');
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(URL!, KEY!, { realtime: { params: { eventsPerSecond: 40 } }, auth: { persistSession: false } });
  const me = Math.random().toString(36).slice(2);
  const ch = client.channel(`pop-pop-pistola:${code}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me } },
  });
  const msgL: ((m: NetMsg) => void)[] = [];
  const stL: ((s: RoomStatus) => void)[] = [];
  let joinedAt = Date.now();

  const room: Room = {
    code,
    role,
    status: 'connecting',
    send(m) {
      void ch.send({ type: 'broadcast', event: 'm', payload: m }).catch(() => {});
    },
    on(f) { msgL.push(f); return () => { const i = msgL.indexOf(f); if (i >= 0) msgL.splice(i, 1); }; },
    onStatus(f) { stL.push(f); return () => { const i = stL.indexOf(f); if (i >= 0) stL.splice(i, 1); }; },
    leave() {
      try { room.send({ type: 'bye' }); } catch { /* ignore */ }
      void ch.unsubscribe();
      void client.removeAllChannels();
    },
  };
  const setStatus = (s: RoomStatus) => {
    if (room.status === s) return;
    room.status = s;
    for (const f of stL) f(s);
  };

  ch.on('broadcast', { event: 'm' }, ({ payload }) => {
    for (const f of [...msgL]) f(payload as NetMsg);
  });
  ch.on('presence', { event: 'sync' }, () => {
    const st = ch.presenceState() as Record<string, { role?: string; at?: number }[]>;
    const people = Object.entries(st).map(([k, v]) => ({ k, role: v[0]?.role, at: v[0]?.at ?? 0 }));
    const others = people.filter((p) => p.k !== me);
    if (role === 'guest' && others.filter((p) => p.role === 'guest').some((p) => p.at < joinedAt)) { setStatus('full'); return; }
    const rival = others.find((p) => p.role !== role);
    if (rival) setStatus('ready');
    else if (room.status === 'ready') setStatus('lost');
    else setStatus('waiting');
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Could not reach the server')), 10000);
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        joinedAt = Date.now();
        await ch.track({ role, at: joinedAt });
        setStatus('waiting');
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        setStatus('error');
        reject(new Error('Could not reach the server'));
      } else if (status === 'CLOSED') {
        setStatus('lost');
      }
    });
  });
  return room;
}
