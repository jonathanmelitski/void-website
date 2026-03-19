import { NextRequest, NextResponse } from "next/server"
import { verifyToken, cognitoClient } from "@/lib/aws/cognito"
import {
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider"

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    if (!(payload["cognito:groups"] ?? []).includes("ADMIN")) return null
    return payload
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const poolId = process.env.COGNITO_USER_POOL_ID!
    const result = await cognitoClient.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))
    const tmpl = result.UserPool?.AdminCreateUserConfig?.InviteMessageTemplate

    return NextResponse.json({
      subject: tmpl?.EmailSubject ?? "",
      bodyHtml: tmpl?.EmailMessage ?? "",
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { subject, bodyHtml } = await request.json()
  if (!subject || !bodyHtml) {
    return NextResponse.json({ error: "subject and bodyHtml are required" }, { status: 400 })
  }

  // Cognito requires both {username} and {####} in the template
  if (!bodyHtml.includes("{username}") || !bodyHtml.includes("{####}")) {
    return NextResponse.json(
      { error: "Template body must include {username} and {####} placeholders" },
      { status: 400 }
    )
  }

  try {
    const poolId = process.env.COGNITO_USER_POOL_ID!

    // Read current pool config to avoid clobbering other fields (email sender, etc.)
    const described = await cognitoClient.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))
    const pool = described.UserPool!
    const existingAdmin = pool.AdminCreateUserConfig ?? {}

    await cognitoClient.send(
      new UpdateUserPoolCommand({
        UserPoolId: poolId,
        EmailConfiguration: pool.EmailConfiguration,
        AdminCreateUserConfig: {
          ...existingAdmin,
          InviteMessageTemplate: {
            ...existingAdmin.InviteMessageTemplate,
            EmailSubject: subject,
            EmailMessage: bodyHtml,
          },
        },
      })
    )

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
