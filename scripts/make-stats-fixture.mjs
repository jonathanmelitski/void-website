// Builds the PII-free stats fixture from a GET-only data dump: structural fields only, names replaced, no timestamps.
// Run: node scripts/make-stats-fixture.mjs <dump.json> scripts/fixtures/stats-games.json
import fs from "node:fs"

const [src, out] = process.argv.slice(2)
const d = JSON.parse(fs.readFileSync(src, "utf8"))
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]))

const players = d.players.map((p, i) => ({ id: p.id, first_name: "Player", last_name: String(i + 1), number: i + 1 }))
const games = d.games.map(({ game, points, pointEvents }) => ({
  game: pick(game, ["id", "opponent", "status", "result", "scoreVoid", "scoreOpponent", "cap"]),
  points: points.map(p => pick(p, ["id", "pointNumber", "lineType", "outcome", "status", "voidScoreBefore", "opponentScoreBefore", "playerIds"])),
  pointEvents: pointEvents.map(e => pick(e, ["id", "pointId", "eventType", "playerId"])),
}))
fs.writeFileSync(out, JSON.stringify({ source: "prod GET dump, names replaced", players, games }) + "\n")
