import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RetrievalQAChain } from 'langchain/chains';
import { Document } from '@langchain/core/documents';
import { logger } from '@/logger';
import { SingletonService } from '../core/SingletonService.js';

export interface LangChainConfig {
  openaiApiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enableRAG: boolean;
  enableMemory: boolean;
}

export interface ConversationContext {
  userId: string;
  sessionId: string;
  todoContext?: any[];
  userPreferences?: Record<string, any>;
  conversationHistory: any[];
}

export interface AIResponse {
  response: string;
  confidence: number;
  reasoning: string;
  suggestions: string[];
  actions: ActionSuggestion[];
  metadata: Record<string, any>;
}

export interface ActionSuggestion {
  type: 'create_todo' | 'update_todo' | 'create_list' | 'schedule' | 'prioritize';
  description: string;
  parameters: Record<string, any>;
  confidence: number;
}

export class AdvancedLangChainService extends SingletonService<AdvancedLangChainService> {
  private chatModel: ChatOpenAI | null = null;
  private embeddings: OpenAIEmbeddings | null = null;
  private vectorStore: MemoryVectorStore | null = null;
  private conversationChains: Map<string, RunnableSequence> = new Map();
  private userContexts: Map<string, ConversationContext> = new Map();
  private config: LangChainConfig | null = null;

  protected constructor() {
    super();
  }

  public static getInstance(): AdvancedLangChainService {
    return super.getInstance();
  }

  /**
   * Configure the LangChain service with API keys and settings
   */
  public configure(config: LangChainConfig): void {
    this.config = config;
    
    this.chatModel = new ChatOpenAI({
      openAIApiKey: config.openaiApiKey,
      modelName: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
    
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openaiApiKey,
    });
  }

  /**
   * Initialize vector store with todo data for RAG
   */
  public async initializeRAG(documents: Document[]): Promise<void> {
    this.ensureConfigured();
    
    try {
      this.vectorStore = await MemoryVectorStore.fromDocuments(
        documents,
        this.embeddings!
      );
      logger.info('RAG vector store initialized', { documentCount: documents.length });
    } catch (error) {
      logger.error('Failed to initialize RAG vector store', error);
      throw error;
    }
  }

  /**
   * Advanced conversational AI with context awareness
   */
  public async processConversation(
    userId: string,
    message: string,
    context?: Partial<ConversationContext>
  ): Promise<AIResponse> {
    try {
      const userContext = this.getUserContext(userId, context);
      
      // Create context-aware prompt
      const systemPrompt = this.createSystemPrompt(userContext);
      const prompt = ChatPromptTemplate.fromMessages([
        ['system', systemPrompt],
        ['human', '{input}'],
      ]);

      // Create or get conversation chain
      let chain = this.conversationChains.get(userId);
      if (!chain) {
        chain = RunnableSequence.from([
          prompt,
          this.chatModel,
          new StringOutputParser(),
        ]);
        this.conversationChains.set(userId, chain);
      }

      // Process with RAG if available
      let ragContext = '';
      if (this.config.enableRAG && this.vectorStore) {
        const similarDocs = await this.vectorStore.similaritySearch(message, 3);
        ragContext = similarDocs.map(doc => doc.pageContent).join('\n');
      }

      // Generate response
      const response = await chain.invoke({
        input: message,
        context: ragContext,
        user_context: JSON.stringify(userContext),
      });

      // Parse and enhance response
      const aiResponse = await this.parseAndEnhanceResponse(
        response,
        message,
        userContext
      );

      // Update conversation history
      userContext.conversationHistory.push({
        timestamp: new Date(),
        human: message,
        ai: response,
      });

      this.userContexts.set(userId, userContext);

      return aiResponse;
    } catch (error) {
      logger.error('Failed to process conversation', error);
      throw error;
    }
  }

  /**
   * Generate intelligent todo suggestions based on user patterns
   */
  public async generateTodoSuggestions(
    userId: string,
    userTodos: any[]
  ): Promise<ActionSuggestion[]> {
    try {
      const context = this.getUserContext(userId);
      
      const prompt = ChatPromptTemplate.fromTemplate(`
        Based on the user's todo history and patterns, suggest 3-5 new todos that would be valuable.
        
        User's existing todos: {todos}
        User patterns: {patterns}
        
        Respond with a JSON array of suggestions in this format:
        [{
          "type": "create_todo",
          "description": "Suggestion description",
          "parameters": {
            "title": "Todo title",
            "priority": "medium",
            "estimatedDuration": "30 minutes"
          },
          "confidence": 0.85
        }]
      `);

      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      const patterns = this.analyzeUserPatterns(userTodos);
      const response = await chain.invoke({
        todos: JSON.stringify(userTodos.slice(-10)), // Last 10 todos
        patterns: JSON.stringify(patterns),
      });

      return this.parseSuggestions(response);
    } catch (error) {
      logger.error('Failed to generate todo suggestions', error);
      return [];
    }
  }

  /**
   * Intelligent todo prioritization using ML
   */
  public async prioritizeTodos(
    userId: string,
    todos: any[]
  ): Promise<Array<{ todoId: string; priority: string; reasoning: string }>> {
    try {
      const prompt = ChatPromptTemplate.fromTemplate(`
        Analyze these todos and suggest optimal prioritization based on:
        - Deadlines and urgency
        - Task dependencies
        - User's historical patterns
        - Business impact
        
        Todos: {todos}
        
        Respond with JSON array:
        [{
          "todoId": "id",
          "priority": "high|medium|low",
          "reasoning": "Explanation for priority"
        }]
      `);

      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      const response = await chain.invoke({
        todos: JSON.stringify(todos),
      });

      return JSON.parse(response);
    } catch (error) {
      logger.error('Failed to prioritize todos', error);
      return [];
    }
  }

  /**
   * Natural language to todo conversion
   */
  public async parseNaturalLanguageTodo(
    userId: string,
    naturalText: string
  ): Promise<ActionSuggestion[]> {
    try {
      const prompt = ChatPromptTemplate.fromTemplate(`
        Parse this natural language text into structured todo actions:
        "{text}"
        
        Extract:
        - Individual todos/tasks
        - Due dates/times
        - Priorities
        - Categories/tags
        - Dependencies
        
        Respond with JSON array of actions:
        [{
          "type": "create_todo",
          "description": "What this action does",
          "parameters": {
            "title": "Todo title",
            "description": "Details",
            "priority": "high|medium|low",
            "dueDate": "ISO date or null",
            "tags": ["tag1", "tag2"],
            "estimatedDuration": "duration in minutes"
          },
          "confidence": 0.9
        }]
      `);

      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      const response = await chain.invoke({ text: naturalText });
      return this.parseSuggestions(response);
    } catch (error) {
      logger.error('Failed to parse natural language todo', error);
      return [];
    }
  }

  /**
   * Intelligent task time estimation
   */
  public async estimateTaskDuration(
    todoTitle: string,
    description: string,
    userHistory: any[]
  ): Promise<{ estimatedMinutes: number; confidence: number; reasoning: string }> {
    try {
      const prompt = ChatPromptTemplate.fromTemplate(`
        Estimate how long this task will take based on:
        - Task title: {title}
        - Description: {description}
        - User's historical completion times: {history}
        
        Consider task complexity, user's experience level, and similar past tasks.
        
        Respond with JSON:
        {
          "estimatedMinutes": 60,
          "confidence": 0.8,
          "reasoning": "Explanation of estimate"
        }
      `);

      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      const response = await chain.invoke({
        title: todoTitle,
        description: description || 'No description provided',
        history: JSON.stringify(userHistory.slice(-20)),
      });

      return JSON.parse(response);
    } catch (error) {
      logger.error('Failed to estimate task duration', error);
      return { estimatedMinutes: 30, confidence: 0.5, reasoning: 'Default estimate' };
    }
  }

  /**
   * Generate productivity insights
   */
  public async generateProductivityInsights(
    userId: string,
    userTodos: any[],
    completedTodos: any[]
  ): Promise<{
    insights: string[];
    recommendations: string[];
    patterns: Record<string, any>;
    score: number;
  }> {
    try {
      const prompt = ChatPromptTemplate.fromTemplate(`
        Analyze user's productivity patterns and generate insights:
        
        Active todos: {activeTodos}
        Completed todos: {completedTodos}
        
        Provide:
        1. Key productivity insights
        2. Actionable recommendations
        3. Identified patterns
        4. Productivity score (0-100)
        
        Respond with JSON:
        {
          "insights": ["insight1", "insight2"],
          "recommendations": ["rec1", "rec2"],
          "patterns": {
            "mostProductiveTime": "morning",
            "averageCompletionTime": "2.5 days",
            "commonCategories": ["work", "personal"]
          },
          "score": 75
        }
      `);

      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      const response = await chain.invoke({
        activeTodos: JSON.stringify(userTodos.slice(-10)),
        completedTodos: JSON.stringify(completedTodos.slice(-20)),
      });

      return JSON.parse(response);
    } catch (error) {
      logger.error('Failed to generate productivity insights', error);
      return {
        insights: [],
        recommendations: [],
        patterns: {},
        score: 50,
      };
    }
  }

  /**
   * Smart deadline suggestions
   */
  public async suggestDeadlines(
    todos: Array<{ id: string; title: string; description?: string; priority: string }>
  ): Promise<Array<{ todoId: string; suggestedDeadline: string; reasoning: string }>> {
    try {
      const prompt = ChatPromptTemplate.fromTemplate(`
        Suggest realistic deadlines for these todos based on:
        - Task complexity and priority
        - Typical completion times
        - Priority levels
        - Dependencies between tasks
        
        Todos: {todos}
        
        Respond with JSON array:
        [{
          "todoId": "id",
          "suggestedDeadline": "ISO date",
          "reasoning": "Why this deadline makes sense"
        }]
      `);

      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      const response = await chain.invoke({
        todos: JSON.stringify(todos),
      });

      return JSON.parse(response);
    } catch (error) {
      logger.error('Failed to suggest deadlines', error);
      return [];
    }
  }

  // Private helper methods

  private getUserContext(userId: string, context?: Partial<ConversationContext>): ConversationContext {
    let userContext = this.userContexts.get(userId);
    
    if (!userContext) {
      userContext = {
        userId,
        sessionId: context?.sessionId || `session_${Date.now()}`,
        todoContext: context?.todoContext || [],
        userPreferences: context?.userPreferences || {},
        conversationHistory: [],
      };
    }

    // Update with new context
    if (context) {
      Object.assign(userContext, context);
    }

    return userContext;
  }

  private createSystemPrompt(context: ConversationContext): string {
    return `You are an intelligent AI assistant specialized in productivity and todo management.

User Context:
- User ID: ${context.userId}
- Current todos: ${context.todoContext?.length || 0} items
- Preferences: ${JSON.stringify(context.userPreferences)}

Your capabilities:
1. Help users manage their todos effectively
2. Provide intelligent suggestions and insights
3. Parse natural language into actionable todos
4. Analyze productivity patterns
5. Suggest optimizations and improvements

Always:
- Be helpful and proactive
- Provide specific, actionable advice
- Consider user's context and history
- Suggest concrete next steps
- Be concise but thorough

When responding, structure your answers to be clear and actionable.`;
  }

  private async parseAndEnhanceResponse(
    response: string,
    originalMessage: string,
    context: ConversationContext
  ): Promise<AIResponse> {
    // Enhanced parsing logic here
    const suggestions = await this.extractSuggestions(response);
    const actions = await this.extractActions(response, originalMessage);
    
    return {
      response,
      confidence: 0.85, // Could be calculated based on model confidence
      reasoning: 'Response generated using context-aware LangChain processing',
      suggestions,
      actions,
      metadata: {
        userId: context.userId,
        timestamp: new Date(),
        model: this.config.model,
      },
    };
  }

  private async extractSuggestions(response: string): Promise<string[]> {
    // Extract actionable suggestions from response
    const lines = response.split('\n');
    return lines
      .filter(line => line.includes('suggest') || line.includes('recommend') || line.includes('consider'))
      .map(line => line.trim())
      .slice(0, 3);
  }

  private async extractActions(response: string, originalMessage: string): Promise<ActionSuggestion[]> {
    // Extract potential actions from the response
    const actions: ActionSuggestion[] = [];
    
    if (originalMessage.toLowerCase().includes('create') || originalMessage.toLowerCase().includes('add')) {
      actions.push({
        type: 'create_todo',
        description: 'Create a new todo based on the conversation',
        parameters: { source: 'conversation' },
        confidence: 0.7,
      });
    }

    return actions;
  }

  private analyzeUserPatterns(todos: any[]): Record<string, any> {
    // Analyze user patterns from todo history
    const patterns: Record<string, any> = {
      totalTodos: todos.length,
      completedCount: todos.filter(t => t.completed).length,
      averagePriority: 'medium', // Calculate based on data
      commonTags: [], // Extract from todos
      timePatterns: {}, // Analyze completion times
    };

    return patterns;
  }

  private parseSuggestions(response: string): ActionSuggestion[] {
    try {
      // Try to parse JSON response
      const parsed = JSON.parse(response);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Fallback to text parsing
      return [{
        type: 'create_todo',
        description: 'Suggestion from AI response',
        parameters: { title: response.slice(0, 50) },
        confidence: 0.6,
      }];
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    this.conversationChains.clear();
    this.userContexts.clear();
    logger.info('LangChain service cleaned up');
  }

  /**
   * Ensure the service is configured before use
   */
  private ensureConfigured(): void {
    if (!this.config || !this.chatModel || !this.embeddings) {
      throw new Error('AdvancedLangChainService not configured - call configure() first');
    }
  }
}