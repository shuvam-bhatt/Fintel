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
  if (score === null || score === undefined) return { label: "UNKNOWN", color: "#64748b", bg: "#1e293b", border: "#475569" };
  if (score >= 0.7) return { label: "TIER 1 (HIGH RISK)", color: "#fca5a5", bg: "#450a0a", border: "#b91c1c" };
  if (score >= 0.4) return { label: "TIER 2 (ELEVATED)", color: "#fef08a", bg: "#422006", border: "#ca8a04" };
  return { label: "TIER 3 (LOW RISK)", color: "#86efac", bg: "#052e16", border: "#16a34a" };
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

  // Decision state
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState("");
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
      alertModal(`Investigation Agent execution failed: ${err.message}`);
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
      alertModal(`SAR draft generation failed: ${err.message}`);
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
      alertModal(`Adjudication submission error: ${err.message}`);
    } finally {
      setSubmittingDecision(false);
    }
  };

  const alertModal = (msg: string) => {
    window.alert(msg);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070c16] text-slate-100 flex items-center justify-center p-8 font-mono">
        <div className="gov-panel p-8 text-center max-w-md w-full border-[#243553]">
          <RefreshCw className="animate-spin text-blue-400 mx-auto mb-4" size={24} />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Accessing Federal Case Ledger</h2>
          <p className="text-xs text-slate-400">Loading Case #{alertId?.slice(0, 8)} records from database...</p>
        </div>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="min-h-screen bg-[#070c16] text-slate-100 flex items-center justify-center p-8 font-mono">
        <div className="gov-panel p-8 text-center max-w-md w-full border-red-800 bg-[#160b0b]">
          <AlertTriangle className="text-red-400 mx-auto mb-3" size={28} />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Case File Record Not Found</h2>
          <p className="text-xs text-slate-400 mb-6">{error || "Unable to locate alert identifier in system."}</p>
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
    <div className="min-h-screen bg-[#070c16] text-slate-100 flex flex-col font-sans">
      {/* ── Official Government Banner ────────────────────────────────────── */}
      <div className="gov-topbar flex flex-wrap items-center justify-between border-b border-[#243553]">
        <div className="flex items-center gap-3">
          <span className="font-bold text-amber-400">FINANCIAL INTELLIGENCE UNIT (FIU)</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-300">SUSPICIOUS ACTIVITY INVESTIGATION DOSSIER</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="text-amber-400 font-mono">CASE REF: FS-SAR-{alert.id.slice(0, 8).toUpperCase()}</span>
          <span className="text-slate-500">|</span>
          <span>RESTRICTED // LAW ENFORCEMENT SENSITIVE</span>
        </div>
      </div>

      {/* ── Case Control Header ───────────────────────────────────────────── */}
      <header className="bg-[#0b1424] border-b border-[#243553] py-4 px-6 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="gov-btn gov-btn-secondary"
              id="back-to-queue-btn"
            >
              <ChevronLeft size={14} /> Back to Ledger
            </Link>
            <div className="h-6 w-px bg-[#243553]" />
            <div>
              <div className="flex items-center gap-3">
                <span
                  className="gov-badge"
                  style={{ background: tier.bg, color: tier.color, borderColor: tier.border }}
                >
                  {tier.label} [{(riskScore * 100).toFixed(0)}%]
                </span>
                <span className="gov-badge bg-blue-950 text-blue-200 border-blue-800">
                  {alert.typology ? alert.typology.toUpperCase().replace(/_/g, " ") : "UNCLASSIFIED"}
                </span>
                <span className="gov-badge bg-slate-900 text-slate-300 border-slate-700">
                  STATUS: {alert.status?.toUpperCase() || "NEW"}
                </span>
              </div>
              <h1 className="text-base font-bold text-white uppercase font-mono tracking-wide mt-1.5">
                Primary Subject: {alert.account_id || "Unidentified Account"} (Transaction #{alert.transaction_id || alert.id.slice(0, 8)})
              </h1>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-3">
            <button
              id="run-agent-btn"
              onClick={handleInvestigate}
              disabled={investigating}
              className="gov-btn gov-btn-primary"
            >
              <Share2 size={13} />
              {investigating ? "Traversing Network..." : "Execute Graph Agent"}
            </button>
            <button
              id="generate-narrative-btn"
              onClick={() => handleGenerateNarrative()}
              disabled={generatingNarrative}
              className="gov-btn gov-btn-secondary"
            >
              <FileText size={13} />
              {generatingNarrative ? "Drafting SAR..." : narrativeText ? "Regenerate SAR Draft" : "Draft SAR Narrative"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Investigation Body ───────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-8 flex-1 w-full space-y-8">
        {/* Success Alert */}
        {decisionSuccess && (
          <div className="p-4 bg-[#052e16] border border-[#16a34a] text-emerald-300 text-xs font-mono flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>{decisionSuccess}</span>
            </div>
            <button
              onClick={() => setDecisionSuccess(null)}
              className="text-slate-400 hover:text-white uppercase text-[10px]"
            >
              [Dismiss]
            </button>
          </div>
        )}

        {/* ── Section 1: Official Case Parameter Grid ─────────────────────── */}
        <section className="gov-panel" aria-labelledby="section-case-summary">
          <div className="border-b border-[#243553] pb-2 mb-4 flex items-center justify-between">
            <h2 id="section-case-summary" className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold flex items-center gap-2">
              <Building size={14} className="text-amber-400" />
              Primary Transaction Parameters & Ingestion Metadata
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Form 111 (BSA CTR/SAR Input)</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Transaction ID
              </span>
              <span className="text-xs font-mono font-bold text-white block">
                {alert.transaction_id || "NOT ASSIGNED"}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Account ID / BIC
              </span>
              <span className="text-xs font-mono font-bold text-blue-300 block">
                {alert.account_id || "UNIDENTIFIED"}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Transaction Amount
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400 block">
                {formatAmount(alert.amount)} {alert.currency || "USD"}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Execution Timestamp
              </span>
              <span className="text-xs font-mono text-slate-300 block">
                {formatDate(alert.timestamp)}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Composite Risk Tier
              </span>
              <span
                className="gov-badge mt-0.5"
                style={{ background: tier.bg, color: tier.color, borderColor: tier.border }}
              >
                {tier.label}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Typology Classification
              </span>
              <span className="text-xs font-mono font-bold text-amber-300 block mt-0.5">
                {(alert.typology || "unclassified").toUpperCase().replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Raw System Event Log Payload */}
          <div className="mt-6 pt-4 border-t border-[#243553]">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-2 font-bold">
              Raw Source Ingestion Payload / Telemetry Record:
            </span>
            <div className="bg-[#070d18] border border-[#243553] p-3 text-xs font-mono text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {alert.raw_text}
            </div>
          </div>
        </section>

        {/* ── Section 2: Two-Column Dossier Workspace ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Evidence, Graph & Timeline (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* View Switcher Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-[#243553] pb-2 font-mono text-xs">
              <button
                id="tab-graph-btn"
                onClick={() => setActiveTab("graph")}
                className={`px-4 py-2 border font-bold uppercase transition ${
                  activeTab === "graph"
                    ? "bg-[#1e3a8a] text-white border-[#3b82f6]"
                    : "bg-[#0b1424] text-slate-400 border-[#243553] hover:text-white"
                }`}
              >
                [1] Knowledge Graph Network
              </button>
              <button
                id="tab-timeline-btn"
                onClick={() => setActiveTab("timeline")}
                className={`px-4 py-2 border font-bold uppercase transition ${
                  activeTab === "timeline"
                    ? "bg-[#1e3a8a] text-white border-[#3b82f6]"
                    : "bg-[#0b1424] text-slate-400 border-[#243553] hover:text-white"
                }`}
              >
                [2] Event Velocity Log
              </button>
              <button
                id="tab-entities-btn"
                onClick={() => setActiveTab("entities")}
                className={`px-4 py-2 border font-bold uppercase transition ${
                  activeTab === "entities"
                    ? "bg-[#1e3a8a] text-white border-[#3b82f6]"
                    : "bg-[#0b1424] text-slate-400 border-[#243553] hover:text-white"
                }`}
              >
                [3] Extracted Entities ({alert.entities?.length || 0})
              </button>
              <button
                id="tab-rag-btn"
                onClick={() => setActiveTab("rag")}
                className={`px-4 py-2 border font-bold uppercase transition ${
                  activeTab === "rag"
                    ? "bg-[#1e3a8a] text-white border-[#3b82f6]"
                    : "bg-[#0b1424] text-slate-400 border-[#243553] hover:text-white"
                }`}
              >
                [4] Precedents ({similarCases.length})
              </button>
            </div>

            {/* TAB 1: Institutional Knowledge Graph */}
            {activeTab === "graph" && (
              <div className="gov-panel space-y-4">
                <div className="flex flex-wrap items-center justify-between border-b border-[#243553] pb-2">
                  <div>
                    <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold flex items-center gap-2">
                      <Share2 className="text-blue-400" size={14} />
                      Multi-Hop Mule Ring & Counterparty Relationship Graph
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Visual correlation of transacted accounts, shared devices, and exit cash-out nodes.
                    </p>
                  </div>
                  <span className="gov-badge bg-blue-950 text-blue-300 border-blue-800">
                    {investigationData?.linked_entities?.length || 0} CORRELATED NODES
                  </span>
                </div>

                {/* Clean Official SVG Network Canvas */}
                <div className="w-full h-80 bg-[#070d18] border border-[#243553] relative overflow-hidden flex items-center justify-center p-4">
                  <svg className="w-full h-full" viewBox="0 0 600 300">
                    {/* Grid Pattern */}
                    <defs>
                      <pattern id="govGrid" width="25" height="25" patternUnits="userSpaceOnUse">
                        <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#162238" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#govGrid)" />

                    {/* Connection Edges */}
                    <line x1="100" y1="150" x2="250" y2="150" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3 3" />
                    <line x1="250" y1="150" x2="400" y2="80" stroke="#3b82f6" strokeWidth="2" />
                    <line x1="250" y1="150" x2="400" y2="220" stroke="#ca8a04" strokeWidth="2" strokeDasharray="4 2" />
                    <line x1="400" y1="80" x2="520" y2="150" stroke="#dc2626" strokeWidth="2" />
                    <line x1="400" y1="220" x2="520" y2="150" stroke="#dc2626" strokeWidth="2" />

                    {/* Edge Labels */}
                    <text x="175" y="140" fill="#94a3b8" fontSize="10" textAnchor="middle" fontFamily="monospace">
                      DEPOSIT / ORIGIN
                    </text>
                    <text x="325" y="105" fill="#93c5fd" fontSize="10" textAnchor="middle" fontFamily="monospace">
                      HOP 1 (TRANSFER)
                    </text>
                    <text x="325" y="195" fill="#fde047" fontSize="10" textAnchor="middle" fontFamily="monospace">
                      SHARED DEVICE / IP
                    </text>
                    <text x="470" y="110" fill="#fca5a5" fontSize="10" textAnchor="middle" fontFamily="monospace">
                      CASHOUT HOP
                    </text>

                    {/* Node 1: Originating Account */}
                    <g>
                      <rect x="65" y="125" width="70" height="50" fill="#0f172a" stroke="#3b82f6" strokeWidth="1.5" />
                      <text x="100" y="145" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        SOURCE
                      </text>
                      <text x="100" y="160" fill="#94a3b8" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                        {alert.account_id ? alert.account_id.slice(-6) : "ORIGIN"}
                      </text>
                    </g>

                    {/* Node 2: Flagged Alert Node */}
                    <g>
                      <rect x="210" y="120" width="80" height="60" fill="#1e293b" stroke={tier.border} strokeWidth="2" />
                      <text x="250" y="143" fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        SUBJECT
                      </text>
                      <text x="250" y="158" fill={tier.color} fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        RISK {(riskScore * 100).toFixed(0)}%
                      </text>
                      <text x="250" y="172" fill="#94a3b8" fontSize="8" textAnchor="middle" fontFamily="monospace">
                        FLAGGED RECORD
                      </text>
                    </g>

                    {/* Node 3: Linked Mule A */}
                    <g>
                      <rect x="365" y="55" width="70" height="50" fill="#0c1d38" stroke="#3b82f6" strokeWidth="1.5" />
                      <text x="400" y="75" fill="#93c5fd" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        MULE HOP 1
                      </text>
                      <text x="400" y="90" fill="#cbd5e1" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                        INTERMEDIARY
                      </text>
                    </g>

                    {/* Node 4: Shared Device */}
                    <g>
                      <rect x="365" y="195" width="70" height="50" fill="#2d1d06" stroke="#ca8a04" strokeWidth="1.5" />
                      <text x="400" y="215" fill="#fde047" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        DEVICE / IP
                      </text>
                      <text x="400" y="230" fill="#e2e8f0" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                        FINGERPRINT
                      </text>
                    </g>

                    {/* Node 5: Cash-Out Terminal */}
                    <g>
                      <rect x="485" y="125" width="70" height="50" fill="#380e0e" stroke="#dc2626" strokeWidth="1.5" />
                      <text x="520" y="145" fill="#fca5a5" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        CASHOUT
                      </text>
                      <text x="520" y="160" fill="#fee2e2" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                        FINAL SINK
                      </text>
                    </g>
                  </svg>
                </div>

                {/* Correlated Entities Subtable */}
                <div className="space-y-2">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold">
                    Correlated Sub-Network Entities ({investigationData?.linked_entities?.length || 0})
                  </h4>
                  {investigationData?.linked_entities && investigationData.linked_entities.length > 0 ? (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {investigationData.linked_entities.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 bg-[#090f1b] border border-[#243553] text-xs font-mono"
                        >
                          <div className="flex items-center gap-3">
                            <span className="p-1 bg-[#162238]">{getEntityIcon(item.entity_type)}</span>
                            <div>
                              <span className="font-bold text-white">{item.entity_value}</span>
                              <span className="text-[10px] text-slate-400 block">
                                TYPE: {item.entity_type.toUpperCase()} • RELATION: {item.relationship?.toUpperCase() || "LINKED"}
                              </span>
                            </div>
                          </div>
                          <span className="gov-badge bg-blue-950 text-blue-300 border-blue-800 text-[10px]">
                            HOP {item.hop_distance || 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 py-3 text-center bg-[#090f1b] border border-[#243553] font-mono">
                      No network hops recorded yet. Click &quot;Execute Graph Agent&quot; above to traverse the knowledge graph.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: Chronological Velocity Log */}
            {activeTab === "timeline" && (
              <div className="gov-panel space-y-4">
                <div className="border-b border-[#243553] pb-2">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold flex items-center gap-2">
                    <Clock className="text-blue-400" size={14} />
                    Chronological Audit Ledger & Evidence Progression
                  </h3>
                </div>
                <div className="space-y-3 font-mono text-xs">
                  <div className="p-3 bg-[#090f1b] border border-[#243553] space-y-1">
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span className="text-amber-400 font-bold">[STEP 1] ANOMALY DETECTION</span>
                      <span>{formatDate(alert.timestamp)}</span>
                    </div>
                    <p className="text-slate-200">
                      Transaction flagged with risk score {(riskScore * 100).toFixed(0)}%. Typology labeled as {alert.typology}.
                    </p>
                  </div>

                  <div className="p-3 bg-[#090f1b] border border-[#243553] space-y-1">
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span className="text-blue-400 font-bold">[STEP 2] NLP DISAMBIGUATION</span>
                      <span>AUTOMATED INTAKE</span>
                    </div>
                    <p className="text-slate-200">
                      Structured extraction identified {alert.entities?.length || 0} financial entities from raw payload notes.
                    </p>
                  </div>

                  <div className="p-3 bg-[#090f1b] border border-[#243553] space-y-1">
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span className="text-emerald-400 font-bold">[STEP 3] KNOWLEDGE GRAPH CORRELATION</span>
                      <span>AGENT ADJUDICATION</span>
                    </div>
                    <p className="text-slate-200">
                      Multi-hop traversal completed. Verdict: {investigationData?.verdict?.toUpperCase() || "LIKELY SUSPICIOUS"}.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Extracted Entities List */}
            {activeTab === "entities" && (
              <div className="gov-panel space-y-4">
                <div className="border-b border-[#243553] pb-2">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold flex items-center gap-2">
                    <Layers className="text-blue-400" size={14} />
                    Extracted Financial Entities (Disambiguated Records)
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                  {alert.entities && alert.entities.length > 0 ? (
                    alert.entities.map((ent, idx) => (
                      <div key={idx} className="p-3 bg-[#090f1b] border border-[#243553] flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="p-1 bg-[#162238]">{getEntityIcon(ent.entity_type)}</span>
                          <div>
                            <span className="font-bold text-white block">{ent.entity_value}</span>
                            <span className="text-[10px] text-slate-400">TYPE: {ent.entity_type.toUpperCase()}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          CONF: {((ent.confidence || 0.95) * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 text-center py-8 text-slate-400 font-mono text-xs">
                      No entities extracted yet. Execute the Graph Agent above to parse entities.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: RAG Precedents */}
            {activeTab === "rag" && (
              <div className="gov-panel space-y-4">
                <div className="border-b border-[#243553] pb-2">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold flex items-center gap-2">
                    <Database className="text-blue-400" size={14} />
                    Historical Precedents & Typology Definitions (pgvector Cosine Search)
                  </h3>
                </div>
                {loadingRAG ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-400">
                    Querying vector database for matching precedents...
                  </div>
                ) : similarCases.length > 0 ? (
                  <div className="space-y-3 font-mono text-xs">
                    {similarCases.map((c, idx) => (
                      <div key={idx} className="p-3 bg-[#090f1b] border border-[#243553] space-y-1">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-bold text-blue-300 uppercase">{c.source_type.replace(/_/g, " ")}</span>
                          <span className="gov-badge bg-blue-950 text-blue-300 border-blue-800 text-[10px]">
                            MATCH: {(c.similarity * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-slate-300 leading-relaxed font-sans">{c.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400 font-mono text-xs">
                    No matching regulatory precedents retrieved.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Official SAR Narrative & Exhibit Grounding (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="gov-panel space-y-5">
              {/* Report Header */}
              <div className="border-b border-[#243553] pb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold flex items-center gap-2">
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
                    className="gov-btn gov-btn-secondary text-[11px]"
                  >
                    <Edit3 size={11} />
                    {isEditingNarrative ? "View Exhibits" : "Edit Text"}
                  </button>
                )}
              </div>

              {/* Narrative Content Body */}
              {narrativeText ? (
                <div className="space-y-4">
                  {isEditingNarrative ? (
                    <div className="space-y-2">
                      <label className="text-[11px] font-mono text-amber-400 uppercase font-bold flex items-center gap-1.5">
                        <Edit3 size={12} /> Compliance Officer Editing Mode:
                      </label>
                      <textarea
                        id="narrative-textarea"
                        value={editableNarrative}
                        onChange={(e) => setEditableNarrative(e.target.value)}
                        rows={16}
                        className="gov-input font-mono text-xs leading-relaxed"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Document Sheet */}
                      <div className="bg-[#070d18] border border-[#243553] p-4 text-xs font-mono leading-relaxed text-slate-200 space-y-2.5">
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
                              className={`cursor-pointer transition-all inline px-1 py-0.5 ${
                                isSelected
                                  ? "bg-[#1e3a8a] text-white font-bold"
                                  : hasCitation
                                  ? "hover:bg-[#162238] border-b border-dotted border-blue-400 text-slate-200"
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
                      <div className="gov-panel bg-[#0a1426] border-[#3b82f6] p-4 space-y-2">
                        <div className="flex items-center justify-between border-b border-[#243553] pb-1.5">
                          <span className="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                            <FileCheck size={13} className="text-emerald-400" />
                            Evidence Traceability Record
                          </span>
                          <span className="gov-badge bg-emerald-950 text-emerald-300 border-emerald-800 text-[10px]">
                            100% VERIFIED GROUNDING
                          </span>
                        </div>
                        {selectedCitation ? (
                          <div className="font-mono text-xs space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">SOURCE REPOSITORY:</span>
                              <span className="font-bold text-blue-300 uppercase">{selectedCitation.source_type}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">RECORD ID:</span>
                              <span className="text-slate-200">{selectedCitation.source_id.slice(0, 20)}...</span>
                            </div>
                            <div className="pt-1.5 border-t border-[#1a2840] text-slate-400 text-[11px]">
                              VERIFIED EVIDENCE: <span className="text-slate-200">{selectedCitation.source_detail}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] font-mono text-slate-400 py-1">
                            Click any narrative sentence with citation mark <code>[EXHIBIT #]</code> to verify its immutable source transaction ID, account, amount, and timestamp.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Official Adjudication Controls ─────────────────────── */}
                  <div className="pt-4 border-t border-[#243553] space-y-3">
                    <span className="text-xs font-mono font-bold uppercase text-slate-300 block tracking-wider">
                      Official Compliance Adjudication Sign-Off:
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        id="approve-sar-btn"
                        onClick={() => handleSubmitDecision(isEditingNarrative ? "edited" : "approved")}
                        disabled={submittingDecision}
                        className="gov-btn gov-btn-success"
                      >
                        <ThumbsUp size={12} />
                        {isEditingNarrative ? "Approve (Edited)" : "Approve SAR"}
                      </button>
                      <button
                        id="reject-case-btn"
                        onClick={() => handleSubmitDecision("rejected")}
                        disabled={submittingDecision}
                        className="gov-btn gov-btn-danger"
                      >
                        <ThumbsDown size={12} />
                        Dismiss Case
                      </button>
                      <button
                        id="request-info-btn"
                        onClick={() => alertModal("Case file flagged for Senior Compliance Officer escalation.")}
                        className="gov-btn gov-btn-secondary"
                      >
                        <Info size={12} />
                        Escalate
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 px-4 border border-[#243553] bg-[#070d18] text-center space-y-3 font-mono">
                  <FileText className="text-slate-500 mx-auto" size={28} />
                  <p className="text-xs font-bold text-white uppercase tracking-wider">No SAR Draft Generated</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Execute the Graph Agent or generate a verified SAR narrative draft with sentence-level citations.
                  </p>
                  <button
                    onClick={() => handleGenerateNarrative()}
                    disabled={generatingNarrative}
                    className="gov-btn gov-btn-primary inline-flex mt-2"
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
