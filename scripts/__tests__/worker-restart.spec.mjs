import { expect,it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { stabilizeTestLoopback } from "../../workers/test-loopback";

it("restarts real workerd with owned local D1 and resolves a discarded committed response",async()=>{
  const root=fs.realpathSync(process.cwd()),parent=path.join(root,"data-dev/stage4");
  fs.mkdirSync(parent,{recursive:true});expect(fs.realpathSync(parent)).toBe(parent);
  const folder=fs.mkdtempSync(path.join(parent,"workerd-restart-"));
  const issuer="https://bokli-synthetic.cloudflareaccess.com";
  const algorithm={name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"};
  const pair=await crypto.subtle.generateKey({...algorithm,modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,["sign","verify"]);
  const jwk={...await crypto.subtle.exportKey("jwk",pair.publicKey),kid:"restart-synthetic",alg:"RS256",use:"sig"};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  async function assertion() {
    const now=Math.floor(Date.now()/1000);
    const data=`${encode({alg:"RS256",typ:"JWT",kid:jwk.kid})}.${encode({iss:issuer,aud:["synthetic-audience"],type:"app",sub:"synthetic-mom",email:"mom@example.invalid",iat:now,exp:now+300})}`;
    return data+"."+Buffer.from(await crypto.subtle.sign(algorithm,pair.privateKey,new TextEncoder().encode(data))).toString("base64url");
  }
  const compiled=await build({entryPoints:["workers/index.ts"],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022"});
  stabilizeTestLoopback();
  const options={modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-03-10",host:"127.0.0.1",port:0,
    d1Databases:{BOKLI_DB:"stage4-local-restart"},d1Persist:folder,
    bindings:{ACCESS_ISSUER:issuer,ACCESS_AUD:"synthetic-audience",ACCESS_ALLOWED_EMAILS:"mom@example.invalid",ACCESS_HEALTH_SERVICE_ID:"synthetic-monitor.access",APP_VERSION:"stage4-synthetic"},
    outboundService:async request=>{
      if(request.method!=="GET"||request.url!==issuer+"/cdn-cgi/access/certs") throw new Error("External network forbidden in local restart qualification");
      return Response.json({keys:[jwk]});
    },
  };
  let runtime;
  try {
    runtime=new Miniflare(options);
    const db=await runtime.getD1Database("BOKLI_DB");
    for(const migration of await readD1Migrations(path.join(root,"drizzle"))) for(const query of migration.queries) await db.prepare(query).run();
    await db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (1,'synthetic-mom','retained-hash','Operator')").run();
    await db.prepare("INSERT INTO user_emails(email,user_id) VALUES ('mom@example.invalid',1)").run();
    const body={month:"2026-01",type:"rental",amountSen:1200,note:null};
    async function send(method="POST") {
      const suffix=method==="GET"?"?idempotencyKey=restart-key":"";
      return runtime.dispatchFetch("https://synthetic.invalid/api/cloud-v1/expenses"+suffix,{method,
        headers:{"Cf-Access-Jwt-Assertion":await assertion(),Origin:"https://synthetic.invalid","X-Bokli-Api-Generation":"cloud-v1","Content-Type":"application/json","Idempotency-Key":"restart-key"},
        ...(method==="GET"?{}:{body:JSON.stringify(body)})});
    }
    expect((await send()).status).toBe(201); // Discard the committed reply; retain only identity/key/body.
    await runtime.dispose();runtime=undefined;
    runtime=new Miniflare(options); // A new workerd process opens the same explicit owned persistence.
    expect(await (await send("GET")).json()).toMatchObject({saved:true,status:200,result:{expense:{amountSen:1200}}});
    const replay=await send();expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({alreadySaved:true});
    const restored=await runtime.getD1Database("BOKLI_DB");
    expect(await restored.prepare("SELECT amount_sen FROM operating_expenses").first("amount_sen")).toBe(1200);
    expect(await restored.prepare("SELECT count(*) FROM cloud_operation_receipts").first("count(*)")).toBe(1);
    expect((await restored.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    console.log("STAGE4_COLD_RESTART",JSON.stringify({actualWorkerdProcesses:2,persistedReceipts:1,amountSen:1200,sameIdentityKeyBody:true,remoteCalls:0}));
  } finally {
    await runtime?.dispose();
    expect(fs.realpathSync(folder)).toBe(folder);expect(folder.startsWith(parent+path.sep)).toBe(true);
    fs.rmSync(folder,{recursive:true});
  }
},60000);
