import type { SpanOptions } from '@opentelemetry/api';
import { AsyncSingletonService } from '@/lib/base/AsyncSingletonService.js';
import { createLogger } from '@/lib/logger.js';
import { ElasticsearchManager, type SearchQuery, type SearchResponse, type QueryDSL } from './ElasticsearchManager.js';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager.js';
import { DistributedTracing } from '@/infrastructure/observability/DistributedTracing.js';

const logger = createLogger('AdvancedSearchService');

export interface SearchRequest {
  query: string;
  filters?: SearchFilter[];
  sort?: SearchSort[];
  pagination?: SearchPagination;
  options?: SearchOptions;
  context?: SearchContext;
}

export interface SearchFilter {
  field: string;
  operator: 'equals' | 'contains' | 'range' | 'exists' | 'terms' | 'prefix' | 'wildcard' | 'fuzzy';
  value: any;
  boost?: number;
  not?: boolean;
}

export interface SearchSort {
  field: string;
  direction: 'asc' | 'desc';
  mode?: 'min' | 'max' | 'avg' | 'sum' | 'median';
  missing?: '_first' | '_last' | any;
}

export interface SearchPagination {
  page?: number;
  size?: number;
  from?: number;
  searchAfter?: any[];
}

export interface SearchOptions {
  highlight?: boolean;
  suggest?: boolean;
  facets?: boolean;
  spell?: boolean;
  analytics?: boolean;
  explain?: boolean;
  timeout?: number;
  trackTotalHits?: boolean;
  minScore?: number;
  searchType?: 'standard' | 'dfs' | 'phrase' | 'fuzzy' | 'semantic';
  boost?: Record<string, number>;
  fuzziness?: string | number;
  operator?: 'and' | 'or';
}

export interface SearchContext {
  userId?: string;
  sessionId?: string;
  source?: string;
  timestamp?: Date;
  location?: GeoLocation;
  device?: DeviceInfo;
  preferences?: UserPreferences;
}

export interface GeoLocation {
  lat: number;
  lon: number;
  radius?: string;
}

export interface DeviceInfo {
  type: 'desktop' | 'mobile' | 'tablet';
  os: string;
  browser: string;
  screen?: {
    width: number;
    height: number;
  };
}

export interface UserPreferences {
  language?: string;
  timezone?: string;
  resultsPerPage?: number;
  sortPreference?: string;
  filters?: Record<string, any>;
}

export interface SearchResult<T = any> {
  id: string;
  score: number;
  source: T;
  highlights?: Record<string, string[]>;
  explanation?: any;
  sort?: any[];
  matchedQueries?: string[];
}

export interface SearchResults<T = any> {
  query: string;
  total: {
    value: number;
    relation: 'eq' | 'gte';
  };
  maxScore: number | null;
  results: SearchResult<T>[];
  facets?: SearchFacet[];
  suggestions?: SearchSuggestion[];
  spellCorrections?: SpellCorrection[];
  analytics?: SearchAnalytics;
  took: number;
  timedOut: boolean;
  pagination: ResultPagination;
}

export interface SearchFacet {
  field: string;
  name: string;
  type: 'terms' | 'range' | 'histogram' | 'date_histogram' | 'geo_distance';
  buckets: FacetBucket[];
  missing?: number;
  other?: number;
}

export interface FacetBucket {
  key: any;
  keyAsString?: string;
  docCount: number;
  from?: any;
  to?: any;
  selected?: boolean;
}

export interface SearchSuggestion {
  text: string;
  score: number;
  type: 'completion' | 'phrase' | 'term';
  context?: Record<string, any>;
}

export interface SpellCorrection {
  original: string;
  suggestion: string;
  confidence: number;
  type: 'spelling' | 'grammar' | 'context';
}

export interface SearchAnalytics {
  searchId: string;
  totalQueries: number;
  avgResponseTime: number;
  popularTerms: Array<{ term: string; count: number }>;
  clickThroughRate: number;
  conversionRate: number;
  bounceRate: number;
  queryPerformance: QueryPerformance;
}

export interface QueryPerformance {
  parseTime: number;
  executeTime: number;
  fetchTime: number;
  totalTime: number;
  shardStatistics: ShardStatistics;
}

export interface ShardStatistics {
  total: number;
  successful: number;
  skipped: number;
  failed: number;
}

export interface ResultPagination {
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  from: number;
  size: number;
}

export interface SearchTemplate {
  id: string;
  name: string;
  description: string;
  query: QueryDSL;
  parameters: TemplateParameter[];
  category: string;
  tags: string[];
  usage: TemplateUsage;
}

export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: any;
  description: string;
  validation?: ParameterValidation;
}

export interface ParameterValidation {
  pattern?: string;
  min?: number;
  max?: number;
  enum?: any[];
  custom?: (value: any) => boolean;
}

export interface TemplateUsage {
  count: number;
  lastUsed: Date;
  avgResponseTime: number;
  successRate: number;
}

export interface SearchProfile {
  userId: string;
  searchHistory: SearchHistoryEntry[];
  preferences: SearchPreferences;
  behavior: SearchBehavior;
  personalization: SearchPersonalization;
}

export interface SearchHistoryEntry {
  query: string;
  timestamp: Date;
  results: number;
  clicked: boolean;
  clickPosition?: number;
  sessionId: string;
  source: string;
}

export interface SearchPreferences {
  defaultSort: string;
  resultsPerPage: number;
  highlightEnabled: boolean;
  suggestionsEnabled: boolean;
  facetsEnabled: boolean;
  autoComplete: boolean;
  searchAsYouType: boolean;
  saveHistory: boolean;
}

export interface SearchBehavior {
  avgQueryLength: number;
  avgResultsViewed: number;
  clickThroughRate: number;
  refinementRate: number;
  sessionDuration: number;
  queryFrequency: number;
  topCategories: string[];
  timePatterns: TimePattern[];
}

export interface TimePattern {
  period: 'hour' | 'day' | 'week' | 'month';
  pattern: number[];
  confidence: number;
}

export interface SearchPersonalization {
  boosts: Record<string, number>;
  filters: Record<string, any>;
  synonyms: Record<string, string[]>;
  categories: CategoryBoost[];
  location?: GeoLocation;
  language: string;
}

export interface CategoryBoost {
  category: string;
  boost: number;
  reason: string;
}

export interface AutoCompleteRequest {
  query: string;
  field?: string;
  size?: number;
  context?: Record<string, any>;
  fuzzy?: boolean;
  filters?: SearchFilter[];
}

export interface AutoCompleteResult {
  suggestions: AutoCompleteSuggestion[];
  total: number;
  took: number;
}

export interface AutoCompleteSuggestion {
  text: string;
  score: number;
  category?: string;
  metadata?: Record<string, any>;
  highlighted?: string;
}

export class AdvancedSearchService extends AsyncSingletonService<AdvancedSearchService> {
  private elasticsearch!: ElasticsearchManager;
  private redis!: RedisClusterManager;
  private tracing!: DistributedTracing;
  private templates: Map<string, SearchTemplate> = new Map();
  private profiles: Map<string, SearchProfile> = new Map();
  private analyticsBuffer: SearchAnalytics[] = [];

  protected constructor() {
    super();
  }

  static async getInstance(): Promise<AdvancedSearchService> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.elasticsearch = await ElasticsearchManager.getInstance();
      this.redis = RedisClusterManager.getInstance();
      this.tracing = await DistributedTracing.getInstance();
      
      await this.loadSearchTemplates();
      await this.loadUserProfiles();
      
      logger.info('AdvancedSearchService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize AdvancedSearchService:', error);
      throw error;
    }
  }

  async search<T = any>(indexName: string, request: SearchRequest): Promise<SearchResults<T>> {
    const spanOptions: SpanOptions = {
      attributes: {
        'search.index': indexName,
        'search.query': request.query,
        'search.user_id': request.context?.userId || 'anonymous'
      }
    };

    return this.tracing.traceAsync('advanced_search', spanOptions, async () => {
      try {
        const startTime = Date.now();
        
        // Build Elasticsearch query
        const elasticQuery = await this.buildElasticsearchQuery(request);
        
        // Apply personalization
        if (request.context?.userId) {
          await this.applyPersonalization(elasticQuery, request.context.userId);
        }
        
        // Execute search
        const elasticResponse = await this.elasticsearch.search<T>(indexName, elasticQuery);
        
        // Transform response
        const results = await this.transformSearchResponse<T>(elasticResponse, request);
        
        // Add facets if requested
        if (request.options?.facets) {
          results.facets = await this.buildFacets(elasticResponse);
        }
        
        // Add suggestions if requested
        if (request.options?.suggest) {
          results.suggestions = await this.generateSuggestions(request.query, indexName);
        }
        
        // Add spell corrections if requested
        if (request.options?.spell) {
          results.spellCorrections = await this.generateSpellCorrections(request.query);
        }
        
        // Record analytics
        if (request.options?.analytics !== false) {
          await this.recordSearchAnalytics(indexName, request, results, Date.now() - startTime);
        }
        
        // Update user profile
        if (request.context?.userId) {
          await this.updateUserProfile(request.context.userId, request, results);
        }
        
        return results;
      } catch (error) {
        logger.error(`Advanced search failed on index ${indexName}:`, error);
        throw error;
      }
    });
  }

  async multiSearch<T = any>(searches: Array<{ index: string; request: SearchRequest }>): Promise<SearchResults<T>[]> {
    const spanOptions: SpanOptions = {
      attributes: {
        'search.operation': 'multi_search',
        'search.count': searches.length
      }
    };

    return this.tracing.traceAsync('advanced_multi_search', spanOptions, async () => {
      try {
        const searchPromises = searches.map(({ index, request }) => 
          this.search<T>(index, request)
        );
        
        const results = await Promise.allSettled(searchPromises);
        
        return results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          } else {
            logger.error(`Multi-search item ${index} failed:`, result.reason);
            return this.createEmptySearchResults<T>(searches[index].request.query);
          }
        });
      } catch (error) {
        logger.error('Multi-search failed:', error);
        throw error;
      }
    });
  }

  async autoComplete(indexName: string, request: AutoCompleteRequest): Promise<AutoCompleteResult> {
    const spanOptions: SpanOptions = {
      attributes: {
        'search.index': indexName,
        'search.operation': 'autocomplete',
        'search.query': request.query
      }
    };

    return this.tracing.traceAsync('search_autocomplete', spanOptions, async () => {
      try {
        // Check cache first
        const cacheKey = `autocomplete:${indexName}:${this.hashAutoCompleteRequest(request)}`;
        const cached = await this.redis.getObject<AutoCompleteResult>(cacheKey);
        if (cached) {
          return cached;
        }
        
        // Build completion query
        const completionQuery = this.buildCompletionQuery(request);
        
        // Execute completion search
        const response = await this.elasticsearch.search(indexName, completionQuery);
        
        // Transform to autocomplete results
        const result: AutoCompleteResult = {
          suggestions: this.extractCompletionSuggestions(response),
          total: response.hits.total.value,
          took: response.took
        };
        
        // Cache results
        await this.redis.setObject(cacheKey, result, 300000); // 5 minutes
        
        return result;
      } catch (error) {
        logger.error(`Autocomplete failed on index ${indexName}:`, error);
        throw error;
      }
    });
  }

  async createSearchTemplate(template: SearchTemplate): Promise<void> {
    try {
      await this.validateSearchTemplate(template);
      
      this.templates.set(template.id, template);
      await this.redis.setObject(`search:template:${template.id}`, template, 86400000 * 30); // 30 days
      
      logger.info(`Search template created: ${template.name} (${template.id})`);
    } catch (error) {
      logger.error('Failed to create search template:', error);
      throw error;
    }
  }

  async executeTemplate<T = any>(templateId: string, parameters: Record<string, any>, indexName: string): Promise<SearchResults<T>> {
    try {
      const template = this.templates.get(templateId);
      if (!template) {
        throw new Error(`Search template not found: ${templateId}`);
      }
      
      // Validate parameters
      await this.validateTemplateParameters(template, parameters);
      
      // Substitute parameters in query
      const query = this.substituteTemplateParameters(template.query, parameters);
      
      // Execute search
      const response = await this.elasticsearch.search<T>(indexName, { query });
      
      // Transform response
      const results = await this.transformSearchResponse<T>(response, { query: '', options: {} });
      
      // Update template usage
      await this.updateTemplateUsage(templateId, response.took);
      
      return results;
    } catch (error) {
      logger.error(`Template execution failed for ${templateId}:`, error);
      throw error;
    }
  }

  async getUserProfile(userId: string): Promise<SearchProfile | null> {
    try {
      let profile = this.profiles.get(userId);
      
      if (!profile) {
        // Try to load from Redis
        profile = await this.redis.getObject<SearchProfile>(`search:profile:${userId}`);
        if (profile) {
          this.profiles.set(userId, profile);
        }
      }
      
      return profile || null;
    } catch (error) {
      logger.error(`Failed to get user profile for ${userId}:`, error);
      return null;
    }
  }

  async updateUserProfile(userId: string, request: SearchRequest, results: SearchResults): Promise<void> {
    try {
      let profile = await this.getUserProfile(userId);
      
      if (!profile) {
        profile = this.createDefaultProfile(userId);
      }
      
      // Update search history
      profile.searchHistory.push({
        query: request.query,
        timestamp: new Date(),
        results: results.total.value,
        clicked: false,
        sessionId: request.context?.sessionId || '',
        source: request.context?.source || 'web'
      });
      
      // Keep only recent history (last 1000 searches)
      if (profile.searchHistory.length > 1000) {
        profile.searchHistory = profile.searchHistory.slice(-1000);
      }
      
      // Update behavior patterns
      await this.updateSearchBehavior(profile, request, results);
      
      // Update personalization
      await this.updatePersonalization(profile, request, results);
      
      // Store profile
      this.profiles.set(userId, profile);
      await this.redis.setObject(`search:profile:${userId}`, profile, 86400000 * 30); // 30 days
      
    } catch (error) {
      logger.error(`Failed to update user profile for ${userId}:`, error);
    }
  }

  private async buildElasticsearchQuery(request: SearchRequest): Promise<SearchQuery> {
    const query: SearchQuery = {
      from: request.pagination?.from || (request.pagination?.page ? (request.pagination.page - 1) * (request.pagination.size || 10) : 0),
      size: request.pagination?.size || 10,
      trackTotalHits: request.options?.trackTotalHits !== false,
      timeout: request.options?.timeout ? `${request.options.timeout}ms` : undefined,
      minScore: request.options?.minScore,
      explain: request.options?.explain
    };
    
    // Build main query
    query.query = await this.buildMainQuery(request);
    
    // Add filters
    if (request.filters && request.filters.length > 0) {
      query.query = {
        bool: {
          must: [query.query],
          filter: this.buildFilters(request.filters)
        }
      };
    }
    
    // Add sorting
    if (request.sort && request.sort.length > 0) {
      query.sort = this.buildSort(request.sort);
    }
    
    // Add highlighting
    if (request.options?.highlight) {
      query.highlight = this.buildHighlight();
    }
    
    // Add search after for cursor pagination
    if (request.pagination?.searchAfter) {
      query.searchAfter = request.pagination.searchAfter;
    }
    
    return query;
  }

  private async buildMainQuery(request: SearchRequest): Promise<QueryDSL> {
    if (!request.query || request.query.trim() === '') {
      return { matchAll: {} };
    }
    
    const searchType = request.options?.searchType || 'standard';
    
    switch (searchType) {
      case 'phrase':
        return this.buildPhraseQuery(request);
      case 'fuzzy':
        return this.buildFuzzyQuery(request);
      case 'semantic':
        return this.buildSemanticQuery(request);
      default:
        return this.buildStandardQuery(request);
    }
  }

  private buildStandardQuery(request: SearchRequest): QueryDSL {
    return {
      multiMatch: {
        query: request.query,
        fields: ['title^3', 'description^2', 'tags^1.5', 'content'],
        type: 'best_fields',
        operator: request.options?.operator || 'or',
        fuzziness: request.options?.fuzziness || 'AUTO',
        boost: 1.0
      }
    };
  }

  private buildPhraseQuery(request: SearchRequest): QueryDSL {
    return {
      multiMatch: {
        query: request.query,
        fields: ['title^3', 'description^2', 'content'],
        type: 'phrase',
        boost: 1.0
      }
    };
  }

  private buildFuzzyQuery(request: SearchRequest): QueryDSL {
    return {
      multiMatch: {
        query: request.query,
        fields: ['title^3', 'description^2', 'content'],
        type: 'best_fields',
        fuzziness: request.options?.fuzziness || 2,
        boost: 1.0
      }
    };
  }

  private buildSemanticQuery(request: SearchRequest): QueryDSL {
    // For semantic search, you would typically use dense vector search
    // This is a simplified version
    return {
      multiMatch: {
        query: request.query,
        fields: ['title^3', 'description^2', 'content'],
        type: 'cross_fields',
        boost: 1.0
      }
    };
  }

  private buildFilters(filters: SearchFilter[]): QueryDSL[] {
    return filters.map(filter => {
      let filterQuery: QueryDSL;
      
      switch (filter.operator) {
        case 'equals':
          filterQuery = { term: { [filter.field]: { value: filter.value, boost: filter.boost } } };
          break;
        case 'contains':
          filterQuery = { match: { [filter.field]: { query: filter.value, boost: filter.boost } } };
          break;
        case 'range':
          filterQuery = { range: { [filter.field]: { ...filter.value, boost: filter.boost } } };
          break;
        case 'exists':
          filterQuery = { exists: { field: filter.field } };
          break;
        case 'terms':
          filterQuery = { terms: { [filter.field]: { value: Array.isArray(filter.value) ? filter.value : [filter.value], boost: filter.boost } } };
          break;
        case 'prefix':
          filterQuery = { prefix: { [filter.field]: { value: filter.value, boost: filter.boost } } };
          break;
        case 'wildcard':
          filterQuery = { wildcard: { [filter.field]: { value: filter.value, boost: filter.boost } } };
          break;
        case 'fuzzy':
          filterQuery = { fuzzy: { [filter.field]: { value: filter.value, boost: filter.boost } } };
          break;
        default:
          filterQuery = { term: { [filter.field]: { value: filter.value } } };
      }
      
      return filter.not ? { bool: { mustNot: [filterQuery] } } : filterQuery;
    });
  }

  private buildSort(sorts: SearchSort[]): any[] {
    return sorts.map(sort => ({
      [sort.field]: {
        order: sort.direction,
        mode: sort.mode,
        missing: sort.missing
      }
    }));
  }

  private buildHighlight(): any {
    return {
      fields: {
        title: {},
        description: {},
        content: {}
      },
      preTags: ['<mark>'],
      postTags: ['</mark>'],
      fragmentSize: 150,
      numberOfFragments: 3
    };
  }

  private async transformSearchResponse<T>(response: SearchResponse<T>, request: SearchRequest): Promise<SearchResults<T>> {
    const total = response.hits.total;
    const pagination = this.calculatePagination(request.pagination, total.value);
    
    return {
      query: request.query,
      total,
      maxScore: response.hits.maxScore,
      results: response.hits.hits.map(hit => ({
        id: hit.id,
        score: hit.score || 0,
        source: hit.source,
        highlights: hit.highlight,
        explanation: hit.explanation,
        sort: hit.sort,
        matchedQueries: hit.matchedQueries
      })),
      took: response.took,
      timedOut: response.timedOut,
      pagination
    };
  }

  private calculatePagination(pagination: SearchPagination | undefined, total: number): ResultPagination {
    const size = pagination?.size || 10;
    const from = pagination?.from || (pagination?.page ? (pagination.page - 1) * size : 0);
    const currentPage = Math.floor(from / size) + 1;
    const totalPages = Math.ceil(total / size);
    
    return {
      currentPage,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrevious: currentPage > 1,
      from,
      size
    };
  }

  private async buildFacets(response: SearchResponse): Promise<SearchFacet[]> {
    // Extract facets from aggregations
    const facets: SearchFacet[] = [];
    
    if (response.aggregations) {
      for (const [key, agg] of Object.entries(response.aggregations)) {
        const facet = this.transformAggregationToFacet(key, agg);
        if (facet) {
          facets.push(facet);
        }
      }
    }
    
    return facets;
  }

  private transformAggregationToFacet(name: string, aggregation: any): SearchFacet | null {
    if (aggregation.buckets) {
      return {
        field: name,
        name: name.replace(/_/g, ' '),
        type: 'terms',
        buckets: aggregation.buckets.map((bucket: any) => ({
          key: bucket.key,
          keyAsString: bucket.key_as_string,
          docCount: bucket.doc_count
        }))
      };
    }
    
    return null;
  }

  private async generateSuggestions(query: string, indexName: string): Promise<SearchSuggestion[]> {
    try {
      const suggester = {
        completion: {
          field: 'suggest',
          text: query,
          size: 5
        }
      };
      
      const response = await this.elasticsearch.suggest(indexName, suggester);
      
      return this.transformSuggestionResponse(response);
    } catch (error) {
      logger.error('Failed to generate suggestions:', error);
      return [];
    }
  }

  private transformSuggestionResponse(response: any): SearchSuggestion[] {
    const suggestions: SearchSuggestion[] = [];
    
    if (response.suggestions) {
      for (const suggestion of response.suggestions) {
        suggestions.push({
          text: suggestion.text,
          score: suggestion.score || 1.0,
          type: 'completion'
        });
      }
    }
    
    return suggestions;
  }

  private async generateSpellCorrections(query: string): Promise<SpellCorrection[]> {
    // Simplified spell correction
    // In a real implementation, you would use a spell checking service
    return [];
  }

  private async applyPersonalization(query: SearchQuery, userId: string): Promise<void> {
    const profile = await this.getUserProfile(userId);
    if (!profile) return;
    
    // Apply user-specific boosts
    if (profile.personalization.boosts && Object.keys(profile.personalization.boosts).length > 0) {
      // Modify query to include personalization boosts
      // This is a simplified implementation
    }
  }

  private buildCompletionQuery(request: AutoCompleteRequest): SearchQuery {
    return {
      suggest: {
        autocomplete: {
          prefix: request.query,
          completion: {
            field: request.field || 'suggest',
            size: request.size || 10,
            fuzzy: request.fuzzy ? { fuzziness: 'AUTO' } : undefined
          }
        }
      },
      size: 0
    };
  }

  private extractCompletionSuggestions(response: SearchResponse): AutoCompleteSuggestion[] {
    const suggestions: AutoCompleteSuggestion[] = [];
    
    if (response.suggest?.autocomplete) {
      for (const suggestion of response.suggest.autocomplete) {
        if (suggestion.options) {
          for (const option of suggestion.options) {
            suggestions.push({
              text: option.text,
              score: option.score || 1.0,
              highlighted: option._source?.highlighted
            });
          }
        }
      }
    }
    
    return suggestions;
  }

  private createDefaultProfile(userId: string): SearchProfile {
    return {
      userId,
      searchHistory: [],
      preferences: {
        defaultSort: 'relevance',
        resultsPerPage: 10,
        highlightEnabled: true,
        suggestionsEnabled: true,
        facetsEnabled: true,
        autoComplete: true,
        searchAsYouType: false,
        saveHistory: true
      },
      behavior: {
        avgQueryLength: 0,
        avgResultsViewed: 0,
        clickThroughRate: 0,
        refinementRate: 0,
        sessionDuration: 0,
        queryFrequency: 0,
        topCategories: [],
        timePatterns: []
      },
      personalization: {
        boosts: {},
        filters: {},
        synonyms: {},
        categories: [],
        language: 'en'
      }
    };
  }

  private async updateSearchBehavior(profile: SearchProfile, request: SearchRequest, results: SearchResults): Promise<void> {
    // Update behavior metrics
    const history = profile.searchHistory;
    
    if (history.length > 0) {
      profile.behavior.avgQueryLength = history.reduce((sum, h) => sum + h.query.length, 0) / history.length;
      profile.behavior.clickThroughRate = history.filter(h => h.clicked).length / history.length;
    }
  }

  private async updatePersonalization(profile: SearchProfile, request: SearchRequest, results: SearchResults): Promise<void> {
    // Update personalization based on search patterns
    // This is a simplified implementation
  }

  private async recordSearchAnalytics(indexName: string, request: SearchRequest, results: SearchResults, duration: number): Promise<void> {
    const analytics: SearchAnalytics = {
      searchId: this.generateSearchId(),
      totalQueries: 1,
      avgResponseTime: duration,
      popularTerms: [{ term: request.query, count: 1 }],
      clickThroughRate: 0,
      conversionRate: 0,
      bounceRate: 0,
      queryPerformance: {
        parseTime: 0,
        executeTime: duration,
        fetchTime: 0,
        totalTime: duration,
        shardStatistics: {
          total: 1,
          successful: 1,
          skipped: 0,
          failed: 0
        }
      }
    };
    
    this.analyticsBuffer.push(analytics);
    
    // Flush buffer if it gets too large
    if (this.analyticsBuffer.length >= 100) {
      await this.flushAnalytics();
    }
  }

  private async flushAnalytics(): Promise<void> {
    if (this.analyticsBuffer.length === 0) return;
    
    try {
      // Store analytics data
      await this.redis.listPush('search:analytics', this.analyticsBuffer);
      this.analyticsBuffer = [];
    } catch (error) {
      logger.error('Failed to flush search analytics:', error);
    }
  }

  private createEmptySearchResults<T>(query: string): SearchResults<T> {
    return {
      query,
      total: { value: 0, relation: 'eq' },
      maxScore: null,
      results: [],
      took: 0,
      timedOut: false,
      pagination: {
        currentPage: 1,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
        from: 0,
        size: 10
      }
    };
  }

  private async loadSearchTemplates(): Promise<void> {
    // Load default search templates
    logger.info('Loading search templates');
  }

  private async loadUserProfiles(): Promise<void> {
    // Load user profiles from cache
    logger.info('Loading user profiles');
  }

  private async validateSearchTemplate(template: SearchTemplate): Promise<void> {
    if (!template.id || !template.name || !template.query) {
      throw new Error('Template ID, name, and query are required');
    }
  }

  private async validateTemplateParameters(template: SearchTemplate, parameters: Record<string, any>): Promise<void> {
    for (const param of template.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new Error(`Required parameter missing: ${param.name}`);
      }
      
      if (param.validation && param.name in parameters) {
        const value = parameters[param.name];
        
        if (param.validation.pattern && typeof value === 'string') {
          const regex = new RegExp(param.validation.pattern);
          if (!regex.test(value)) {
            throw new Error(`Parameter ${param.name} does not match pattern: ${param.validation.pattern}`);
          }
        }
        
        if (param.validation.min !== undefined && typeof value === 'number') {
          if (value < param.validation.min) {
            throw new Error(`Parameter ${param.name} must be at least ${param.validation.min}`);
          }
        }
        
        if (param.validation.max !== undefined && typeof value === 'number') {
          if (value > param.validation.max) {
            throw new Error(`Parameter ${param.name} must be at most ${param.validation.max}`);
          }
        }
        
        if (param.validation.enum && !param.validation.enum.includes(value)) {
          throw new Error(`Parameter ${param.name} must be one of: ${param.validation.enum.join(', ')}`);
        }
        
        if (param.validation.custom && !param.validation.custom(value)) {
          throw new Error(`Parameter ${param.name} failed custom validation`);
        }
      }
    }
  }

  private substituteTemplateParameters(query: QueryDSL, parameters: Record<string, any>): QueryDSL {
    // Simple parameter substitution
    // In a real implementation, you would use a more sophisticated template engine
    const queryString = JSON.stringify(query);
    let substituted = queryString;
    
    for (const [key, value] of Object.entries(parameters)) {
      const placeholder = `{{${key}}}`;
      substituted = substituted.replace(new RegExp(placeholder, 'g'), JSON.stringify(value));
    }
    
    return JSON.parse(substituted);
  }

  private async updateTemplateUsage(templateId: string, responseTime: number): Promise<void> {
    const template = this.templates.get(templateId);
    if (!template) return;
    
    template.usage.count++;
    template.usage.lastUsed = new Date();
    template.usage.avgResponseTime = (template.usage.avgResponseTime + responseTime) / 2;
    
    // Store updated template
    await this.redis.setObject(`search:template:${templateId}`, template, 86400000 * 30); // 30 days
  }

  private hashAutoCompleteRequest(request: AutoCompleteRequest): string {
    return Buffer.from(JSON.stringify(request)).toString('base64').substring(0, 16);
  }

  private generateSearchId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async shutdown(): Promise<void> {
    await this.flushAnalytics();
    logger.info('AdvancedSearchService shutdown completed');
  }
}