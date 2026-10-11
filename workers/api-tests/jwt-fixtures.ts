import { env, fetchMock } from "cloudflare:test";
export const issuer = "https://bokli-synthetic.cloudflareaccess.com";
const algorithm = {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"};
export async function signingKey(kid = "synthetic-key") {
  const pair = await crypto.subtle.generateKey({...algorithm,modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,["sign","verify"]);
  const jwk = {...await crypto.subtle.exportKey("jwk",pair.publicKey),kid,alg:"RS256",use:"sig"};
  return {pair,jwk,kid};
}
export type SigningKey = Awaited<ReturnType<typeof signingKey>>;
function encode(value: unknown) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
export async function token(key: SigningKey, claims: Record<string,unknown> = {}, header: Record<string,unknown> = {}) {
  const now = Math.floor(Date.now()/1000);
  const data = `${encode({alg:"RS256",typ:"JWT",kid:key.kid,...header})}.${encode({iss:issuer,aud:["synthetic-audience"],exp:now+300,iat:now,nbf:now,type:"app",sub:"synthetic-mom",email:"mom@example.invalid",...claims})}`;
  const signature = await crypto.subtle.sign(algorithm,key.pair.privateKey,new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;
}
export function jwks(keys: SigningKey[],status=200) {
  fetchMock.get(issuer).intercept({method:"GET",path:"/cdn-cgi/access/certs"}).reply(status,JSON.stringify({keys:keys.map(k=>k.jwk)}),{headers:{"content-type":"application/json"}});
}
export async function seedIdentity() {
  await env.BOKLI_DB.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (1,'synthetic-mom','retained-hash','Operator'),(2,'synthetic-admin','retained-admin-hash','Admin')").run();
  await env.BOKLI_DB.prepare("INSERT INTO user_emails(email,user_id) VALUES ('mom@example.invalid',1),('admin@example.invalid',2)").run();
}
