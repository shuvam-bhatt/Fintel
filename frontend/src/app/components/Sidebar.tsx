"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  Activity,
  Database,
  Share2,
  CheckCircle2,
  Shield,
  HelpCircle,
  Radio,
  ExternalLink,
  Layers,
} from "lucide-react";
import { api } from "@/lib/api";

interface SidebarProps {
  currentAlertId?: string;
  onSeedSuccess?: () => void;
}

export default function Sidebar({ currentAlertId, onSeedSuccess }: SidebarProps) {
  const pathname = usePathname();
  const [seeding, setSeeding] = useState(false);
  const [seedToast, setSeedToast] = useState<string | null>(null);
  const [firstAlertId, setFirstAlertId] = useState<string | null>(null);

  const isDashboard = pathname === "/";
  const isDossier = pathname.startsWith("/alerts");
  const isMonitoring = pathname === "/monitoring";

  // Fetch the first alert id so Active Dossier always points to a real alert
  useEffect(() => {
    api.getAlerts({ page: 1, page_size: 1 })
      .then((res) => {
        if (res.items && res.items.length > 0) {
          setFirstAlertId(res.items[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleSeedData = async () => {
    setSeeding(true);
    try {
      await api.seedAll();
      await api.seedTypologies();
      setSeedToast("Benchmark datasets re-seeded successfully!");
      if (onSeedSuccess) onSeedSuccess();
      setTimeout(() => setSeedToast(null), 3500);
    } catch (err: any) {
      setSeedToast(`Seeding error: ${err.message}`);
      setTimeout(() => setSeedToast(null), 4000);
    } finally {
      setSeeding(false);
    }
  };

  const dossierHref = currentAlertId
    ? `/alerts/${currentAlertId}`
    : firstAlertId
    ? `/alerts/${firstAlertId}`
    : `/alerts/a2744e66-fbab-4ee4-9d1d-ab23ca057765`;

  return (
    <aside className="w-60 bg-[#111114] border-r border-[#222226] flex flex-col justify-between shrink-0 h-screen sticky top-0 text-sm select-none z-30">
      {/* ── Top Navigation Section ───────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
        
        {/* Brand Header */}
        <Link href="/" className="flex items-center gap-2.5 px-1 py-1 group">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:bg-blue-500 transition">
            <Shield size={17} />
          </div>
          <div className="flex flex-col text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-zinc-100 tracking-tight leading-none">
                Fintel
              </span>
              <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 leading-none">
                AML
              </span>
            </div>
            <span className="text-[11px] text-zinc-500 leading-tight mt-0.5">
              Investigation Copilot
            </span>
          </div>
        </Link>

        {/* Primary Navigation */}
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-2.5 block mb-1">
            Navigation
          </span>

          <Link
            href="/"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition ${
              isDashboard
                ? "bg-[#1f1f24] text-white font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c]"
            }`}
          >
            <LayoutDashboard size={15} className={isDashboard ? "text-blue-400" : "text-zinc-400"} />
            <span>Alerts Ledger</span>
          </Link>

          <Link
            href={dossierHref}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition ${
              isDossier
                ? "bg-[#1f1f24] text-white font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c]"
            }`}
          >
            <FileText size={15} className={isDossier ? "text-blue-400" : "text-zinc-400"} />
            <span>Case Dossier</span>
          </Link>

          <Link
            href="/monitoring"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition ${
              isMonitoring
                ? "bg-[#1f1f24] text-white font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c]"
            }`}
          >
            <Activity size={15} className={isMonitoring ? "text-blue-400" : "text-zinc-400"} />
            <span>Telemetry & Audit</span>
          </Link>
        </div>

        {/* Management & Actions */}
        <div className="space-y-1 pt-1">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-2.5 block mb-1">
            Actions & Tools
          </span>

          <button
            onClick={handleSeedData}
            disabled={seeding}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition cursor-pointer text-left"
          >
            <div className="flex items-center gap-2.5">
              <Database size={15} className={seeding ? "animate-spin text-blue-400" : "text-zinc-400"} />
              <span>Re-Seed Data</span>
            </div>
            <span className="text-[10px] text-blue-400 font-mono">
              {seeding ? "Syncing..." : "Run"}
            </span>
          </button>

          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <div className="flex items-center gap-2.5">
              <HelpCircle size={15} className="text-zinc-400" />
              <span>API Swagger Docs</span>
            </div>
            <ExternalLink size={12} className="text-zinc-500" />
          </a>

          <a
            href="http://localhost:8000/metrics"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <div className="flex items-center gap-2.5">
              <Radio size={15} className="text-emerald-400" />
              <span>Prometheus /metrics</span>
            </div>
            <ExternalLink size={12} className="text-zinc-500" />
          </a>

          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <div className="flex items-center gap-2.5">
              <Activity size={15} className="text-amber-400" />
              <span>Grafana Portal</span>
            </div>
            <ExternalLink size={12} className="text-zinc-500" />
          </a>
        </div>

        {/* Re-seed Toast */}
        {seedToast && (
          <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono flex items-center gap-2">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            <span className="truncate">{seedToast}</span>
          </div>
        )}
      </div>

      {/* ── Minimalist Bottom System Status ─────────────────────────────── */}
      <div className="border-t border-[#222226] p-3 text-[11px] text-zinc-500 space-y-1 font-mono">
        <div className="flex items-center justify-between">
          <span>Engine</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Online
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span>Database</span>
          <span className="text-zinc-400">PostgreSQL 16</span>
        </div>
      </div>
    </aside>
  );
}
