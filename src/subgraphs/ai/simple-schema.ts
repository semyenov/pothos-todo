import { makeExecutableSchema } from '@graphql-tools/schema';

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
    
    type TodoSuggestion {
      title: String!
      description: String
      priority: String!
      estimatedTime: Int
    }

    type TodoSearchResult {
      id: ID!
      title: String!
      similarity: Float!
    }

    type UserInsight {
      type: String!
      message: String!
      data: String
    }

    type User {
      id: ID!
      insights: [UserInsight!]!
    }

    type Todo {
      id: ID!
      similarTodos(limit: Int = 5): [TodoSearchResult!]!
    }

    type Query {
      searchTodos(query: String!, limit: Int = 10): [TodoSearchResult!]!
      suggestTodos(limit: Int = 5): [TodoSuggestion!]!
      askAboutTodos(question: String!): String!
      getUserInsights(userId: ID!): [UserInsight!]!
      predictCompletionTime(todoId: ID!): Float
    }

    type Mutation {
      executeNLPCommand(command: String!): String!
    }
  `,
  resolvers: {
    User: {
      insights: async (parent: any) => {
        // Mock implementation
        return [
          {
            type: 'productivity',
            message: 'You complete most tasks on Mondays',
            data: JSON.stringify({ day: 'Monday', percentage: 45 }),
          },
        ];
      },
    },
    Todo: {
      similarTodos: async (parent: any, args: any) => {
        // Mock implementation
        return [
          {
            id: '1',
            title: 'Similar Todo Example',
            similarity: 0.85,
          },
        ];
      },
    },
    Query: {
      searchTodos: async (_: any, args: any) => {
        // Mock implementation
        return [
          {
            id: '1',
            title: 'Example Todo',
            similarity: 0.95,
          },
        ];
      },
      suggestTodos: async (_: any, args: any) => {
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
      askAboutTodos: async (_: any, args: any) => {
        // Mock implementation
        return `Based on your todos, ${args.question}`;
      },
      getUserInsights: async (_: any, args: any) => {
        // Mock implementation
        return [
          {
            type: 'completion_rate',
            message: 'Your task completion rate is 78%',
            data: JSON.stringify({ rate: 0.78 }),
          },
        ];
      },
      predictCompletionTime: async (_: any, args: any) => {
        // Mock implementation
        return 3.5; // hours
      },
    },
    Mutation: {
      executeNLPCommand: async (_: any, args: any) => {
        // Mock implementation
        return `Executed command: ${args.command}`;
      },
    },
  },
});