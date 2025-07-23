import { builder } from "./builder.js";

// Import authentication types first
// import './types/auth.js';

// Import scalars
// import './scalars.js';

// Import root types
// import './queries/index.js';
// import './mutations/index.js';
// import './subscriptions/index.js';

// Import types
// import './enums.js';
// import './types/User.js';
// import './types/Todo.js';
// import './types/TodoList.js';
// import './types/Session.js';

export const schema = builder.toSchema();
export default schema;
