"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Shield,
  Radio,
  Database,
  Building,
  Activity,
  FileText,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";

interface NavbarProps {
  currentAlertId?: string;
  onSeedSuccess?: () => void;
}

export default function Navbar({ currentAlertId, onSeedSuccess }: NavbarProps) {
  const pathname = usePathname();
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      await api.seedAll();
      await api.seedTypologies();
      setSeedMsg("Dataset re-seeded successfully.");
      if (onSeedSuccess) {
        onSeedSuccess();
      }
      setTimeout(() => setSeedMsg(null), 4000);
    } catch (err: any) {
      setSeedMsg(`Seed failed: ${err.message}`);
      setTimeout(() => setSeedMsg(null), 5000);
    } finally {
      setSeeding(false);
    }
  };

  const isHome = pathname === "/";
  const isMonitoring = pathname === "/monitoring";
  const isDossier = pathname.startsWith("/alerts/");

  return (
    <>
      {/* ── Official Federal Government Classification Banner ──────────────── */}
      <div className="gov-topbar flex flex-wrap items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-amber-400">FINANCIAL INTELLIGENCE UNIT (FIU)</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300">BSA / AML INVESTIGATION & SAR FILING COPILOT</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="text-emerald-400 font-mono flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            SYSTEM OPERATIONAL
          </span>
          <span className="text-slate-500 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">RESTRICTED // LAW ENFORCEMENT SENSITIVE</span>
        </div>
      </div>

      {/* ── Primary Application Header ───────────────────────────────────── */}
      <header className="fintel-nav px-4 sm:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Brand & Identity */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 group-hover:bg-blue-600/30 group-hover:border-blue-400 transition-all shadow-[0_0_15px_rgba(59,130,246,0.2)]">
              <Shield size={19} className="group-hover:scale-105 transition-transform" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white tracking-wider font-mono">FINTEL</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 font-mono border border-blue-700/50">
                  v1.0 FIU
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                AI Investigation Copilot & Evidence-Grounded SAR Filing
              </p>
            </div>
          </Link>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1.5 bg-[#0a1224] p-1 rounded-lg border border-slate-800">
            <Link
              href="/"
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all flex items-center gap-1.5 ${
                isHome
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Building size={13} />
              Intake Ledger
            </Link>

            {currentAlertId ? (
              <Link
                href={`/alerts/${currentAlertId}`}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all flex items-center gap-1.5 ${
                  isDossier
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <FileText size={13} />
                Case Dossier
              </Link>
            ) : isDossier ? (
              <span className="px-3 py-1.5 text-xs font-mono font-medium rounded-md bg-blue-600 text-white shadow-sm flex items-center gap-1.5">
                <FileText size={13} />
                Case Dossier
              </span>
            ) : null}

            <Link
              href="/monitoring"
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all flex items-center gap-1.5 ${
                isMonitoring
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <Radio size={13} className={isMonitoring ? "text-amber-300" : "text-amber-400"} />
              Telemetry
            </Link>
          </nav>

          {/* Action Center */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="gov-btn gov-btn-secondary text-[11px] py-1.5 px-3"
              id="global-seed-btn"
              title="Re-seed synthetic IEEE-CIS & PaySim benchmark datasets"
            >
              <Database size={13} className={seeding ? "animate-spin text-blue-400" : "text-slate-400"} />
              {seeding ? "Ingesting..." : "Re-Seed Data"}
            </button>
          </div>
        </div>

        {/* Ingest Status Toast */}
        {seedMsg && (
          <div className="max-w-7xl mx-auto mt-2 p-2 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-mono rounded flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-400" />
              {seedMsg}
            </span>
            <button onClick={() => setSeedMsg(null)} className="text-slate-400 hover:text-white text-[10px]">
              ✕
            </button>
          </div>
        )}
      </header>
    </>
  );
}
