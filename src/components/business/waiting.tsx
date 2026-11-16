import { CardLoader, StatStrip } from "@/components/ui";

// What each Business tab shows while its figures are on their way: the tab's cards in their places, each with the small
// gradient ring centred, no logo and no caption (as on the Command Centre).

function CardWaiting({ label, className, height }: { label: string; className: string; height: string }) {
  return (
    <div className={`sp-card g-pad min-w-0 ${className}`}>
      <CardLoader label={label} className={height} />
    </div>
  );
}

export function WeekWaiting() {
  return (
    <div className="g-grid items-start">
      <CardWaiting label="Loading the week…" className="span-12" height="h-80" />
      <CardWaiting label="Loading rising products…" className="span-6" height="h-40" />
      <CardWaiting label="Loading falling products…" className="span-6" height="h-40" />
    </div>
  );
}

export function TargetsWaiting() {
  return (
    <div className="g-grid items-start">
      <CardWaiting label="Loading the sales target…" className="span-6" height="h-40" />
      <CardWaiting label="Loading the profit target…" className="span-6" height="h-40" />
      <CardWaiting label="Loading the last four months…" className="span-12" height="h-64" />
    </div>
  );
}

export function DeadWaiting() {
  return (
    <>
      <StatStrip ariaLabel="Dead and slow stock" className="mb-4">
        {["Loading dead stock value…", "Loading dead products…", "Loading slow stock value…", "Loading products with no cost…"].map((label) => (
          <div key={label} className="sp-card kpi-card justify-center">
            <CardLoader label={label} className="h-[46px]" />
          </div>
        ))}
      </StatStrip>
      <CardWaiting label="Loading dead stock…" className="" height="h-64" />
    </>
  );
}
