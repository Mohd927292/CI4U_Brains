"use client";

import dynamic from "next/dynamic";

export const LeadsOverviewChart = dynamic(
  () =>
    import("./dashboard-chart-visuals").then(
      (mod) => mod.LeadsOverviewChartVisual,
    ),
  {
    ssr: false,
    loading: () => <ChartPlaceholder className="h-72" />,
  },
);

export const LeadCategoryChart = dynamic(
  () =>
    import("./dashboard-chart-visuals").then(
      (mod) => mod.LeadCategoryChartVisual,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-6 lg:grid-cols-[minmax(200px,280px)_1fr]">
        <ChartPlaceholder className="h-64" />
        <div className="flex min-w-0 flex-col justify-center gap-4">
          {["Raw Leads", "Warm Leads", "Hot Leads", "Won Leads"].map(
            (label) => (
              <div
                key={label}
                className="h-5 animate-pulse rounded bg-white/[0.035]"
              />
            ),
          )}
        </div>
      </div>
    ),
  },
);

function ChartPlaceholder({ className }: { className: string }) {
  return (
    <div
      className={`${className} w-full animate-pulse rounded-md border border-white/5 bg-white/[0.025]`}
      aria-hidden="true"
    />
  );
}
