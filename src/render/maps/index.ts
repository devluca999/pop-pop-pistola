// Duel locations as data. Add a map: write a MapDef file and list it here.
import type { FakeKind, MapId } from '../../types';
import type { MapDef } from './types';
import { NOON } from './noon';
import { MIDNIGHT } from './midnight';
import { TRAIN } from './train';
import { MESA } from './mesa';
import { SALOON } from './saloon';

export type { MapDef } from './types';

export interface MapInfo { id: MapId; name: string; fakes: FakeKind[] }

const DEFS: MapDef[] = [NOON, MIDNIGHT, TRAIN, MESA, SALOON];

/** Every map, in menu order: noon, midnight, train, mesa, saloon. */
export const MAPS: MapInfo[] = DEFS.map((d) => ({ id: d.id, name: d.name, fakes: [...d.fakes] }));

export function mapDef(id: MapId): MapDef {
  return DEFS.find((d) => d.id === id) ?? NOON;
}
