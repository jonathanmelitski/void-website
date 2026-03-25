/**
 * Custom Next.js server with WebSocket support for Void Live.
 *
 * WS endpoint:      ws://host/ws/game/:gameId
 * Push endpoint:    POST /internal/push/:gameId  (secured with WS_INTERNAL_SECRET)
 * Health endpoint:  GET  /health
 *
 * Connection lifecycle:
 *   - Client connects → added to per-game subscriber set, initial state pushed immediately
 *   - State updates arrive via POST /internal/push/:gameId from Next.js mutation routes
 *   - Heartbeat pings every 30s; dead connections (no pong) are terminated
 *   - Game reaches FINAL → push endpoint closes all subs with code 1000 (no reconnect)
 *   - Subscriber count drops to 0 → game removed from map
 *   - SIGTERM / SIGINT → graceful close of all connections before exit
 */

import { createServer, IncomingMessage } from "node:http"
import { parse } from "node:url"
import next from "next"
import { WebSocketServer, WebSocket } from "ws"
import { loadEnvConfig } from "@next/env"

// Load .env.local before any AWS SDK calls
loadEnvConfig(process.cwd())

import { getGame } from "./lib/aws/games"
import { listPointsByGame } from "./lib/aws/points"
import { listEventsByGame } from "./lib/aws/point-events"
import { listPlayers } from "./lib/aws/players"
import type { GameItem } from "./lib/aws/games"
import type { PointItem } from "./lib/aws/points"
import type { PointEventItem } from "./lib/aws/point-events"
import type { PlayerItem } from "./lib/aws/players"

// --- Types ---

interface ExtWebSocket extends WebSocket {
  isAlive: boolean
}

export type LiveGameMessage = {
  game: GameItem
  points: PointItem[]
  pointEvents: PointEventItem[]
  players: PlayerItem[]
  ts: number
}

// --- State ---

const dev = process.env.NODE_ENV !== "production"
const port = parseInt(process.env.PORT ?? "3000", 10)

// Per-game subscriber sets
const gameSubscribers = new Map<string, Set<ExtWebSocket>>()

// --- Next.js app ---

const app = next({ dev })
const handle = app.getRequestHandler()

// --- Fetch full game state from DynamoDB ---

async function fetchGameState(gameId: string): Promise<LiveGameMessage | null> {
  const [game, points, pointEvents, players] = await Promise.all([
    getGame(gameId),
    listPointsByGame(gameId),
    listEventsByGame(gameId),
    listPlayers(),
  ])
  if (!game) return null
  return { game, points, pointEvents, players, ts: Date.now() }
}

// --- Send state to a single subscriber ---

function sendState(ws: ExtWebSocket, state: LiveGameMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(state))
  }
}

// --- Main boot ---

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true)
    const { pathname } = parsedUrl

    // GET /health
    if (req.method === "GET" && pathname === "/health") {
      const gameCount = gameSubscribers.size
      const subscriberCount = [...gameSubscribers.values()].reduce((n, s) => n + s.size, 0)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", games: gameCount, subscribers: subscriberCount }))
      return
    }

    // POST /internal/push/:gameId
    const pushMatch = pathname?.match(/^\/internal\/push\/([^/]+)$/)
    if (req.method === "POST" && pushMatch) {
      const secret = req.headers["authorization"]?.replace("Bearer ", "")
      if (secret !== process.env.WS_INTERNAL_SECRET) {
        res.writeHead(401); res.end(); return
      }
      const gameId = pushMatch[1]
      const subs = gameSubscribers.get(gameId)
      if (!subs || subs.size === 0) { res.writeHead(204); res.end(); return }

      let body = ""
      req.on("data", (chunk: Buffer) => { body += chunk.toString() })
      req.on("end", () => {
        const dead: ExtWebSocket[] = []
        subs.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) ws.send(body)
          else dead.push(ws)
        })
        dead.forEach(ws => subs.delete(ws))

        try {
          const msg = JSON.parse(body) as LiveGameMessage
          if (msg.game.status === "FINAL") {
            console.log(`[WS] Game ${gameId} is FINAL, closing all subscribers`)
            subs.forEach(ws => ws.close(1000, "Game over"))
            gameSubscribers.delete(gameId)
          }
        } catch {}

        res.writeHead(204); res.end()
      })
      return
    }

    // All other requests → Next.js
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  // --- WebSocket connection handler ---

  wss.on("connection", (ws: ExtWebSocket, _req: IncomingMessage, gameId: string) => {
    // Register subscriber
    if (!gameSubscribers.has(gameId)) gameSubscribers.set(gameId, new Set())
    gameSubscribers.get(gameId)!.add(ws)
    ws.isAlive = true

    console.log(`[WS] Client connected to game ${gameId} (${gameSubscribers.get(gameId)!.size} total)`)

    // Heartbeat pong handler
    ws.on("pong", () => { ws.isAlive = true })

    // Cleanup on disconnect
    ws.on("close", () => {
      const subs = gameSubscribers.get(gameId)
      if (subs) {
        subs.delete(ws)
        if (subs.size === 0) {
          gameSubscribers.delete(gameId)
          console.log(`[WS] Last subscriber left game ${gameId}`)
        }
      }
    })

    // Push initial state immediately without waiting for next poll cycle
    fetchGameState(gameId)
      .then(state => {
        if (!state) { ws.close(1008, "Game not found"); return }
        sendState(ws, state)
      })
      .catch(err => {
        console.error(`[WS] Failed to fetch initial state for game ${gameId}:`, err)
        ws.close(1011, "Internal error")
      })
  })

  // --- HTTP upgrade → WebSocket handshake ---

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const { pathname } = parse(request.url ?? "")
    const match = pathname?.match(/^\/ws\/game\/([^/]+)$/)

    if (!match) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
      socket.destroy()
      return
    }

    const gameId = match[1]
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit("connection", ws, request, gameId)
    })
  })

  // --- Heartbeat: detect dead connections (network drop, no close frame) ---

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(client => {
      const ws = client as ExtWebSocket
      if (!ws.isAlive) {
        console.log("[WS] Terminating dead connection (no pong)")
        ws.terminate()
        return
      }
      ws.isAlive = false
      ws.ping()
    })
  }, 30_000)

  // --- Graceful shutdown ---

  function shutdown(signal: string) {
    console.log(`[WS] ${signal} received — shutting down gracefully`)
    clearInterval(heartbeatInterval)

    wss.clients.forEach(ws => ws.close(1001, "Server shutting down"))

    server.close(() => {
      console.log("[WS] HTTP server closed")
      process.exit(0)
    })

    // Force exit after 5s if connections don't drain
    setTimeout(() => {
      console.error("[WS] Forced exit after timeout")
      process.exit(1)
    }, 5_000).unref()
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))

  // --- Start listening ---

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (${dev ? "dev" : "prod"})`)
    console.log(`> WebSocket ready on ws://localhost:${port}/ws/game/:gameId`)
  })
})
