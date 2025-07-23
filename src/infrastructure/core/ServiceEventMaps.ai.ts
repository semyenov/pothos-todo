/**
 * AI/ML Service Event Maps
 * 
 * Type-safe event definitions for all AI/ML services in the system.
 * These event maps provide compile-time type safety for event-driven
 * AI service interactions.
 */

import type { Todo, User } from '@prisma/client';

/**
 * Vector store events for embedding storage and retrieval
 */
export interface VectorStoreEventMap {
  'vector:connected': { url: string; collections: string[] };
  'vector:disconnected': { reason?: string };
  'vector:collection-created': { name: string; dimension: number };
  'vector:collection-deleted': { name: string };
  'vector:embeddings-stored': { 
    collection: string; 
    count: number; 
    dimension: number;
    metadata?: Record<string, any>;
  };
  'vector:search-performed': { 
    collection: string; 
    query: number[]; 
    results: number; 
    duration: number;
    filters?: any;
  };
  'vector:error': { error: Error; operation: string };
  'vector:metrics': {
    collections: number;
    totalPoints: number;
    indexingProgress?: number;
  };
}

/**
 * Embedding service events for text-to-vector conversion
 */
export interface EmbeddingServiceEventMap {
  'embedding:generated': { 
    text: string; 
    model: string; 
    dimension: number; 
    duration: number;
    tokens?: number;
  };
  'embedding:batch-generated': { 
    count: number; 
    model: string; 
    duration: number;
    totalTokens?: number;
  };
  'embedding:cached': { text: string; hit: boolean };
  'embedding:error': { error: Error; text?: string };
  'embedding:model-changed': { oldModel: string; newModel: string };
  'embedding:rate-limit': { 
    retryAfter: number; 
    requestsRemaining?: number;
  };
}

/**
 * NLP service events for natural language processing
 */
export interface NLPServiceEventMap {
  'nlp:command-parsed': { 
    input: string; 
    command: string; 
    confidence: number;
    entities?: Record<string, any>;
  };
  'nlp:text-generated': { 
    prompt: string; 
    response: string; 
    model: string; 
    tokens: { prompt: number; completion: number };
  };
  'nlp:intent-recognized': { 
    text: string; 
    intent: string; 
    confidence: number;
    slots?: Record<string, any>;
  };
  'nlp:sentiment-analyzed': { 
    text: string; 
    sentiment: 'positive' | 'negative' | 'neutral'; 
    score: number;
  };
  'nlp:error': { error: Error; operation: string };
  'nlp:model-switched': { from: string; to: string; reason?: string };
}

/**
 * RAG service events for retrieval-augmented generation
 */
export interface RAGServiceEventMap {
  'rag:query-processed': { 
    query: string; 
    documentsRetrieved: number; 
    relevanceScores: number[];
  };
  'rag:context-built': { 
    query: string; 
    contextLength: number; 
    sources: string[];
  };
  'rag:answer-generated': { 
    query: string; 
    answer: string; 
    confidence: number;
    citations: Array<{ source: string; relevance: number }>;
  };
  'rag:knowledge-indexed': { 
    documents: number; 
    chunks: number; 
    duration: number;
  };
  'rag:cache-hit': { query: string; answer: string };
  'rag:error': { error: Error; stage: 'retrieval' | 'generation' };
}

/**
 * ML prediction service events
 */
export interface MLPredictionServiceEventMap {
  'ml:prediction-made': { 
    model: string; 
    input: any; 
    output: any; 
    confidence?: number;
    duration: number;
  };
  'ml:model-loaded': { 
    model: string; 
    version: string; 
    size?: number;
  };
  'ml:training-started': { 
    model: string; 
    dataset: string; 
    epochs?: number;
  };
  'ml:training-completed': { 
    model: string; 
    metrics: Record<string, number>;
    duration: number;
  };
  'ml:batch-prediction': { 
    model: string; 
    batchSize: number; 
    duration: number;
  };
  'ml:error': { error: Error; model?: string };
}

/**
 * AI insight service events
 */
export interface AIInsightServiceEventMap {
  'insight:generated': { 
    type: string; 
    userId: string; 
    insights: any[]; 
    confidence: number;
  };
  'insight:pattern-detected': { 
    pattern: string; 
    occurrences: number; 
    significance: number;
  };
  'insight:recommendation-made': { 
    userId: string; 
    recommendation: string; 
    basis: string[];
  };
  'insight:anomaly-detected': { 
    metric: string; 
    value: number; 
    expectedRange: [number, number];
  };
  'insight:report-generated': { 
    userId: string; 
    reportType: string; 
    sections: number;
  };
  'insight:error': { error: Error; insightType?: string };
}

/**
 * Advanced LangChain service events
 */
export interface LangChainServiceEventMap {
  'langchain:chain-executed': { 
    chainType: string; 
    input: any; 
    output: any; 
    steps: number;
    duration: number;
  };
  'langchain:memory-updated': { 
    sessionId: string; 
    messages: number; 
    tokens: number;
  };
  'langchain:tool-called': { 
    tool: string; 
    input: any; 
    output: any; 
    success: boolean;
  };
  'langchain:agent-action': { 
    agent: string; 
    action: string; 
    thought: string;
    observation?: string;
  };
  'langchain:error': { error: Error; chain?: string };
  'langchain:token-usage': { 
    prompt: number; 
    completion: number; 
    total: number;
    cost?: number;
  };
}

/**
 * AI orchestration service events
 */
export interface AIOrchestrationEventMap {
  'orchestration:workflow-started': { 
    workflowId: string; 
    type: string; 
    steps: number;
  };
  'orchestration:step-completed': { 
    workflowId: string; 
    step: string; 
    result: any;
    duration: number;
  };
  'orchestration:workflow-completed': { 
    workflowId: string; 
    success: boolean; 
    duration: number;
    outputs?: any;
  };
  'orchestration:parallel-execution': { 
    tasks: string[]; 
    concurrency: number;
  };
  'orchestration:retry-attempted': { 
    workflowId: string; 
    step: string; 
    attempt: number;
  };
  'orchestration:error': { 
    error: Error; 
    workflowId?: string; 
    step?: string;
  };
}

/**
 * AI pipeline service events
 */
export interface AIPipelineEventMap {
  'pipeline:started': { 
    pipelineId: string; 
    stages: string[]; 
    input: any;
  };
  'pipeline:stage-started': { 
    pipelineId: string; 
    stage: string; 
    index: number;
  };
  'pipeline:stage-completed': { 
    pipelineId: string; 
    stage: string; 
    output: any; 
    duration: number;
  };
  'pipeline:transform-applied': { 
    pipelineId: string; 
    transform: string; 
    before: any; 
    after: any;
  };
  'pipeline:completed': { 
    pipelineId: string; 
    output: any; 
    duration: number;
    stages: number;
  };
  'pipeline:error': { 
    error: Error; 
    pipelineId: string; 
    stage?: string;
  };
}

/**
 * Advanced AI manager events (multi-provider management)
 */
export interface AdvancedAIManagerEventMap {
  'ai-manager:provider-selected': { 
    task: string; 
    provider: string; 
    reason: 'cost' | 'performance' | 'availability' | 'capability';
  };
  'ai-manager:fallback-triggered': { 
    fromProvider: string; 
    toProvider: string; 
    error: Error;
  };
  'ai-manager:cost-tracked': { 
    provider: string; 
    model: string; 
    tokens: number; 
    cost: number;
  };
  'ai-manager:rate-limit-handled': { 
    provider: string; 
    waitTime: number; 
    switched: boolean;
  };
  'ai-manager:provider-health': { 
    provider: string; 
    status: 'healthy' | 'degraded' | 'down';
    latency?: number;
  };
  'ai-manager:quota-warning': { 
    provider: string; 
    used: number; 
    limit: number; 
    percentage: number;
  };
}

/**
 * Aggregate type for all AI service event maps
 */
export type AIServiceEventMap = 
  | VectorStoreEventMap
  | EmbeddingServiceEventMap
  | NLPServiceEventMap
  | RAGServiceEventMap
  | MLPredictionServiceEventMap
  | AIInsightServiceEventMap
  | LangChainServiceEventMap
  | AIOrchestrationEventMap
  | AIPipelineEventMap
  | AdvancedAIManagerEventMap;

/**
 * Helper type to get event map for a specific AI service
 */
export type GetAIServiceEventMap<T extends string> = 
  T extends 'vector-store' ? VectorStoreEventMap :
  T extends 'embedding' ? EmbeddingServiceEventMap :
  T extends 'nlp' ? NLPServiceEventMap :
  T extends 'rag' ? RAGServiceEventMap :
  T extends 'ml-prediction' ? MLPredictionServiceEventMap :
  T extends 'ai-insight' ? AIInsightServiceEventMap :
  T extends 'langchain' ? LangChainServiceEventMap :
  T extends 'ai-orchestration' ? AIOrchestrationEventMap :
  T extends 'ai-pipeline' ? AIPipelineEventMap :
  T extends 'ai-manager' ? AdvancedAIManagerEventMap :
  never;