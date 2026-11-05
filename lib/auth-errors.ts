// Plain-language copy for Cognito errors on the sign-in screens. Routes return { error, code? };
// raw AWS SDK messages never reach the user. Pure (no SDK imports) so client pages can share the strings.

export type AuthAction = "login" | "register" | "confirm" | "resend" | "reset" | "confirm-reset" | "challenge"

/** Machine-readable hints the client acts on (e.g. send an unconfirmed user to the confirm screen). */
export type AuthErrorCode = "UNCONFIRMED" | "EXISTS" | "ALREADY_CONFIRMED" | "SESSION_EXPIRED" | "RESET_REQUIRED"

export const AUTH_NETWORK_ERROR = "Couldn't reach Void Live. Check your connection and try again."
export const AUTH_GENERIC_ERROR = "Something went wrong. Try again in a moment."

/** Shown under new-password fields. Matches the Cognito user pool password policy. */
export const PASSWORD_RULES = "At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol."

const WRONG_CODE = "That code isn't right. Check the email and try again."
const TOO_MANY = "Too many attempts. Wait a few minutes and try again."

// InvalidPasswordException messages name the rule that failed; turn that into one plain sentence.
function passwordPolicyMessage(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes("long enough") || m.includes("length")) return "Use at least 8 characters."
  if (m.includes("uppercase")) return "Add an uppercase letter to your password."
  if (m.includes("lowercase")) return "Add a lowercase letter to your password."
  if (m.includes("numeric") || m.includes("number")) return "Add a number to your password."
  if (m.includes("symbol")) return "Add a symbol (like ! or #) to your password."
  return `Choose a stronger password. ${PASSWORD_RULES}`
}

export function authError(err: unknown, action: AuthAction): { error: string; code?: AuthErrorCode } {
  const name = err instanceof Error ? err.name : ""
  const message = err instanceof Error ? err.message : ""

  switch (name) {
    case "NotAuthorizedException":
      if (action === "login") return { error: "That email and password don't match." }
      if (action === "challenge") return { error: "This sign-in timed out. Sign in again.", code: "SESSION_EXPIRED" }
      if (action === "confirm" && /confirmed/i.test(message)) {
        return { error: "This account is already confirmed. Sign in instead.", code: "ALREADY_CONFIRMED" }
      }
      return { error: AUTH_GENERIC_ERROR }
    case "UserNotFoundException":
      // Never reveal whether an account exists
      if (action === "login") return { error: "That email and password don't match." }
      if (action === "confirm" || action === "confirm-reset") return { error: WRONG_CODE }
      if (action === "resend") return { error: "We couldn't send a code to that email. Check it and try again." }
      return { error: AUTH_GENERIC_ERROR }
    case "UserNotConfirmedException":
      return { error: "Confirm your email to finish setting up your account.", code: "UNCONFIRMED" }
    case "PasswordResetRequiredException":
      return { error: "You need to reset your password before signing in.", code: "RESET_REQUIRED" }
    case "UsernameExistsException":
      return { error: "An account with this email already exists. Sign in instead.", code: "EXISTS" }
    case "InvalidPasswordException":
      return { error: passwordPolicyMessage(message) }
    case "CodeMismatchException":
      return { error: WRONG_CODE }
    case "ExpiredCodeException":
      return { error: "That code has expired. Request a new one." }
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return { error: TOO_MANY }
    case "CodeDeliveryFailureException":
      return { error: "We couldn't send the code. Check the email address and try again." }
    case "InvalidParameterException":
      if (action === "register") return { error: "Check your email address and password, then try again." }
      if (/password/i.test(message) && /policy|conform|length|satisfy/i.test(message)) return { error: passwordPolicyMessage(message) }
      return { error: AUTH_GENERIC_ERROR }
    default:
      return { error: AUTH_GENERIC_ERROR }
  }
}
