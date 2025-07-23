import { makeExecutableSchema } from '@graphql-tools/schema';
import { mergeSchemas } from '@graphql-tools/schema';
import prisma from '../../lib/prisma.js';
import bcrypt from 'bcrypt';

// Federation directives for production use
const federationDirectives = /* GraphQL */ `
  directive @key(fields: String!) on OBJECT | INTERFACE
  directive @extends on OBJECT | INTERFACE
  directive @external on OBJECT | FIELD_DEFINITION
  directive @requires(fields: String!) on FIELD_DEFINITION
  directive @provides(fields: String!) on FIELD_DEFINITION
  directive @shareable on FIELD_DEFINITION | OBJECT
  directive @tag(name: String!) repeatable on FIELD_DEFINITION | INTERFACE | OBJECT | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION
  directive @inaccessible on SCALAR | OBJECT | FIELD_DEFINITION | ARGUMENT_DEFINITION | INTERFACE | UNION | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION
  directive @override(from: String!) on FIELD_DEFINITION
`;

export const schema = makeExecutableSchema({
  typeDefs: /* GraphQL */ `
    ${federationDirectives}
    type User {
      id: ID!
      email: String!
      name: String
      createdAt: String!
      updatedAt: String!
    }

    type Query {
      user(id: ID!): User
      me: User
      users: [User!]!
    }

    type Mutation {
      createUser(
        email: String!
        name: String
        password: String!
      ): User!
      
      updateUser(
        id: ID!
        email: String
        name: String
      ): User
      
      deleteUser(id: ID!): User
    }
  `,
  resolvers: {
    User: {
      createdAt: (parent) => parent.createdAt.toISOString(),
      updatedAt: (parent) => parent.updatedAt.toISOString(),
    },
    Query: {
      user: async (_, args) => {
        return prisma.user.findUnique({
          where: { id: args.id },
        });
      },
      me: async (_, args, context) => {
        // In a real app, get user from context
        if (!context.user) return null;
        return prisma.user.findUnique({
          where: { id: context.user.id },
        });
      },
      users: async () => {
        return prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
        });
      },
    },
    Mutation: {
      createUser: async (_, args) => {
        // Hash password before storing
        const hashedPassword = await bcrypt.hash(args.password, 10);
        
        return prisma.user.create({
          data: {
            email: args.email,
            name: args.name,
            password: hashedPassword,
          },
        });
      },
      updateUser: async (_, args) => {
        const data: any = {};
        if (args.email !== undefined) data.email = args.email;
        if (args.name !== undefined) data.name = args.name;

        return prisma.user.update({
          where: { id: args.id },
          data,
        });
      },
      deleteUser: async (_, args) => {
        return prisma.user.delete({
          where: { id: args.id },
        });
      },
    },
  },
});