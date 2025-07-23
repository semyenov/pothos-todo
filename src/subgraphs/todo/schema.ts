import { Container } from "../../infrastructure/container/Container.js";
import { builder } from "../../api/schema/builder.js";
import { TodoObject } from "../../graphql/__generated__/Todo/object.base.js";
import { TodoListObject } from "../../graphql/__generated__/TodoList/object.base.js";
import prisma from "../../lib/prisma.js";
import { Priority, TodoStatus } from "../../graphql/__generated__/inputs.js";
import type { User as PrismaUser } from "@prisma/client";

// Context type for the subgraph
export interface TodoSubgraphContext {
  container: Container;
  request: Request;
  user?: PrismaUser | null;
}

// Define Todo type with federation
builder.prismaObject("Todo", {
  ...TodoObject,
  directives: {
    key: { fields: "id" },
  },
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    status: t.field({
      type: TodoStatus,
      resolve: (parent) => parent.status,
    }),
    priority: t.field({
      type: Priority,
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
    // Reference to user (external)
    user: t.field({
      type: builder.objectRef<PrismaUser>("User"),
      directives: {
        external: true,
      },
      resolve: () => {
        throw new Error("User should be resolved by User subgraph");
      },
    }),
  }),
});

// Define TodoList type with federation
builder.prismaObject("TodoList", {
  ...TodoListObject,
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
    // Reference to user (external)
    user: t.field({
      type: builder.objectRef<PrismaUser>("User"),
      directives: {
        external: true,
      },
      resolve: () => {
        throw new Error("User should be resolved by User subgraph");
      },
    }),
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

// Reference to external User type
builder.objectType(builder.objectRef<PrismaUser>("User"), {
  directives: {
    extends: true,
    key: { fields: "id" },
  },
  fields: (t) => ({
    id: t.id({
      directives: { external: true },
      resolve: () => {
        throw new Error("User.id should be resolved by User subgraph");
      },
    }),
    // Add todos field to User
    todos: t.prismaField({
      type: ["Todo"],
      resolve: async (query, root, _args, _ctx) => {
        return prisma.todo.findMany({
          ...query,
          where: { userId: root.id },
          orderBy: { createdAt: "desc" },
        });
      },
    }),
    // Add todoLists field to User
    todoLists: t.prismaField({
      type: ["TodoList"],
      resolve: async (query, root, _args, _ctx) => {
        return prisma.todoList.findMany({
          ...query,
          where: { userId: root.id },
          orderBy: { createdAt: "desc" },
        });
      },
    }),
  }),
});

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
          where: { id: args.id },
        });
      },
    }),

    // List todos
    todos: t.prismaField({
      type: ["Todo"],
      args: {
        status: t.arg({ type: TodoStatus, required: false }),
        priority: t.arg({ type: Priority, required: false }),
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
          where: { id: args.id },
        });
      },
    }),

    // List todo lists
    todoLists: t.prismaField({
      type: ["TodoList"],
      args: {
        includeArchived: t.arg.boolean({
          required: false,
          defaultValue: false,
        }),
      },
      resolve: async (query, root, args, _ctx) => {
        const where: any = {};
        if (!args.includeArchived) {
          where.isArchived = false;
        }

        return prisma.todoList.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
      },
    }),
  }),
});

// Build and export the schema
export const schema = builder.toSubGraphSchema({
  linkUrl: "http://localhost:4002/graphql",
  composeDirectives: [
    "@key",
    "@extends",
    "@external",
    "@provides",
    "@requires",
  ],
  federationDirectives: [
    "@key",
    "@extends",
    "@external",
    "@provides",
    "@requires",
  ],
});
