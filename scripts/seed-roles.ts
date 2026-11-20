// One-off migration from Cognito groups to roles. DRY RUN unless --apply.
//   npx tsx scripts/seed-roles.ts            # print the plan
//   npx tsx scripts/seed-roles.ts --apply    # write it
//
// Creates (or reuses, by name) Admin, Coach and Member roles matching today's access, then assigns:
//   Cognito ADMIN → Admin role   COACH → Coach   everyone else → Member   (Owner is the separate OWNER group)
// Existing assignments are kept: roles are only added. Safe to re-run. Cognito groups are not touched.
// Uses .env.local, so it targets whatever that points at (prod).
process.loadEnvFile(".env.local")

type Permission = import("../lib/permissions/catalog").Permission

const APPLY = process.argv.includes("--apply")
const ACTOR = "seed-roles"

const SEED: { name: string; color: string; group: string | null; permissions: (all: readonly Permission[]) => Permission[] }[] = [
  // Everything except administrator: owners already have everything; this is the assignable equivalent.
  { name: "Admin", color: "red", group: "ADMIN", permissions: (all) => all.filter((p) => p !== "administrator") },
  {
    name: "Coach",
    color: "blue",
    group: "COACH",
    // Exactly what COACH_OR_ADMIN routes allowed before roles.
    permissions: () => [
      "events.manage", "events.viewPrivate", "games.score", "players.manage",
      "film.manage", "playerLinks.manage", "photos.upload", "newsletters.edit",
    ],
  },
  // Any signed-in user could upload photos (Manage → Photos) before roles.
  { name: "Member", color: "slate", group: null, permissions: () => ["photos.upload"] },
]

async function main() {
  const { ALL_PERMISSIONS } = await import("../lib/permissions/catalog")
  const { listRoles, createRole } = await import("../lib/aws/roles")
  const { listUserRoles, setUserRoles } = await import("../lib/aws/user-roles")
  const { cognitoClient } = await import("../lib/aws/cognito")
  const { ListUsersCommand, ListUsersInGroupCommand } = await import("@aws-sdk/client-cognito-identity-provider")
  const poolId = process.env.COGNITO_USER_POOL_ID!

  const allUsers: { username: string; sub: string; email: string }[] = []
  let PaginationToken: string | undefined
  do {
    const res = await cognitoClient.send(new ListUsersCommand({ UserPoolId: poolId, PaginationToken }))
    for (const u of res.Users ?? []) {
      const attr = (n: string) => u.Attributes?.find((a) => a.Name === n)?.Value ?? ""
      allUsers.push({ username: u.Username ?? "", sub: attr("sub"), email: attr("email") })
    }
    PaginationToken = res.PaginationToken
  } while (PaginationToken)

  const inGroup = async (group: string) => {
    const names = new Set<string>()
    let NextToken: string | undefined
    do {
      const res = await cognitoClient.send(new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: group, NextToken }))
      for (const u of res.Users ?? []) if (u.Username) names.add(u.Username)
      NextToken = res.NextToken
    } while (NextToken)
    return names
  }
  const [admins, coaches] = await Promise.all([inGroup("ADMIN"), inGroup("COACH")])

  // Roles: reuse by name (case-insensitive) so re-runs don't duplicate.
  // A dry run can go before the tables exist: treat a missing table as empty.
  const missingOk = <T,>(p: Promise<T[]>) =>
    p.catch((err) => {
      if (!APPLY && err?.name === "ResourceNotFoundException") return [] as T[]
      throw err
    })
  const existing = await missingOk(listRoles())
  let position = existing.reduce((m, r) => Math.max(m, r.position), 0)
  const roleIdByName = new Map<string, string>()
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"}: ${allUsers.length} users, ${admins.size} in ADMIN, ${coaches.size} in COACH\n`)
  console.log("Roles")
  for (const seed of SEED) {
    const perms = seed.permissions(ALL_PERMISSIONS)
    const found = existing.find((r) => r.name.toLowerCase() === seed.name.toLowerCase())
    if (found) {
      roleIdByName.set(seed.name, found.id)
      const same = [...found.permissions].sort().join() === [...perms].sort().join()
      console.log(`  = ${seed.name} exists (${found.id})${same ? "" : `  ! permissions differ from seed, left as is: ${found.permissions.join(", ")}`}`)
      continue
    }
    console.log(`  + ${seed.name}: ${perms.join(", ") || "(none)"}`)
    if (APPLY) {
      const role = await createRole({ name: seed.name, color: seed.color, permissions: perms, position: ++position }, ACTOR)
      roleIdByName.set(seed.name, role.id)
    } else {
      roleIdByName.set(seed.name, `<new ${seed.name}>`)
    }
  }

  const current = new Map((await missingOk(listUserRoles())).map((a) => [a.sub, a.roleIds ?? []]))
  console.log("\nAssignments")
  let changes = 0
  for (const u of allUsers.sort((a, b) => a.email.localeCompare(b.email))) {
    if (!u.sub) { console.log(`  ? ${u.username}: no sub, skipped`); continue }
    const seedName = admins.has(u.username) ? "Admin" : coaches.has(u.username) ? "Coach" : "Member"
    const roleId = roleIdByName.get(seedName)!
    const have = current.get(u.sub) ?? []
    const owner = admins.has(u.username) ? " (was ADMIN)" : ""
    if (have.includes(roleId)) { console.log(`  = ${u.email || u.username}${owner}: already ${seedName}`); continue }
    changes++
    console.log(`  + ${u.email || u.username}${owner}: ${seedName}`)
    if (APPLY) await setUserRoles(u.sub, [...have, roleId], ACTOR)
  }

  console.log(`\n${changes} assignment${changes === 1 ? "" : "s"} ${APPLY ? "written" : "to write"}.${APPLY ? "" : " Re-run with --apply to write."}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exit(1)
})
