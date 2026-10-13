"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  Eye,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Building,
  FileCheck,
  Radio,
  Flame,
  Clock,
  Layers,
  ArrowUpRight,
  SlidersHorizontal,
} from "lucide-react";
import { api, type Alert, type DashboardStats, type PaginatedAlerts } from "@/lib/api";
import Navbar from "./components/Navbar";

// ─── Utility Formatters ─────────────────────────────────────────────────────

function formatAmount(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

function getRiskTier(score: number | null) {
  if (score === null || score === undefined) {
    return { label: "UNKNOWN", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)", border: "rgba(148, 163, 184, 0.3)" };
  }
  if (score >= 0.7) {
    return { label: "TIER 1 (HIGH)", color: "#f87171", bg: "rgba(239, 68, 68, 0.15)", border: "rgba(239, 68, 68, 0.35)" };
  }
  if (score >= 0.4) {
    return { label: "TIER 2 (ELEVATED)", color: "#fbbf24", bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.35)" };
  }
  return { label: "TIER 3 (LOW)", color: "#34d399", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.35)" };
}

function getStatusBadge(status: string | null) {
  const s = (status || "new").toLowerCase();
  switch (s) {
    case "approved":
      return (
        <span className="gov-badge gov-badge-approved">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          APPROVED FOR SAR
        </span>
      );
    case "investigating":
      return (
        <span className="gov-badge gov-badge-investigating">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          UNDER REVIEW
        </span>
      );
    case "rejected":
      return (
        <span className="gov-badge gov-badge-rejected">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          DISMISSED
        </span>
      );
    default:
      return (
        <span className="gov-badge gov-badge-new">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          NEW CASE
        </span>
      );
  }
}

function getTypologyBadge(typology: string | null) {
  if (!typology || typology === "unclassified") {
    return <span className="gov-badge text-slate-400 border-slate-700/60 bg-slate-900/60">UNCLASSIFIED</span>;
  }
  const clean = typology.toUpperCase().replace(/_/g, " ");
  return <span className="gov-badge text-blue-300 border-blue-700/50 bg-blue-950/70">{clean}</span>;
}

// ─── Main Institutional Dashboard Page ──────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typologyFilter, setTypologyFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [minRisk, setMinRisk] = useState<string>("");

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
        min_risk: minRisk ? parseFloat(minRisk) : undefined,
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
  }, [page, pageSize, statusFilter, typologyFilter, minRisk, searchQuery]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleResetFilters = () => {
    setStatusFilter("");
    setTypologyFilter("");
    setSearchQuery("");
    setMinRisk("");
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-slate-100 flex flex-col font-sans">
      <Navbar onSeedSuccess={() => { fetchStats(); fetchAlerts(); }} />

      {/* ── Main Dashboard Workspace ────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex-1 w-full space-y-5">
        
        {/* ── KPI Executive Metric Ribbon ────────────────────────────────── */}
        <section aria-labelledby="section-stats-title">
          <div className="flex items-center justify-between mb-2.5">
            <h2 id="section-stats-title" className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold flex items-center gap-2">
              <BarChart3 size={14} className="text-blue-400" />
              Aggregate Surveillance & Risk Ledger
            </h2>
            <span className="text-[11px] font-mono text-slate-500">
              Surveillance Engine: IEEE-CIS & PaySim Ingest Active
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="kpi-card">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Total Flagged Alerts
              </span>
              <div className="text-2xl font-bold font-mono text-white">
                {stats?.total_alerts?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Benchmark Ingested
              </span>
            </div>

            <div className="kpi-card">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Pending Adjudication
              </span>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {stats?.new_alerts?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Unassigned Case Queue
              </span>
            </div>

            <div className="kpi-card">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Active Investigations
              </span>
              <div className="text-2xl font-bold font-mono text-amber-400">
                {stats?.investigating?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Graph Traversal In Progress
              </span>
            </div>

            <div className="kpi-card">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                SAR Approved Cases
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {stats?.approved?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Citations Verified by FIU
              </span>
            </div>

            <div className="kpi-card col-span-2 sm:col-span-1">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Flame size={12} className="text-rose-400" />
                Tier 1 High Risk
              </span>
              <div className="text-2xl font-bold font-mono text-rose-400">
                {stats?.high_risk_count?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Risk Score ≥ 0.70 Threshold
              </span>
            </div>
          </div>
        </section>

        {/* ── Transaction Intake Ledger with Integrated Controls ─────────── */}
        <section className="gov-panel p-0 overflow-hidden" aria-labelledby="section-ledger-title">
          
          {/* Integrated Control Header */}
          <div className="bg-[#0b1324] border-b border-slate-800 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Shield size={16} />
                </div>
                <div>
                  <h2 id="section-ledger-title" className="text-sm font-bold font-mono text-white tracking-wide uppercase flex items-center gap-2">
                    Case Intake & Transaction Anomaly Ledger
                  </h2>
                  <span className="text-[11px] font-mono text-slate-400 block">
                    Showing {alerts.length} of {totalAlerts.toLocaleString()} matching system records
                  </span>
                </div>
              </div>

              {/* Status Quick Filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => { setStatusFilter(""); setPage(1); }}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-all ${
                    statusFilter === ""
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  ALL ({totalAlerts})
                </button>
                <button
                  onClick={() => { setStatusFilter("new"); setPage(1); }}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-all ${
                    statusFilter === "new"
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  NEW ({stats?.new_alerts || 0})
                </button>
                <button
                  onClick={() => { setStatusFilter("investigating"); setPage(1); }}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-all ${
                    statusFilter === "investigating"
                      ? "bg-amber-600 text-white border-amber-500"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  REVIEW ({stats?.investigating || 0})
                </button>
                <button
                  onClick={() => { setStatusFilter("approved"); setPage(1); }}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-all ${
                    statusFilter === "approved"
                      ? "bg-emerald-600 text-white border-emerald-500"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  APPROVED ({stats?.approved || 0})
                </button>
                <button
                  onClick={() => { setStatusFilter("rejected"); setPage(1); }}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-all ${
                    statusFilter === "rejected"
                      ? "bg-rose-600 text-white border-rose-500"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  DISMISSED ({stats?.rejected || 0})
                </button>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-2.5 pt-1">
              {/* Search Box */}
              <div className="md:col-span-5 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  id="filter-search-input"
                  type="text"
                  placeholder="Search Account ID, Transaction Ref..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="gov-input pl-8"
                />
              </div>

              {/* Typology Dropdown */}
              <div className="md:col-span-3">
                <select
                  id="filter-typology-select"
                  value={typologyFilter}
                  onChange={(e) => {
                    setTypologyFilter(e.target.value);
                    setPage(1);
                  }}
                  className="gov-select"
                >
                  <option value="">ALL TYPOLOGIES</option>
                  <option value="mule_network">MULE NETWORK</option>
                  <option value="structuring">STRUCTURING (SMURFING)</option>
                  <option value="rapid_movement">RAPID MOVEMENT</option>
                  <option value="layering">CIRCULAR LAYERING</option>
                  <option value="synthetic_identity">SYNTHETIC IDENTITY</option>
                </select>
              </div>

              {/* Risk Tier Dropdown */}
              <div className="md:col-span-2">
                <select
                  id="filter-min-risk-select"
                  value={minRisk}
                  onChange={(e) => {
                    setMinRisk(e.target.value);
                    setPage(1);
                  }}
                  className="gov-select"
                >
                  <option value="">ALL SCORES</option>
                  <option value="0.7">TIER 1 (≥ 0.70)</option>
                  <option value="0.4">TIER 2+ (≥ 0.40)</option>
                  <option value="0.2">TIER 3+ (≥ 0.20)</option>
                </select>
              </div>

              {/* Reset & Refresh Controls */}
              <div className="md:col-span-2 flex items-center gap-1.5">
                <button
                  onClick={handleResetFilters}
                  className="gov-btn gov-btn-secondary flex-1 text-xs py-2"
                  title="Clear all filters"
                >
                  Reset
                </button>
                <button
                  onClick={() => fetchAlerts()}
                  className="gov-btn gov-btn-secondary py-2 px-2.5"
                  id="refresh-ledger-btn"
                  title="Refresh Table"
                >
                  <RefreshCw size={13} className={loading ? "animate-spin text-blue-400" : ""} />
                </button>
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="gov-table">
              <thead>
                <tr>
                  <th className="w-[140px]">Alert Reference</th>
                  <th className="w-[160px]">Account ID</th>
                  <th className="w-[130px]">Amount (USD)</th>
                  <th className="w-[170px]">Timestamp (UTC)</th>
                  <th className="w-[180px]">Assigned Typology</th>
                  <th className="w-[180px]">Risk Tier</th>
                  <th className="w-[150px]">Compliance Status</th>
                  <th className="w-[110px] text-right pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400 font-mono text-xs">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-blue-400" />
                        <span>Loading official ledger records from surveillance database...</span>
                      </div>
                    </td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400 font-mono text-xs">
                      No records match the selected query criteria.
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => {
                    const tier = getRiskTier(alert.risk_score);
                    const riskPercent = Math.round((alert.risk_score || 0) * 100);
                    return (
                      <tr key={alert.id} className="border-b border-slate-800/60">
                        <td className="font-mono font-semibold text-slate-200">
                          {alert.transaction_id || alert.id.slice(0, 8)}
                        </td>
                        <td className="font-mono text-blue-400 font-medium">
                          {alert.account_id || "UNIDENTIFIED"}
                        </td>
                        <td className="font-mono text-emerald-400 font-semibold">
                          {formatAmount(alert.amount)}
                        </td>
                        <td className="font-mono text-slate-400 text-[11px]">
                          {formatDate(alert.timestamp)}
                        </td>
                        <td>{getTypologyBadge(alert.typology)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span
                              className="gov-badge"
                              style={{ background: tier.bg, color: tier.color, borderColor: tier.border }}
                            >
                              {tier.label} [{riskPercent}%]
                            </span>
                            <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden hidden xl:block">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${riskPercent}%`,
                                  background: tier.color,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td>{getStatusBadge(alert.status)}</td>
                        <td className="text-right pr-4">
                          <Link
                            href={`/alerts/${alert.id}`}
                            className="gov-btn gov-btn-primary text-[11px] py-1 px-2.5 inline-flex"
                            id={`inspect-alert-${alert.id}`}
                          >
                            <Eye size={12} />
                            Dossier
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination Footer */}
          <div className="bg-[#0b1324] border-t border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
            <span className="text-slate-400">
              Page {page} of {totalPages} ({totalAlerts.toLocaleString()} records total)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gov-btn gov-btn-secondary text-xs py-1 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
                id="pagination-prev-btn"
              >
                <ChevronLeft size={13} />
                Previous
              </button>
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="gov-btn gov-btn-secondary text-xs py-1 px-3 disabled:opacity-30 disabled:cursor-not-allowed"
                id="pagination-next-btn"
              >
                Next
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </section>

        {/* ── Regulatory Compliance Standard Card ─────────────────────────── */}
        <section className="gov-panel py-3.5 px-4.5 bg-slate-900/40 border border-slate-800" aria-labelledby="section-admin-title">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mt-0.5">
              <FileCheck size={16} />
            </div>
            <div>
              <h3 id="section-admin-title" className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                Regulatory Mandate: 31 CFR § 1020.320 SAR Evidence Traceability Standard
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed font-sans mt-0.5">
                Every claim generated by the Fintel Copilot is directly cited against ingested transaction telemetry,
                knowledge-graph entity hops, or historical typology precedents. Analyst review and human-in-the-loop sign-off
                are required before FinCEN filing submission.
              </p>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
