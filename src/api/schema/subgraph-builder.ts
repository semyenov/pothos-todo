import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import FederationPlugin from '@pothos/plugin-federation';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type PrismaTypes from '@pothos/plugin-prisma/generated';
import prisma from '@/lib/subgraph-prisma';

// Create a simplified builder for subgraphs that doesn't require the full container
export const builder = new SchemaBuilder<{
  PrismaTypes: PrismaTypes;
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    JSON: { Input: any; Output: any };
  };
  Context: {
    request: Request;
  };
  AuthScopes: {
    authenticated: boolean;
  };
}>({
  plugins: [PrismaPlugin, FederationPlugin, ScopeAuthPlugin],
  prisma: {
    client: prisma,
  },
  scopeAuth: {
    authScopes: async () => ({
      authenticated: false, // Simplified auth for subgraphs
    }),
  },
  // TODO: Add federation options when properly supported
  // federation: {
  //   version: 1,
  // },
});

// Add scalar types
builder.scalarType('DateTime', {
  serialize: (value) => (value as Date).toISOString(),
  parseValue: (value) => new Date(value as string),
});

// Add enum types using string values
builder.enumType('Priority', {
  values: {
    LOW: { value: 'LOW' },
    MEDIUM: { value: 'MEDIUM' },
    HIGH: { value: 'HIGH' },
    URGENT: { value: 'URGENT' },
  },
});

builder.enumType('TodoStatus', {
  values: {
    PENDING: { value: 'PENDING' },
    IN_PROGRESS: { value: 'IN_PROGRESS' },
    COMPLETED: { value: 'COMPLETED' },
    CANCELLED: { value: 'CANCELLED' },
  },
});