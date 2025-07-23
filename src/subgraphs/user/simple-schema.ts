import { builder } from "@/api/schema/subgraph-builder";
import prisma from "@/lib/prisma";

// Define User type for this subgraph
builder.prismaObject('User', {
  directives: {
    key: { fields: 'id' },
  },
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name', { nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

// Query type
builder.queryType({
  fields: (t) => ({
    me: t.prismaField({
      type: 'User',
      nullable: true,
      resolve: async (query, root, args, ctx) => {
        // For now, just return the first user
        return prisma.user.findFirst();
      },
    }),
    user: t.prismaField({
      type: 'User',
      nullable: true,
      args: {
        id: t.arg.id({ required: true }),
      },
      resolve: async (query, root, args) => {
        return prisma.user.findUnique({
          ...query,
          where: { id: args.id },
        });
      },
    }),
    users: t.prismaField({
      type: ['User'],
      resolve: async (query) => {
        return prisma.user.findMany({
          ...query,
          orderBy: { createdAt: 'desc' },
        });
      },
    }),
  }),
});

// Simple mutation type
builder.mutationType({
  fields: (t) => ({
    _userSubgraphHealthCheck: t.boolean({
      resolve: () => true,
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: "http://localhost:4001/graphql",
});