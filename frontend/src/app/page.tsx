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
  Database,
  Building,
  FileCheck,
  Radio,
  FileText,
} from "lucide-react";
import { api, type Alert, type DashboardStats, type PaginatedAlerts } from "@/lib/api";

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
  if (score === null || score === undefined) return { label: "UNKNOWN", color: "#64748b", bg: "#1e293b", border: "#475569" };
  if (score >= 0.7) return { label: "TIER 1 (HIGH)", color: "#fca5a5", bg: "#450a0a", border: "#b91c1c" };
  if (score >= 0.4) return { label: "TIER 2 (ELEVATED)", color: "#fef08a", bg: "#422006", border: "#ca8a04" };
  return { label: "TIER 3 (LOW)", color: "#86efac", bg: "#052e16", border: "#16a34a" };
}

function getStatusBadge(status: string | null) {
  const s = (status || "new").toLowerCase();
  switch (s) {
    case "approved":
      return <span className="gov-badge gov-badge-approved">APPROVED FOR SAR</span>;
    case "investigating":
      return <span className="gov-badge gov-badge-investigating">UNDER REVIEW</span>;
    case "rejected":
      return <span className="gov-badge gov-badge-rejected">DISMISSED</span>;
    default:
      return <span className="gov-badge gov-badge-new">NEW CASE</span>;
  }
}

function getTypologyBadge(typology: string | null) {
  if (!typology || typology === "unclassified") {
    return <span className="gov-badge bg-slate-900 text-slate-400 border-slate-700">UNCLASSIFIED</span>;
  }
  const clean = typology.toUpperCase().replace(/_/g, " ");
  return <span className="gov-badge bg-blue-950/80 text-blue-200 border-blue-700">{clean}</span>;
}

// ─── Main Institutional Dashboard Page ──────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

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

  const handleSeedAll = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      await api.seedAll();
      await api.seedTypologies();
      setSeedMsg("Official benchmark dataset re-seeded successfully.");
      await fetchStats();
      await fetchAlerts();
    } catch (err: any) {
      setSeedMsg(`Seeding error: ${err.message}`);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070c16] text-slate-100 flex flex-col font-sans">
      {/* ── Official Federal Government Banner ────────────────────────────── */}
      <div className="gov-topbar flex flex-wrap items-center justify-between border-b border-[#243553]">
        <div className="flex items-center gap-3">
          <span className="font-bold text-amber-400">FINANCIAL INTELLIGENCE UNIT (FIU)</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-300">BSA / AML INVESTIGATION & SAR COPILOT</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="text-emerald-400 font-mono">● SYSTEM OPERATIONAL</span>
          <span className="text-slate-400">RESTRICTED // LAW ENFORCEMENT SENSITIVE</span>
        </div>
      </div>

      {/* ── Agency Portal Header ─────────────────────────────────────────── */}
      <header className="bg-[#0b1424] border-b border-[#243553] py-4 px-6 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[#1e3a8a] border border-[#3b82f6] flex items-center justify-center text-white">
              <Building size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-wide uppercase font-mono">
                Fintel Compliance & Case Intake Ledger
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Automated Transaction Anomaly Detection • Graph Ring Traversal • Evidence-Grounded SAR Filing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/monitoring"
              className="gov-btn gov-btn-secondary"
              id="header-monitoring-btn"
            >
              <Radio size={14} className="text-amber-400" />
              Telemetry / Grafana
            </Link>
            <button
              onClick={handleSeedAll}
              disabled={seeding}
              className="gov-btn gov-btn-primary"
              id="header-seed-btn"
            >
              <Database size={14} />
              {seeding ? "Ingesting..." : "Re-Seed Data"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Container ──────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-8 flex-1 w-full space-y-8">
        {/* Seed Notification */}
        {seedMsg && (
          <div className="p-3 bg-[#0d2818] border border-[#16a34a] text-emerald-300 text-xs font-mono flex items-center justify-between">
            <span>{seedMsg}</span>
            <button onClick={() => setSeedMsg(null)} className="text-slate-400 hover:text-white uppercase text-[10px]">
              Dismiss
            </button>
          </div>
        )}

        {/* ── Section 1: Official Summary Tiles ──────────────────────────── */}
        <section aria-labelledby="section-stats-title">
          <div className="border-b border-[#243553] pb-2 mb-4">
            <h2 id="section-stats-title" className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold">
              Aggregate Risk Ledger Statistics
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
            <div className="gov-panel">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Total Flagged Alerts
              </span>
              <div className="text-2xl font-bold font-mono text-white">
                {stats?.total_alerts?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                PaySim & IEEE-CIS Ingested
              </span>
            </div>

            <div className="gov-panel">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Pending Adjudication
              </span>
              <div className="text-2xl font-bold font-mono text-blue-300">
                {stats?.new_alerts?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Unassigned Case Queue
              </span>
            </div>

            <div className="gov-panel">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Active Investigations
              </span>
              <div className="text-2xl font-bold font-mono text-amber-300">
                {stats?.investigating?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Graph Traversal In Progress
              </span>
            </div>

            <div className="gov-panel">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Approved for SAR Filing
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {stats?.approved?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Citations Verified by Analyst
              </span>
            </div>

            <div className="gov-panel">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                High Risk (Tier 1)
              </span>
              <div className="text-2xl font-bold font-mono text-red-400">
                {stats?.high_risk_count?.toLocaleString() || "—"}
              </div>
              <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                Risk Score ≥ 0.70 Threshold
              </span>
            </div>
          </div>
        </section>

        {/* ── Section 2: Case Query & Filter Form ────────────────────────── */}
        <section className="gov-panel" aria-labelledby="section-filters-title">
          <div className="border-b border-[#243553] pb-2 mb-4 flex items-center justify-between">
            <h2 id="section-filters-title" className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold flex items-center gap-2">
              <Filter size={14} className="text-amber-400" />
              Alert Intake Query Controls
            </h2>
            <button
              onClick={() => {
                setStatusFilter("");
                setTypologyFilter("");
                setSearchQuery("");
                setMinRisk("");
                setPage(1);
              }}
              className="text-[11px] font-mono text-slate-400 hover:text-white uppercase cursor-pointer"
            >
              [Reset Filters]
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5 font-bold">
                Compliance Status
              </label>
              <select
                id="filter-status-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="gov-select"
              >
                <option value="">ALL STATUSES</option>
                <option value="new">NEW (PENDING)</option>
                <option value="investigating">UNDER ACTIVE REVIEW</option>
                <option value="approved">APPROVED FOR SAR</option>
                <option value="rejected">DISMISSED</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5 font-bold">
                Typology Classification
              </label>
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

            <div>
              <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5 font-bold">
                Minimum Risk Threshold
              </label>
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
                <option value="0.7">TIER 1 ONLY (≥ 0.70)</option>
                <option value="0.5">TIER 1 & 2 (≥ 0.50)</option>
                <option value="0.3">TIER 2+ (≥ 0.30)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5 font-bold">
                Search Account / Ref Number
              </label>
              <div className="relative">
                <input
                  id="filter-search-input"
                  type="text"
                  placeholder="e.g. MULE-A-001 or C123..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="gov-input"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 3: Official Case Ledger Table ───────────────────────── */}
        <section className="gov-panel p-0 overflow-hidden" aria-labelledby="section-ledger-title">
          <div className="bg-[#0b1424] p-4 border-b border-[#243553] flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="section-ledger-title" className="text-sm font-bold font-mono text-white tracking-wide uppercase flex items-center gap-2">
                <Shield size={16} className="text-[#3b82f6]" />
                Transaction Anomaly Ledger
              </h2>
              <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                Displaying {alerts.length} of {totalAlerts.toLocaleString()} matching system records
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchAlerts()}
                className="gov-btn gov-btn-secondary"
                id="refresh-ledger-btn"
                title="Refresh Table"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="gov-table">
              <thead>
                <tr>
                  <th>Alert Reference</th>
                  <th>Primary Account</th>
                  <th>Amount (USD)</th>
                  <th>Timestamp (UTC)</th>
                  <th>Assigned Typology</th>
                  <th>Risk Tier</th>
                  <th>Compliance Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400 font-mono text-xs">
                      Loading official ledger records from database...
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
                    return (
                      <tr key={alert.id} className="hover:bg-[#121f38] transition">
                        <td className="font-mono font-semibold text-slate-200">
                          {alert.transaction_id || alert.id.slice(0, 8)}
                        </td>
                        <td className="font-mono text-blue-300 font-medium">
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
                          <span
                            className="gov-badge"
                            style={{ background: tier.bg, color: tier.color, borderColor: tier.border }}
                          >
                            {tier.label} [{((alert.risk_score || 0) * 100).toFixed(0)}%]
                          </span>
                        </td>
                        <td>{getStatusBadge(alert.status)}</td>
                        <td>
                          <Link
                            href={`/alerts/${alert.id}`}
                            className="gov-btn gov-btn-primary"
                            id={`inspect-alert-${alert.id}`}
                          >
                            <Eye size={12} />
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

          {/* Table Pagination Controls */}
          <div className="bg-[#0b1424] p-4 border-t border-[#243553] flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
            <span className="text-slate-400">
              Page {page} of {totalPages} ({totalAlerts.toLocaleString()} records)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gov-btn gov-btn-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                id="pagination-prev-btn"
              >
                <ChevronLeft size={14} />
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="gov-btn gov-btn-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                id="pagination-next-btn"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>

        {/* ── Section 4: Administrative Benchmark Info ────────────────────── */}
        <section className="gov-panel bg-[#090f1b]" aria-labelledby="section-admin-title">
          <div className="border-b border-[#243553] pb-2 mb-3">
            <h3 id="section-admin-title" className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold flex items-center gap-2">
              <FileCheck size={14} className="text-emerald-400" />
              Regulatory Compliance Standard Note
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            In compliance with federal reporting mandates (31 CFR § 1020.320), Fintel enforces strict evidence traceability.
            Case narratives generated by the intelligence copilot map every claim to real source records before regulatory sign-off.
            Analyst adjudication requires human-in-the-loop review before any report is finalized.
          </p>
        </section>
      </main>
    </div>
  );
}
