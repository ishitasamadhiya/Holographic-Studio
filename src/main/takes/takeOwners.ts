import type { TakeStore } from './takeStore';

/**
 * Remembers which page began each take, by the id of its web contents.
 *
 * Take ids only live in the page's memory. When the page reloads, crashes or closes, the
 * takes it was still recording can never be finished or discarded by anyone, so the main
 * process has to know whose they were in order to clean them up.
 */
export class TakeOwners {
  private readonly ownerByTake = new Map<string, number>();

  claim(takeId: string, ownerId: number): void {
    this.ownerByTake.set(takeId, ownerId);
  }

  release(takeId: string): void {
    this.ownerByTake.delete(takeId);
  }

  isOwnedBy(takeId: string, ownerId: number): boolean {
    return this.ownerByTake.get(takeId) === ownerId;
  }

  takesOf(ownerId: number): string[] {
    return [...this.ownerByTake].filter(([, owner]) => owner === ownerId).map(([takeId]) => takeId);
  }
}

/**
 * Call when the page with this id is gone. Lets go of all its takes and deletes the ones
 * it never finished (closing their files). Finished takes are complete on disk and stay
 * until the usual clean-up; an export of one that is still running is left to complete,
 * because it is the only way that performance can still reach the user's folder.
 */
export async function abandonTakesOf(
  ownerId: number,
  owners: TakeOwners,
  takes: TakeStore,
): Promise<void> {
  const takeIds = owners.takesOf(ownerId);
  for (const takeId of takeIds) owners.release(takeId);
  const unfinished = new Set(takes.unfinishedTakeIds());
  await Promise.all(
    takeIds.filter((takeId) => unfinished.has(takeId)).map((takeId) => takes.discard(takeId)),
  );
}
