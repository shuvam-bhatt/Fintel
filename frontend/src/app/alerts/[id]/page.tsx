"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  Share2,
  FileText,
  Clock,
  Layers,
  Sparkles,
  Edit3,
  ThumbsUp,
  ThumbsDown,
  Info,
  RefreshCw,
  Eye,
  Database,
  Building,
  DollarSign,
  User,
  Smartphone,
  Globe,
  Radio,
  ExternalLink,
  FileCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  api,
  type Alert,
  type Entity,
  type Investigation,
  type Narrative,
  type Citation,
  type InvestigateResult,
  type SimilarCase,
} from "@/lib/api";
import Navbar from "../../components/Navbar";

// ─── Formatters & Utility Helpers ───────────────────────────────────────────

function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

function getRiskTier(score: number | null | undefined) {
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

function getEntityIcon(type: string | null) {
  switch (type?.toLowerCase()) {
    case "account":
      return <User size={12} className="text-blue-400" />;
    case "device":
      return <Smartphone size={12} className="text-cyan-400" />;
    case "counterparty":
      return <Globe size={12} className="text-amber-400" />;
    case "amount":
      return <DollarSign size={12} className="text-emerald-400" />;
    default:
      return <Layers size={12} className="text-slate-400" />;
  }
}

// ─── Case Dossier Page ──────────────────────────────────────────────────────

export default function AlertDetailPage() {
  const params = useParams();
  const router = useRouter();
  const alertId = params?.id as string;

  const showAlert = (msg: string) => {
    if (typeof window !== "undefined") {
      window.alert(msg);
    }
  };

  // Data states
  const [alert, setAlert] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Investigation states
  const [investigating, setInvestigating] = useState(false);
  const [investigationData, setInvestigationData] = useState<InvestigateResult | null>(null);

  // Narrative states
  const [generatingNarrative, setGeneratingNarrative] = useState(false);
  const [narrativeText, setNarrativeText] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [currentNarrativeId, setCurrentNarrativeId] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [selectedSentenceIdx, setSelectedSentenceIdx] = useState<number | null>(null);

  // Editing mode
  const [isEditingNarrative, setIsEditingNarrative] = useState(false);
  const [editableNarrative, setEditableNarrative] = useState("");

  // Similar cases (RAG)
  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([]);
  const [loadingRAG, setLoadingRAG] = useState(false);

  // Active view tab
  const [activeTab, setActiveTab] = useState<"graph" | "timeline" | "entities" | "rag">("graph");

  // Raw payload toggle
  const [showRawPayload, setShowRawPayload] = useState(false);

  // Decision state
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);

  // Load alert record
  const fetchAlert = useCallback(async () => {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAlert(alertId);
      setAlert(data);

      if (data.investigations && data.investigations.length > 0) {
        const latestInv = data.investigations[0];
        setInvestigationData({
          investigation_id: latestInv.id,
          alert_id: alertId,
          linked_entities: Array.isArray(latestInv.linked_entities) ? latestInv.linked_entities : [],
          evidence_chain: [],
          verdict: latestInv.verdict || "likely_suspicious",
          confidence: latestInv.confidence || 0.85,
        });

        if (latestInv.narratives && latestInv.narratives.length > 0) {
          const latestNarrative = latestInv.narratives[0];
          setCurrentNarrativeId(latestNarrative.id);
          setNarrativeText(latestNarrative.narrative_text || "");
          setEditableNarrative(latestNarrative.edited_text || latestNarrative.narrative_text || "");
          setCitations(latestNarrative.citations || []);
        }
      }

      // Fetch RAG similarities
      if (data.raw_text) {
        setLoadingRAG(true);
        api.retrieveSimilar(data.raw_text, 3)
          .then((res) => setSimilarCases(res.similar_cases || []))
          .catch((err) => console.error("RAG retrieval error:", err))
          .finally(() => setLoadingRAG(false));
      }
    } catch (err: any) {
      console.error("Failed to load case file:", err);
      setError(err.message || "Failed to load case record from database.");
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    fetchAlert();
  }, [fetchAlert]);

  // Run Investigation Agent
  const handleInvestigate = async () => {
    if (!alertId) return;
    setInvestigating(true);
    try {
      const result = await api.investigate(alertId);
      setInvestigationData(result);
      await fetchAlert();

      if (!narrativeText) {
        await handleGenerateNarrative(result);
      }
    } catch (err: any) {
      console.error("Investigation execution failed:", err);
      showAlert(`Investigation Agent execution failed: ${err.message}`);
    } finally {
      setInvestigating(false);
    }
  };

  // Generate Narrative
  const handleGenerateNarrative = async (invResult?: InvestigateResult) => {
    let inv = invResult || investigationData;
    if (!alert) return;
    setGeneratingNarrative(true);
    try {
      if (!inv && alertId) {
        try {
          inv = await api.investigate(alertId);
          setInvestigationData(inv);
        } catch (e) {
          console.warn("Auto-investigation fallback", e);
        }
      }
      const payload = {
        investigation_id: inv?.investigation_id,
        alert_id: alertId,
        alert: alert,
        linked_entities: inv?.linked_entities || [],
        verdict: inv?.verdict || "suspicious",
      };
      const res = await api.generateNarrative(payload);
      setNarrativeText(res.narrative_text);
      setEditableNarrative(res.narrative_text);
      setCitations(res.citations || []);
      setCurrentNarrativeId(res.narrative_id);
    } catch (err: any) {
      console.error("Narrative drafting failed:", err);
      showAlert(`SAR draft generation failed: ${err.message}`);
    } finally {
      setGeneratingNarrative(false);
    }
  };

  // Submit Adjudication
  const handleSubmitDecision = async (decision: "approved" | "rejected" | "edited") => {
    setSubmittingDecision(true);
    try {
      if (currentNarrativeId) {
        await api.narrativeDecision(
          currentNarrativeId,
          decision,
          decision === "edited" ? editableNarrative : undefined
        );
      }
      await api.submitDecision(alertId, decision === "edited" ? "approved" : decision);

      setDecisionSuccess(`OFFICIAL RECORD: Case status successfully updated to ${decision.toUpperCase()}.`);
      setTimeout(() => setDecisionSuccess(null), 5000);
      setIsEditingNarrative(false);
      await fetchAlert();
    } catch (err: any) {
      console.error("Adjudication submission failed:", err);
      showAlert(`Adjudication submission error: ${err.message}`);
    } finally {
      setSubmittingDecision(false);
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-slate-100 flex items-center justify-center p-8 font-mono">
        <div className="gov-panel p-6 text-center max-w-md w-full">
          <RefreshCw className="animate-spin text-blue-400 mx-auto mb-3" size={24} />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Accessing Federal Case Ledger</h2>
          <p className="text-xs text-slate-400">Loading Case #{alertId?.slice(0, 8)} records from database...</p>
        </div>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-slate-100 flex items-center justify-center p-8 font-mono">
        <div className="gov-panel p-6 text-center max-w-md w-full">
          <AlertTriangle className="text-red-400 mx-auto mb-3" size={28} />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Case File Record Not Found</h2>
          <p className="text-xs text-slate-400 mb-4">{error || "Unable to locate alert identifier in system."}</p>
          <Link href="/" className="gov-btn gov-btn-secondary inline-flex">
            <ChevronLeft size={14} /> Return to Queue
          </Link>
        </div>
      </div>
    );
  }

  const sentences = narrativeText
    ? narrativeText.match(/[^.!?]+[.!?]+/g) || [narrativeText]
    : [];

  const riskScore = alert.risk_score || 0;
  const tier = getRiskTier(riskScore);

  return (
    <div className="min-h-screen bg-[var(--background)] text-slate-100 flex flex-col font-sans">
      <Navbar currentAlertId={alert.id} />

      {/* ── Case Control Header ───────────────────────────────────────────── */}
      <div className="bg-[#0b1324] border-b border-slate-800 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="gov-btn gov-btn-secondary py-1.5 px-3 text-xs"
              id="back-to-queue-btn"
            >
              <ChevronLeft size={13} /> Back to Ledger
            </Link>
            <div className="h-4 w-px bg-slate-800" />
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="gov-badge"
                  style={{ background: tier.bg, color: tier.color, borderColor: tier.border }}
                >
                  {tier.label} [{(riskScore * 100).toFixed(0)}%]
                </span>
                <span className="gov-badge bg-blue-950/70 text-blue-300 border-blue-800/60">
                  {alert.typology ? alert.typology.toUpperCase().replace(/_/g, " ") : "UNCLASSIFIED"}
                </span>
                <span className="gov-badge bg-slate-900/60 text-slate-300 border-slate-700/60">
                  STATUS: {alert.status?.toUpperCase() || "NEW"}
                </span>
              </div>
              <h1 className="text-sm font-bold text-white font-mono tracking-wide mt-1">
                Primary Subject: {alert.account_id || "Unidentified Account"} (Tx #{alert.transaction_id || alert.id.slice(0, 8)})
              </h1>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2">
            <button
              id="run-agent-btn"
              onClick={handleInvestigate}
              disabled={investigating}
              className="gov-btn gov-btn-primary py-1.5 px-3.5 text-xs"
            >
              <Share2 size={13} className={investigating ? "animate-spin" : ""} />
              {investigating ? "Traversing Network..." : "Execute Graph Agent"}
            </button>
            <button
              id="generate-narrative-btn"
              onClick={() => handleGenerateNarrative()}
              disabled={generatingNarrative}
              className="gov-btn gov-btn-secondary py-1.5 px-3.5 text-xs"
            >
              <FileText size={13} className={generatingNarrative ? "animate-spin text-blue-400" : ""} />
              {generatingNarrative ? "Drafting SAR..." : narrativeText ? "Regenerate SAR Draft" : "Draft SAR Narrative"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Investigation Body ───────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex-1 w-full space-y-4">
        {/* Success Alert */}
        {decisionSuccess && (
          <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-lg text-emerald-300 text-xs font-mono flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} />
              <span>{decisionSuccess}</span>
            </div>
            <button
              onClick={() => setDecisionSuccess(null)}
              className="text-slate-400 hover:text-white text-[10px]"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Compact Case Parameter Ribbon ────────────────────────────────── */}
        <section className="gov-panel p-3.5" aria-labelledby="section-case-summary">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                Transaction Ref
              </span>
              <span className="text-xs font-mono font-bold text-white block mt-0.5 truncate">
                {alert.transaction_id || "NOT ASSIGNED"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                Account ID / BIC
              </span>
              <span className="text-xs font-mono font-bold text-blue-400 block mt-0.5 truncate">
                {alert.account_id || "UNIDENTIFIED"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                Transaction Amount
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400 block mt-0.5">
                {formatAmount(alert.amount)} {alert.currency || "USD"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                Execution Timestamp
              </span>
              <span className="text-xs font-mono text-slate-300 block mt-0.5 truncate">
                {formatDate(alert.timestamp)}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                Composite Risk Tier
              </span>
              <span
                className="gov-badge mt-0.5 text-[10px] py-0.5"
                style={{ background: tier.bg, color: tier.color, borderColor: tier.border }}
              >
                {tier.label}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                Typology Classification
              </span>
              <span className="text-xs font-mono font-bold text-amber-300 block mt-0.5 truncate">
                {(alert.typology || "unclassified").toUpperCase().replace(/_/g, " ")}
              </span>
            </div>
          </div>
        </section>

        {/* ── Two-Column High-Efficiency Dossier Workspace ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          
          {/* Left Column: Evidence, Graph & Timeline (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            
            {/* View Switcher Tabs */}
            <div className="gov-panel p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                  <button
                    id="tab-graph-btn"
                    onClick={() => setActiveTab("graph")}
                    className={`px-3 py-1.5 font-semibold uppercase rounded-md transition text-xs flex items-center gap-1.5 ${
                      activeTab === "graph"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Share2 size={12} />
                    Knowledge Graph
                  </button>
                  <button
                    id="tab-timeline-btn"
                    onClick={() => setActiveTab("timeline")}
                    className={`px-3 py-1.5 font-semibold uppercase rounded-md transition text-xs flex items-center gap-1.5 ${
                      activeTab === "timeline"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Clock size={12} />
                    Velocity Log
                  </button>
                  <button
                    id="tab-entities-btn"
                    onClick={() => setActiveTab("entities")}
                    className={`px-3 py-1.5 font-semibold uppercase rounded-md transition text-xs flex items-center gap-1.5 ${
                      activeTab === "entities"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Layers size={12} />
                    Entities ({alert.entities?.length || 0})
                  </button>
                  <button
                    id="tab-rag-btn"
                    onClick={() => setActiveTab("rag")}
                    className={`px-3 py-1.5 font-semibold uppercase rounded-md transition text-xs flex items-center gap-1.5 ${
                      activeTab === "rag"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <FileCheck size={12} />
                    Precedents ({similarCases.length})
                  </button>
                </div>
                <span className="gov-badge bg-blue-950/70 text-blue-300 border-blue-800/60 text-[10px]">
                  {investigationData?.linked_entities?.length || 0} CORRELATED HOPS
                </span>
              </div>

              {/* TAB 1: Institutional Knowledge Graph */}
              {activeTab === "graph" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Multi-Hop Mule Ring & Counterparty Relationship Graph</span>
                    <span className="font-mono text-[11px] text-blue-400">BFS Graph Algorithm Traversal</span>
                  </div>

                  {/* Clean SVG Network Canvas */}
                  <div className="w-full h-72 bg-[#090f1d] border border-slate-800/80 rounded-lg relative overflow-hidden flex items-center justify-center p-3">
                    <svg className="w-full h-full" viewBox="0 0 600 280">
                      <defs>
                        <pattern id="govGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#131e33" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#govGrid)" />

                      {/* Connection Edges */}
                      <line x1="100" y1="140" x2="240" y2="140" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3 3" />
                      <line x1="240" y1="140" x2="390" y2="75" stroke="#3b82f6" strokeWidth="2" />
                      <line x1="240" y1="140" x2="390" y2="205" stroke="#ca8a04" strokeWidth="2" strokeDasharray="4 2" />
                      <line x1="390" y1="75" x2="510" y2="140" stroke="#dc2626" strokeWidth="2" />
                      <line x1="390" y1="205" x2="510" y2="140" stroke="#dc2626" strokeWidth="2" />

                      {/* Edge Labels */}
                      <text x="170" y="132" fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">
                        ORIGIN DEPOSIT
                      </text>
                      <text x="315" y="100" fill="#93c5fd" fontSize="9" textAnchor="middle" fontFamily="monospace">
                        HOP 1 (TRANSFER)
                      </text>
                      <text x="315" y="185" fill="#fde047" fontSize="9" textAnchor="middle" fontFamily="monospace">
                        SHARED DEVICE / IP
                      </text>
                      <text x="460" y="100" fill="#fca5a5" fontSize="9" textAnchor="middle" fontFamily="monospace">
                        CASHOUT TERMINAL
                      </text>

                      {/* Node 1: Source */}
                      <g>
                        <rect x="65" y="115" width="70" height="50" rx="6" fill="#0c172c" stroke="#3b82f6" strokeWidth="1.5" />
                        <text x="100" y="135" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          SOURCE
                        </text>
                        <text x="100" y="152" fill="#94a3b8" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                          {alert.account_id ? alert.account_id.slice(-6) : "ORIGIN"}
                        </text>
                      </g>

                      {/* Node 2: Subject */}
                      <g>
                        <rect x="200" y="110" width="80" height="60" rx="6" fill="#152442" stroke={tier.border} strokeWidth="2" />
                        <text x="240" y="133" fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          SUBJECT
                        </text>
                        <text x="240" y="148" fill={tier.color} fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          RISK {(riskScore * 100).toFixed(0)}%
                        </text>
                        <text x="240" y="162" fill="#94a3b8" fontSize="8" textAnchor="middle" fontFamily="monospace">
                          FLAGGED
                        </text>
                      </g>

                      {/* Node 3: Mule Hop 1 */}
                      <g>
                        <rect x="355" y="50" width="70" height="50" rx="6" fill="#0c1d38" stroke="#3b82f6" strokeWidth="1.5" />
                        <text x="390" y="70" fill="#93c5fd" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          MULE HOP 1
                        </text>
                        <text x="390" y="86" fill="#cbd5e1" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                          INTERMEDIARY
                        </text>
                      </g>

                      {/* Node 4: Device */}
                      <g>
                        <rect x="355" y="180" width="70" height="50" rx="6" fill="#2d1d06" stroke="#ca8a04" strokeWidth="1.5" />
                        <text x="390" y="200" fill="#fde047" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          DEVICE / IP
                        </text>
                        <text x="390" y="216" fill="#e2e8f0" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                          FINGERPRINT
                        </text>
                      </g>

                      {/* Node 5: Cash-out */}
                      <g>
                        <rect x="475" y="115" width="70" height="50" rx="6" fill="#3b0f0f" stroke="#ef4444" strokeWidth="1.5" />
                        <text x="510" y="135" fill="#fca5a5" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                          CASHOUT
                        </text>
                        <text x="510" y="152" fill="#cbd5e1" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                          EXIT POINT
                        </text>
                      </g>
                    </svg>
                  </div>
                </div>
              )}

              {/* TAB 2: Timeline */}
              {activeTab === "timeline" && (
                <div className="space-y-2.5 font-mono text-xs">
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg flex items-start gap-3">
                    <span className="p-1 rounded bg-blue-500/20 text-blue-400 mt-0.5"><Clock size={13} /></span>
                    <div>
                      <span className="text-white font-bold block">T-0: Initial Anomaly Detection Triggered</span>
                      <span className="text-[11px] text-slate-400">Transaction amount {formatAmount(alert.amount)} analyzed by risk engine.</span>
                    </div>
                  </div>
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg flex items-start gap-3">
                    <span className="p-1 rounded bg-amber-500/20 text-amber-400 mt-0.5"><Share2 size={13} /></span>
                    <div>
                      <span className="text-white font-bold block">T+2m: Multi-Hop Knowledge Graph Traversal</span>
                      <span className="text-[11px] text-slate-400">Correlated {investigationData?.linked_entities?.length || 0} associated nodes across network.</span>
                    </div>
                  </div>
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg flex items-start gap-3">
                    <span className="p-1 rounded bg-emerald-500/20 text-emerald-400 mt-0.5"><FileCheck size={13} /></span>
                    <div>
                      <span className="text-white font-bold block">T+5m: RAG Precedent Retrieval & SAR Drafting</span>
                      <span className="text-[11px] text-slate-400">Matched historical typology cases with sentence-level exhibit citations.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Entities */}
              {activeTab === "entities" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 font-mono text-xs">
                  {alert.entities && alert.entities.length > 0 ? (
                    alert.entities.map((ent, idx) => (
                      <div key={idx} className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="p-1.5 bg-slate-800 rounded">{getEntityIcon(ent.entity_type)}</span>
                          <div>
                            <span className="font-bold text-white block truncate max-w-[150px]">{ent.entity_value}</span>
                            <span className="text-[10px] text-slate-400">
                              TYPE: {ent.entity_type ? ent.entity_type.toUpperCase() : "UNKNOWN"}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          CONF: {((ent.confidence || 0.95) * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 text-center py-6 text-slate-400 font-mono text-xs">
                      No entities extracted yet. Execute the Graph Agent above to parse entities.
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: RAG Precedents */}
              {activeTab === "rag" && (
                <div className="space-y-2.5 text-xs">
                  {similarCases.length > 0 ? (
                    similarCases.map((c, idx) => (
                      <div key={idx} className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg space-y-1">
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold text-blue-400 uppercase">{c.source_type}</span>
                          <span className="gov-badge bg-emerald-950/70 text-emerald-300 border-emerald-800/60 text-[10px]">
                            MATCH: {(c.similarity * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-slate-300 leading-relaxed font-sans">{c.content}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-400 font-mono text-xs">
                      No matching regulatory precedents retrieved.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Ingestion Payload Accordion */}
            <div className="gov-panel p-3">
              <button
                onClick={() => setShowRawPayload(!showRawPayload)}
                className="w-full flex items-center justify-between text-xs font-mono text-slate-300 font-bold hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <Database size={13} className="text-blue-400" />
                  Raw Source Ingestion Payload / Telemetry Record
                </span>
                {showRawPayload ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showRawPayload && (
                <div className="mt-2.5 p-3 bg-[#070b16] border border-slate-800 rounded text-xs font-mono text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-48">
                  {alert.raw_text}
                </div>
              )}
            </div>

          </div>

          {/* Right Column: SAR Narrative & Adjudication (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="gov-panel space-y-3.5">
              
              {/* Header */}
              <div className="border-b border-slate-800 pb-2.5 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold flex items-center gap-1.5">
                    <FileText className="text-amber-400" size={14} />
                    SAR Form Part V: Narrative
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                    Official Regulatory Filing Draft (31 CFR § 1020.320)
                  </span>
                </div>
                {narrativeText && (
                  <button
                    id="edit-narrative-toggle-btn"
                    onClick={() => setIsEditingNarrative(!isEditingNarrative)}
                    className="gov-btn gov-btn-secondary text-[11px] py-1 px-2.5"
                  >
                    <Edit3 size={11} />
                    {isEditingNarrative ? "View Exhibits" : "Edit Draft"}
                  </button>
                )}
              </div>

              {/* Narrative Content Body */}
              {narrativeText ? (
                <div className="space-y-3">
                  {isEditingNarrative ? (
                    <div className="space-y-2">
                      <label className="text-[11px] font-mono text-amber-400 uppercase font-bold flex items-center gap-1.5">
                        <Edit3 size={12} /> Compliance Officer Editing Mode:
                      </label>
                      <textarea
                        id="narrative-textarea"
                        value={editableNarrative}
                        onChange={(e) => setEditableNarrative(e.target.value)}
                        rows={14}
                        className="gov-input font-mono text-xs leading-relaxed"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Document Sheet */}
                      <div className="bg-[#070b16] border border-slate-800/80 rounded-lg p-4 text-xs font-mono leading-relaxed text-slate-200 space-y-2 max-h-[360px] overflow-y-auto">
                        {sentences.map((sentence, idx) => {
                          const hasCitation = citations.some(
                            (c) => c.sentence_index === idx || sentence.includes(c.sentence)
                          );
                          const isSelected = selectedSentenceIdx === idx;
                          return (
                            <span
                              key={idx}
                              onClick={() => {
                                setSelectedSentenceIdx(idx);
                                const match = citations.find(
                                  (c) => c.sentence_index === idx || sentence.includes(c.sentence)
                                );
                                setSelectedCitation(match || null);
                              }}
                              className={`cursor-pointer transition-all inline px-1 py-0.5 rounded ${
                                isSelected
                                  ? "bg-blue-600 text-white font-medium"
                                  : hasCitation
                                  ? "hover:text-blue-300 border-b border-dotted border-blue-400 text-slate-200"
                                  : "text-slate-300"
                              }`}
                              title={hasCitation ? "Click to verify source exhibit citation" : "Narrative statement"}
                            >
                              {sentence}{" "}
                              {hasCitation && (
                                <sup className="exhibit-cite">
                                  EXHIBIT {idx + 1}
                                </sup>
                              )}
                            </span>
                          );
                        })}
                      </div>

                      {/* Evidence Grounding Card */}
                      <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg space-y-2">
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                          <span className="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                            <FileCheck size={13} className="text-emerald-400" />
                            Evidence Traceability Record
                          </span>
                          <span className="gov-badge bg-emerald-950/70 text-emerald-300 border-emerald-800/60 text-[10px]">
                            100% VERIFIED
                          </span>
                        </div>
                        {selectedCitation ? (
                          <div className="font-mono text-xs space-y-1 pt-0.5">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">SOURCE:</span>
                              <span className="font-bold text-blue-400 uppercase">{selectedCitation.source_type}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">RECORD ID:</span>
                              <span className="text-slate-200 truncate max-w-[180px]">{selectedCitation.source_id}</span>
                            </div>
                            <div className="pt-1 border-t border-slate-800/60 text-slate-400 text-[11px]">
                              VERIFIED: <span className="text-slate-200">{selectedCitation.source_detail}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] font-mono text-slate-400 py-0.5">
                            Click any narrative sentence with an <code>[EXHIBIT #]</code> badge to verify its source record.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Official Adjudication Controls ─────────────────────── */}
                  <div className="pt-3 border-t border-slate-800 space-y-2.5">
                    <span className="text-[11px] font-mono font-bold uppercase text-slate-300 block tracking-wider">
                      Official Compliance Adjudication Sign-Off:
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        id="approve-sar-btn"
                        onClick={() => handleSubmitDecision(isEditingNarrative ? "edited" : "approved")}
                        disabled={submittingDecision}
                        className="gov-btn gov-btn-success text-xs py-2"
                      >
                        <ThumbsUp size={12} />
                        {isEditingNarrative ? "Approve" : "Approve SAR"}
                      </button>
                      <button
                        id="reject-case-btn"
                        onClick={() => handleSubmitDecision("rejected")}
                        disabled={submittingDecision}
                        className="gov-btn gov-btn-danger text-xs py-2"
                      >
                        <ThumbsDown size={12} />
                        Dismiss
                      </button>
                      <button
                        id="request-info-btn"
                        onClick={() => showAlert("Case file flagged for Senior Compliance Officer escalation.")}
                        className="gov-btn gov-btn-secondary text-xs py-2"
                      >
                        <Info size={12} />
                        Escalate
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-10 px-4 bg-[#070b16] border border-slate-800 rounded-lg text-center space-y-2.5 font-mono">
                  <FileText className="text-slate-500 mx-auto" size={26} />
                  <p className="text-xs font-bold text-white uppercase tracking-wider">No SAR Draft Generated</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Execute the Graph Agent or generate a verified SAR narrative draft with sentence-level citations.
                  </p>
                  <button
                    onClick={() => handleGenerateNarrative()}
                    disabled={generatingNarrative}
                    className="gov-btn gov-btn-primary inline-flex mt-1 text-xs py-1.5 px-3"
                  >
                    <FileText size={12} /> Draft SAR Narrative Now
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
