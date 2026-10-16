import { afterEach,expect,it,vi } from "vitest";
import { sendCloudWrite,CloudOutcomeUnknownError } from "./cloud-write";
afterEach(()=>vi.unstubAllGlobals());
function request(key="durable") {
  return new Request("https://synthetic.invalid/api/cloud-v1/expenses",{method:"POST",headers:{"Idempotency-Key":key,"X-Bokli-Actor-Id":"1","Content-Type":"application/json"},body:JSON.stringify({month:"2026-01",type:"rental",amountSen:1200})});
}
it("resolves a lost committed reply through primary authenticated status without sending again",async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError("lost reply")).mockResolvedValueOnce(Response.json({saved:true,status:200,result:{alreadySaved:true,expense:{amountSen:1200}}}));
  vi.stubGlobal("fetch",fetcher);
  const reply=await sendCloudWrite(request());
  expect(await reply.json()).toMatchObject({alreadySaved:true});expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0].url).toBe("https://synthetic.invalid/api/cloud-v1/operations/status?operation=expense.add&operationId=durable");
  expect(fetcher.mock.calls[1][0].headers.get("X-Bokli-Actor-Id")).toBe("1");
});
it("requires the persisted mapped actor before sending any keyed retry consumer",async()=>{
  const unbound=request();unbound.headers.delete("X-Bokli-Actor-Id");
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(sendCloudWrite(unbound)).rejects.toThrow("actor");expect(fetcher).not.toHaveBeenCalled();
});
it("retries only once with identical ID, headers and body after saved:false",async()=>{
  const sent:{url:string;key:string|null;body:string}[]=[];
  let call=0;
  vi.stubGlobal("fetch",async(r:Request)=>{
    sent.push({url:r.url,key:r.headers.get("Idempotency-Key"),body:r.method==="GET"?"":await r.text()});
    call++;if(call===1) return Response.json({code:"outcomeUnknown"},{status:503});
    if(call===2) return Response.json({saved:false});
    return Response.json({expense:{amountSen:1200}},{status:201});
  });
  expect((await sendCloudWrite(request())).status).toBe(201);expect(sent[2]).toEqual(sent[0]);
});
it("retains an unknown outcome when status fails or the bounded retry is lost",async()=>{
  for(const responses of [
    [new TypeError("lost"),Response.json({}, {status:503})],
    [new TypeError("lost"),Response.json({saved:false}),new TypeError("lost retry")],
  ]) {
    const fetcher=vi.fn().mockImplementation(()=>{const reply=responses.shift();return reply instanceof Error?Promise.reject(reply):Promise.resolve(reply);});
    vi.stubGlobal("fetch",fetcher);
    await expect(sendCloudWrite(request())).rejects.toMatchObject({operationId:"durable"});
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  }
});
it("never automatically retries unkeyed compatibility or a known business refusal",async()=>{
  const unkeyed=request();unkeyed.headers.delete("Idempotency-Key");
  const fetcher=vi.fn().mockRejectedValue(new TypeError("lost"));vi.stubGlobal("fetch",fetcher);
  await expect(sendCloudWrite(unkeyed)).rejects.toBeInstanceOf(CloudOutcomeUnknownError);expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockReset().mockResolvedValue(Response.json({code:"monthClosed"},{status:409}));
  expect((await sendCloudWrite(request())).status).toBe(409);expect(fetcher).toHaveBeenCalledTimes(1);
});

function interruptedBody(status=201) {
  return new Response(new ReadableStream({start(controller){controller.error(new TypeError("reply body lost after headers"));}}),{status,headers:{"Content-Type":"application/json"}});
}
it("resolves a committed reply whose body is lost after successful headers",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(interruptedBody()).mockResolvedValueOnce(Response.json({saved:true,status:200,result:{alreadySaved:true,expense:{amountSen:1200}}}));
  vi.stubGlobal("fetch",fetcher);
  const reply=await sendCloudWrite(request());expect(await reply.json()).toMatchObject({alreadySaved:true});expect(fetcher).toHaveBeenCalledTimes(2);
});
it("keeps a lost retry body and malformed successful JSON unknown inside the recovery boundary",async()=>{
  for(const retry of [interruptedBody(),new Response("{incomplete",{status:201}),Response.json(null,{status:201})]) {
    const fetcher=vi.fn().mockRejectedValueOnce(new TypeError("lost")).mockResolvedValueOnce(Response.json({saved:false})).mockResolvedValueOnce(retry);
    vi.stubGlobal("fetch",fetcher);await expect(sendCloudWrite(request())).rejects.toMatchObject({operationId:"durable"});expect(fetcher).toHaveBeenCalledTimes(3);
  }
});
