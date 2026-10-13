"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  Activity,
  Database,
  FileSpreadsheet,
  Sparkles,
  History,
  HelpCircle,
  Settings,
  Search,
  ChevronsUpDown,
  Share2,
  CheckCircle2,
  Building2,
  Shield,
  Layers,
  Flame,
  Radio,
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

  const isDashboard = pathname === "/";
  const isDossier = pathname.startsWith("/alerts");
  const isMonitoring = pathname === "/monitoring";

  const handleSeedData = async () => {
    setSeeding(true);
    try {
      await api.seedAll();
      await api.seedTypologies();
      setSeedToast("Dataset re-seeded successfully!");
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
    : `/alerts/a2744e66-fbab-4ee4-9d1d-ab23ca057765`;

  return (
    <aside className="w-64 bg-[#111114] border-r border-[#222226] flex flex-col justify-between shrink-0 h-screen sticky top-0 text-sm select-none z-30">
      {/* ── Top Section ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-y-auto px-3 py-3 space-y-4">
        
        {/* Workspace Switcher Pill */}
        <div className="flex items-center justify-between p-2 rounded-xl bg-[#18181c] hover:bg-[#1f1f24] border border-[#27272a] transition cursor-pointer group">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Building2 size={18} />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-semibold text-zinc-100 tracking-tight leading-snug">
                Fintel FIU
              </span>
              <span className="text-[11px] text-zinc-400 font-normal leading-none">
                Enterprise
              </span>
            </div>
          </div>
          <ChevronsUpDown size={15} className="text-zinc-500 group-hover:text-zinc-300" />
        </div>

        {/* Primary Navigation Group */}
        <nav className="space-y-1">
          <Link
            href="/"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
              isDashboard
                ? "bg-[#222228] text-white shadow-sm font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c]"
            }`}
          >
            <LayoutDashboard size={16} className={isDashboard ? "text-blue-400" : "text-zinc-400"} />
            <span>Dashboard</span>
          </Link>

          <Link
            href="/"
            className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <div className="flex items-center gap-3">
              <ShieldAlert size={16} className="text-zinc-400" />
              <span>Accounts & Queue</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300">
              1,000
            </span>
          </Link>

          <Link
            href={dossierHref}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
              isDossier
                ? "bg-[#222228] text-white shadow-sm font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c]"
            }`}
          >
            <FileText size={16} className={isDossier ? "text-blue-400" : "text-zinc-400"} />
            <span>Active Dossier</span>
          </Link>

          <Link
            href={dossierHref}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <Share2 size={16} className="text-zinc-400" />
            <span>Network Graph</span>
          </Link>

          <Link
            href="/monitoring"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition ${
              isMonitoring
                ? "bg-[#222228] text-white shadow-sm font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c]"
            }`}
          >
            <Activity size={16} className={isMonitoring ? "text-blue-400" : "text-zinc-400"} />
            <span>Activity & Audit</span>
          </Link>
        </nav>

        {/* Tools & Support Group */}
        <div className="pt-2 space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider px-3 block mb-1">
            Tools & support
          </span>

          <button
            onClick={handleSeedData}
            disabled={seeding}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <Database size={16} className={seeding ? "animate-spin text-blue-400" : "text-zinc-400"} />
              <span>Data library</span>
            </div>
            <span className="text-[10px] text-blue-400 font-mono">
              {seeding ? "Sync..." : "Re-Seed"}
            </span>
          </button>

          <Link
            href={dossierHref}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <FileSpreadsheet size={16} className="text-zinc-400" />
            <span>SAR Reports</span>
          </Link>

          <Link
            href="/monitoring"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <Sparkles size={16} className="text-zinc-400" />
            <span>Word Assistant</span>
          </Link>

          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <History size={16} className="text-zinc-400" />
            <span>Trash / Dismissed</span>
          </Link>

          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
          >
            <HelpCircle size={16} className="text-zinc-400" />
            <span>API Docs & Help</span>
          </a>
        </div>

        {/* Re-seed Toast */}
        {seedToast && (
          <div className="mx-1 p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono flex items-center gap-2">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            <span className="truncate">{seedToast}</span>
          </div>
        )}
      </div>

      {/* ── Pinned Bottom Section ────────────────────────────────────────── */}
      <div className="border-t border-[#222226] p-3 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition cursor-pointer">
          <Settings size={16} />
          <span>Settings</span>
        </div>

        <a
          href="http://localhost:8000/metrics"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition"
        >
          <Radio size={16} className="text-emerald-400" />
          <span>Telemetry Scrape</span>
        </a>

        <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#18181c] transition cursor-pointer">
          <div className="flex items-center gap-3">
            <Search size={16} />
            <span>Search</span>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            ⌘K
          </span>
        </div>

        {/* User Profile Pill at Bottom */}
        <div className="flex items-center justify-between p-2 rounded-xl hover:bg-[#18181c] transition cursor-pointer mt-2 group">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              JD
            </div>
            <div className="flex flex-col text-left truncate">
              <span className="text-xs font-semibold text-zinc-100 truncate">
                Agent Shaw
              </span>
              <span className="text-[11px] text-zinc-500 truncate">
                shaw@fintel.gov
              </span>
            </div>
          </div>
          <ChevronsUpDown size={14} className="text-zinc-500 group-hover:text-zinc-300 shrink-0 ml-1" />
        </div>
      </div>
    </aside>
  );
}
