import { randomBytes, createHash, createPublicKey, verify } from "node:crypto";
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const random = () => randomBytes(32).toString("base64url");
export function createMicrosoftAuth(
  { tenantId, clientId, clientSecret, origin } = {},
  fetchImpl = fetch,
) {
  const configured = Boolean(tenantId && clientId && clientSecret && origin);
  if (
    configured &&
    (!guid.test(tenantId) ||
      !guid.test(clientId) ||
      !/^https:\/\//.test(origin))
  )
    throw Error(
      "Microsoft authentication requires valid tenant/client GUIDs and an HTTPS APP_ORIGIN.",
    );
  const authority = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const redirectUri = origin
    ? new URL("/auth/microsoft/callback", origin).href
    : null;
  const pending = new Map();
  let keys = null,
    keysAt = 0;
  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("Identity provider request failed.");
    return response.json();
  }
  async function verifyToken(token, nonce) {
    if (typeof token !== "string" || token.length > 32000)
      throw Error("Invalid identity token.");
    const parts = token.split(".");
    if (parts.length !== 3) throw Error("Invalid identity token.");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (header.alg !== "RS256" || typeof header.kid !== "string")
      throw Error("Unsupported identity signature.");
    const keyUrl = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    if (!keys || Date.now() - keysAt > 3600000) {
      keys = (await request(keyUrl)).keys;
      keysAt = Date.now();
    }
    let jwk = keys?.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) {
      keys = (await request(keyUrl)).keys;
      keysAt = Date.now();
      jwk = keys?.find((k) => k.kid === header.kid && k.kty === "RSA");
    }
    if (
      !jwk ||
      !verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      )
    )
      throw Error("Invalid identity signature.");
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== issuer ||
      claims.aud !== clientId ||
      claims.tid !== tenantId ||
      claims.nonce !== nonce ||
      !guid.test(claims.oid || "") ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      !Number.isFinite(claims.nbf) ||
      claims.nbf > now + 60
    )
      throw Error("Invalid identity claims.");
    const roles = Array.isArray(claims.roles) ? claims.roles : [];
    const role = roles.includes("Attendance.Admin")
      ? "admin"
      : roles.some((r) =>
            [
              "Attendance.Staff",
              "Attendance.Secretary",
              "Attendance.Teacher",
              "Attendance.DivisionHead",
              "Attendance.Executive",
            ].includes(r),
          )
        ? "staff"
        : null;
    if (!role) throw Error("Assigned attendance role required.");
    const persona = roles.includes("Attendance.Secretary")
      ? "secretary"
      : roles.includes("Attendance.Teacher")
        ? "teacher"
        : roles.includes("Attendance.DivisionHead")
          ? "division"
          : roles.includes("Attendance.Executive")
            ? "executive"
            : null;
    return {
      oid: claims.oid,
      role,
      ...(persona && role !== "admin" ? { persona } : {}),
    };
  }
  return {
    configured,
    begin() {
      if (!configured)
        throw Error("Microsoft authentication is not configured.");
      for (const [key, value] of pending)
        if (value.expires < Date.now()) pending.delete(key);
      if (pending.size >= 1000) throw Error("Too many sign-in requests.");
      const state = random(),
        nonce = random(),
        verifier = random(),
        binding = random();
      pending.set(state, {
        nonce,
        verifier,
        binding,
        expires: Date.now() + 600000,
      });
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: "openid",
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      return { url: authority + "/authorize?" + params, binding };
    },
    async complete(params, binding) {
      const state = params.get("state"),
        saved = pending.get(state);
      pending.delete(state);
      if (
        !saved ||
        saved.expires < Date.now() ||
        saved.binding !== binding ||
        params.has("error") ||
        !params.get("code")
      )
        throw Error("Invalid sign-in state.");
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: params.get("code"),
        redirect_uri: redirectUri,
        code_verifier: saved.verifier,
      });
      const result = await request(authority + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      return verifyToken(result.id_token, saved.nonce);
    },
  };
}
