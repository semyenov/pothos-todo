import { TestSuite } from '../testing-framework.js';

export const gatewayIntegrationTests: TestSuite = {
  name: 'Gateway Integration Tests',
  description: 'Test cross-subgraph queries and federation features',
  endpoint: 'http://localhost:4000/graphql',
  
  tests: [
    {
      name: 'Should fetch user with todos',
      query: `
        query UserWithTodos($userId: ID!) {
          user(id: $userId) {
            id
            email
            name
            todos {
              id
              title
              status
              priority
            }
          }
        }
      `,
      variables: {
        userId: '1',
      },
    },
    
    {
      name: 'Should fetch todo with user details',
      query: `
        query TodoWithUser($todoId: ID!) {
          todo(id: $todoId) {
            id
            title
            user {
              id
              email
              name
            }
          }
        }
      `,
      variables: {
        todoId: '1',
      },
    },
    
    {
      name: 'Should fetch user with AI insights',
      query: `
        query UserWithInsights($userId: ID!) {
          user(id: $userId) {
            id
            email
            insights {
              productivityScore
              completionRate
              suggestions
            }
          }
        }
      `,
      variables: {
        userId: '1',
      },
    },
    
    {
      name: 'Should create todo and get AI suggestions',
      query: `
        mutation CreateTodoWithAI($input: CreateTodoInput!) {
          createTodo(input: $input) {
            id
            title
            aiSuggestions {
              priority
              estimatedTime
              relatedTodos {
                id
                title
              }
            }
          }
        }
      `,
      variables: {
        input: {
          title: 'Prepare presentation for client meeting',
          userId: '1',
        },
      },
    },
    
    {
      name: 'Should handle complex nested queries',
      query: `
        query ComplexQuery($userId: ID!) {
          user(id: $userId) {
            id
            email
            todoLists {
              id
              title
              todos {
                id
                title
                priority
                aiAnalysis {
                  urgency
                  complexity
                }
              }
            }
            stats {
              totalTodos
              completedTodos
              productivityTrend
            }
          }
        }
      `,
      variables: {
        userId: '1',
      },
    },
    
    {
      name: 'Should batch multiple queries efficiently',
      query: `
        query BatchedQueries {
          users(first: 5) {
            id
            todos(first: 3) {
              id
              title
            }
          }
          recentTodos: todos(orderBy: { createdAt: DESC }, first: 10) {
            id
            title
            user {
              email
            }
          }
          aiSuggestions: suggestTodos(userId: "1", limit: 3) {
            title
            priority
          }
        }
      `,
    },
    
    {
      name: 'Should handle federation directives properly',
      query: `
        query FederationTest {
          _service {
            sdl
          }
        }
      `,
    },
    
    {
      name: 'Should resolve entity references',
      query: `
        query ResolveEntities($representations: [_Any!]!) {
          _entities(representations: $representations) {
            ... on User {
              id
              email
              todos {
                id
                title
              }
            }
            ... on Todo {
              id
              title
              user {
                email
              }
            }
          }
        }
      `,
      variables: {
        representations: [
          { __typename: 'User', id: '1' },
          { __typename: 'Todo', id: '1' },
        ],
      },
    },
    
    {
      name: 'Should handle subscription across subgraphs',
      query: `
        subscription TodoUpdates($userId: ID!) {
          todoUpdated(userId: $userId) {
            id
            title
            status
            user {
              email
            }
            aiAnalysis {
              impact
              suggestions
            }
          }
        }
      `,
      variables: {
        userId: '1',
      },
      skipReason: 'Subscription testing requires WebSocket client',
    },
    
    {
      name: 'Should handle errors from different subgraphs',
      query: `
        query ErrorHandling {
          user(id: "invalid") {
            id
            email
          }
          todo(id: "999999") {
            id
            title
          }
          executeNLPCommand(userId: "1", command: "") {
            success
            error
          }
        }
      `,
      expectedErrors: ['User not found', 'Todo not found', 'Command cannot be empty'],
    },
    
    {
      name: 'Should respect field-level permissions',
      query: `
        query PermissionTest($userId: ID!) {
          user(id: $userId) {
            id
            email
            sensitiveData
          }
        }
      `,
      variables: {
        userId: '1',
      },
      skipReason: 'Field-level permissions not implemented',
    },
    
    {
      name: 'Should optimize N+1 queries',
      query: `
        query N1Test {
          users(first: 10) {
            id
            todos {
              id
              user {
                email
              }
            }
          }
        }
      `,
    },
    
    {
      name: 'Should handle circular references',
      query: `
        query CircularReference($userId: ID!) {
          user(id: $userId) {
            id
            todos {
              id
              user {
                id
                todos {
                  id
                  title
                }
              }
            }
          }
        }
      `,
      variables: {
        userId: '1',
      },
    },
    
    {
      name: 'Should support field aliases',
      query: `
        query AliasedFields($userId: ID!) {
          currentUser: user(id: $userId) {
            identifier: id
            mail: email
            taskCount: todoCount
            pendingTasks: todos(where: { status: "pending" }) {
              id
              title
            }
            completedTasks: todos(where: { status: "completed" }) {
              id
              title
            }
          }
        }
      `,
      variables: {
        userId: '1',
      },
    },
    
    {
      name: 'Should handle mutations across subgraphs',
      query: `
        mutation CrossSubgraphMutation($userId: ID!, $todoTitle: String!) {
          createTodo(input: { userId: $userId, title: $todoTitle }) {
            id
            title
            user {
              email
              todoCount
            }
            aiSuggestions {
              priority
              estimatedTime
            }
          }
        }
      `,
      variables: {
        userId: '1',
        todoTitle: 'Cross-subgraph test todo',
      },
    },
    
    {
      name: 'Should handle complex filtering across subgraphs',
      query: `
        query ComplexFiltering {
          users(
            where: {
              AND: [
                { email: { contains: "test" } }
                { createdAt: { gte: "2023-01-01" } }
              ]
            }
          ) {
            id
            email
            todos(
              where: {
                OR: [
                  { status: "pending", priority: "high" }
                  { dueDate: { lte: "2024-12-31" } }
                ]
              }
            ) {
              id
              title
              status
              priority
            }
          }
        }
      `,
    },
    
    {
      name: 'Should measure query complexity',
      query: `
        query ComplexityTest {
          users(first: 100) {
            todos(first: 100) {
              user {
                todos(first: 100) {
                  id
                }
              }
            }
          }
        }
      `,
      expectedErrors: ['Query too complex'],
      skipReason: 'Requires complexity limiting to be enabled',
    },
  ],
};