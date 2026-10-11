import { applyD1Migrations, env, SELF, fetchMock } from "cloudflare:test";
import { beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { signingKey, token, jwks, seedIdentity, type SigningKey } from "./jwt-fixtures";
let key: SigningKey;
beforeAll(async()=>{key=await signingKey();});
beforeEach(async()=>{
  fetchMock.activate();fetchMock.disableNetConnect();
  await applyD1Migrations(env.BOKLI_DB,env.TEST_MIGRATIONS);
  await seedIdentity();
});
afterEach(()=>{fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();});
it("verifies the service JWT signature and exposes only coarse health",async()=>{
  jwks([key]);
  const jwt=await token(key,{email:undefined,sub:"",common_name:env.ACCESS_HEALTH_SERVICE_ID,nbf:undefined});
  const response=await SELF.fetch("https://synthetic.invalid/api/health",{headers:{"Cf-Access-Jwt-Assertion":jwt}});
  expect({status:response.status,body:await response.clone().json()}).toEqual({status:200,body:{status:"ok",version:"stage3-synthetic"}});
  expect(await response.json()).toEqual({status:"ok",version:"stage3-synthetic"});
});
it("looks up the normalized signed email and ignores forged role headers",async()=>{
  jwks([key]);
  const jwt=await token(key,{email:" MOM@EXAMPLE.INVALID "});
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":jwt,"Cf-Access-Authenticated-User-Email":"admin@example.invalid","X-Role":"Admin","X-Bokli-User":"2"}});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({id:1,role:"Operator"});
});

const dataPaths=["identity","dashboard","sheets","expenses","close","history","close/reopen","operations"];
it("admits the mapped Admin only from the verified signed identity",async()=>{
  jwks([key]);
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key,{email:"admin@example.invalid",sub:"synthetic-admin"})}});
  expect(await response.json()).toEqual({id:2,role:"Admin"});
});
it("denies missing tokens and alternate authorization sources",async()=>{
  for (const headers of [{},{"Cf-Access-Authenticated-User-Email":"mom@example.invalid","X-Role":"Admin"},{Cookie:`CF_Authorization=${await token(key)}`},{Authorization:`Bearer ${await token(key)}`},{"CF-Access-Client-Id":env.ACCESS_HEALTH_SERVICE_ID,"CF-Access-Client-Secret":"synthetic-not-a-secret"},{"X-Test-User":"1","X-Bokli-Fake-Identity":"Admin","X-Spike-Token":"synthetic","X-Forwarded-Host":"localhost","Host":"localhost"}]) {
    const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers});
    expect(response.status).toBe(401);
  }
});
it.each([
  ["expired",{exp:Math.floor(Date.now()/1000)-1}],
  ["wrong issuer",{iss:"https://other.cloudflareaccess.com"}],
  ["wrong audience",{aud:["other"]}],
  ["scalar audience",{aud:"synthetic-audience"}],
  ["future nbf",{nbf:Math.floor(Date.now()/1000)+1000}],
  ["future iat",{iat:Math.floor(Date.now()/1000)+1000}],
  ["string expiry",{exp:"9999999999"}],
  ["global token",{type:"org"}],
])("rejects a signed token with %s",async(_name,claims)=>{
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key,claims)}});
  expect(response.status).toBe(401);
});
it.each(["", "invalid", "a.b.c", "a.b", "a.b.c.d", "x".repeat(16385)])("rejects malformed JWT #%#",async jwt=>{
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":jwt}});
  expect(response.status).toBe(401);
});
it.each([{alg:"none"},{alg:"HS256"},{kid:""},{crit:["synthetic"]},{typ:"not-JWT"}])("rejects unsupported JWT header %j",async header=>{
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key,{},header)}});
  expect(response.status).toBe(401);
});
it("rejects wrong signatures and unknown keys",async()=>{
  const other=await signingKey("other-key");
  for(const jwt of [await token(other,{}, {kid:key.kid}),await token(other)]) {
    jwks([key]);
    const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status).toBe(401);
  }
});
it("fails closed during JWKS outage and accepts rotation only after signature verification",async()=>{
  const rotated=await signingKey("rotated-key");
  const jwt=await token(rotated);
  for (const [keys,status,expected] of [[[key],503,503],[[key],200,401],[[key,rotated],200,200],[[rotated],200,200]] as const) {
    jwks([...keys],status);
    const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status).toBe(expected);
  }
});
it("fails closed on unavailable, malformed, redirected and duplicate JWKS",async()=>{
  for(const [status,body] of [[302,""],[200,"not-json"],[200,JSON.stringify({keys:[]})],[200,JSON.stringify({keys:[key.jwk,key.jwk]})]] as const){
    fetchMock.get(env.ACCESS_ISSUER).intercept({method:"GET",path:"/cdn-cgi/access/certs"}).reply(status,body);
    const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key)}});
    expect(response.status).toBe(503);
  }
  const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key)}});
  expect(response.status).toBe(503); // Network is disabled: there is no allowed JWKS reply.
});
it("rejects signed but unmapped, unapproved and ambiguous identities",async()=>{
  await env.BOKLI_DB.prepare("DELETE FROM user_emails WHERE user_id=2").run();
  for(const claims of [{email:"unknown@example.invalid"},{email:"admin@example.invalid"},{email:"bad email"},{email:undefined},{sub:""},{common_name:"unknown.access"},{common_name:env.ACCESS_HEALTH_SERVICE_ID},{email:"mom@example.invalid",common_name:env.ACCESS_HEALTH_SERVICE_ID,sub:""}]){
    jwks([key]);
    const response=await SELF.fetch("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key,claims)}});
    expect(response.status).toBe(403);
  }
});
it("restricts service identity to health across every data path and mutation method",async()=>{
  const jwt=await token(key,{sub:"",email:undefined,common_name:env.ACCESS_HEALTH_SERVICE_ID});
  for(const path of dataPaths) for(const method of ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]) {
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/${path}`,{method,headers:{"Cf-Access-Jwt-Assertion":jwt,"Cf-Access-Authenticated-User-Email":"admin@example.invalid","X-Role":"Admin"}});
    expect(response.status,`${method} ${path}`).toBe(403);
  }
},60000);
it("rejects health path encoding, case, suffix, query and method tricks",async()=>{
  const jwt=await token(key,{sub:"",email:undefined,common_name:env.ACCESS_HEALTH_SERVICE_ID});
  const paths=["/api/Health","/API/health","/api/%68ealth","/api/health/","//api/health","/api/health%2f","/api/health;","/api/health?path=/api/cloud-v1/dashboard","/api/health/../cloud-v1/dashboard","/api/health/%2e%2e/cloud-v1/identity","/api/health%00","/api/health%252f"];
  for(const path of paths){
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid${path}`,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    expect(response.status,path).toBe(403);
  }
  for(const method of ["HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]){
    jwks([key]);
    expect((await SELF.fetch("https://synthetic.invalid/api/health",{method,headers:{"Cf-Access-Jwt-Assertion":jwt}})).status).toBe(403);
  }
  jwks([key]);
  expect((await SELF.fetch("https://synthetic.invalid/api/health",{headers:{"Cf-Access-Jwt-Assertion":await token(key)}})).status).toBe(403);
});
it("fails closed on missing or malformed deployment configuration",async()=>{
  const worker=(await import("../index")).default;
  const request=new Request("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key)}});
  for(const name of ["BOKLI_DB","ACCESS_ISSUER","ACCESS_AUD","ACCESS_ALLOWED_EMAILS","ACCESS_HEALTH_SERVICE_ID","APP_VERSION"]){
    expect((await worker.fetch(request,{...env,[name]:undefined} as any)).status,name).toBe(503);
  }
  for(const patch of [{ACCESS_ISSUER:"http://bokli-synthetic.cloudflareaccess.com"},{ACCESS_ISSUER:"https://evil.invalid"},{ACCESS_ISSUER:"https://bokli-synthetic.cloudflareaccess.com/"},{ACCESS_ALLOWED_EMAILS:"MOM@example.invalid"},{ACCESS_ALLOWED_EMAILS:"mom@example.invalid,mom@example.invalid"},{ACCESS_AUD:" "},{APP_VERSION:"secret\nvalue"},{ACCESS_HEALTH_SERVICE_ID:"*"}]){
    expect((await worker.fetch(request,{...env,...patch})).status).toBe(503);
  }
});
it("explicitly rejects unsupported cloud mutations and preserves all synthetic records",async()=>{
  const jwt=await token(key);
  for(const path of ["sheets","expenses","close","close/reopen"]) for(const method of ["POST","DELETE","PUT","PATCH"]){
    jwks([key]);
    const response=await SELF.fetch(`https://synthetic.invalid/api/cloud-v1/${path}`,{method,headers:{"Cf-Access-Jwt-Assertion":jwt,"Idempotency-Key":"synthetic-operation","X-Bokli-Api-Generation":"cloud-v1"}});
    expect(response.status,`${method} ${path}`).toBe(405);
    expect(await response.json()).toEqual({code:"mutationNotSupported"});
  }
  for(const table of ["daily_sheets","cost_lines","operating_expenses","month_closes","month_close_events","operating_expense_add_requests"])
    expect(await env.BOKLI_DB.prepare(`SELECT count(*) AS n FROM ${table}`).first("n")).toBe(0);
});
it("rejects wrong binding types before attempting identity verification",async()=>{
  const worker=(await import("../index")).default;
  const request=new Request("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key)}});
  for(const patch of [{APP_VERSION:123},{ACCESS_AUD:123},{BOKLI_DB:{}},{ACCESS_ALLOWED_EMAILS:[]},{ACCESS_ISSUER:42}]){
    const response=await worker.fetch(request,{...env,...patch} as any);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({code:"invalidConfiguration"});
  }
});
it("rejects Unicode case-fold aliases of an approved Admin email",async()=>{
  await env.BOKLI_DB.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (3,'synthetic-katte','retained','Admin')").run();
  await env.BOKLI_DB.prepare("INSERT INTO user_emails(email,user_id) VALUES ('katte@example.invalid',3)").run();
  const worker=(await import("../index")).default;
  for(const [email,status] of [["Katte@example.invalid",403],["KATTE@EXAMPLE.INVALID",200]] as const){
    jwks([key]);
    const response=await worker.fetch(new Request("https://synthetic.invalid/api/cloud-v1/identity",{headers:{"Cf-Access-Jwt-Assertion":await token(key,{email})}}),{...env,ACCESS_ALLOWED_EMAILS:env.ACCESS_ALLOWED_EMAILS+",katte@example.invalid"});
    expect(response.status,email).toBe(status);
    if(status===200) expect(await response.json()).toEqual({id:3,role:"Admin"});
  }
});
