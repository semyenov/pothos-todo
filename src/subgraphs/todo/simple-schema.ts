import { builder } from "../../api/schema/subgraph-builder.js";
import prisma from "../../lib/subgraph-prisma.js";

// Define Todo type with federation
builder.prismaObject("Todo", {
  directives: {
    key: { fields: "id" },
  },
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    status: t.expose('status', {
      type: 'TodoStatus',
    }),
    priority: t.expose('priority', {
      type: 'Priority',
    }),
    dueDate: t.expose("dueDate", {
      type: "DateTime",
      nullable: true,
    }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
    userId: t.exposeID("userId"),
    todoListId: t.exposeID("todoListId", { nullable: true }),
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

// Query type
builder.queryType({
  fields: (t) => ({
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
    todos: t.prismaField({
      type: ["Todo"],
      args: {
        status: t.arg.string({ required: false }),
        priority: t.arg.string({ required: false }),
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
    _todoSubgraphHealthCheck: t.boolean({
      resolve: () => true,
    }),
  }),
});

// Build and export the schema
export const schema = builder.toSubGraphSchema({
  linkUrl: "http://localhost:4002/graphql",
});