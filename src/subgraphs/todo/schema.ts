import { Container } from "../../infrastructure/container/Container.js";
import { builder } from "../../api/schema/subgraph-builder.js";
import prisma from "../../lib/subgraph-prisma.js";
import type { User as PrismaUser } from "@prisma/client";
import "./subscriptions.js"; // Import subscriptions

// Context type for the subgraph
export interface TodoSubgraphContext {
  container: Container;
  request: Request;
  user?: PrismaUser | null;
}

// Define Todo type with federation
builder.prismaObject("Todo", {
  directives: {
    key: { fields: "id" },
  },
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    status: t.field({
      type: 'TodoStatus',
      resolve: (parent) => parent.status,
    }),
    priority: t.field({
      type: 'Priority',
      resolve: (parent) => parent.priority,
    }),
    dueDate: t.expose("dueDate", {
      type: "DateTime",
      nullable: true,
    }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
    userId: t.exposeID("userId"),
    todoListId: t.exposeID("todoListId", { nullable: true }),
    // userId is exposed for federation, but user field is resolved by gateway
  }),
});

// Define TodoList type with federation
builder.prismaObject("TodoList", {
  directives: {
    key: { fields: "id" },
  },
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
    userId: t.exposeID("userId"),
    // userId is exposed for federation, but user field is resolved by gateway
    // Todos in this list
    todos: t.prismaField({
      type: ["Todo"],
      resolve: async (query, root, _args, _ctx) => {
        return prisma.todo.findMany({
          ...query,
          where: { todoListId: root.id },
          orderBy: { createdAt: "desc" },
        });
      },
    }),
  }),
});

// Remove the User type extension for now to avoid circular dependencies
// In a real federation setup, this would be handled by the gateway

// Query type
builder.queryType({
  fields: (t) => ({
    // Entity resolver for Todo
    todo: t.prismaField({
      type: "Todo",
      nullable: true,
      args: {
        id: t.arg.id({ required: true }),
      },
      resolve: async (query, root, args, _ctx) => {
        return prisma.todo.findUnique({
          where: { id: args.id as string },
        });
      },
    }),

    // List todos
    todos: t.prismaField({
      type: ["Todo"],
      args: {
        status: t.arg({ type: 'TodoStatus', required: false }),
        priority: t.arg({ type: 'Priority', required: false }),
        todoListId: t.arg.id({ required: false }),
      },
      resolve: async (query, root, args, _ctx) => {
        const where: any = {};
        if (args.status) where.status = args.status;
        if (args.priority) where.priority = args.priority;
        if (args.todoListId) where.todoListId = args.todoListId;

        return prisma.todo.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
      },
    }),

    // Entity resolver for TodoList
    todoList: t.prismaField({
      type: "TodoList",
      nullable: true,
      args: {
        id: t.arg.id({ required: true }),
      },
      resolve: async (query, root, args, _ctx) => {
        return prisma.todoList.findUnique({
          where: { id: args.id as string },
        });
      },
    }),

    // List todo lists
    todoLists: t.prismaField({
      type: ["TodoList"],
      resolve: async (query) => {
        return prisma.todoList.findMany({
          orderBy: { createdAt: "desc" },
        });
      },
    }),
  }),
});

// Mutation type
builder.mutationType({
  fields: (t) => ({
    // Placeholder mutation to ensure Mutation type exists
    _todoSubgraphHealthCheck: t.boolean({
      resolve: () => true,
    }),
  }),
});

// Extend User type from user subgraph
builder.objectType('User', {
  directives: {
    key: { fields: 'id', resolvable: false },
    extends: true,
  },
  fields: (t) => ({
    id: t.id({ 
      resolve: (user) => user.id,
      // external: true, // Not supported in field definition
    }),
    todos: t.prismaField({
      type: ['Todo'],
      resolve: async (query, user, args, ctx) => {
        return prisma.todo.findMany({
          ...query,
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });
      },
    }),
    todoLists: t.prismaField({
      type: ['TodoList'],
      resolve: async (query, user, args, ctx) => {
        return prisma.todoList.findMany({
          ...query,
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });
      },
    }),
  }),
});

// Build and export the schema
export const schema = builder.toSubGraphSchema({
  linkUrl: "http://localhost:4002/graphql",
});
