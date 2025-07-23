import { makeExecutableSchema } from '@graphql-tools/schema';
import prisma from '../../lib/prisma.js';

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
    enum TodoStatus {
      pending
      in_progress
      completed
      cancelled
    }

    enum Priority {
      low
      medium
      high
      urgent
    }

    type Todo {
      id: ID!
      title: String!
      description: String
      status: TodoStatus!
      priority: Priority!
      dueDate: String
      createdAt: String!
      updatedAt: String!
      userId: ID!
      todoListId: ID
      user: User!
      todoList: TodoList
    }

    type TodoList {
      id: ID!
      title: String!
      description: String
      isArchived: Boolean!
      createdAt: String!
      updatedAt: String!
      userId: ID!
      user: User!
      todos: [Todo!]!
    }

    type User {
      id: ID!
      todos: [Todo!]!
      todoLists: [TodoList!]!
    }

    type Query {
      todo(id: ID!): Todo
      todos(status: TodoStatus, priority: Priority, todoListId: ID): [Todo!]!
      todoList(id: ID!): TodoList
      todoLists(includeArchived: Boolean = false): [TodoList!]!
    }

    type Mutation {
      createTodo(
        title: String!
        description: String
        priority: Priority!
        dueDate: String
        todoListId: ID
      ): Todo!
      
      updateTodo(
        id: ID!
        title: String
        description: String
        status: TodoStatus
        priority: Priority
        dueDate: String
        todoListId: ID
      ): Todo
      
      deleteTodo(id: ID!): Todo
      
      createTodoList(
        title: String!
        description: String
      ): TodoList!
      
      updateTodoList(
        id: ID!
        title: String
        description: String
        isArchived: Boolean
      ): TodoList
      
      deleteTodoList(id: ID!): TodoList
    }
  `,
  resolvers: {
    Todo: {
      user: async (parent) => {
        return { __typename: 'User', id: parent.userId };
      },
      todoList: async (parent) => {
        if (!parent.todoListId) return null;
        return prisma.todoList.findUnique({
          where: { id: parent.todoListId },
        });
      },
      createdAt: (parent) => parent.createdAt.toISOString(),
      updatedAt: (parent) => parent.updatedAt.toISOString(),
      dueDate: (parent) => parent.dueDate?.toISOString() || null,
    },
    TodoList: {
      user: async (parent) => {
        return { __typename: 'User', id: parent.userId };
      },
      todos: async (parent) => {
        return prisma.todo.findMany({
          where: { todoListId: parent.id },
          orderBy: { createdAt: 'desc' },
        });
      },
      createdAt: (parent) => parent.createdAt.toISOString(),
      updatedAt: (parent) => parent.updatedAt.toISOString(),
    },
    User: {
      todos: async (parent) => {
        return prisma.todo.findMany({
          where: { userId: parent.id },
          orderBy: { createdAt: 'desc' },
        });
      },
      todoLists: async (parent) => {
        return prisma.todoList.findMany({
          where: { userId: parent.id },
          orderBy: { createdAt: 'desc' },
        });
      },
    },
    Query: {
      todo: async (_, args) => {
        return prisma.todo.findUnique({
          where: { id: args.id },
        });
      },
      todos: async (_, args) => {
        const where: any = {};
        if (args.status) where.status = args.status;
        if (args.priority) where.priority = args.priority;
        if (args.todoListId) where.todoListId = args.todoListId;

        return prisma.todo.findMany({
          where,
          orderBy: { createdAt: 'desc' },
        });
      },
      todoList: async (_, args) => {
        return prisma.todoList.findUnique({
          where: { id: args.id },
        });
      },
      todoLists: async (_, args) => {
        const where: any = {};
        if (!args.includeArchived) {
          where.isArchived = false;
        }

        return prisma.todoList.findMany({
          where,
          orderBy: { createdAt: 'desc' },
        });
      },
    },
    Mutation: {
      createTodo: async (_, args) => {
        return prisma.todo.create({
          data: {
            title: args.title,
            description: args.description,
            priority: args.priority,
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            todoListId: args.todoListId,
            status: 'pending',
            // Note: In a real app, get userId from context
            userId: 'temp-user-id',
          },
        });
      },
      updateTodo: async (_, args) => {
        const data: any = {};
        if (args.title !== undefined) data.title = args.title;
        if (args.description !== undefined) data.description = args.description;
        if (args.status !== undefined) data.status = args.status;
        if (args.priority !== undefined) data.priority = args.priority;
        if (args.dueDate !== undefined) data.dueDate = new Date(args.dueDate);
        if (args.todoListId !== undefined) data.todoListId = args.todoListId;

        return prisma.todo.update({
          where: { id: args.id },
          data,
        });
      },
      deleteTodo: async (_, args) => {
        return prisma.todo.delete({
          where: { id: args.id },
        });
      },
      createTodoList: async (_, args) => {
        return prisma.todoList.create({
          data: {
            title: args.title,
            description: args.description,
            isArchived: false,
            // Note: In a real app, get userId from context
            userId: 'temp-user-id',
          },
        });
      },
      updateTodoList: async (_, args) => {
        const data: any = {};
        if (args.title !== undefined) data.title = args.title;
        if (args.description !== undefined) data.description = args.description;
        if (args.isArchived !== undefined) data.isArchived = args.isArchived;

        return prisma.todoList.update({
          where: { id: args.id },
          data,
        });
      },
      deleteTodoList: async (_, args) => {
        return prisma.todoList.delete({
          where: { id: args.id },
        });
      },
    },
  },
});