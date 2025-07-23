import { builder } from "@/api/schema/builder";
import {
  createOneUserMutationObject,
  updateOneUserMutationObject,
  deleteOneUserMutationObject,
  UserObject,
} from "@/graphql/__generated__/User";
import prisma from "@/lib/prisma";

export const UserType = builder.prismaNode("User", {
  id: { resolve: (user) => user.id },
  findUnique: (id) => ({ id }),
  fields: (t) => ({
    ...UserObject.fields,

    todos: t.relatedConnection("todos", {
      cursor: "id",
      query: (args, ctx) => ({
        ...args,
        where: { userId: ctx.user?.id },
      }),
    }),

    todoLists: t.relatedConnection("todoLists", {
      cursor: "id",
      query: (args, ctx) => ({
        ...args,
        where: { userId: ctx.user?.id },
      }),
    }),
  }),
});

export const UserQueryType = builder.queryType({
  fields: (t) => ({
    me: t.prismaField({
      type: UserType,
      authScopes: { authenticated: true },
      resolve: (query, root, args, ctx) =>
        prisma.user.findUnique({
          where: { id: ctx.user?.id },
        }),
    }),
  }),
});

builder.mutationFields((t) => {
  return {
    createUser: t.prismaField({
      ...createOneUserMutationObject(t),
      authScopes: { admin: true },
    }),
    updateUser: t.prismaField({
      ...updateOneUserMutationObject(t),
      authScopes: { admin: true },
    }),
    deleteUser: t.prismaField({
      ...deleteOneUserMutationObject(t),
      authScopes: { admin: true },
    }),
  };
});

export const schema = builder.toSubGraphSchema({
  linkUrl: "http://localhost:4001/graphql",
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
  sortSchema: true,
});
