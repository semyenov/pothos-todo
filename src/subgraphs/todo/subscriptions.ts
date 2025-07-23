import { builder } from "../../api/schema/subgraph-builder.js";
import { PubSub } from 'graphql-subscriptions';
import prisma from "../../lib/subgraph-prisma.js";
import type { Todo, TodoList } from "@prisma/client";

// Create a PubSub instance for this subgraph
export const pubsub = new PubSub();

// Subscription topics
export const TODO_EVENTS = {
  TODO_CREATED: 'TODO_CREATED',
  TODO_UPDATED: 'TODO_UPDATED',
  TODO_DELETED: 'TODO_DELETED',
  TODO_COMPLETED: 'TODO_COMPLETED',
  TODOLIST_CREATED: 'TODOLIST_CREATED',
  TODOLIST_UPDATED: 'TODOLIST_UPDATED',
  TODOLIST_DELETED: 'TODOLIST_DELETED',
} as const;

// Define subscription payload types
interface TodoEvent {
  type: keyof typeof TODO_EVENTS;
  todo: Todo;
  userId: string;
}

interface TodoListEvent {
  type: keyof typeof TODO_EVENTS;
  todoList: TodoList;
  userId: string;
}

// Add subscription type to schema
builder.subscriptionType({
  fields: (t) => ({
    // Subscribe to todo changes for a specific user
    todoChanged: t.prismaField({
      type: 'Todo',
      args: {
        userId: t.arg.id({ required: true }),
      },
      subscribe: (_root, args) => {
        // Filter events by userId
        const asyncIterator = (pubsub as any).asyncIterator([
          TODO_EVENTS.TODO_CREATED,
          TODO_EVENTS.TODO_UPDATED,
          TODO_EVENTS.TODO_DELETED,
          TODO_EVENTS.TODO_COMPLETED,
        ]) as AsyncIterable<TodoEvent>;

        // Wrap the async iterator to filter by userId
        return {
          async *[Symbol.asyncIterator]() {
            for await (const event of asyncIterator) {
              if (event.userId === args.userId) {
                yield event;
              }
            }
          },
        };
      },
      resolve: (query, payload: TodoEvent) => payload.todo,
    }),

    // Subscribe to todo completions
    todoCompleted: t.prismaField({
      type: 'Todo',
      args: {
        userId: t.arg.id({ required: true }),
      },
      subscribe: (_root, args) => {
        const asyncIterator = (pubsub as any).asyncIterator([TODO_EVENTS.TODO_COMPLETED]) as AsyncIterable<TodoEvent>;

        return {
          async *[Symbol.asyncIterator]() {
            for await (const event of asyncIterator) {
              if (event.userId === args.userId) {
                yield event;
              }
            }
          },
        };
      },
      resolve: (query, payload: TodoEvent) => payload.todo,
    }),

    // Subscribe to todo list changes
    todoListChanged: t.prismaField({
      type: 'TodoList',
      args: {
        userId: t.arg.id({ required: true }),
      },
      subscribe: (_root, args) => {
        const asyncIterator = (pubsub as any).asyncIterator([
          TODO_EVENTS.TODOLIST_CREATED,
          TODO_EVENTS.TODOLIST_UPDATED,
          TODO_EVENTS.TODOLIST_DELETED,
        ]) as AsyncIterable<TodoListEvent>;

        return {
          async *[Symbol.asyncIterator]() {
            for await (const event of asyncIterator) {
              if (event.userId === args.userId) {
                yield event;
              }
            }
          },
        };
      },
      resolve: (query, payload: TodoListEvent) => payload.todoList,
    }),

    // Real-time todo statistics - temporarily commented out to fix schema build
    // todoStats: t.field({
    //   type: builder.objectRef<{
    //     totalTodos: number;
    //     completedTodos: number;
    //     pendingTodos: number;
    //     completionRate: number;
    //   }>('TodoStats'),
    //   args: {
    //     userId: t.arg.id({ required: true }),
    //   },
    //   subscribe: async (_root, args) => {
    //     // Calculate initial stats
    //     const calculateStats = async () => {
    //       const [total, completed] = await Promise.all([
    //         prisma.todo.count({ where: { userId: args.userId } }),
    //         prisma.todo.count({ where: { userId: args.userId, status: 'COMPLETED' } }),
    //       ]);

    //       const pending = total - completed;
    //       const completionRate = total > 0 ? (completed / total) * 100 : 0;

    //       return {
    //         totalTodos: total,
    //         completedTodos: completed,
    //         pendingTodos: pending,
    //         completionRate: Math.round(completionRate),
    //       };
    //     };

    //     // Return async iterator that recalculates on todo changes
    //     const asyncIterator = pubsub.asyncIterator([
    //       TODO_EVENTS.TODO_CREATED,
    //       TODO_EVENTS.TODO_UPDATED,
    //       TODO_EVENTS.TODO_DELETED,
    //       TODO_EVENTS.TODO_COMPLETED,
    //     ]);

    //     return {
    //       async *[Symbol.asyncIterator]() {
    //         // Emit initial stats
    //         yield await calculateStats();

    //         // Emit updated stats on changes
    //         for await (const event of asyncIterator) {
    //           if (event.userId === args.userId) {
    //             yield await calculateStats();
    //           }
    //         }
    //       },
    //     };
    //   },
    //   resolve: (payload) => payload,
    // }),
  }),
});

// Define TodoStats object type - temporarily commented out
// builder.objectType('TodoStats', {
//   fields: (t) => ({
//     totalTodos: t.exposeInt('totalTodos'),
//     completedTodos: t.exposeInt('completedTodos'),
//     pendingTodos: t.exposeInt('pendingTodos'),
//     completionRate: t.exposeInt('completionRate'),
//   }),
// });

// Helper functions to publish events
export function publishTodoEvent(type: keyof typeof TODO_EVENTS, todo: Todo) {
  const event: TodoEvent = { type, todo, userId: todo.userId };
  pubsub.publish(type, event);
}

export function publishTodoListEvent(type: keyof typeof TODO_EVENTS, todoList: TodoList) {
  const event: TodoListEvent = { type, todoList, userId: todoList.userId };
  pubsub.publish(type, event);
}