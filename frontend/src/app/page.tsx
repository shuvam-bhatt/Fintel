"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  CreditCard,
  ChevronRight,
  Search,
  SlidersHorizontal,
  ArrowUpRight,
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

// Generate realistic bar heights matching the screenshot
const BAR_DATA = [
  { day: "Apr 1", height: 35 },
  { day: "Apr 2", height: 25 },
  { day: "Apr 3", height: 45 },
  { day: "Apr 4", height: 30 },
  { day: "Apr 5", height: 60 },
  { day: "Apr 6", height: 40 },
  { day: "Apr 7", height: 50 },
  { day: "Apr 8", height: 38 },
  { day: "Apr 9", height: 55 },
  { day: "Apr 10", height: 42 },
  { day: "Apr 11", height: 48 },
  { day: "Apr 12", height: 75 },
  { day: "Apr 13", height: 62 },
  { day: "Apr 14", height: 50 },
  { day: "Apr 15", height: 58 },
  { day: "Apr 16", height: 35 },
  { day: "Apr 17", height: 45 },
  { day: "Apr 18", height: 55 },
  { day: "Apr 19", height: 70 },
  { day: "Apr 20", height: 52 },
  { day: "Apr 21", height: 60 },
  { day: "Apr 22", height: 48 },
  { day: "Apr 23", height: 65 },
  { day: "Apr 24", height: 72 },
  { day: "Apr 25", height: 58 },
  { day: "Apr 26", height: 80 },
  { day: "Apr 27", height: 68 },
  { day: "Apr 28", height: 55 },
  { day: "Apr 29", height: 88 },
  { day: "Apr 30", height: 70 },
  { day: "May 1", height: 78 },
  { day: "May 5", height: 60 },
  { day: "May 8", height: 82 },
  { day: "May 11", height: 85 },
  { day: "May 16", height: 65 },
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

  // Featured transactions for the right card
  const topTransactions = alerts.slice(0, 3);

  return (
    <div className="flex-1 flex flex-col bg-[#0c0c0e] min-w-0">
      
      {/* ── Top Breadcrumb Header ─────────────────────────────────────────── */}
      <header className="h-14 border-b border-[#1e1e22] px-6 flex items-center justify-between shrink-0 bg-[#0c0c0e]">
        <div className="flex items-center gap-2.5 text-xs text-zinc-400">
          <PanelLeft size={16} className="text-zinc-500 hover:text-zinc-300 cursor-pointer" />
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-100 font-semibold tracking-tight">Home</span>
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
        
        {/* ── Top Metric Cards (Checking account & Revenue) ────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* Card 1: Checking Account */}
          <div className="ref-card flex items-center justify-between p-5">
            <div className="flex items-center gap-5">
              {/* Circular Ring SVG */}
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle
                    cx="32"
                    cy="32"
                    r="24"
                    fill="transparent"
                    stroke="#222226"
                    strokeWidth="5"
                  />
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

              {/* Metric Details */}
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                  Checking account
                </h3>
                <p className="text-[11px] text-zinc-500">Current balance</p>
                <div className="text-2xl font-bold font-sans text-white tracking-tight">
                  $25,895.00
                </div>
              </div>
            </div>

            {/* Percentage Pill */}
            <div className="pill-badge pill-green">
              +1.25%
            </div>
          </div>

          {/* Card 2: Revenue */}
          <div className="ref-card flex items-center justify-between p-5">
            <div className="flex items-center gap-5">
              {/* Circular Ring SVG */}
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle
                    cx="32"
                    cy="32"
                    r="24"
                    fill="transparent"
                    stroke="#222226"
                    strokeWidth="5"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="24"
                    fill="transparent"
                    stroke="#3b82f6"
                    strokeWidth="5"
                    strokeDasharray="150"
                    strokeDashoffset="65"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              {/* Metric Details */}
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                  Revenue
                </h3>
                <p className="text-[11px] text-zinc-500">Current balance</p>
                <div className="text-2xl font-bold font-sans text-white tracking-tight">
                  $8,325.00
                </div>
              </div>
            </div>

            {/* Percentage Pill */}
            <div className="pill-badge pill-green">
              +4.25%
            </div>
          </div>

        </div>

        {/* ── Middle Row: Balance Overview Chart & Transactions ────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          
          {/* Left Wide Card: Balance Overview Bar Chart (8 cols) */}
          <div className="lg:col-span-8 ref-card flex flex-col justify-between p-6">
            <div>
              <h2 className="text-base font-semibold text-zinc-100 tracking-tight">
                Balance overview
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                A clear snapshot of your current account balance over the last months.
              </p>
            </div>

            {/* Dense Blue Vertical Bar Chart */}
            <div className="mt-8 pt-4">
              <div className="h-44 flex items-end justify-between gap-1.5 px-1 pb-2">
                {BAR_DATA.map((bar, i) => (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  >
                    {/* Tooltip on Hover */}
                    <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-zinc-900 text-zinc-200 text-[10px] py-0.5 px-1.5 rounded border border-zinc-700 whitespace-nowrap z-20">
                      {bar.day}: ${(bar.height * 280).toLocaleString()}
                    </div>

                    <div
                      className="w-full bg-[#2563eb] hover:bg-[#3b82f6] transition-all rounded-t-[2px]"
                      style={{ height: `${bar.height}%` }}
                    />
                  </div>
                ))}
              </div>

              {/* X-Axis Labels */}
              <div className="flex items-center justify-between text-[11px] text-zinc-500 font-sans pt-3 border-t border-[#222226] px-1">
                <span>Apr 1</span>
                <span>Apr 6</span>
                <span>Apr 11</span>
                <span>Apr 16</span>
                <span>Apr 21</span>
                <span>Apr 26</span>
                <span>May 1</span>
                <span>May 6</span>
                <span>May 11</span>
                <span>May 16</span>
              </div>
            </div>
          </div>

          {/* Right Card: Transactions (4 cols) */}
          <div className="lg:col-span-4 ref-card flex flex-col justify-between p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-1 border-b border-[#222226]">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-serif">
                    $
                  </span>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Transactions
                  </h3>
                </div>
                <button
                  onClick={() => { setStatusFilter(""); setPage(1); }}
                  className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition"
                >
                  Last month <ChevronRight size={13} />
                </button>
              </div>

              {/* Transactions List */}
              <div className="space-y-3.5">
                {/* Item 1: Tax Refund */}
                <div className="flex items-center justify-between py-1 group">
                  <div className="flex items-center gap-3">
                    {/* Mastercard Style Red/Orange Circles */}
                    <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center relative shrink-0">
                      <div className="w-3.5 h-3.5 rounded-full bg-red-500/80 -mr-1.5" />
                      <div className="w-3.5 h-3.5 rounded-full bg-amber-500/80" />
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-zinc-100 leading-snug">
                        Tax Refund
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        2024 Income Tax Refund
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-emerald-400 block">
                      +$542.00
                    </span>
                    <span className="text-[10px] text-zinc-500">Dec 20</span>
                  </div>
                </div>

                {/* Item 2: Freelance Payment */}
                <div className="flex items-center justify-between py-1 group">
                  <div className="flex items-center gap-3">
                    {/* PayPal Style Blue Icon */}
                    <div className="w-8 h-8 rounded-lg bg-blue-950/40 border border-blue-900/40 flex items-center justify-center text-blue-400 text-xs font-bold shrink-0">
                      P
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-zinc-100 leading-snug">
                        Freelance Payment
                      </h4>
                      <p className="text-[11px] text-zinc-500 truncate max-w-[130px]">
                        Payment for invoice #INV-4421
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-rose-400 block">
                      -$800.00
                    </span>
                    <span className="text-[10px] text-zinc-500">Dec 14</span>
                  </div>
                </div>

                {/* Item 3: Salary Payment */}
                <div className="flex items-center justify-between py-1 group">
                  <div className="flex items-center gap-3">
                    {/* Visa Blue Card Icon */}
                    <div className="w-8 h-8 rounded-lg bg-indigo-950/40 border border-indigo-900/40 flex items-center justify-center text-indigo-400 text-[10px] font-bold shrink-0">
                      VISA
                    </div>
                    <div>
                      <h4 className="text-xs font-medium text-zinc-100 leading-snug">
                        Salary Payment
                      </h4>
                      <p className="text-[11px] text-zinc-500 truncate max-w-[130px]">
                        Acme Corporation SRL
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-rose-400 block">
                      -$2500.00
                    </span>
                    <span className="text-[10px] text-zinc-500">Dec 01</span>
                  </div>
                </div>
              </div>
            </div>

            {/* View All Button */}
            <button
              onClick={() => {
                const el = document.getElementById("payments-section");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="w-full mt-4 py-2 rounded-xl bg-[#202024] hover:bg-[#27272c] text-zinc-300 text-xs font-medium transition text-center"
            >
              View all
            </button>
          </div>

        </div>

        {/* ── Bottom Section: Payments / Case Intake Ledger ────────────────── */}
        <section id="payments-section" className="ref-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-100 tracking-tight">
                Payments
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manage your payments.
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
              View all
            </button>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2.5 flex-1 max-w-md">
              <div className="relative w-full">
                <input
                  type="text"
                  placeholder="Filter emails, accounts..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="ref-input w-full pr-8 text-xs"
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
                <option value="approved">Approved</option>
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
              </select>

              <button
                onClick={() => fetchAlerts()}
                className="ref-btn ref-btn-secondary text-xs flex items-center gap-1.5"
              >
                <SlidersHorizontal size={13} />
                <span>Columns</span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto pt-1">
            <table className="ref-table">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" className="rounded accent-blue-600 bg-zinc-900 border-zinc-700" />
                  </th>
                  <th className="w-28">Status</th>
                  <th>Email / Account</th>
                  <th>Typology</th>
                  <th className="w-28 text-right">Amount</th>
                  <th className="w-20 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-zinc-500 font-sans text-xs">
                      Loading payments and ledger records...
                    </td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-zinc-500 font-sans text-xs">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => {
                    const status = (alert.status || "new").toLowerCase();
                    return (
                      <tr key={alert.id} className="group">
                        <td>
                          <input type="checkbox" className="rounded accent-blue-600 bg-zinc-900 border-zinc-700" />
                        </td>
                        <td>
                          {status === "approved" ? (
                            <span className="pill-badge pill-green">Approved</span>
                          ) : status === "investigating" ? (
                            <span className="pill-badge pill-amber">In review</span>
                          ) : status === "rejected" ? (
                            <span className="pill-badge pill-rose">Dismissed</span>
                          ) : (
                            <span className="pill-badge pill-blue">New</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-col">
                            <span className="font-mono text-zinc-200 text-xs font-medium">
                              {alert.account_id || "m@example.com"}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Tx #{alert.transaction_id || alert.id.slice(0, 8)} • {formatDate(alert.timestamp)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="text-xs text-zinc-400 capitalize">
                            {(alert.typology || "unclassified").replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="text-right font-medium text-zinc-200 text-xs font-mono">
                          {formatCurrency(alert.amount)}
                        </td>
                        <td className="text-right">
                          <Link
                            href={`/alerts/${alert.id}`}
                            className="ref-btn ref-btn-secondary text-[11px] py-1 px-2.5 inline-flex opacity-80 group-hover:opacity-100"
                          >
                            <Eye size={12} />
                            View
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
          <div className="flex items-center justify-between pt-3 border-t border-[#222226] text-xs text-zinc-500">
            <span>
              Page {page} of {totalPages} ({totalAlerts} total results)
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
