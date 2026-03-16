import crypto from "crypto";

/**
 * Signs a payload string using HMAC-SHA256 and returns the hex-encoded signature.
 */
export function signPayload(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  return hmac.digest("hex");
}

/**
 * Verifies a payload signature against an expected signature using
 * timing-safe comparison to prevent timing attacks.
 */
export function verifySignature(
  payload: string,
  secret: string,
  signature: string
): boolean {
  const expected = signPayload(payload, secret);

  if (expected.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex")
  );
}
