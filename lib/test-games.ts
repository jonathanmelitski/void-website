// Test games (scoring practice): real writes, but never part of any event, public list or stats,
// and thrown away with "Discard" (POST /api/games/[id]/discard). Client-safe: no AWS imports.

/** Every test game belongs to this pseudo-event, so it never shows up under a real event. */
export const TEST_EVENT_ID = "__test__"

export function isTestGame(game: { isTest?: boolean; eventId?: string } | null | undefined): boolean {
  return !!game && (game.isTest === true || game.eventId === TEST_EVENT_ID)
}
