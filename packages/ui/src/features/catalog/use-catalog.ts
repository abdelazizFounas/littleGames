import type { GameSummary } from '@littlegames/net';
import { useAsyncData, type AsyncData } from '../../lib/use-async-data';
import { useSession } from '../../session/use-session';

/** Loads the playable games for the signed-in player. */
export function useCatalog(): AsyncData<GameSummary[]> {
  const { loadCatalog } = useSession();
  return useAsyncData(loadCatalog, 'Could not load the game list.');
}
