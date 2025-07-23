import { builder } from "../../api/schema/subgraph-builder.js";
import type { User as PrismaUser, Todo as PrismaTodo } from "@prisma/client";

// AI-specific types
builder.objectType('TodoSuggestion', {
  fields: (t) => ({
    title: t.string(),
    description: t.string({ nullable: true }),
    priority: t.string(),
    estimatedTime: t.int({ nullable: true }),
  }),
});

builder.objectType('TodoSearchResult', {
  fields: (t) => ({
    id: t.id(),
    title: t.string(),
    similarity: t.float(),
  }),
});

builder.objectType('UserInsight', {
  fields: (t) => ({
    type: t.string(),
    message: t.string(),
    data: t.string({ nullable: true }),
  }),
});

// Remove type extensions to avoid circular dependencies
// In a real federation setup, these would be handled properly

// Query type
builder.queryType({
  fields: (t) => ({
    searchTodos: t.field({
      type: ['TodoSearchResult'],
      args: {
        query: t.arg.string({ required: true }),
        limit: t.arg.int({ defaultValue: 10 }),
      },
      resolve: async () => {
        // Mock implementation
        return [
          {
            id: '1',
            title: 'Example Todo',
            similarity: 0.95,
          },
        ];
      },
    }),
    suggestTodos: t.field({
      type: ['TodoSuggestion'],
      args: {
        limit: t.arg.int({ defaultValue: 5 }),
      },
      resolve: async () => {
        // Mock implementation
        return [
          {
            title: 'Review project documentation',
            description: 'Go through all project docs and update outdated sections',
            priority: 'medium',
            estimatedTime: 120,
          },
        ];
      },
    }),
    askAboutTodos: t.string({
      args: {
        question: t.arg.string({ required: true }),
      },
      resolve: async (_, args) => {
        // Mock implementation
        return `Based on your todos, ${args.question}`;
      },
    }),
    getUserInsights: t.field({
      type: ['UserInsight'],
      args: {
        userId: t.arg.id({ required: true }),
      },
      resolve: async () => {
        // Mock implementation
        return [
          {
            type: 'completion_rate',
            message: 'Your task completion rate is 78%',
            data: JSON.stringify({ rate: 0.78 }),
          },
        ];
      },
    }),
    predictCompletionTime: t.float({
      nullable: true,
      args: {
        todoId: t.arg.id({ required: true }),
      },
      resolve: async () => {
        // Mock implementation
        return 3.5; // hours
      },
    }),
  }),
});

// Mutation type
builder.mutationType({
  fields: (t) => ({
    executeNLPCommand: t.string({
      args: {
        command: t.arg.string({ required: true }),
      },
      resolve: async (_, args) => {
        // Mock implementation
        return `Executed command: ${args.command}`;
      },
    }),
  }),
});

// Build and export the schema
export const schema = builder.toSubGraphSchema({
  linkUrl: "http://localhost:4003/graphql",
});