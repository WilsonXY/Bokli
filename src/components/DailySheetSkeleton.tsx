// Loading Daily Sheet: the same boxes as an empty DailySheetForm (date bar,
// revenue cards, costs, bottom bar), so switching dates doesn't shift the page.
// scripts/cloud-flows/daily-sheet-skeleton.mjs checks the boxes line up.
const bar = "rounded-md bg-surface-subtle animate-pulse";
const card = "bg-white border border-surface-border rounded-xl p-3 shadow-xs";
const navButton = `w-11 h-11 shrink-0 rounded-lg sm:w-28 ${bar}`;
const divider = (
  <div className="pt-2 pb-0.5">
    <hr className="border-t border-surface-border" />
  </div>
);

function SectionHeader() {
  return (
    <div className="h-6 flex items-center justify-between px-0.5">
      <div className={`h-4 w-24 ${bar}`} />
      <div className={`h-4 w-36 ${bar}`} />
    </div>
  );
}

export function DailySheetSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className={card}>
        <div className="flex items-center justify-between">
          <div className={navButton} />
          <div className="py-1 flex flex-col items-center">
            <div className="h-6 flex items-center"><div className={`h-4 w-24 ${bar}`} /></div>
            <div className="h-[19.5px] flex items-center"><div className={`h-3 w-28 ${bar}`} /></div>
          </div>
          <div className={navButton} />
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeader />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className={card}>
              <div className="h-5 mb-1.5 flex items-center"><div className={`h-3.5 w-28 ${bar}`} /></div>
              <div className={`h-12 rounded-lg ${bar}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {divider}
        <SectionHeader />
        <div className={`h-[60px] rounded-xl ${bar}`} />
        {divider}
      </div>

      <div className="sticky bottom-16 z-30">
        <div className="bg-white/95 border border-surface-border rounded-xl p-3 shadow-sm flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className={`h-3 w-24 ${bar}`} />
            <div className={`h-5 w-20 ${bar}`} />
          </div>
          <div className={`h-12 w-28 rounded-lg ${bar}`} />
        </div>
      </div>
    </div>
  );
}
