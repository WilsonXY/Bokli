import type { D1Database } from "@cloudflare/workers-types";
import { eq, sql } from "drizzle-orm";
import { createD1Adapter } from "./d1";
import { userEmails, users } from "../src/db/schema";
import type { UserRole } from "../src/db/schema";

export interface WorkerEnv {
  BOKLI_DB: D1Database;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  ACCESS_ALLOWED_EMAILS: string;
  ACCESS_HEALTH_SERVICE_ID: string;
  APP_VERSION: string;
  /** Production only: Healthchecks ping URL (secret). The scheduled handler pings it every 5 minutes. */
  HEALTHCHECK_URL?: string;
}
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string" || [...value].some(character=>character.charCodeAt(0)>127)) throw new ApiError(403,"unknownIdentity");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[!-~]+@[!-~]+\.[!-~]+$/.test(email) || email.split("@").length !== 2) throw new ApiError(403,"unknownIdentity");
  return email;
}
export function validateConfig(env: WorkerEnv) {
  if (!env.BOKLI_DB || typeof env.BOKLI_DB.prepare !== "function" ||
    [env.ACCESS_ISSUER,env.ACCESS_AUD,env.ACCESS_ALLOWED_EMAILS,env.ACCESS_HEALTH_SERVICE_ID,env.APP_VERSION].some(value=>typeof value !== "string") ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER ?? "") ||
    !/^[!-~]{1,256}$/.test(env.ACCESS_AUD ?? "") ||
    !/^[A-Za-z0-9_-]+\.access$/.test(env.ACCESS_HEALTH_SERVICE_ID ?? "") ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(env.APP_VERSION ?? "") || !env.ACCESS_ALLOWED_EMAILS) throw new ApiError(503,"invalidConfiguration");
  try {
    const emails = env.ACCESS_ALLOWED_EMAILS.split(",");
    if (emails.some(e=>normalizeEmail(e) !== e) || new Set(emails).size !== emails.length) throw new Error();
    return emails;
  } catch { throw new ApiError(503,"invalidConfiguration"); }
}
function decode(part: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new ApiError(401,"invalidIdentity");
  return Uint8Array.from(atob(part.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
}
function object(part: string): Record<string,unknown> {
  const value = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decode(part)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value;
}
/** The only trust source is the signed Access assertion; headers/cookies never map roles. */
export async function verifyAccess(request: Request, env: WorkerEnv): Promise<Record<string,unknown>> {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt || jwt.length > 16384) throw new ApiError(401,"invalidIdentity");
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) throw new Error();
    const header = object(parts[0]);
    const claims = object(parts[1]);
    const now = Math.floor(Date.now()/1000);
    if (header.alg !== "RS256" || (header.typ !== undefined && header.typ !== "JWT") || typeof header.kid !== "string" || !header.kid || header.crit !== undefined ||
      claims.iss !== env.ACCESS_ISSUER || claims.type !== "app" ||
      !Array.isArray(claims.aud) || !claims.aud.every(a=>typeof a === "string") || !claims.aud.includes(env.ACCESS_AUD) ||
      !Number.isSafeInteger(claims.exp) || (claims.exp as number) <= now ||
      !Number.isSafeInteger(claims.iat) || (claims.iat as number) > now || (claims.iat as number) >= (claims.exp as number) ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) > now))) throw new Error();
    let response: Response;
    try {
      response = await fetch(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`,{redirect:"manual",signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error();
    } catch { throw new ApiError(503,"identityUnavailable"); }
    let keys: (JsonWebKey & {kid?:string})[];
    try {
      const body = await response.text();
      if (body.length > 65536) throw new Error();
      const jwks = JSON.parse(body);
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > 20) throw new Error();
      keys = jwks.keys;
      if (keys.some(k=>!k || typeof k !== "object" || typeof k.kid !== "string") || new Set(keys.map(k=>k.kid)).size !== keys.length) throw new Error();
    } catch { throw new ApiError(503,"identityUnavailable"); }
    const key = keys.find(k=>k.kid===header.kid);
    if (!key || key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256") || (key.use !== undefined && key.use !== "sig") ||
      key.d !== undefined || !key.n || decode(key.n).length < 256 || (key.key_ops !== undefined && !key.key_ops.includes("verify"))) throw new Error();
    const publicKey = await crypto.subtle.importKey("jwk",key,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error();
    return claims;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401,"invalidIdentity");
  }
}
export interface CloudIdentity { id: number; role: UserRole }
export async function lookupIdentity(claims: Record<string,unknown>, env: WorkerEnv, allowedEmails: string[]): Promise<CloudIdentity> {
  if (claims.common_name !== undefined || typeof claims.sub !== "string" || !claims.sub) throw new ApiError(403,"unknownIdentity");
  const email = normalizeEmail(claims.email);
  if (!allowedEmails.includes(email)) throw new ApiError(403,"unknownIdentity");
  const db = createD1Adapter(env.BOKLI_DB);
  const rows = await db.select({id:sql<string>`CAST(${users.id} AS TEXT)`,role:users.role}).from(userEmails)
    .innerJoin(users,eq(users.id,userEmails.userId)).where(eq(userEmails.email,email)).limit(1);
  const row = rows[0];
  if (!row || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || !["Operator","Admin"].includes(row.role)) throw new ApiError(403,"unknownIdentity");
  return {id:Number(row.id),role:row.role};
}
