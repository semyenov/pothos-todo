import { builder } from "../../api/schema/builder.js";
import { nanoid } from "nanoid";

// AI-specific types
const TodoSuggestion = builder.interfaceRef<{
  id: string;
  title: string;
  description: string;
  priority: string;
  estimatedTime: number;
}>('TodoSuggestion');

TodoSuggestion.implement({
  fields: (t) => ({
    title: t.string({
      resolve: (parent) => parent.title,
    }),
    description: t.string({
      resolve: (parent) => parent.description,
    }),
    priority: t.string({
      resolve: (parent) => parent.priority,
    }),
    estimatedTime: t.int({
      resolve: (parent) => parent.estimatedTime,
    }),
  }),
});

const TodoSearchResult = builder.interfaceRef<{
  id: string;
  title: string;
  similarity: number;
}>('TodoSearchResult');

TodoSearchResult.implement({
  fields: (t) => ({
    id: t.id({
      resolve: (parent) => parent.id,
    }),
    title: t.string({
      resolve: (parent) => parent.title,
    }),
    similarity: t.float({
      resolve: (parent) => parent.similarity,
    }),
  }),
});

const UserInsight = builder.interfaceRef<{
  type: string;
  message: string;
  data: string;
}>('UserInsight');

UserInsight.implement({
  fields: (t) => ({
    type: t.string({
      resolve: (parent) => parent.type,
    }),
    message: t.string({
      resolve: (parent) => parent.message,
    }),
    data: t.string({
      nullable: true,
      resolve: (parent) => parent.data,
    }),
  }),
});

// Remove type extensions to avoid circular dependencies
// In a real federation setup, these would be handled properly

// Query type
builder.queryType({
  fields: (t) => ({
    searchTodos: t.field({
      type: TodoSearchResult,
      args: {
        query: t.arg.string({ required: true }),
        limit: t.arg.int({ defaultValue: 10 }),
      },
      resolve: async (_, args) => {
        // Mock implementation
        return {
          id: nanoid(),
          title: 'Example Todo',
          similarity: 0.95,
        };
      },
    }),
    suggestTodos: t.field({
      type: TodoSuggestion,
      args: {
        limit: t.arg.int({ defaultValue: 5 }),
      },
      resolve: async (_, args) => {
        // Mock implementation
        return {
          title: 'Review project documentation',
          description: 'Go through all project docs and update outdated sections',
          priority: 'medium',
          estimatedTime: 120,
          id: nanoid(),
        };
      },
    }),
    askAboutTodos: t.field({
      type: TodoSuggestion,
      args: {
        question: t.arg.string({ required: true }),
      },
      resolve: async (_, args) => {
        // Mock implementation
        return {
          id: nanoid(),
          title: 'Review project documentation',
          description: 'Go through all project docs and update outdated sections',
          priority: 'medium',
          estimatedTime: 120,
        };
      },
    }),
    getUserInsights: t.field({
      type: UserInsight,
      args: {
        userId: t.arg.string({ required: true }),
      },
      resolve: async (_, args) => {
        return {
          type: 'completion_rate',
          message: 'Your task completion rate is 78%',
          data: JSON.stringify({ rate: 0.78 }),
          id: nanoid(),
        };
      },
    }),
    predictCompletionTime: t.float({
      nullable: true,
      args: {
        todoId: t.arg.string({ required: true }),
      },
      resolve: async (_, args) => {
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