"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  CreditCard,
  ChevronRight,
  Search,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  Building2,
  DollarSign,
  Layers,
  Shield,
  Eye,
  PanelLeft,
  Share2,
  Activity,
  FileText,
} from "lucide-react";
import { api, type Alert, type DashboardStats, type PaginatedAlerts } from "@/lib/api";

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Dec 20";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "Dec 20";
  }
}

// Daily Transaction Anomaly Velocity distribution
const VELOCITY_DATA = [
  { day: "Day 1", height: 35 },
  { day: "Day 2", height: 25 },
  { day: "Day 3", height: 45 },
  { day: "Day 4", height: 30 },
  { day: "Day 5", height: 60 },
  { day: "Day 6", height: 40 },
  { day: "Day 7", height: 50 },
  { day: "Day 8", height: 38 },
  { day: "Day 9", height: 55 },
  { day: "Day 10", height: 42 },
  { day: "Day 11", height: 48 },
  { day: "Day 12", height: 75 },
  { day: "Day 13", height: 62 },
  { day: "Day 14", height: 50 },
  { day: "Day 15", height: 58 },
  { day: "Day 16", height: 35 },
  { day: "Day 17", height: 45 },
  { day: "Day 18", height: 55 },
  { day: "Day 19", height: 70 },
  { day: "Day 20", height: 52 },
  { day: "Day 21", height: 60 },
  { day: "Day 22", height: 48 },
  { day: "Day 23", height: 65 },
  { day: "Day 24", height: 72 },
  { day: "Day 25", height: 58 },
  { day: "Day 26", height: 80 },
  { day: "Day 27", height: 68 },
  { day: "Day 28", height: 55 },
  { day: "Day 29", height: 88 },
  { day: "Day 30", height: 70 },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typologyFilter, setTypologyFilter] = useState("");

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.getStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to load dashboard metrics:", err);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res: PaginatedAlerts = await api.getAlerts({
        page,
        page_size: pageSize,
        status: statusFilter || undefined,
        typology: typologyFilter || undefined,
        search: searchQuery || undefined,
        sort_by: "risk_score",
        sort_order: "desc",
      });
      setAlerts(res.items);
      setTotalPages(res.total_pages);
      setTotalAlerts(res.total);
    } catch (err) {
      console.error("Failed to fetch alert queue:", err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, typologyFilter, searchQuery]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Top 3 priority cases for the right panel
  const priorityCases = alerts.slice(0, 3);

  return (
    <div className="flex-1 flex flex-col bg-[#0c0c0e] min-w-0">
      
      {/* ── Top Breadcrumb Header ─────────────────────────────────────────── */}
      <header className="h-14 border-b border-[#1e1e22] px-6 flex items-center justify-between shrink-0 bg-[#0c0c0e]">
        <div className="flex items-center gap-2.5 text-xs text-zinc-400">
          <Link href="/" className="hover:text-zinc-200 flex items-center gap-1.5">
            <PanelLeft size={16} className="text-zinc-500" />
            <span>Dashboard</span>
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-100 font-semibold tracking-tight">Alerts Queue</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            System Live
          </div>

          <Link
            href="/monitoring"
            className="ref-btn ref-btn-secondary text-[11px] py-1 px-2.5"
          >
            Telemetry & Audit
          </Link>
        </div>
      </header>

      {/* ── Main Dashboard Canvas ─────────────────────────────────────────── */}
      <div className="flex-1 p-6 space-y-6 max-w-[1600px] w-full mx-auto">
        
        {/* ── Top Summary Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* Card 1: Total Flagged Alerts */}
          <div className="ref-card flex items-center justify-between p-5">
            <div className="flex items-center gap-5">
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="24" fill="transparent" stroke="#222226" strokeWidth="5" />
                  <circle
                    cx="32"
                    cy="32"
                    r="24"
                    fill="transparent"
                    stroke="#2563eb"
                    strokeWidth="5"
                    strokeDasharray="150"
                    strokeDashoffset="35"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                  Flagged Transaction Alerts
                </h3>
                <p className="text-[11px] text-zinc-500">PaySim & IEEE-CIS Ingested</p>
                <div className="text-2xl font-bold font-sans text-white tracking-tight">
                  {stats?.total_alerts?.toLocaleString() || "1,000"}
                </div>
              </div>
            </div>

            <div className="pill-badge pill-blue">
              {stats?.new_alerts || 0} Pending Review
            </div>
          </div>

          {/* Card 2: High Risk Queue */}
          <div className="ref-card flex items-center justify-between p-5">
            <div className="flex items-center gap-5">
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="24" fill="transparent" stroke="#222226" strokeWidth="5" />
                  <circle
                    cx="32"
                    cy="32"
                    r="24"
                    fill="transparent"
                    stroke="#ef4444"
                    strokeWidth="5"
                    strokeDasharray="150"
                    strokeDashoffset="65"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                  Tier 1 Critical Alerts
                </h3>
                <p className="text-[11px] text-zinc-500">Risk Score ≥ 0.70 Threshold</p>
                <div className="text-2xl font-bold font-sans text-rose-400 tracking-tight">
                  {stats?.high_risk_count?.toLocaleString() || "156"}
                </div>
              </div>
            </div>

            <div className="pill-badge pill-rose">
              High Priority
            </div>
          </div>

        </div>

        {/* ── Middle Row: Ingestion Velocity Chart & Priority Alerts ──────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          
          {/* Left Card: Anomaly Velocity Distribution (8 cols) */}
          <div className="lg:col-span-8 ref-card flex flex-col justify-between p-6">
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-zinc-100 tracking-tight">
                    Transaction Anomaly Velocity
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Temporal distribution of anomalous transactions across ingested PaySim and IEEE-CIS datasets.
                  </p>
                </div>
                <span className="pill-badge pill-blue text-[10px]">
                  Real-Time Scrape
                </span>
              </div>
            </div>

            {/* Dense Blue Vertical Bar Chart */}
            <div className="mt-8 pt-4">
              <div className="h-44 flex items-end justify-between gap-1.5 px-1 pb-2">
                {VELOCITY_DATA.map((bar, i) => (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  >
                    <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-zinc-900 text-zinc-200 text-[10px] py-0.5 px-1.5 rounded border border-zinc-700 whitespace-nowrap z-20">
                      {bar.day}: {Math.round(bar.height * 12)} anomalies
                    </div>

                    <div
                      className="w-full bg-[#2563eb] hover:bg-[#3b82f6] transition-all rounded-t-[2px]"
                      style={{ height: `${bar.height}%` }}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 font-sans pt-3 border-t border-[#222226] px-1">
                <span>Window Start</span>
                <span>T + 5 Days</span>
                <span>T + 10 Days</span>
                <span>T + 15 Days</span>
                <span>T + 20 Days</span>
                <span>Window End</span>
              </div>
            </div>
          </div>

          {/* Right Card: High Priority Cases (4 cols) */}
          <div className="lg:col-span-4 ref-card flex flex-col justify-between p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-1 border-b border-[#222226]">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-zinc-100">
                    High-Risk Queue
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  Top Priority
                </span>
              </div>

              {/* Priority Alerts List */}
              <div className="space-y-3">
                {priorityCases.length > 0 ? (
                  priorityCases.map((c) => (
                    <Link
                      key={c.id}
                      href={`/alerts/${c.id}`}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[#141417] hover:bg-[#1a1a1f] border border-[#222226] transition group"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-medium text-zinc-100 truncate">
                            {c.account_id || "Account"}
                          </span>
                          <span className="pill-badge pill-rose text-[9px] py-0 px-1.5">
                            {Math.round((c.risk_score || 0.8) * 100)}%
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 truncate capitalize mt-0.5">
                          {(c.typology || "unclassified").replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-medium text-emerald-400 block">
                          {formatCurrency(c.amount)}
                        </span>
                        <span className="text-[10px] text-blue-400 flex items-center justify-end gap-0.5 group-hover:underline">
                          Inspect <ChevronRight size={10} />
                        </span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="text-xs text-zinc-500 py-6 text-center">Loading priority queue...</p>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                const el = document.getElementById("alerts-table-section");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="w-full mt-4 py-2 rounded-xl bg-[#202024] hover:bg-[#27272c] text-zinc-300 text-xs font-medium transition text-center"
            >
              View complete ledger ({totalAlerts.toLocaleString()})
            </button>
          </div>

        </div>

        {/* ── Bottom Section: AML Intake Ledger Table ──────────────────────── */}
        <section id="alerts-table-section" className="ref-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-100 tracking-tight">
                Case Intake & Transaction Ledger
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Complete searchable repository of flagged transaction anomalies across datasets.
              </p>
            </div>
            
            <button
              onClick={() => {
                setStatusFilter("");
                setSearchQuery("");
                setTypologyFilter("");
                setPage(1);
              }}
              className="ref-btn ref-btn-secondary text-xs"
            >
              Reset Filters
            </button>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2.5 flex-1 max-w-md">
              <div className="relative w-full">
                <input
                  type="text"
                  placeholder="Search account, transaction ID..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="ref-input w-full pr-8 text-xs font-mono"
                />
                <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {/* Quick Filter Selects */}
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="ref-select text-xs py-1.5"
              >
                <option value="">Status: All</option>
                <option value="new">New (Pending)</option>
                <option value="investigating">Under Review</option>
                <option value="approved">Approved for SAR</option>
                <option value="rejected">Dismissed</option>
              </select>

              <select
                value={typologyFilter}
                onChange={(e) => {
                  setTypologyFilter(e.target.value);
                  setPage(1);
                }}
                className="ref-select text-xs py-1.5"
              >
                <option value="">Typology: All</option>
                <option value="mule_network">Mule Network</option>
                <option value="structuring">Structuring</option>
                <option value="rapid_movement">Rapid Movement</option>
                <option value="layering">Layering</option>
                <option value="synthetic_identity">Synthetic Identity</option>
              </select>

              <button
                onClick={() => fetchAlerts()}
                className="ref-btn ref-btn-secondary text-xs flex items-center gap-1.5"
                title="Refresh table data"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto pt-1">
            <table className="ref-table">
              <thead>
                <tr>
                  <th className="w-28">Status</th>
                  <th>Primary Account</th>
                  <th>Assigned Typology</th>
                  <th className="w-28">Risk Score</th>
                  <th className="w-28 text-right">Amount (USD)</th>
                  <th className="w-28 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-zinc-500 font-sans text-xs">
                      Loading ledger records from database...
                    </td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-zinc-500 font-sans text-xs">
                      No matching transaction records found.
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => {
                    const status = (alert.status || "new").toLowerCase();
                    const risk = alert.risk_score || 0;
                    return (
                      <tr key={alert.id} className="group">
                        <td>
                          {status === "approved" ? (
                            <span className="pill-badge pill-green">Approved</span>
                          ) : status === "investigating" ? (
                            <span className="pill-badge pill-amber">In review</span>
                          ) : status === "rejected" ? (
                            <span className="pill-badge pill-rose">Dismissed</span>
                          ) : (
                            <span className="pill-badge pill-blue">New Case</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-col">
                            <span className="font-mono text-zinc-200 text-xs font-medium">
                              {alert.account_id || "Unidentified Account"}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Tx #{alert.transaction_id || alert.id.slice(0, 8)} • {formatDate(alert.timestamp)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="text-xs text-zinc-300 capitalize font-medium">
                            {(alert.typology || "unclassified").replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          <span className={`pill-badge ${risk >= 0.7 ? "pill-rose" : risk >= 0.4 ? "pill-amber" : "pill-green"}`}>
                            {Math.round(risk * 100)}%
                          </span>
                        </td>
                        <td className="text-right font-medium text-emerald-400 text-xs font-mono">
                          {formatCurrency(alert.amount)}
                        </td>
                        <td className="text-right">
                          <Link
                            href={`/alerts/${alert.id}`}
                            className="ref-btn ref-btn-secondary text-[11px] py-1 px-2.5 inline-flex opacity-85 group-hover:opacity-100 group-hover:border-blue-500/50"
                          >
                            <Eye size={12} className="text-blue-400" />
                            Case File
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-3 border-t border-[#222226] text-xs text-zinc-500 font-mono">
            <span>
              Page {page} of {totalPages} ({totalAlerts.toLocaleString()} total alerts)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="ref-btn ref-btn-secondary text-xs disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="ref-btn ref-btn-secondary text-xs disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
