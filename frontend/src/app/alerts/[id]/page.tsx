"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  Share2,
  FileText,
  Clock,
  Layers,
  Edit3,
  ThumbsUp,
  ThumbsDown,
  Info,
  RefreshCw,
  Building2,
  DollarSign,
  User,
  Smartphone,
  Globe,
  FileCheck,
  ChevronDown,
  ChevronUp,
  PanelLeft,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Database,
  ArrowRight,
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

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "$0.00";
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

function getEntityIcon(type: string | null) {
  switch (type?.toLowerCase()) {
    case "account":
      return <User size={13} className="text-blue-400" />;
    case "device":
      return <Smartphone size={13} className="text-cyan-400" />;
    case "counterparty":
      return <Globe size={13} className="text-amber-400" />;
    case "amount":
      return <DollarSign size={13} className="text-emerald-400" />;
    default:
      return <Layers size={13} className="text-zinc-400" />;
  }
}

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

  // UI state
  const [showRawPayload, setShowRawPayload] = useState(false);
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);

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

      setDecisionSuccess(`Case status successfully updated to ${decision.toUpperCase()}.`);
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
      <div className="flex-1 flex items-center justify-center p-8 bg-[#0c0c0e]">
        <div className="ref-card p-6 text-center max-w-sm w-full space-y-2">
          <RefreshCw className="animate-spin text-blue-400 mx-auto" size={24} />
          <h2 className="text-sm font-semibold text-zinc-100">Loading Case Dossier</h2>
          <p className="text-xs text-zinc-500">Retrieving intelligence record from database...</p>
        </div>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-[#0c0c0e]">
        <div className="ref-card p-6 text-center max-w-sm w-full space-y-3">
          <AlertTriangle className="text-rose-400 mx-auto" size={28} />
          <h2 className="text-sm font-semibold text-zinc-100">Case Record Not Found</h2>
          <p className="text-xs text-zinc-500">{error || "Unable to locate identifier."}</p>
          <Link href="/" className="ref-btn ref-btn-secondary inline-flex text-xs">
            <ChevronLeft size={14} /> Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const sentences = narrativeText
    ? narrativeText.match(/[^.!?]+[.!?]+/g) || [narrativeText]
    : [];

  const riskScore = alert.risk_score || 0;
  const isHighRisk = riskScore >= 0.7;

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
          <span className="text-zinc-100 font-semibold tracking-tight">
            Case #{alert.transaction_id || alert.id.slice(0, 8)}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/" className="ref-btn ref-btn-secondary text-xs py-1.5 px-3">
            <ChevronLeft size={13} /> Back to Queue
          </Link>

          <button
            onClick={handleInvestigate}
            disabled={investigating}
            className="ref-btn ref-btn-primary text-xs py-1.5 px-3"
          >
            <Share2 size={13} className={investigating ? "animate-spin" : ""} />
            {investigating ? "Traversing Network..." : "Execute Graph Agent"}
          </button>

          <button
            onClick={() => handleGenerateNarrative()}
            disabled={generatingNarrative}
            className="ref-btn ref-btn-secondary text-xs py-1.5 px-3"
          >
            <FileText size={13} className={generatingNarrative ? "animate-spin text-blue-400" : ""} />
            {generatingNarrative ? "Drafting SAR..." : narrativeText ? "Regenerate Draft" : "Draft SAR Narrative"}
          </button>
        </div>
      </header>

      {/* ── Main Case Canvas ──────────────────────────────────────────────── */}
      <div className="flex-1 p-6 space-y-6 max-w-[1600px] w-full mx-auto">
        
        {/* Toast Feedback */}
        {decisionSuccess && (
          <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs font-mono flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} />
              <span>{decisionSuccess}</span>
            </div>
            <button
              onClick={() => setDecisionSuccess(null)}
              className="text-zinc-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Top Summary Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* Card 1: Subject Account & Transaction Value */}
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
                    stroke={isHighRisk ? "#ef4444" : "#2563eb"}
                    strokeWidth="5"
                    strokeDasharray="150"
                    strokeDashoffset={150 - (riskScore * 150)}
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                  Subject Account
                </h3>
                <p className="text-[11px] text-zinc-500 font-mono">
                  {alert.account_id || "Unidentified Account"}
                </p>
                <div className="text-2xl font-bold font-sans text-white tracking-tight">
                  {formatCurrency(alert.amount)}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5">
              <span className={`pill-badge ${isHighRisk ? "pill-rose" : "pill-blue"}`}>
                Risk {Math.round(riskScore * 100)}%
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {formatDate(alert.timestamp)}
              </span>
            </div>
          </div>

          {/* Card 2: Typology & Adjudication Verdict */}
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
                    stroke="#10b981"
                    strokeWidth="5"
                    strokeDasharray="150"
                    strokeDashoffset="40"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight capitalize">
                  {(alert.typology || "unclassified").replace(/_/g, " ")}
                </h3>
                <p className="text-[11px] text-zinc-500">Automated Agent Assessment</p>
                <div className="text-2xl font-bold font-sans text-white tracking-tight">
                  {investigationData?.verdict === "likely_suspicious" ? "Suspicious" : "Likely Benign"}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5">
              <span className={`pill-badge ${alert.status === "approved" ? "pill-green" : alert.status === "investigating" ? "pill-amber" : "pill-blue"}`}>
                STATUS: {alert.status ? alert.status.toUpperCase() : "NEW"}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                Confidence: {Math.round((investigationData?.confidence || 0.85) * 100)}%
              </span>
            </div>
          </div>

        </div>

        {/* ── Two-Column Dossier Workspace ─────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Knowledge Graph, Entities, Audit Progression (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Knowledge Graph Card (Always prominent) */}
            <div className="ref-card p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#222226] pb-3">
                <div className="flex items-center gap-2">
                  <Share2 size={16} className="text-blue-400" />
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Multi-Hop Knowledge Graph Traversal
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                      Visual correlation across account hops, shared hardware devices, and cash-out points.
                    </p>
                  </div>
                </div>

                <span className="pill-badge pill-blue text-[10px]">
                  {investigationData?.linked_entities?.length || 0} Connected Nodes
                </span>
              </div>

              {/* Responsive SVG Network Canvas */}
              <div className="h-72 w-full bg-[#111114] border border-[#222226] rounded-xl relative overflow-hidden flex items-center justify-center p-3">
                <svg className="w-full h-full" viewBox="0 0 600 280">
                  <defs>
                    <pattern id="dossierGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a1a1f" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#dossierGrid)" />

                  {/* Connection Edges */}
                  <line x1="100" y1="140" x2="240" y2="140" stroke="#2563eb" strokeWidth="2" strokeDasharray="3 3" />
                  <line x1="240" y1="140" x2="390" y2="75" stroke="#2563eb" strokeWidth="2" />
                  <line x1="240" y1="140" x2="390" y2="205" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" />
                  <line x1="390" y1="75" x2="510" y2="140" stroke="#ef4444" strokeWidth="2" />
                  <line x1="390" y1="205" x2="510" y2="140" stroke="#ef4444" strokeWidth="2" />

                  {/* Edge Labels */}
                  <text x="170" y="132" fill="#71717a" fontSize="9" textAnchor="middle" fontFamily="sans-serif">
                    ORIGIN DEPOSIT
                  </text>
                  <text x="315" y="100" fill="#60a5fa" fontSize="9" textAnchor="middle" fontFamily="sans-serif">
                    HOP 1 (TRANSFER)
                  </text>
                  <text x="315" y="185" fill="#fbbf24" fontSize="9" textAnchor="middle" fontFamily="sans-serif">
                    SHARED DEVICE / IP
                  </text>
                  <text x="460" y="100" fill="#f87171" fontSize="9" textAnchor="middle" fontFamily="sans-serif">
                    CASHOUT TERMINAL
                  </text>

                  {/* Node 1: Source */}
                  <g>
                    <rect x="65" y="115" width="70" height="50" rx="8" fill="#18181b" stroke="#2563eb" strokeWidth="1.5" />
                    <text x="100" y="135" fill="#f4f4f5" fontSize="10" fontWeight="600" textAnchor="middle">SOURCE</text>
                    <text x="100" y="152" fill="#a1a1aa" fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                      {alert.account_id ? alert.account_id.slice(-6) : "ORIGIN"}
                    </text>
                  </g>

                  {/* Node 2: Subject */}
                  <g>
                    <rect x="200" y="110" width="80" height="60" rx="8" fill="#1f1f23" stroke="#3b82f6" strokeWidth="2" />
                    <text x="240" y="133" fill="#ffffff" fontSize="11" fontWeight="bold" textAnchor="middle">SUBJECT</text>
                    <text x="240" y="148" fill="#60a5fa" fontSize="9" fontWeight="bold" textAnchor="middle">
                      RISK {Math.round(riskScore * 100)}%
                    </text>
                    <text x="240" y="162" fill="#a1a1aa" fontSize="8" textAnchor="middle">FLAGGED</text>
                  </g>

                  {/* Node 3: Mule Hop 1 */}
                  <g>
                    <rect x="355" y="50" width="70" height="50" rx="8" fill="#18181b" stroke="#2563eb" strokeWidth="1.5" />
                    <text x="390" y="70" fill="#60a5fa" fontSize="10" fontWeight="600" textAnchor="middle">MULE HOP 1</text>
                    <text x="390" y="86" fill="#a1a1aa" fontSize="8.5" textAnchor="middle">INTERMEDIARY</text>
                  </g>

                  {/* Node 4: Device */}
                  <g>
                    <rect x="355" y="180" width="70" height="50" rx="8" fill="#18181b" stroke="#f59e0b" strokeWidth="1.5" />
                    <text x="390" y="200" fill="#fbbf24" fontSize="10" fontWeight="600" textAnchor="middle">DEVICE / IP</text>
                    <text x="390" y="216" fill="#a1a1aa" fontSize="8.5" textAnchor="middle">FINGERPRINT</text>
                  </g>

                  {/* Node 5: Cashout */}
                  <g>
                    <rect x="475" y="115" width="70" height="50" rx="8" fill="#18181b" stroke="#ef4444" strokeWidth="1.5" />
                    <text x="510" y="135" fill="#f87171" fontSize="10" fontWeight="600" textAnchor="middle">CASHOUT</text>
                    <text x="510" y="152" fill="#a1a1aa" fontSize="8.5" textAnchor="middle">EXIT POINT</text>
                  </g>
                </svg>
              </div>
            </div>

            {/* Extracted Financial Entities (Displayed cleanly without hiding behind tabs) */}
            <div className="ref-card p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[#222226] pb-2.5">
                <div className="flex items-center gap-2">
                  <Layers size={15} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Extracted Financial Entities ({alert.entities?.length || 0})
                  </h3>
                </div>
                <span className="text-[11px] text-zinc-500 font-mono">
                  NLP Disambiguated
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                {alert.entities && alert.entities.length > 0 ? (
                  alert.entities.map((ent, idx) => (
                    <div key={idx} className="p-2.5 bg-[#141417] border border-[#222226] rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="p-1.5 bg-[#18181b] rounded-lg shrink-0">
                          {getEntityIcon(ent.entity_type)}
                        </span>
                        <div className="truncate">
                          <span className="font-mono text-zinc-200 text-xs font-medium block truncate">
                            {ent.entity_value}
                          </span>
                          <span className="text-[10px] text-zinc-500 uppercase">
                            {ent.entity_type || "UNKNOWN"}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                        {Math.round((ent.confidence || 0.95) * 100)}%
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 text-center py-6 text-zinc-500 text-xs font-mono">
                    No entities extracted yet. Click &quot;Execute Graph Agent&quot; above to parse entities.
                  </div>
                )}
              </div>
            </div>

            {/* Event Velocity Progression & Precedents Side-by-Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              {/* Velocity Log Card */}
              <div className="ref-card p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-[#222226] pb-2">
                  <Clock size={15} className="text-blue-400" />
                  <h3 className="text-xs font-semibold text-zinc-100 uppercase tracking-wide">
                    Audit Progression
                  </h3>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="p-2.5 bg-[#141417] border border-[#222226] rounded-xl space-y-0.5">
                    <span className="text-[10px] text-amber-400 font-mono font-medium block">
                      1. ANOMALY TRIGGER
                    </span>
                    <span className="text-zinc-300 block">
                      Flagged at risk score {Math.round(riskScore * 100)}% for {alert.typology}.
                    </span>
                  </div>
                  <div className="p-2.5 bg-[#141417] border border-[#222226] rounded-xl space-y-0.5">
                    <span className="text-[10px] text-blue-400 font-mono font-medium block">
                      2. GRAPH CORRELATION
                    </span>
                    <span className="text-zinc-300 block">
                      Discovered {investigationData?.linked_entities?.length || 0} interconnected network nodes.
                    </span>
                  </div>
                </div>
              </div>

              {/* RAG Precedents Card */}
              <div className="ref-card p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-[#222226] pb-2">
                  <Database size={15} className="text-blue-400" />
                  <h3 className="text-xs font-semibold text-zinc-100 uppercase tracking-wide">
                    Precedent Case Matches ({similarCases.length})
                  </h3>
                </div>
                <div className="space-y-2 text-xs">
                  {similarCases.length > 0 ? (
                    similarCases.slice(0, 2).map((c, idx) => (
                      <div key={idx} className="p-2.5 bg-[#141417] border border-[#222226] rounded-xl space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-medium text-blue-400 uppercase">{c.source_type}</span>
                          <span className="pill-badge pill-green text-[9px]">
                            {Math.round(c.similarity * 100)}% Match
                          </span>
                        </div>
                        <p className="text-zinc-300 line-clamp-2 text-[11px] leading-relaxed">
                          {c.content}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-zinc-500 text-xs py-4 text-center">
                      No precedents retrieved yet.
                    </p>
                  )}
                </div>
              </div>

            </div>

            {/* Ingestion Payload Accordion */}
            <div className="ref-card p-4">
              <button
                onClick={() => setShowRawPayload(!showRawPayload)}
                className="w-full flex items-center justify-between text-xs text-zinc-300 font-medium hover:text-white"
              >
                <span>Raw Ingestion Telemetry Record</span>
                {showRawPayload ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showRawPayload && (
                <div className="mt-3 p-3 bg-[#0a0a0c] border border-[#222226] rounded-xl text-xs font-mono text-zinc-300 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-48">
                  {alert.raw_text}
                </div>
              )}
            </div>

          </div>

          {/* Right Column: SAR Narrative & Adjudication Controls (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="ref-card p-6 space-y-4">
              
              <div className="flex items-center justify-between pb-3 border-b border-[#222226]">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    SAR Form Part V: Narrative
                  </h3>
                  <p className="text-[11px] text-zinc-500">Official Evidence-Grounded Regulatory Draft</p>
                </div>
                {narrativeText && (
                  <button
                    onClick={() => setIsEditingNarrative(!isEditingNarrative)}
                    className="ref-btn ref-btn-secondary text-[11px] py-1 px-2.5"
                  >
                    <Edit3 size={11} />
                    {isEditingNarrative ? "View Citations" : "Edit Draft"}
                  </button>
                )}
              </div>

              {narrativeText ? (
                <div className="space-y-4">
                  {isEditingNarrative ? (
                    <div className="space-y-2">
                      <label className="text-[11px] font-mono text-amber-400 font-semibold block">
                        Compliance Officer Edit Mode:
                      </label>
                      <textarea
                        value={editableNarrative}
                        onChange={(e) => setEditableNarrative(e.target.value)}
                        rows={14}
                        className="ref-input w-full font-mono text-xs leading-relaxed"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Document Sheet */}
                      <div className="bg-[#111114] border border-[#222226] rounded-xl p-4 text-xs font-mono leading-relaxed text-zinc-200 space-y-2 max-h-[380px] overflow-y-auto">
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
                                  ? "hover:text-blue-300 border-b border-dotted border-blue-400 text-zinc-200"
                                  : "text-zinc-300"
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
                      <div className="p-3.5 bg-[#141417] border border-blue-500/30 rounded-xl space-y-2 text-xs">
                        <div className="flex items-center justify-between pb-1.5 border-b border-[#222226]">
                          <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                            <FileCheck size={14} className="text-emerald-400" />
                            Evidence Traceability Record
                          </span>
                          <span className="pill-badge pill-green text-[10px]">
                            100% Grounded
                          </span>
                        </div>
                        {selectedCitation ? (
                          <div className="font-mono text-xs space-y-1.5 pt-1 text-zinc-300">
                            <div className="flex items-center justify-between">
                              <span className="text-zinc-500">Source:</span>
                              <span className="text-blue-400 uppercase font-semibold">{selectedCitation.source_type}</span>
                            </div>
                            <div className="flex items-center justify-between truncate">
                              <span className="text-zinc-500">Record ID:</span>
                              <span className="text-zinc-200 truncate ml-2">{selectedCitation.source_id}</span>
                            </div>
                            <div className="text-zinc-400 text-[11px] pt-1 border-t border-[#1e1e24]">
                              <span className="text-zinc-500 block mb-0.5">Verified Evidence:</span>
                              <span className="text-zinc-200">{selectedCitation.source_detail}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-zinc-500">
                            Click any narrative sentence with an <code>[EXHIBIT #]</code> badge to verify its source database transaction ID, account, amount, and timestamp.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Adjudication Sign-Off Buttons */}
                  <div className="pt-3 border-t border-[#222226] space-y-2.5">
                    <span className="text-[11px] font-medium text-zinc-400 block">
                      Compliance Adjudication Sign-Off:
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleSubmitDecision(isEditingNarrative ? "edited" : "approved")}
                        disabled={submittingDecision}
                        className="ref-btn ref-btn-primary text-xs py-2"
                      >
                        <ThumbsUp size={12} />
                        {isEditingNarrative ? "Approve Edit" : "Approve SAR"}
                      </button>
                      <button
                        onClick={() => handleSubmitDecision("rejected")}
                        disabled={submittingDecision}
                        className="ref-btn ref-btn-secondary text-xs py-2 text-rose-400 hover:text-rose-300"
                      >
                        <ThumbsDown size={12} />
                        Dismiss Case
                      </button>
                      <button
                        onClick={() => showAlert("Case file flagged for Senior Compliance Officer escalation.")}
                        className="ref-btn ref-btn-secondary text-xs py-2"
                      >
                        <Info size={12} />
                        Escalate
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 px-4 bg-[#111114] border border-[#222226] rounded-xl text-center space-y-3 font-sans">
                  <FileText className="text-zinc-600 mx-auto" size={28} />
                  <p className="text-xs font-medium text-zinc-200">No SAR Draft Generated</p>
                  <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
                    Click below to generate an official evidence-grounded Part V SAR narrative draft with sentence-level citations.
                  </p>
                  <button
                    onClick={() => handleGenerateNarrative()}
                    disabled={generatingNarrative}
                    className="ref-btn ref-btn-primary inline-flex text-xs py-2 px-4"
                  >
                    Draft SAR Narrative Now
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
