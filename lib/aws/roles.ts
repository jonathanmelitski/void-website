import { randomUUID } from "crypto"
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { scanAll } from "./paginate"
import { sanitizePermissions, type Permission } from "@/lib/permissions/catalog"

// DynamoDB table: VoidRoles. PK: id
const TABLE = () => process.env.DYNAMO_ROLES_TABLE!

export type RoleItem = {
  id: string
  name: string
  /** Swatch key from the role editor palette. */
  color?: string
  permissions: Permission[]
  /** Display order, ascending. */
  position: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}

// Unknown permission keys (removed from the catalog, or written outside the app) never take effect.
function clean(item: Record<string, unknown> | undefined): RoleItem | null {
  if (!item) return null
  return { ...(item as RoleItem), permissions: sanitizePermissions(item.permissions) }
}

export async function listRoles(): Promise<RoleItem[]> {
  const items = await scanAll<Record<string, unknown>>({ TableName: TABLE() })
  return items
    .map((i) => clean(i)!)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

export async function getRole(id: string): Promise<RoleItem | null> {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE(), Key: { id } }))
  return clean(result.Item)
}

export async function createRole(
  fields: Pick<RoleItem, "name" | "permissions" | "position"> & Partial<Pick<RoleItem, "color" | "id">>,
  actor: string
): Promise<RoleItem> {
  const now = new Date().toISOString()
  const item: RoleItem = {
    id: fields.id ?? randomUUID(),
    name: fields.name,
    ...(fields.color ? { color: fields.color } : {}),
    permissions: sanitizePermissions(fields.permissions),
    position: fields.position,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  }
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item, ConditionExpression: "attribute_not_exists(id)" }))
  return item
}

type Removable<T> = { [K in keyof T]?: T[K] | null }

export async function updateRole(
  id: string,
  fields: Removable<Pick<RoleItem, "name" | "color" | "permissions" | "position">>,
  actor: string
): Promise<void> {
  const withMeta: Record<string, unknown> = {
    ...fields,
    ...(fields.permissions ? { permissions: sanitizePermissions(fields.permissions) } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  }
  const entries = Object.entries(withMeta).filter(([, v]) => v !== undefined)
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]))
  const sets = entries.flatMap(([, v], i) => (v === null ? [] : [`#f${i} = :v${i}`]))
  const removes = entries.flatMap(([, v], i) => (v === null ? [`#f${i}`] : []))
  const values = Object.fromEntries(entries.flatMap(([, v], i) => (v === null ? [] : [[`:v${i}`, v]])))
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: [sets.length ? `SET ${sets.join(", ")}` : "", removes.length ? `REMOVE ${removes.join(", ")}` : ""].filter(Boolean).join(" "),
      ConditionExpression: "attribute_exists(id)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  )
}

export async function deleteRole(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
