import { builder } from '../builder.js';
import './auth.js'; // Import auth mutations to register them
import './todo.js'; // Import todo mutations to register them
import './nlp.js'; // Import NLP mutations to register them
import './ai-enhanced.js'; // Import AI-enhanced mutations to register them

// Define the root Mutation type
builder.mutationType({
  fields: (t) => ({
    // This will be extended by other mutation files
  }),
});