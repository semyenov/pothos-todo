import { TestSuite, TestDataGenerator, Assertions } from '../testing-framework.js';

export const userSubgraphTests: TestSuite = {
  name: 'User Subgraph Tests',
  description: 'Test user-related operations and federation features',
  endpoint: 'http://localhost:4001/graphql',
  
  setupQueries: [
    // Clean up test users
    `mutation { _cleanupTestUsers }`,
  ],
  
  tests: [
    {
      name: 'Should return schema typename',
      query: `query { __typename }`,
      expectedResult: { __typename: 'Query' },
    },
    
    {
      name: 'Should fetch all users',
      query: `
        query GetAllUsers {
          users {
            id
            email
            name
            createdAt
          }
        }
      `,
      expectedResult: {
        users: Assertions.isNotNull,
      },
    },
    
    {
      name: 'Should create a new user',
      query: `
        mutation CreateUser($input: UserCreateInput!) {
          createUser(data: $input) {
            id
            email
            name
          }
        }
      `,
      variables: {
        input: {
          email: TestDataGenerator.randomEmail(),
          name: 'Test User',
          password: 'SecurePassword123!',
        },
      },
    },
    
    {
      name: 'Should fetch user by ID',
      query: `
        query GetUserById($id: ID!) {
          user(id: $id) {
            id
            email
            name
            createdAt
            updatedAt
          }
        }
      `,
      variables: {
        id: '1', // Assuming user with ID 1 exists from seed data
      },
    },
    
    {
      name: 'Should handle non-existent user',
      query: `
        query GetNonExistentUser {
          user(id: "99999") {
            id
            email
          }
        }
      `,
      expectedResult: {
        user: null,
      },
    },
    
    {
      name: 'Should validate email format',
      query: `
        mutation CreateInvalidUser {
          createUser(data: {
            email: "invalid-email"
            name: "Test"
            password: "password123"
          }) {
            id
          }
        }
      `,
      expectedErrors: ['Invalid email format'],
    },
    
    {
      name: 'Should update user profile',
      query: `
        mutation UpdateUser($id: ID!, $data: UserUpdateInput!) {
          updateUser(id: $id, data: $data) {
            id
            name
            updatedAt
          }
        }
      `,
      variables: {
        id: '1',
        data: {
          name: 'Updated Name',
        },
      },
    },
    
    {
      name: 'Should delete user',
      query: `
        mutation DeleteUser($id: ID!) {
          deleteUser(id: $id)
        }
      `,
      variables: {
        id: '2', // Different user to avoid conflicts
      },
      expectedResult: {
        deleteUser: true,
      },
    },
    
    {
      name: 'Should support federation _entities query',
      query: `
        query EntitiesQuery($representations: [_Any!]!) {
          _entities(representations: $representations) {
            ... on User {
              id
              email
              name
            }
          }
        }
      `,
      variables: {
        representations: [
          {
            __typename: 'User',
            id: '1',
          },
        ],
      },
    },
    
    {
      name: 'Should support federation _service query',
      query: `
        query ServiceQuery {
          _service {
            sdl
          }
        }
      `,
    },
    
    {
      name: 'Should paginate users',
      query: `
        query PaginatedUsers($first: Int!, $after: String) {
          users(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                email
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
          }
        }
      `,
      variables: {
        first: 5,
      },
    },
    
    {
      name: 'Should filter users by email',
      query: `
        query FilterUsers($email: String!) {
          users(where: { email: { contains: $email } }) {
            id
            email
          }
        }
      `,
      variables: {
        email: 'test',
      },
    },
    
    {
      name: 'Should sort users by creation date',
      query: `
        query SortedUsers {
          users(orderBy: { createdAt: DESC }) {
            id
            createdAt
          }
        }
      `,
    },
    
    {
      name: 'Should handle concurrent user creation',
      description: 'Test race conditions with duplicate emails',
      query: `
        mutation ConcurrentCreate($email: String!) {
          createUser(data: {
            email: $email
            name: "Concurrent Test"
            password: "password123"
          }) {
            id
          }
        }
      `,
      variables: {
        email: 'concurrent@test.com',
      },
      // This test would be run multiple times concurrently
    },
    
    {
      name: 'Should enforce password requirements',
      query: `
        mutation WeakPassword {
          createUser(data: {
            email: "weak@test.com"
            name: "Test"
            password: "123"
          }) {
            id
          }
        }
      `,
      expectedErrors: ['Password must be at least 8 characters'],
    },
    
    {
      name: 'Should handle user authentication',
      query: `
        mutation Login($email: String!, $password: String!) {
          login(email: $email, password: $password) {
            token
            user {
              id
              email
            }
          }
        }
      `,
      variables: {
        email: 'test@example.com',
        password: 'password123',
      },
      skipReason: 'Requires auth setup',
    },
    
    {
      name: 'Should track user activity',
      query: `
        query UserActivity($id: ID!) {
          user(id: $id) {
            id
            lastLoginAt
            loginCount
          }
        }
      `,
      variables: {
        id: '1',
      },
    },
    
    {
      name: 'Should handle user preferences',
      query: `
        mutation UpdatePreferences($id: ID!, $preferences: JSON!) {
          updateUserPreferences(userId: $id, preferences: $preferences) {
            id
            preferences
          }
        }
      `,
      variables: {
        id: '1',
        preferences: {
          theme: 'dark',
          notifications: true,
        },
      },
      skipReason: 'Preferences not implemented yet',
    },
  ],
  
  teardownQueries: [
    // Clean up test data
    `mutation { _cleanupTestUsers }`,
  ],
};