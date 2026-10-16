import http from "node:http";
import { expect,it } from "vitest";
import { stabilizeTestLoopback } from "../../workers/test-loopback";
it("disables idle timeouts only on Miniflare's private loopback server",()=>{
  stabilizeTestLoopback();
  const handler=Object.defineProperty(()=>{},"name",{value:"#handleLoopback"});
  const loopback=http.createServer(handler),ordinary=http.createServer(()=>{});
  try {expect(loopback.keepAliveTimeout).toBe(0);expect(ordinary.keepAliveTimeout).toBe(5000);}
  finally {loopback.close();ordinary.close();}
});
