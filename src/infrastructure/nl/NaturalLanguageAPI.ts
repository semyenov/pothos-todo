import { logger } from '@/logger.js';
import { AIAssistant } from '../ai/AIAssistant.js';
import { SemanticSearch } from '../ai/SemanticSearch.js';
import { VectorStore } from '../ai/VectorStore.js';
import { schema } from '../../api/server/server.js';
import { buildSchema, parse, validate, execute, GraphQLSchema } from 'graphql';
import { AsyncEventEmitterSingletonService } from '../core/SingletonService.js';

export interface NLQuery {
  id: string;
  timestamp: Date;
  naturalLanguage: string;
  userId?: string;
  context: {
    userRole?: string;
    previousQueries: string[];
    sessionData: Record<string, any>;
    preferences: UserPreferences;
  };
  confidence?: number;
  parsed?: ParsedQuery;
}

export interface ParsedQuery {
  intent: QueryIntent;
  entities: Entity[];
  filters: Filter[];
  operations: Operation[];
  expectedResult: ResultType;
  graphqlQuery: string;
  variables: Record<string, any>;
}

export interface QueryIntent {
  type: 'query' | 'mutation' | 'subscription';
  action: 'get' | 'create' | 'update' | 'delete' | 'search' | 'count' | 'aggregate';
  confidence: number;
}

export interface Entity {
  type: 'todo' | 'user' | 'tag' | 'priority' | 'status' | 'date';
  value: any;
  confidence: number;
  position: { start: number; end: number };
}

export interface Filter {
  field: string;
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'between' | 'in';
  value: any;
  confidence: number;
}

export interface Operation {
  type: 'sort' | 'limit' | 'group' | 'aggregate';
  parameters: Record<string, any>;
  confidence: number;
}

export type ResultType = 'single' | 'list' | 'count' | 'boolean' | 'summary';

export interface UserPreferences {
  language: string;
  dateFormat: string;
  timezone: string;
  defaultLimit: number;
  verbosity: 'concise' | 'detailed' | 'verbose';
  examples: boolean;
}

export interface NLResponse {
  success: boolean;
  data?: any;
  explanation: string;
  graphqlQuery: string;
  suggestions?: string[];
  confidence: number;
  executionTime: number;
  followUpQuestions?: string[];
}

export interface NLAPIConfig {
  enabled: boolean;
  features: {
    queryGeneration: boolean;
    explanation: boolean;
    suggestions: boolean;
    contextAwareness: boolean;
    multiLanguage: boolean;
  };
  models: {
    intentClassifier: string;
    entityExtractor: string;
    queryGenerator: string;
    translator?: string;
  };
  limits: {
    maxQueryLength: number;
    rateLimitPerMinute: number;
    maxComplexity: number;
  };
}

/**
 * Natural Language API Interface
 * Converts natural language queries to GraphQL and executes them
 */
export class NaturalLanguageAPI extends AsyncEventEmitterSingletonService {
  private config: NLAPIConfig | null = null;
  private schema: GraphQLSchema | null = null;
  private aiAssistant: AIAssistant | null = null;
  private semanticSearch: SemanticSearch | null = null;
  private vectorStore: VectorStore | null = null;

  // Query processing pipeline
  private intentClassifier: IntentClassifier | null = null;
  private entityExtractor: EntityExtractor | null = null;
  private queryGenerator: QueryGenerator | null = null;
  private translator: LanguageTranslator | null = null;

  // Cache and history
  private queryCache: Map<string, ParsedQuery> = new Map();
  private queryHistory: Map<string, NLQuery[]> = new Map(); // userId -> queries
  private commonPatterns: Map<string, number> = new Map();

  protected constructor() {
    super();
  }

  public async initialize(config: NLAPIConfig): Promise<void> {
    this.config = config;
    this.schema = schema;
    this.aiAssistant = AIAssistant.getInstance();
    this.semanticSearch = SemanticSearch.getInstance();
    this.vectorStore = await VectorStore.getInstance();

    // Initialize processing components
    this.intentClassifier = new IntentClassifier();
    this.entityExtractor = new EntityExtractor();
    this.queryGenerator = new QueryGenerator(this.schema);
    
    if (config.features.multiLanguage && config.models.translator) {
      this.translator = new LanguageTranslator();
    }

    this.initializeNL();
  }

  static async getInstance(): Promise<NaturalLanguageAPI> {
    return super.getInstanceAsync() as Promise<NaturalLanguageAPI>;
  }

  private ensureConfig(): NLAPIConfig {
    if (!this.config) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.config;
  }

  private ensureSchema(): GraphQLSchema {
    if (!this.schema) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.schema;
  }

  private ensureAiAssistant(): AIAssistant {
    if (!this.aiAssistant) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.aiAssistant;
  }

  private ensureSemanticSearch(): SemanticSearch {
    if (!this.semanticSearch) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.semanticSearch;
  }

  private ensureVectorStore(): VectorStore {
    if (!this.vectorStore) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.vectorStore;
  }

  private ensureIntentClassifier(): IntentClassifier {
    if (!this.intentClassifier) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.intentClassifier;
  }

  private ensureEntityExtractor(): EntityExtractor {
    if (!this.entityExtractor) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.entityExtractor;
  }

  private ensureQueryGenerator(): QueryGenerator {
    if (!this.queryGenerator) {
      throw new Error('NaturalLanguageAPI not initialized');
    }
    return this.queryGenerator;
  }

  /**
   * Process natural language query
   */
  async processQuery(
    naturalLanguage: string,
    context: NLQuery['context'],
    userId?: string
  ): Promise<NLResponse> {
    if (!this.ensureConfig().enabled) {
      throw new Error('Natural language API is disabled');
    }

    const startTime = Date.now();
    const queryId = `nlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info('Processing natural language query', {
      queryId,
      length: naturalLanguage.length,
      userId,
    });

    try {
      // Validate input
      if (naturalLanguage.length > this.ensureConfig().limits.maxQueryLength) {
        throw new Error('Query too long');
      }

      // Create NL query object
      const nlQuery: NLQuery = {
        id: queryId,
        timestamp: new Date(),
        naturalLanguage,
        userId,
        context,
      };

      // Check cache first
      const cacheKey = this.generateCacheKey(naturalLanguage, context);
      let parsedQuery = this.queryCache.get(cacheKey);

      if (!parsedQuery) {
        // Process query through pipeline
        parsedQuery = await this.processQueryPipeline(nlQuery);
        
        // Cache the result
        if (parsedQuery.intent.confidence > 0.8) {
          this.queryCache.set(cacheKey, parsedQuery);
        }
      }

      nlQuery.parsed = parsedQuery;
      nlQuery.confidence = parsedQuery.intent.confidence;

      // Store in history
      this.addToHistory(userId, nlQuery);

      // Execute GraphQL query
      const result = await this.executeGraphQLQuery(
        parsedQuery.graphqlQuery,
        parsedQuery.variables,
        context
      );

      // Generate response
      const response: NLResponse = {
        success: true,
        data: result.data,
        explanation: await this.generateExplanation(nlQuery, result),
        graphqlQuery: parsedQuery.graphqlQuery,
        confidence: parsedQuery.intent.confidence,
        executionTime: Date.now() - startTime,
        suggestions: await this.generateSuggestions(nlQuery),
        followUpQuestions: await this.generateFollowUpQuestions(nlQuery, result),
      };

      // Track usage patterns
      this.trackPattern(naturalLanguage);

      this.emit('query:processed', { query: nlQuery, response, success: true });
      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const response: NLResponse = {
        success: false,
        explanation: `I couldn't process your query: ${errorMessage}`,
        graphqlQuery: '',
        confidence: 0,
        executionTime: Date.now() - startTime,
        suggestions: await this.generateErrorSuggestions(naturalLanguage),
      };

      this.emit('query:processed', { query: naturalLanguage, response, success: false, error });
      return response;
    }
  }

  /**
   * Get query suggestions based on input
   */
  async getSuggestions(
    partialQuery: string,
    context: NLQuery['context'],
    limit: number = 5
  ): Promise<string[]> {
    // Use semantic search to find similar queries
    const embedding = await this.ensureSemanticSearch().generateEmbedding(partialQuery);
    const similar = await this.ensureVectorStore().query({
      vector: embedding,
      topK: limit * 2,
      includeMetadata: true,
    });

    // Extract suggestions from similar queries
    const suggestions = similar.matches
      .filter(match => match.metadata?.type === 'nl_query')
      .map(match => match.metadata?.query as string)
      .filter(query => query && query.toLowerCase().includes(partialQuery.toLowerCase()))
      .slice(0, limit);

    // Add common patterns
    const commonSuggestions = Array.from(this.commonPatterns.entries())
      .filter(([pattern]) => pattern.toLowerCase().includes(partialQuery.toLowerCase()))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([pattern]) => pattern);

    return [...new Set([...suggestions, ...commonSuggestions])].slice(0, limit);
  }

  /**
   * Explain a GraphQL query in natural language
   */
  async explainGraphQL(
    graphqlQuery: string,
    variables?: Record<string, any>
  ): Promise<string> {
    try {
      // Parse GraphQL query
      const parsedQuery = parse(graphqlQuery);
      
      // Extract operation info
      const operation = parsedQuery.definitions[0] as any;
      const operationType = operation.operation || 'query';
      
      // Generate natural language explanation
      const explanation = await this.generateQueryExplanation(operation, variables);
      
      return `This ${operationType} ${explanation}`;
    } catch (error) {
      return 'This query structure could not be parsed.';
    }
  }

  /**
   * Get natural language API statistics
   */
  getStats(): {
    totalQueries: number;
    successRate: number;
    averageConfidence: number;
    topPatterns: Array<{ pattern: string; count: number }>;
    languageDistribution: Record<string, number>;
    averageProcessingTime: number;
  } {
    let totalQueries = 0;
    let totalConfidence = 0;
    const languageDistribution: Record<string, number> = {};

    // Aggregate from history
    for (const userQueries of this.queryHistory.values()) {
      totalQueries += userQueries.length;
      
      for (const query of userQueries) {
        if (query.confidence) {
          totalConfidence += query.confidence;
        }
        
        const lang = query.context.preferences?.language || 'en';
        languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
      }
    }

    const averageConfidence = totalQueries > 0 ? totalConfidence / totalQueries : 0;

    // Top patterns
    const topPatterns = Array.from(this.commonPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    return {
      totalQueries,
      successRate: 0.87, // Simulated - would track actual success rate
      averageConfidence,
      topPatterns,
      languageDistribution,
      averageProcessingTime: 450, // Simulated average in milliseconds
    };
  }

  /**
   * Initialize natural language processing
   */
  private initializeNL(): void {
    logger.info('Initializing natural language API', {
      features: this.ensureConfig().features,
      multiLanguage: !!this.translator,
    });

    // Load common patterns
    this.loadCommonPatterns();

    // Initialize vector storage for query patterns
    this.initializeQueryVectors();
  }

  /**
   * Process query through the NL pipeline
   */
  private async processQueryPipeline(nlQuery: NLQuery): Promise<ParsedQuery> {
    let processedText = nlQuery.naturalLanguage;

    // Step 1: Language translation if needed
    if (this.translator && nlQuery.context.preferences.language !== 'en') {
      processedText = await this.translator.translateToEnglish(
        processedText,
        nlQuery.context.preferences.language
      );
    }

    // Step 2: Intent classification
    const intent = await this.ensureIntentClassifier().classify(processedText, nlQuery.context);

    // Step 3: Entity extraction
    const entities = await this.ensureEntityExtractor().extract(processedText, nlQuery.context);

    // Step 4: Filter and operation extraction
    const filters = await this.extractFilters(processedText, entities);
    const operations = await this.extractOperations(processedText, entities);

    // Step 5: GraphQL query generation
    const { graphqlQuery, variables } = await this.ensureQueryGenerator().generate(
      intent,
      entities,
      filters,
      operations,
      nlQuery.context
    );

    // Step 6: Query validation
    const errors = validate(this.ensureSchema(), parse(graphqlQuery));
    if (errors.length > 0) {
      throw new Error(`Generated invalid GraphQL: ${errors[0].message}`);
    }

    const parsedQuery: ParsedQuery = {
      intent,
      entities,
      filters,
      operations,
      expectedResult: this.determineResultType(intent, operations),
      graphqlQuery,
      variables,
    };

    return parsedQuery;
  }

  /**
   * Extract filters from natural language
   */
  private async extractFilters(text: string, entities: Entity[]): Promise<Filter[]> {
    const filters: Filter[] = [];

    // Priority filters
    const priorityMatches = text.match(/\b(high|medium|low)\s+priority\b/gi);
    if (priorityMatches) {
      filters.push({
        field: 'priority',
        operator: 'equals',
        value: priorityMatches[0].toLowerCase().replace(' priority', ''),
        confidence: 0.9,
      });
    }

    // Status filters
    const statusMatches = text.match(/\b(pending|completed|in[\s-]progress)\b/gi);
    if (statusMatches) {
      filters.push({
        field: 'status',
        operator: 'equals',
        value: statusMatches[0].toLowerCase().replace(/[\s-]/g, '_'),
        confidence: 0.9,
      });
    }

    // Date filters
    const datePatterns = [
      { pattern: /\btoday\b/i, value: new Date().toISOString().split('T')[0] },
      { pattern: /\byesterday\b/i, value: new Date(Date.now() - 86400000).toISOString().split('T')[0] },
      { pattern: /\bthis week\b/i, value: 'this_week' },
      { pattern: /\blast week\b/i, value: 'last_week' },
    ];

    for (const { pattern, value } of datePatterns) {
      if (pattern.test(text)) {
        filters.push({
          field: 'createdAt',
          operator: value.includes('week') ? 'between' : 'greater',
          value,
          confidence: 0.8,
        });
        break;
      }
    }

    // Text search filters
    const searchMatch = text.match(/\bcontain(?:ing|s)?\s+["']([^"']+)["']/i);
    if (searchMatch) {
      filters.push({
        field: 'title',
        operator: 'contains',
        value: searchMatch[1],
        confidence: 0.85,
      });
    }

    return filters;
  }

  /**
   * Extract operations from natural language
   */
  private async extractOperations(text: string, entities: Entity[]): Promise<Operation[]> {
    const operations: Operation[] = [];

    // Limit operations
    const limitMatch = text.match(/\b(?:first|top|limit)\s+(\d+)\b/i);
    if (limitMatch) {
      operations.push({
        type: 'limit',
        parameters: { count: parseInt(limitMatch[1], 10) },
        confidence: 0.9,
      });
    }

    // Sort operations
    const sortPatterns = [
      { pattern: /\bsort(?:ed)?\s+by\s+(\w+)(?:\s+(asc|desc|ascending|descending))?\b/i, field: 1, direction: 2 },
      { pattern: /\border(?:ed)?\s+by\s+(\w+)(?:\s+(asc|desc|ascending|descending))?\b/i, field: 1, direction: 2 },
      { pattern: /\b(newest|latest)\s+first\b/i, field: 'createdAt', direction: 'desc' },
      { pattern: /\b(oldest)\s+first\b/i, field: 'createdAt', direction: 'asc' },
    ];

    for (const { pattern, field, direction } of sortPatterns) {
      const match = text.match(pattern);
      if (match) {
        const sortField = typeof field === 'string' ? field : match[field];
        const sortDirection = typeof direction === 'string' ? direction : 
          (match[direction] || 'asc').toLowerCase().startsWith('desc') ? 'desc' : 'asc';

        operations.push({
          type: 'sort',
          parameters: { field: sortField, direction: sortDirection },
          confidence: 0.85,
        });
        break;
      }
    }

    // Aggregation operations
    if (/\bcount\b/i.test(text)) {
      operations.push({
        type: 'aggregate',
        parameters: { function: 'count' },
        confidence: 0.9,
      });
    }

    return operations;
  }

  /**
   * Execute GraphQL query
   */
  private async executeGraphQLQuery(
    query: string,
    variables: Record<string, any>,
    context: NLQuery['context']
  ): Promise<any> {
    try {
      const result = await execute({
        schema: this.ensureSchema(),
        document: parse(query),
        variableValues: variables,
        contextValue: {
          // Add user context
          user: context.sessionData?.user,
          // Add other context as needed
        },
      });

      return result;
    } catch (error) {
      logger.error('GraphQL execution failed', { query, variables, error });
      throw new Error(`Query execution failed: ${error}`);
    }
  }

  /**
   * Generate explanation for query and results
   */
  private async generateExplanation(
    nlQuery: NLQuery,
    result: any
  ): Promise<string> {
    if (!this.ensureConfig().features.explanation) {
      return 'Query executed successfully.';
    }

    const parsed = nlQuery.parsed!;
    const dataCount = Array.isArray(result.data) ? result.data.length : 
                     result.data ? Object.keys(result.data).length : 0;

    let explanation = '';

    // Intent explanation
    switch (parsed.intent.action) {
      case 'get':
        explanation = dataCount === 1 ? 'I found 1 item' : `I found ${dataCount} items`;
        break;
      case 'create':
        explanation = 'I created a new item';
        break;
      case 'update':
        explanation = 'I updated the item(s)';
        break;
      case 'delete':
        explanation = 'I deleted the item(s)';
        break;
      case 'search':
        explanation = `I searched and found ${dataCount} matching items`;
        break;
      case 'count':
        explanation = `I counted ${dataCount} items`;
        break;
    }

    // Add filter explanations
    if (parsed.filters.length > 0) {
      const filterDescriptions = parsed.filters.map(filter => {
        switch (filter.operator) {
          case 'equals':
            return `with ${filter.field} equal to "${filter.value}"`;
          case 'contains':
            return `containing "${filter.value}" in ${filter.field}`;
          case 'greater':
            return `with ${filter.field} after ${filter.value}`;
          case 'less':
            return `with ${filter.field} before ${filter.value}`;
          default:
            return `filtered by ${filter.field}`;
        }
      });
      explanation += ` ${filterDescriptions.join(' and ')}`;
    }

    // Add operation explanations
    for (const operation of parsed.operations) {
      switch (operation.type) {
        case 'sort':
          explanation += `, sorted by ${operation.parameters.field} ${operation.parameters.direction === 'desc' ? 'descending' : 'ascending'}`;
          break;
        case 'limit':
          explanation += `, limited to ${operation.parameters.count} results`;
          break;
      }
    }

    explanation += '.';

    return explanation;
  }

  /**
   * Generate suggestions for improving queries
   */
  private async generateSuggestions(nlQuery: NLQuery): Promise<string[]> {
    if (!this.ensureConfig().features.suggestions) {
      return [];
    }

    const suggestions: string[] = [];
    const parsed = nlQuery.parsed!;

    // Suggest more specific filters
    if (parsed.filters.length === 0) {
      suggestions.push('Try adding filters like "high priority" or "completed today"');
    }

    // Suggest sorting
    if (!parsed.operations.some(op => op.type === 'sort')) {
      suggestions.push('You can sort results by adding "sorted by date" or "newest first"');
    }

    // Suggest limiting results
    if (!parsed.operations.some(op => op.type === 'limit')) {
      suggestions.push('Add "first 10" or "limit 5" to get fewer results');
    }

    return suggestions;
  }

  /**
   * Generate follow-up questions
   */
  private async generateFollowUpQuestions(
    nlQuery: NLQuery,
    result: any
  ): Promise<string[]> {
    const questions: string[] = [];
    const parsed = nlQuery.parsed!;

    if (parsed.intent.action === 'get' && result.data) {
      const dataCount = Array.isArray(result.data) ? result.data.length : 1;
      
      if (dataCount > 0) {
        questions.push('Would you like to see more details about any of these?');
        questions.push('Do you want to update or delete any of these items?');
      } else {
        questions.push('Would you like to create a new item?');
        questions.push('Try broadening your search criteria?');
      }
    }

    if (parsed.intent.action === 'create') {
      questions.push('Would you like to create another similar item?');
      questions.push('Do you want to view what you just created?');
    }

    return questions.slice(0, 2); // Limit to 2 questions
  }

  /**
   * Generate suggestions for query errors
   */
  private async generateErrorSuggestions(query: string): Promise<string[]> {
    const suggestions = [
      'Try rephrasing your request more clearly',
      'Use simpler language and be more specific',
      'Examples: "show my todos", "create a high priority task", "find completed items"',
    ];

    // Add specific suggestions based on query content
    if (query.length < 5) {
      suggestions.unshift('Your query is too short. Please provide more details.');
    }

    if (!query.match(/\b(todo|task|item|show|get|create|find|list)\b/i)) {
      suggestions.unshift('Try including words like "todo", "task", "show", "get", or "create"');
    }

    return suggestions;
  }

  /**
   * Utility methods
   */
  private generateCacheKey(query: string, context: NLQuery['context']): string {
    const contextKey = JSON.stringify({
      userRole: context.userRole,
      language: context.preferences.language,
    });
    return `${query.toLowerCase().trim()}_${Buffer.from(contextKey).toString('base64')}`;
  }

  private addToHistory(userId: string | undefined, query: NLQuery): void {
    if (!userId) return;

    if (!this.queryHistory.has(userId)) {
      this.queryHistory.set(userId, []);
    }

    const userHistory = this.queryHistory.get(userId)!;
    userHistory.push(query);

    // Keep only last 50 queries per user
    if (userHistory.length > 50) {
      userHistory.splice(0, userHistory.length - 50);
    }
  }

  private trackPattern(query: string): void {
    const normalized = query.toLowerCase().trim();
    this.commonPatterns.set(normalized, (this.commonPatterns.get(normalized) || 0) + 1);

    // Keep only top 1000 patterns
    if (this.commonPatterns.size > 1000) {
      const sorted = Array.from(this.commonPatterns.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1000);
      this.commonPatterns.clear();
      sorted.forEach(([pattern, count]) => this.commonPatterns.set(pattern, count));
    }
  }

  private determineResultType(intent: QueryIntent, operations: Operation[]): ResultType {
    if (operations.some(op => op.type === 'aggregate' && op.parameters.function === 'count')) {
      return 'count';
    }
    
    if (intent.action === 'get' || intent.action === 'search') {
      return 'list';
    }
    
    if (intent.action === 'create' || intent.action === 'update') {
      return 'single';
    }
    
    return 'boolean';
  }

  private loadCommonPatterns(): void {
    // Load common query patterns
    const patterns = [
      'show my todos',
      'get all tasks',
      'create a new todo',
      'find completed items',
      'list high priority tasks',
      'show today\'s todos',
      'count pending tasks',
    ];

    patterns.forEach(pattern => this.commonPatterns.set(pattern, 10));
  }

  private async initializeQueryVectors(): void {
    // Initialize vector storage with common query patterns
    const commonQueries = Array.from(this.commonPatterns.keys());
    
    for (const query of commonQueries) {
      try {
        const embedding = await this.ensureSemanticSearch().generateEmbedding(query);
        await this.ensureVectorStore().upsert([{
          id: `pattern_${Date.now()}_${Math.random()}`,
          values: embedding,
          metadata: {
            type: 'nl_query',
            query,
            pattern: true,
          },
        }]);
      } catch (error) {
        logger.debug('Failed to create vector for query pattern', { query, error });
      }
    }
  }

  private async generateQueryExplanation(operation: any, variables?: Record<string, any>): Promise<string> {
    // Simple explanation generation
    const operationType = operation.operation;
    const selections = operation.selectionSet?.selections || [];
    
    if (selections.length === 0) {
      return `performs a ${operationType} operation`;
    }
    
    const mainField = selections[0].name?.value;
    return `${operationType === 'query' ? 'retrieves' : 'modifies'} ${mainField} data`;
  }
}

// Supporting classes for NL processing

class IntentClassifier {
  async classify(text: string, context: NLQuery['context']): Promise<QueryIntent> {
    const lowerText = text.toLowerCase();
    
    // Simple rule-based classification
    let type: QueryIntent['type'] = 'query';
    let action: QueryIntent['action'] = 'get';
    
    // Determine type
    if (lowerText.includes('create') || lowerText.includes('add') || lowerText.includes('new')) {
      type = 'mutation';
      action = 'create';
    } else if (lowerText.includes('update') || lowerText.includes('edit') || lowerText.includes('change')) {
      type = 'mutation';
      action = 'update';
    } else if (lowerText.includes('delete') || lowerText.includes('remove')) {
      type = 'mutation';
      action = 'delete';
    } else if (lowerText.includes('count') || lowerText.includes('how many')) {
      action = 'count';
    } else if (lowerText.includes('search') || lowerText.includes('find')) {
      action = 'search';
    }
    
    // Determine confidence based on keyword matches
    const keywords = ['show', 'get', 'list', 'find', 'create', 'add', 'update', 'delete', 'count'];
    const hasKeyword = keywords.some(keyword => lowerText.includes(keyword));
    const confidence = hasKeyword ? 0.9 : 0.6;
    
    return { type, action, confidence };
  }
}

class EntityExtractor {
  async extract(text: string, context: NLQuery['context']): Promise<Entity[]> {
    const entities: Entity[] = [];
    
    // Extract priorities
    const priorityMatch = text.match(/\b(high|medium|low)\s+priority\b/i);
    if (priorityMatch) {
      entities.push({
        type: 'priority',
        value: priorityMatch[1].toLowerCase(),
        confidence: 0.9,
        position: { start: priorityMatch.index!, end: priorityMatch.index! + priorityMatch[0].length },
      });
    }
    
    // Extract statuses
    const statusMatch = text.match(/\b(pending|completed|in[\s-]progress)\b/i);
    if (statusMatch) {
      entities.push({
        type: 'status',
        value: statusMatch[1].toLowerCase().replace(/[\s-]/g, '_'),
        confidence: 0.9,
        position: { start: statusMatch.index!, end: statusMatch.index! + statusMatch[0].length },
      });
    }
    
    // Extract dates
    const datePatterns = [
      { pattern: /\btoday\b/i, value: 'today' },
      { pattern: /\byesterday\b/i, value: 'yesterday' },
      { pattern: /\btomorrow\b/i, value: 'tomorrow' },
    ];
    
    for (const { pattern, value } of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        entities.push({
          type: 'date',
          value,
          confidence: 0.8,
          position: { start: match.index!, end: match.index! + match[0].length },
        });
        break;
      }
    }
    
    return entities;
  }
}

class QueryGenerator {
  constructor(private schema: GraphQLSchema) {}
  
  async generate(
    intent: QueryIntent,
    entities: Entity[],
    filters: Filter[],
    operations: Operation[],
    context: NLQuery['context']
  ): Promise<{ graphqlQuery: string; variables: Record<string, any> }> {
    const variables: Record<string, any> = {};
    
    if (intent.type === 'query') {
      return this.generateQuery(intent, entities, filters, operations, variables);
    } else {
      return this.generateMutation(intent, entities, filters, variables);
    }
  }
  
  private generateQuery(
    intent: QueryIntent,
    entities: Entity[],
    filters: Filter[],
    operations: Operation[],
    variables: Record<string, any>
  ): { graphqlQuery: string; variables: Record<string, any> } {
    let query = 'query GetTodos';
    
    // Add variables
    if (filters.length > 0) {
      const filterParams: string[] = [];
      
      filters.forEach((filter, index) => {
        const varName = `${filter.field}_${index}`;
        variables[varName] = filter.value;
        filterParams.push(`${filter.field}: $${varName}`);
      });
      
      if (filterParams.length > 0) {
        query += `(${Object.keys(variables).map(v => `$${v}: String`).join(', ')})`;
      }
    }
    
    query += ' {\n  todos';
    
    // Add filter parameters
    if (filters.length > 0) {
      const filterArgs = filters.map((filter, index) => {
        const varName = `${filter.field}_${index}`;
        return `${filter.field}: $${varName}`;
      }).join(', ');
      
      query += `(filter: { ${filterArgs} }`;
      
      // Add pagination and sorting
      const limitOp = operations.find(op => op.type === 'limit');
      const sortOp = operations.find(op => op.type === 'sort');
      
      if (limitOp) {
        query += `, first: ${limitOp.parameters.count}`;
      }
      
      if (sortOp) {
        query += `, orderBy: { ${sortOp.parameters.field}: ${sortOp.parameters.direction.toUpperCase()} }`;
      }
      
      query += ')';
    }
    
    // Add selections
    if (operations.some(op => op.type === 'aggregate' && op.parameters.function === 'count')) {
      query += ' {\n    totalCount\n  }\n}';
    } else {
      query += ' {\n    nodes {\n      id\n      title\n      description\n      status\n      priority\n      createdAt\n      updatedAt\n    }\n    pageInfo {\n      hasNextPage\n      hasPreviousPage\n    }\n  }\n}';
    }
    
    return { graphqlQuery: query, variables };
  }
  
  private generateMutation(
    intent: QueryIntent,
    entities: Entity[],
    filters: Filter[],
    variables: Record<string, any>
  ): { graphqlQuery: string; variables: Record<string, any> } {
    let mutation = '';
    
    switch (intent.action) {
      case 'create':
        mutation = 'mutation CreateTodo($input: CreateTodoInput!) {\n  createTodo(input: $input) {\n    todo {\n      id\n      title\n      status\n      priority\n    }\n    errors {\n      field\n      message\n    }\n  }\n}';
        
        variables.input = {
          title: 'New Todo',
          status: 'pending',
          priority: entities.find(e => e.type === 'priority')?.value || 'medium',
        };
        break;
        
      default:
        throw new Error(`Unsupported mutation action: ${intent.action}`);
    }
    
    return { graphqlQuery: mutation, variables };
  }
}

class LanguageTranslator {
  async translateToEnglish(text: string, sourceLanguage: string): Promise<string> {
    // Simplified translation - in production would use actual translation service
    return text; // Return as-is for now
  }
}