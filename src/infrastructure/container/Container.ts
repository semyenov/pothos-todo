import { PrismaClient } from '@prisma/client';
import { PrismaTodoRepository } from '../persistence/PrismaTodoRepository.js';
import { PrismaTodoListRepository } from '../persistence/PrismaTodoListRepository.js';
import { PrismaUserRepository } from '../persistence/PrismaUserRepository.js';
import { PrismaEventStore } from '../events/PrismaEventStore.js';
import { InMemoryEventPublisher } from '../events/InMemoryEventPublisher.js';
import { EventHandlerRegistry } from '../events/EventHandlerRegistry.js';
import { CreateTodoHandler } from '../../application/handlers/CreateTodoHandler.js';
import { UpdateTodoHandler } from '../../application/handlers/UpdateTodoHandler.js';
import { CompleteTodoHandler } from '../../application/handlers/CompleteTodoHandler.js';
import { DeleteTodoHandler } from '../../application/handlers/DeleteTodoHandler.js';
import { ExecuteNLPCommandHandler } from '../../application/handlers/ExecuteNLPCommandHandler.js';
import { CacheManager } from '../cache/CacheManager.js';
import { VectorStore } from '../ai/VectorStore.js';
import { EmbeddingService } from '../ai/EmbeddingService.js';
import { NLPService } from '../ai/NLPService.js';
import { RAGService } from '../ai/RAGService.js';
import { MLPredictionService } from '../ai/MLPredictionService.js';
import { PrismaService } from '../database/PrismaService.js';
import { SingletonService } from '../core/SingletonService.js';
import { v4 as uuidv4 } from 'uuid';

export class Container extends SingletonService<Container> {
  public readonly id: string;

  private readonly _prismaService: PrismaService;
  private readonly _prisma: PrismaClient;
  private readonly _todoRepository: PrismaTodoRepository;
  private readonly _todoListRepository: PrismaTodoListRepository;
  private readonly _userRepository: PrismaUserRepository;
  private readonly _eventStore: PrismaEventStore;
  private readonly _eventPublisher: InMemoryEventPublisher;
  private readonly _eventHandlerRegistry: EventHandlerRegistry;
  private readonly _cacheManager: CacheManager;
  private readonly _vectorStore: VectorStore;
  private readonly _embeddingService: EmbeddingService;
  private readonly _nlpService: NLPService;
  private readonly _ragService: RAGService;
  private readonly _mlPredictionService: MLPredictionService;

  private readonly _createTodoHandler: CreateTodoHandler;
  private readonly _updateTodoHandler: UpdateTodoHandler;
  private readonly _completeTodoHandler: CompleteTodoHandler;
  private readonly _deleteTodoHandler: DeleteTodoHandler;
  private readonly _executeNLPCommandHandler: ExecuteNLPCommandHandler;

  protected constructor() {
    super();

    this.id = uuidv4();
    this._prismaService = PrismaService.getInstance();
    this._prisma = this._prismaService.getClient();

    this._todoRepository = new PrismaTodoRepository(this._prisma);
    this._todoListRepository = new PrismaTodoListRepository(this._prisma);
    this._userRepository = new PrismaUserRepository(this._prisma);

    this._eventStore = new PrismaEventStore(this._prisma);
    this._eventPublisher = new InMemoryEventPublisher(this._eventStore);
    this._eventHandlerRegistry = new EventHandlerRegistry(this._eventPublisher);
    // Async services will be initialized separately
    this._cacheManager = null as any; // Will be initialized async
    this._vectorStore = null as any; // Will be initialized async
    this._embeddingService = EmbeddingService.getInstance(this._prisma);
    this._nlpService = NLPService.getInstance();
    this._ragService = RAGService.getInstance(this._embeddingService, this._vectorStore);
    this._mlPredictionService = MLPredictionService.getInstance(this._prisma);

    this._createTodoHandler = new CreateTodoHandler(this._todoRepository, this._eventPublisher);
    this._updateTodoHandler = new UpdateTodoHandler(this._todoRepository, this._eventPublisher);
    this._completeTodoHandler = new CompleteTodoHandler(this._todoRepository, this._eventPublisher);
    this._deleteTodoHandler = new DeleteTodoHandler(this._todoRepository, this._eventPublisher);
    this._executeNLPCommandHandler = new ExecuteNLPCommandHandler(
      this._nlpService,
      this._createTodoHandler,
      this._updateTodoHandler,
      this._completeTodoHandler,
      this._deleteTodoHandler,
      this._todoRepository
    );
  }

  async initializeEmbeddingHandler(): Promise<void> {
    // Import dynamically to avoid circular dependency
    const { TodoEmbeddingHandler } = await import('../events/handlers/TodoEmbeddingHandler.js');
    const handler = new TodoEmbeddingHandler();
    this._eventHandlerRegistry.setEmbeddingHandler(handler);
  }

  static getInstance(): Container {
    return super.getInstance();
  }

  // Initialize async services separately
  async initializeAsyncServices(): Promise<void> {
    if (!this._cacheManager) {
      this._cacheManager = await CacheManager.getInstance();
    }
    if (!this._vectorStore) {
      this._vectorStore = await VectorStore.getInstance();
    }
  }

  get prismaService(): PrismaService {
    return this._prismaService;
  }

  get prisma(): PrismaClient {
    return this._prisma;
  }

  get todoRepository(): PrismaTodoRepository {
    return this._todoRepository;
  }

  get todoListRepository(): PrismaTodoListRepository {
    return this._todoListRepository;
  }

  get userRepository(): PrismaUserRepository {
    return this._userRepository;
  }

  get eventStore(): PrismaEventStore {
    return this._eventStore;
  }

  get eventPublisher(): InMemoryEventPublisher {
    return this._eventPublisher;
  }

  get cacheManager(): CacheManager {
    return this._cacheManager;
  }

  get vectorStore(): VectorStore {
    return this._vectorStore;
  }

  get embeddingService(): EmbeddingService {
    return this._embeddingService;
  }

  get nlpService(): NLPService {
    return this._nlpService;
  }

  get ragService(): RAGService {
    return this._ragService;
  }

  get mlPredictionService(): MLPredictionService {
    return this._mlPredictionService;
  }

  get createTodoHandler(): CreateTodoHandler {
    return this._createTodoHandler;
  }

  get updateTodoHandler(): UpdateTodoHandler {
    return this._updateTodoHandler;
  }

  get completeTodoHandler(): CompleteTodoHandler {
    return this._completeTodoHandler;
  }

  get deleteTodoHandler(): DeleteTodoHandler {
    return this._deleteTodoHandler;
  }

  get executeNLPCommandHandler(): ExecuteNLPCommandHandler {
    return this._executeNLPCommandHandler;
  }

  async disconnect(): Promise<void> {
    await this._prisma.$disconnect();
  }
}