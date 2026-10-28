// Cognito usernames are UUIDs for email sign-ins — never show those as a person's name
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A displayable author name, or "" when all we have is an opaque id */
export function authorLabel(name: string | undefined): string {
  if (!name || UUID_RE.test(name)) return ""
  return name
}
