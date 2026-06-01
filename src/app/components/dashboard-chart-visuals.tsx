"use client";

import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const leadTrend = [
  { day: "May 9", leads: 32 },
  { day: "May 12", leads: 68 },
  { day: "May 15", leads: 41 },
  { day: "May 18", leads: 70 },
  { day: "May 21", leads: 58 },
  { day: "May 24", leads: 101 },
  { day: "May 27", leads: 123 },
  { day: "May 30", leads: 84 },
  { day: "Jun 2", leads: 89 },
  { day: "Jun 5", leads: 106 },
  { day: "Jun 8", leads: 129 },
];

const leadCategories = [
  { name: "Raw Leads", value: 56, color: "#1677ff" },
  { name: "Warm Leads", value: 23, color: "#26c6c9" },
  { name: "Hot Leads", value: 42, color: "#ff8a18" },
  { name: "Won Leads", value: 37, color: "#2fb344" },
];

export function LeadsOverviewChartVisual() {
  return (
    <div className="h-72 w-full" aria-label="Leads overview chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={leadTrend} margin={{ left: -20, right: 8, top: 12 }}>
          <defs>
            <linearGradient id="leadArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#1677ff" stopOpacity={0.75} />
              <stop offset="95%" stopColor="#1677ff" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#c7d2fe", fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#c7d2fe", fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: "#07162c",
              border: "1px solid rgba(96, 165, 250, 0.25)",
              borderRadius: "8px",
              color: "#fff",
            }}
            cursor={{ stroke: "rgba(59, 130, 246, 0.35)" }}
          />
          <Area
            type="monotone"
            dataKey="leads"
            isAnimationActive={false}
            stroke="#2f8cff"
            strokeWidth={3}
            fill="url(#leadArea)"
            dot={{ fill: "#eef6ff", stroke: "#1677ff", strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LeadCategoryChartVisual() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(200px,280px)_1fr]">
      <div className="relative h-64 min-w-0" aria-label="Lead category chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={leadCategories}
              dataKey="value"
              isAnimationActive={false}
              innerRadius="58%"
              outerRadius="92%"
              paddingAngle={0}
              stroke="transparent"
            >
              {leadCategories.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#07162c",
                border: "1px solid rgba(96, 165, 250, 0.25)",
                borderRadius: "8px",
                color: "#fff",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-sm text-slate-300">Total Leads</span>
          <strong className="text-4xl font-semibold text-white">158</strong>
        </div>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-4">
        {leadCategories.map((category) => (
          <div
            key={category.name}
            className="grid grid-cols-[16px_1fr_auto] items-center gap-3 text-sm text-slate-100"
          >
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: category.color }}
              aria-hidden="true"
            />
            <span className="truncate">{category.name}</span>
            <span className="font-semibold text-white">{category.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
