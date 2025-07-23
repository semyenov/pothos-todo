import { builder } from "../builder.js";
import {
  TodoStatus as TodoStatusEnum,
  Priority as PriorityEnum,
} from "../enums.js";
import prisma from "@/lib/prisma";
import * as TodoListCrud from "@/graphql/__generated__/TodoList";

export const TodoListType = builder.prismaNode("TodoList", {
  id: { field: "id" },
  findUnique: (id) => ({ id }),
  fields: (t) => ({
    ...(() => {
      const { id, ...rest } = TodoListCrud.TodoListObject.fields(t);
      return rest;
    })(),
    todos: t.relation("todos", {
      args: {
        status: t.arg({ type: TodoStatusEnum, required: false }),
        priority: t.arg({ type: PriorityEnum, required: false }),
      },
      query: (args) => ({
        where: {
          ...(args.status && { status: args.status }),
          ...(args.priority && { priority: args.priority }),
        },
        orderBy: [
          { priority: "desc" },
          { dueDate: "asc" },
          { createdAt: "desc" },
        ],
      }),
    }),
    todosCount: t.int({
      resolve: (todoList, args, context) => {
        return prisma.todo.count({
          where: { todoListId: todoList.id },
        });
      },
    }),
    completedTodosCount: t.int({
      resolve: (todoList, args, context) => {
        return prisma.todo.count({
          where: {
            todoListId: todoList.id,
            status: "COMPLETED",
          },
        });
      },
    }),
    pendingTodosCount: t.int({
      resolve: (todoList, args, context) => {
        return prisma.todo.count({
          where: {
            todoListId: todoList.id,
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
        });
      },
    }),
    completionPercentage: t.float({
      resolve: async (todoList, args, context) => {
        const total = await prisma.todo.count({
          where: { todoListId: todoList.id },
        });
        if (total === 0) return 0;

        const completed = await prisma.todo.count({
          where: {
            todoListId: todoList.id,
            status: "COMPLETED",
          },
        });

        return (completed / total) * 100;
      },
    }),
  }),
});

export const TodoListQueries = builder.queryFields((t) => {
  const findFirst = TodoListCrud.findFirstTodoListQueryObject(t);
  const findMany = TodoListCrud.findManyTodoListQueryObject(t);
  const findUnique = TodoListCrud.findUniqueTodoListQueryObject(t);
  const count = TodoListCrud.countTodoListQueryObject(t);
  return {
    todoList: t.prismaField({
      type: "TodoList",
      nullable: true,
      authScopes: { authenticated: true },
      args: {
        id: t.arg.id({ required: true }),
      },
      resolve: (query, root, args, context) => {
        return prisma.todoList.findFirst({
          ...query,
          where: {
            id: args.id,
            userId: context.user?.id,
          },
        });
      },
    }),

    findFirstTodoList: t.prismaField({
      ...findFirst,
      args: {
        ...findFirst.args,
        customArg: t.arg({ type: "String", required: false }),
      },
      authScopes: { authenticated: true },
      resolve: (query, root, args, context, info) => {
        const { customArg } = args;
        console.log(customArg);
        return findFirst.resolve(query, root, args, context, info);
      },
    }),

    findManyTodoList: t.prismaField({
      ...findMany,
      args: {
        ...findMany.args,
        customArg: t.arg({ type: "String", required: false }),
      },
      authScopes: { authenticated: true },
      resolve: (query, root, args, context, info) => {
        const { customArg } = args;
        console.log(customArg);
        return findMany.resolve(query, root, args, context, info);
      },
    }),

    findUniqueTodoList: t.prismaField({
      ...findUnique,
      args: {
        ...findUnique.args,
        customArg: t.arg({ type: "String", required: false }),
      },
      authScopes: { authenticated: true },
      resolve: (query, root, args, context, info) => {
        const { customArg } = args;
        console.log(customArg);
        return findUnique.resolve(query, root, args, context, info);
      },
    }),

    todoLists: t.prismaField({
      type: ["TodoList"],
      authScopes: { authenticated: true },
      args: {
        search: t.arg.string({ required: false }),
        limit: t.arg.int({ required: false, defaultValue: 20 }),
        offset: t.arg.int({ required: false, defaultValue: 0 }),
      },
      resolve: (query, root, args, context) => {
        const where: any = {
          userId: context.user?.id,
        };

        if (args.search) {
          where.OR = [
            { title: { contains: args.search, mode: "insensitive" } },
            { description: { contains: args.search, mode: "insensitive" } },
          ];
        }

        return prisma.todoList.findMany({
          ...query,
          where,
          orderBy: { createdAt: "desc" },
          take: args.limit || undefined,
          skip: args.offset || undefined,
        });
      },
    }),
  };
});
