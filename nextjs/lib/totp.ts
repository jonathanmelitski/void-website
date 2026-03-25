import { verify } from "otplib"

export async function verifyTOTP(code: string): Promise<boolean> {
  const secret = process.env.TOTP_SECRET
  if (!secret) throw new Error("TOTP_SECRET is not configured")
  const result = await verify({ token: code, secret })
  return result.valid
}
