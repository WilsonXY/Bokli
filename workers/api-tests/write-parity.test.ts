import { env,fetchMock } from "cloudflare:test";
import { expect,it } from "vitest";
import { writeFixture } from "./write-fixtures";
import type { WriteReference } from "./legacy-write-reference";
function comparable(value:any):any {
  if(Array.isArray(value)) return value.map(comparable);
  if(value && typeof value==="object") return Object.fromEntries(Object.entries(value).filter(([key])=>!["id","dailySheetId","createdAt","updatedAt","closedAt","reopenedAt","error"].includes(key)).map(([key,v])=>[key,comparable(v)]));
  return value;
}
it("matches retained SQLite business results through all six real D1 consumers",async()=>{
  const f=await writeFixture();
  try {
    const steps=(JSON.parse(env.TEST_READ_CASES)[0] as {writes:WriteReference[]}).writes;
    expect(steps).toHaveLength(14);
    for(const step of steps) {
      let path=step.path;
      if(path==="sheet-delete") {
        const current=await (await f.send("sheets?date=2026-01-02")).json() as any;
        path=`sheets?date=2026-01-02&id=${current.data.sheet.id}&updatedAt=${encodeURIComponent(current.data.sheet.updatedAt)}`;
      }
      const response=await f.send(path,step.method,step.body,step.key,step.admin?f.admin:f.mom);
      expect(response.status,step.key).toBe(step.status);
      expect(comparable(await response.json()),step.key).toEqual(comparable(step.expected));
    }
    console.log("STAGE4_WRITE_PARITY",JSON.stringify({steps:steps.length,consumers:6,reference:"retained SQLite services",storage:"real local workerd/D1"}));
  } finally {fetchMock.assertNoPendingInterceptors();fetchMock.deactivate();}
});
