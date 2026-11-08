import type { CharacterId } from '../types';
import type { ExchangePlan, InputEvent, MatchState, WillChoice } from '../rules';

/** Messages between the two online clients. */
export type NetMsg =
  | { type: 'hello'; role: 'host' | 'guest'; v: number }
  | { type: 'pick'; character: CharacterId; labels?: string[] }
  | { type: 'start'; characters: [CharacterId, CharacterId] }
  | { type: 'plan'; ex: number; plan: ExchangePlan; state: MatchState; lead: number }
  | { type: 'input'; ex: number; ev: InputEvent }
  | { type: 'upto'; ex: number; t: number }
  | { type: 'choice'; ex: number; choice: WillChoice }
  | { type: 'ping' }
  | { type: 'rematch' }
  | { type: 'bye' };

export interface NetLink {
  send(m: NetMsg): void;
  on(f: (m: NetMsg) => void): () => void;
}
