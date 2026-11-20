import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { scanAll } from "./paginate"

// DynamoDB table: VoidUserRoles. PK: sub (Cognito user sub)
const TABLE = () => process.env.DYNAMO_USER_ROLES_TABLE!

export type UserRolesItem = {
  sub: string
  roleIds: string[]
  updatedAt: string
  updatedBy: string
}

export async function getUserRoles(sub: string): Promise<string[]> {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE(), Key: { sub } }))
  const ids = (result.Item as UserRolesItem | undefined)?.roleIds
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []
}

export async function listUserRoles(): Promise<UserRolesItem[]> {
  return scanAll<UserRolesItem>({ TableName: TABLE() })
}

export async function setUserRoles(sub: string, roleIds: string[], actor: string): Promise<void> {
  const unique = [...new Set(roleIds)]
  if (unique.length === 0) {
    await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { sub } }))
    return
  }
  const item: UserRolesItem = { sub, roleIds: unique, updatedAt: new Date().toISOString(), updatedBy: actor }
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function deleteUserRoles(sub: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { sub } }))
}

/** Strip a deleted role from everyone who held it. Returns the subs that changed. */
export async function removeRoleFromAll(roleId: string, actor: string): Promise<string[]> {
  const holders = (await listUserRoles()).filter((u) => u.roleIds?.includes(roleId))
  await Promise.all(holders.map((u) => setUserRoles(u.sub, u.roleIds.filter((r) => r !== roleId), actor)))
  return holders.map((u) => u.sub)
}
