import { EventEmitter } from "events";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/unjs-utils.js";
import chalk from "chalk";
import { federationMetrics } from "./monitoring.js";
import Redis from "ioredis";
import {
  Kafka,
  type Producer,
  type Consumer,
  type EachMessagePayload,
} from "kafkajs";

// Event types for the federation
export interface FederationEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: any;
  metadata?: {
    userId?: string;
    correlationId?: string;
    version?: string;
    tags?: string[];
  };
}

// Event streaming configuration
export interface EventStreamConfig {
  enabled: boolean;
  broker: "redis" | "kafka" | "memory";
  redis?: {
    host: string;
    port: number;
    password?: string;
    keyPrefix: string;
  };
  kafka?: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topics: Record<string, { partitions: number; replicationFactor: number }>;
  };
  events: {
    retention: number; // milliseconds
    batchSize: number;
    maxConcurrency: number;
  };
  websocket: {
    enabled: boolean;
    port: number;
    path: string;
  };
}

export const defaultEventStreamConfig: EventStreamConfig = {
  enabled: true,
  broker: process.env.KAFKA_BROKERS ? "kafka" : "redis",
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    keyPrefix: "federation:events:",
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
    clientId: "pothos-todo-federation",
    groupId: "federation-consumers",
    topics: {
      "user-events": { partitions: 3, replicationFactor: 1 },
      "todo-events": { partitions: 3, replicationFactor: 1 },
      "ai-events": { partitions: 2, replicationFactor: 1 },
      "system-events": { partitions: 1, replicationFactor: 1 },
    },
  },
  events: {
    retention: 24 * 60 * 60 * 1000, // 24 hours
    batchSize: 100,
    maxConcurrency: 10,
  },
  websocket: {
    enabled: true,
    port: 4005,
    path: "/events",
  },
};

// Event store interface
export interface EventStore {
  publish(event: FederationEvent): Promise<void>;
  subscribe(
    pattern: string,
    handler: (event: FederationEvent) => void
  ): Promise<void>;
  unsubscribe(pattern: string): Promise<void>;
  getEvents(filter: EventFilter): Promise<FederationEvent[]>;
  close(): Promise<void>;
}

export interface EventFilter {
  type?: string;
  source?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

// Redis-based event store
export class RedisEventStore implements EventStore {
  private client: Redis;
  private subscriber: Redis;
  private subscriptions = new Map<string, (event: FederationEvent) => void>();

  constructor(private config: EventStreamConfig["redis"]) {
    this.client = new Redis({
      host: config!.host,
      port: config!.port,
      password: config!.password,
    });

    this.subscriber = new Redis({
      host: config!.host,
      port: config!.port,
      password: config!.password,
    });

    this.subscriber.on("message", (channel, message) => {
      try {
        const event: FederationEvent = JSON.parse(message);
        const handler = this.subscriptions.get(channel);
        if (handler) {
          handler(event);
        }
      } catch (error) {
        logger.error("Error processing Redis message:", error);
      }
    });
  }

  async publish(event: FederationEvent): Promise<void> {
    const channel = `${this.config!.keyPrefix}${event.type}`;
    const message = JSON.stringify(event);

    await Promise.all([
      // Publish for real-time subscribers
      this.client.publish(channel, message),
      // Store in stream for replay
      this.client.xadd(
        `${this.config!.keyPrefix}stream:${event.type}`,
        "*",
        "data",
        message
      ),
    ]);

    federationMetrics.requestsTotal.inc({
      subgraph: "events",
      operation_type: "publish",
      operation_name: event.type,
      status: "success",
    });
  }

  async subscribe(
    pattern: string,
    handler: (event: FederationEvent) => void
  ): Promise<void> {
    const channel = `${this.config!.keyPrefix}${pattern}`;
    this.subscriptions.set(channel, handler);
    await this.subscriber.subscribe(channel);
  }

  async unsubscribe(pattern: string): Promise<void> {
    const channel = `${this.config!.keyPrefix}${pattern}`;
    this.subscriptions.delete(channel);
    await this.subscriber.unsubscribe(channel);
  }

  async getEvents(filter: EventFilter): Promise<FederationEvent[]> {
    const streamKey = `${this.config!.keyPrefix}stream:${filter.type || "*"}`;

    // Get events from Redis stream
    const results = await this.client.xrange(
      streamKey,
      filter.from ? filter.from.getTime().toString() : "-",
      filter.to ? filter.to.getTime().toString() : "+",
      "COUNT",
      filter.limit || 100
    );

    return results.map(([id, fields]) => {
      const data = fields[1] as string; // fields is ['data', jsonString]
      return JSON.parse(data);
    });
  }

  async close(): Promise<void> {
    await this.client.quit();
    await this.subscriber.quit();
  }
}

// Kafka-based event store
export class KafkaEventStore implements EventStore {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private subscriptions = new Map<string, (event: FederationEvent) => void>();

  constructor(private config: EventStreamConfig["kafka"]) {
    this.kafka = new Kafka({
      clientId: config!.clientId,
      brokers: config!.brokers,
    });

    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: config!.groupId });
  }

  async initialize(): Promise<void> {
    await this.producer.connect();
    await this.consumer.connect();

    // Create topics if they don't exist
    const admin = this.kafka.admin();
    await admin.connect();

    const topicConfigs = Object.entries(this.config!.topics).map(
      ([topic, config]) => ({
        topic,
        numPartitions: config.partitions,
        replicationFactor: config.replicationFactor,
      })
    );

    await admin.createTopics({
      topics: topicConfigs,
    });

    await admin.disconnect();

    // Set up consumer
    await this.consumer.subscribe({
      topics: Object.keys(this.config!.topics),
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: this.handleMessage.bind(this),
    });
  }

  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    try {
      if (!message.value) return;

      const event: FederationEvent = JSON.parse(message.value.toString());
      const handler = this.subscriptions.get(topic);

      if (handler) {
        handler(event);
      }
    } catch (error) {
      logger.error("Error processing Kafka message:", error);
    }
  }

  async publish(event: FederationEvent): Promise<void> {
    const topic = this.getTopicForEvent(event);

    await this.producer.send({
      topic,
      messages: [
        {
          key: event.id,
          value: JSON.stringify(event),
          headers: {
            type: event.type,
            source: event.source,
            timestamp: event.timestamp.toISOString(),
          },
        },
      ],
    });

    federationMetrics.requestsTotal.inc({
      subgraph: "events",
      operation_type: "publish",
      operation_name: event.type,
      status: "success",
    });
  }

  async subscribe(
    pattern: string,
    handler: (event: FederationEvent) => void
  ): Promise<void> {
    const topic = this.getTopicForPattern(pattern);
    this.subscriptions.set(topic, handler);
  }

  async unsubscribe(pattern: string): Promise<void> {
    const topic = this.getTopicForPattern(pattern);
    this.subscriptions.delete(topic);
  }

  async getEvents(filter: EventFilter): Promise<FederationEvent[]> {
    // Kafka doesn't support easy historical queries
    // In production, you'd use Kafka Streams or connect to a data store
    logger.warn("Historical event queries not implemented for Kafka store");
    return [];
  }

  async close(): Promise<void> {
    await this.producer.disconnect();
    await this.consumer.disconnect();
  }

  private getTopicForEvent(event: FederationEvent): string {
    if (event.source.includes("user")) return "user-events";
    if (event.source.includes("todo")) return "todo-events";
    if (event.source.includes("ai")) return "ai-events";
    return "system-events";
  }

  private getTopicForPattern(pattern: string): string {
    if (pattern.includes("user")) return "user-events";
    if (pattern.includes("todo")) return "todo-events";
    if (pattern.includes("ai")) return "ai-events";
    return "system-events";
  }
}

// Memory-based event store (for development)
export class MemoryEventStore implements EventStore {
  private events: FederationEvent[] = [];
  private subscriptions = new Map<string, (event: FederationEvent) => void>();
  private emitter = new EventEmitter();

  constructor(private config: EventStreamConfig) {
    // Cleanup old events periodically
    setInterval(() => {
      const cutoff = new Date(Date.now() - config.events.retention);
      this.events = this.events.filter((event) => event.timestamp > cutoff);
    }, 60 * 1000); // Every minute
  }

  async publish(event: FederationEvent): Promise<void> {
    this.events.push(event);

    // Notify subscribers
    this.subscriptions.forEach((handler, pattern) => {
      if (this.matchesPattern(event.type, pattern)) {
        handler(event);
      }
    });

    this.emitter.emit("event", event);

    federationMetrics.requestsTotal.inc({
      subgraph: "events",
      operation_type: "publish",
      operation_name: event.type,
      status: "success",
    });
  }

  async subscribe(
    pattern: string,
    handler: (event: FederationEvent) => void
  ): Promise<void> {
    this.subscriptions.set(pattern, handler);
  }

  async unsubscribe(pattern: string): Promise<void> {
    this.subscriptions.delete(pattern);
  }

  async getEvents(filter: EventFilter): Promise<FederationEvent[]> {
    let filtered = this.events;

    if (filter.type) {
      filtered = filtered.filter((e) => e.type === filter.type);
    }
    if (filter.source) {
      filtered = filtered.filter((e) => e.source === filter.source);
    }
    if (filter.userId) {
      filtered = filtered.filter((e) => e.metadata?.userId === filter.userId);
    }
    if (filter.from) {
      filtered = filtered.filter((e) => e.timestamp >= filter.from!);
    }
    if (filter.to) {
      filtered = filtered.filter((e) => e.timestamp <= filter.to!);
    }

    // Limit results
    if (filter.limit) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered.reverse(); // Most recent first
  }

  async close(): Promise<void> {
    this.subscriptions.clear();
    this.emitter.removeAllListeners();
  }

  private matchesPattern(eventType: string, pattern: string): boolean {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return regex.test(eventType);
  }
}

// Event stream manager
export class EventStreamManager {
  private store!: EventStore;
  private wsServer?: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(private config: EventStreamConfig = defaultEventStreamConfig) {
    this.initializeStore();
  }

  private async initializeStore(): Promise<void> {
    switch (this.config.broker) {
      case "kafka":
        const kafkaStore = new KafkaEventStore(this.config.kafka);
        await kafkaStore.initialize();
        this.store = kafkaStore;
        break;
      case "redis":
        this.store = new RedisEventStore(this.config.redis);
        break;
      default:
        this.store = new MemoryEventStore(this.config);
    }

    logger.info(
      chalk.green(`✅ Event store initialized: ${this.config.broker}`)
    );
  }

  // Start WebSocket server for real-time events
  async startWebSocketServer(): Promise<void> {
    if (!this.config.websocket.enabled) return;

    const server = createServer();
    this.wsServer = new WebSocketServer({
      server,
      path: this.config.websocket.path,
    });

    this.wsServer.on("connection", (ws, req) => {
      logger.info(chalk.blue("New WebSocket connection"));
      this.clients.add(ws);

      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "subscribe") {
            // Subscribe to event patterns
            await this.subscribeClient(ws, message.patterns || ["*"]);
          } else if (message.type === "unsubscribe") {
            // Unsubscribe from patterns
            await this.unsubscribeClient(ws, message.patterns || ["*"]);
          }
        } catch (error) {
          logger.error("WebSocket message error:", error);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        logger.info(chalk.blue("WebSocket connection closed"));
      });
    });

    server.listen(this.config.websocket.port, () => {
      logger.info(
        chalk.green(
          `🔌 Event WebSocket server listening on port ${this.config.websocket.port}`
        )
      );
    });
  }

  private async subscribeClient(
    ws: WebSocket,
    patterns: string[]
  ): Promise<void> {
    for (const pattern of patterns) {
      await this.store.subscribe(pattern, (event) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "event",
              event,
            })
          );
        }
      });
    }
  }

  private async unsubscribeClient(
    ws: WebSocket,
    patterns: string[]
  ): Promise<void> {
    for (const pattern of patterns) {
      await this.store.unsubscribe(pattern);
    }
  }

  // Publish event
  async publishEvent(
    event: Omit<FederationEvent, "id" | "timestamp">
  ): Promise<void> {
    const fullEvent: FederationEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date(),
    };

    await this.store.publish(fullEvent);

    // Send to WebSocket clients
    this.broadcastToClients({
      type: "event",
      event: fullEvent,
    });
  }

  // Subscribe to events
  async subscribe(
    pattern: string,
    handler: (event: FederationEvent) => void
  ): Promise<void> {
    await this.store.subscribe(pattern, handler);
  }

  // Get historical events
  async getEvents(filter: EventFilter): Promise<FederationEvent[]> {
    return this.store.getEvents(filter);
  }

  // Broadcast to WebSocket clients
  private broadcastToClients(message: unknown): void {
    const messageStr = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Shutdown
  async shutdown(): Promise<void> {
    if (this.wsServer) {
      this.wsServer.close();
    }
    await this.store.close();
  }
}

// Event-driven GraphQL plugin
export function createEventDrivenPlugin(eventManager: EventStreamManager) {
  return {
    onExecute({
      args,
    }: {
      args: {
        document: { definitions: { operation: string }[] };
        operationName: string;
        contextValue: { userId: string };
        request: { headers: { "x-correlation-id": string } };
      };
    }) {
      const operationType = args.document.definitions[0]?.operation as string;
      const operationName = args.operationName || "anonymous";

      return {
        onExecuteDone({
          result,
        }: {
          result: { errors?: unknown; data?: unknown };
        }) {
          // Publish events for mutations
          if (
            operationType === "mutation" &&
            !result.errors &&
            result.data &&
            args.contextValue?.userId
          ) {
            const event = {
              type: `graphql.${operationType}.${operationName}`,
              source: "federation-gateway",
              data: {
                operation: operationName,
                variables: args.contextValue?.userId,
                result: result.data,
              },
              metadata: {
                userId: args.contextValue?.userId,
                correlationId: args.request?.headers?.["x-correlation-id"],
              },
            };

            eventManager.publishEvent(event).catch((error) => {
              logger.error("Failed to publish GraphQL event:", error);
            });
          }
        },
      };
    },
  };
}

// Federation event types
export const FederationEventTypes = {
  // User events
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",

  // Todo events
  TODO_CREATED: "todo.created",
  TODO_UPDATED: "todo.updated",
  TODO_DELETED: "todo.deleted",
  TODO_STATUS_CHANGED: "todo.status.changed",
  TODO_COMPLETED: "todo.completed",

  // AI events
  AI_SUGGESTION_GENERATED: "ai.suggestion.generated",
  AI_INSIGHT_CREATED: "ai.insight.created",
  AI_COMMAND_EXECUTED: "ai.command.executed",

  // System events
  SCHEMA_UPDATED: "schema.updated",
  SUBGRAPH_HEALTH_CHANGED: "subgraph.health.changed",
  CACHE_INVALIDATED: "cache.invalidated",
};

// Export singleton
export const eventStreamManager = new EventStreamManager();
