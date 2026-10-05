/**
 * Fintel — API Client
 * Centralized fetch wrapper for all backend endpoints.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'Unknown error');
    throw new Error(`API Error ${res.status}: ${errorBody}`);
  }
  return res.json();
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Alert {
  id: string;
  raw_text: string;
  transaction_id: string | null;
  account_id: string | null;
  amount: number | null;
  currency: string | null;
  timestamp: string | null;
  risk_score: number | null;
  typology: string | null;
  status: string | null;
  created_at: string | null;
  entities?: Entity[];
  investigations?: Investigation[];
}

export interface Entity {
  id: string;
  alert_id: string | null;
  entity_type: string | null;
  entity_value: string | null;
  confidence: number | null;
  created_at: string | null;
}

export interface Investigation {
  id: string;
  alert_id: string | null;
  linked_entities: any;
  retrieved_cases: any;
  verdict: string | null;
  confidence: number | null;
  created_at: string | null;
  narratives: Narrative[];
}

export interface Narrative {
  id: string;
  investigation_id: string | null;
  narrative_text: string | null;
  citations: Citation[] | null;
  analyst_decision: string | null;
  edited_text: string | null;
  created_at: string | null;
}

export interface Citation {
  sentence: string;
  sentence_index?: number;
  source_type: string;
  source_id: string;
  source_detail: string;
}

export interface PaginatedAlerts {
  items: Alert[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DashboardStats {
  total_alerts: number;
  new_alerts: number;
  investigating: number;
  approved: number;
  rejected: number;
  avg_risk_score: number;
  high_risk_count: number;
  typology_distribution: Record<string, number>;
}

export interface InvestigateResult {
  investigation_id: string;
  alert_id: string;
  linked_entities: LinkedEntity[];
  evidence_chain: EvidenceChainItem[];
  verdict: string;
  confidence: number;
}

export interface LinkedEntity {
  entity_id: string | null;
  entity_type: string;
  entity_value: string;
  relationship: string | null;
  hop_distance: number | null;
}

export interface EvidenceChainItem {
  source: string;
  target: string;
  relationship: string;
  weight: number | null;
}

export interface NarrativeResult {
  narrative_id: string;
  narrative_text: string;
  citations: Citation[];
}

export interface SimilarCase {
  id: string;
  source_type: string;
  content: string;
  similarity: number;
}

// ─── API Functions ──────────────────────────────────────────────────────────

export const api = {
  // Alerts
  getAlerts: (params: {
    page?: number;
    page_size?: number;
    status?: string;
    typology?: string;
    min_risk?: number;
    sort_by?: string;
    sort_order?: string;
    search?: string;
  }) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    });
    return apiFetch<PaginatedAlerts>(`/alerts?${searchParams}`);
  },

  getAlert: (id: string) => apiFetch<Alert>(`/alerts/${id}`),

  getStats: () => apiFetch<DashboardStats>('/alerts/stats'),

  submitDecision: (alertId: string, decision: string) =>
    apiFetch(`/alerts/${alertId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),

  // NLP
  extractEntities: (rawText: string) =>
    apiFetch<{ entities: any[]; typology_classification: string; confidence: number }>(
      '/nlp/extract',
      { method: 'POST', body: JSON.stringify({ raw_text: rawText }) }
    ),

  // Agent
  investigate: (alertId: string) =>
    apiFetch<InvestigateResult>('/agent/investigate', {
      method: 'POST',
      body: JSON.stringify({ alert_id: alertId }),
    }),

  // RAG
  retrieveSimilar: (queryText: string, topK = 5) =>
    apiFetch<{ similar_cases: SimilarCase[] }>('/rag/retrieve', {
      method: 'POST',
      body: JSON.stringify({ query_text: queryText, top_k: topK }),
    }),

  // Narrative
  generateNarrative: (investigationResult: any) =>
    apiFetch<NarrativeResult>('/narrative/generate', {
      method: 'POST',
      body: JSON.stringify({ investigation_result: investigationResult }),
    }),

  narrativeDecision: (narrativeId: string, decision: string, editedText?: string) =>
    apiFetch(`/narrative/${narrativeId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, edited_text: editedText }),
    }),

  // Seeding
  seedAll: () => apiFetch('/seed/all', { method: 'POST' }),
  seedTypologies: () => apiFetch('/rag/seed-typologies', { method: 'POST' }),

  // Health
  health: () => apiFetch<{ status: string }>('/health'),
};
