// Guards against permission drift. Run: npx tsx scripts/permissions.check.ts
//  1. Only lib/auth and lib/permissions read Cognito groups; everything else uses permissions.
//  2. Every mutating API route handler calls requireUser (or is on the reviewed allowlist).
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(__dirname, "..")
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "scripts", "amplify"])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

// Mutating routes that intentionally don't use requireUser. Each has its own auth; review before adding.
const PUBLIC_MUTATIONS: Record<string, string> = {
  "app/api/auth/login/route.ts": "sign-in",
  "app/api/auth/logout/route.ts": "sign-out",
  "app/api/auth/refresh/route.ts": "token refresh",
  "app/api/auth/challenge/route.ts": "sign-in challenge (new password / MFA)",
  "app/api/auth/register/route.ts": "self sign-up",
  "app/api/auth/confirm/route.ts": "sign-up confirmation code",
  "app/api/auth/reset-password/route.ts": "forgot-password request",
  "app/api/auth/confirm-reset/route.ts": "forgot-password code",
  "app/api/subscribe/[name]/route.ts": "public newsletter sign-up",
}

const problems: string[] = []
const files = walk(ROOT)

for (const file of files) {
  const rel = relative(ROOT, file)
  const src = readFileSync(file, "utf8")
  if (src.includes("cognito:groups") && !rel.startsWith("lib/auth/") && !rel.startsWith("lib/permissions/") && rel !== "lib/aws/cognito.ts" && !rel.startsWith("ws/")) {
    problems.push(`${rel}: reads cognito:groups; use requireUser({ permission }) / can() instead`)
  }
  if (/^app\/api\/.*\/route\.ts$/.test(rel)) {
    const mutating = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(src)
    if (mutating && !src.includes("requireUser(") && !(rel in PUBLIC_MUTATIONS)) {
      problems.push(`${rel}: mutating handler without requireUser (add it, or allowlist with a reason)`)
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"))
  process.exit(1)
}
console.log(`✓ permissions: ${files.length} files clean`)
