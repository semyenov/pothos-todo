// ./pothos.config.js

/** @type {import('prisma-generator-pothos-codegen').Config} */
module.exports = {
  inputs: {
    outputFilePath: './src/graphql/__generated__/inputs.ts',
    prismaImporter: `\nimport { Prisma } from '@prisma/client'; \nimport type { InputObjectRef } from '@pothos/core'`,

    // replacer: (code) => {
    //   // Исправляем проблемы TS2742 путём добавления явных аннотаций типов
    //   let fixedCode = code;

    //   // Паттерн для поиска экспортов с builder.inputRef
    //   const inputRefPattern = /export const (\w+) = builder\.inputRef<PrismaUpdateOperationsInputFilter<Prisma\.(\w+)>, false>\('(\w+)'\)\.implement\(/g;

    //   // Заменяем на явно типизированные версии
    //   fixedCode = fixedCode.replace(inputRefPattern, (match, constName, prismaType, inputName) => {
    //     return `export const ${constName}: InputObjectRef<PrismaUpdateOperationsInputFilter<Prisma.${prismaType}>, false> = builder.inputRef<PrismaUpdateOperationsInputFilter<Prisma.${prismaType}>, false>('${inputName}').implement(`;
    //   });

    //   // Fix boolean fields to use t.boolean() instead of t.field()
    //   fixedCode = fixedCode.replace(
    //     /t\.field\(\{ required: (true|false), type: Inputs\.BoolFieldUpdateOperationsInput \}\)/g,
    //     't.boolean({ required: $1 })'
    //   );

    //   // Fix array fields type issues
    //   fixedCode = fixedCode.replace(
    //     /t\.field\(\{ required: (true|false), type: \[Inputs\.(\w+)\] \}\)/g,
    //     't.list({ required: $1, type: Inputs.$2 })'
    //   );

    //   // Fix nullable field references
    //   fixedCode = fixedCode.replace(
    //     /t\.field\(\{ type: Inputs\.(\w+), required: false \}\)/g,
    //     't.field({ type: Inputs.$1, required: false })'
    //   );

    //   // Fix import statements to use type imports
    //   fixedCode = fixedCode.replace(
    //     /import \{([^}]+)\} from '@pothos\/core';/g,
    //     (match, imports) => {
    //       const importList = imports.split(',').map(i => i.trim());
    //       const typeImports = ['FieldOptionsFromKind', 'InputFieldMap', 'InterfaceParam', 'MutationFieldsShape', 'QueryFieldsShape', 'TypeParam'];
    //       const typeOnlyImports = importList.filter(i => typeImports.includes(i));
    //       const regularImports = importList.filter(i => !typeImports.includes(i));

    //       let result = '';
    //       if (regularImports.length > 0) {
    //         result += `import { ${regularImports.join(', ')} } from '@pothos/core';`;
    //       }
    //       if (typeOnlyImports.length > 0) {
    //         if (result) result += '\n';
    //         result += `import type { ${typeOnlyImports.join(', ')} } from '@pothos/core';`;
    //       }
    //       return result;
    //     }
    //   );

    //   // Fix import statements for Prisma plugin
    //   fixedCode = fixedCode.replace(
    //     /import \{([^}]+)\} from '@pothos\/plugin-prisma';/g,
    //     (match, imports) => {
    //       const importList = imports.split(',').map(i => i.trim());
    //       const typeImports = ['PrismaFieldOptions', 'PrismaObjectTypeOptions', 'RelatedFieldOptions'];
    //       const typeOnlyImports = importList.filter(i => typeImports.includes(i));
    //       const regularImports = importList.filter(i => !typeImports.includes(i));

    //       let result = '';
    //       if (regularImports.length > 0) {
    //         result += `import { ${regularImports.join(', ')} } from '@pothos/plugin-prisma';`;
    //       }
    //       if (typeOnlyImports.length > 0) {
    //         if (result) result += '\n';
    //         result += `import type { ${typeOnlyImports.join(', ')} } from '@pothos/plugin-prisma';`;
    //       }
    //       return result;
    //     }
    //   );

    //   // Fix boolean values in args - DISABLED as it causes issues with nullable fields
    //   // fixedCode = fixedCode.replace(/: (true|false),/g, ': t.arg.boolean({ required: false }),');
    //   // fixedCode = fixedCode.replace(/: (true|false) \}/g, ': t.arg.boolean({ required: false }) }');

    //   // Fix array issues in orderBy
    //   fixedCode = fixedCode.replace(/orderBy: args.orderBy \?\? false,/g, 'orderBy: args.orderBy,');
    //   fixedCode = fixedCode.replace(/orderBy: false\[\]/g, 'orderBy: undefined');

    //   // Fix where clause issues
    //   fixedCode = fixedCode.replace(/where: args.where \?\? false,/g, 'where: args.where || undefined,');
    //   fixedCode = fixedCode.replace(/where: false,/g, 'where: undefined,');

    //   // Keep DateTime and Json scalars - they're needed for field types

    //   return fixedCode;
    // },
  },
  crud: {
    outputDir: './src/graphql/__generated__/',
    inputsImporter: `import * as Inputs from '@/graphql/__generated__/inputs';`,
    resolverImports: `\nimport prisma from '@/lib/prisma';`,
    prismaCaller: 'prisma',
    // replacer: (code, config) => {
    //   let fixedCode = code;

    //   // Fix import statements to use type imports
    //   fixedCode = fixedCode.replace(
    //     /import \{\s*([^}]+)\s*\} from '@pothos\/core';/g,
    //     (match, imports) => {
    //       const importList = imports.split(',').map(i => i.trim());
    //       const typeImports = ['FieldOptionsFromKind', 'InputFieldMap', 'InterfaceParam', 'MutationFieldsShape', 'QueryFieldsShape', 'TypeParam'];
    //       const typeOnlyImports = importList.filter(i => typeImports.includes(i));
    //       const regularImports = importList.filter(i => !typeImports.includes(i));

    //       let result = '';
    //       if (regularImports.length > 0) {
    //         result += `import { ${regularImports.join(', ')} } from '@pothos/core';`;
    //       }
    //       if (typeOnlyImports.length > 0) {
    //         if (result) result += '\n';
    //         result += `import type { ${typeOnlyImports.join(', ')} } from '@pothos/core';`;
    //       }
    //       return result;
    //     }
    //   );

    //   // Fix import statements for Prisma plugin
    //   fixedCode = fixedCode.replace(
    //     /import \{\s*([^}]+)\s*\} from '@pothos\/plugin-prisma';/g,
    //     (match, imports) => {
    //       const importList = imports.split(',').map(i => i.trim());
    //       const typeImports = ['PrismaFieldOptions', 'PrismaObjectTypeOptions', 'RelatedFieldOptions'];
    //       const typeOnlyImports = importList.filter(i => typeImports.includes(i));
    //       const regularImports = importList.filter(i => !typeImports.includes(i));

    //       let result = '';
    //       if (regularImports.length > 0) {
    //         result += `import { ${regularImports.join(', ')} } from '@pothos/plugin-prisma';`;
    //       }
    //       if (typeOnlyImports.length > 0) {
    //         if (result) result += '\n';
    //         result += `import type { ${typeOnlyImports.join(', ')} } from '@pothos/plugin-prisma';`;
    //       }
    //       return result;
    //     }
    //   );

    //   // Fix boolean values in args - DISABLED as it causes issues with nullable fields
    //   // fixedCode = fixedCode.replace(/: (true|false),/g, ': t.arg.boolean({ required: false }),');
    //   // fixedCode = fixedCode.replace(/: (true|false) \}/g, ': t.arg.boolean({ required: false }) }');

    //   // Fix array issues in orderBy
    //   fixedCode = fixedCode.replace(/orderBy: args.orderBy \?\? false,/g, 'orderBy: args.orderBy,');
    //   fixedCode = fixedCode.replace(/orderBy: false\[\]/g, 'orderBy: undefined');

    //   // Fix where clause issues
    //   fixedCode = fixedCode.replace(/where: args.where \?\? false,/g, 'where: args.where || undefined,');
    //   fixedCode = fixedCode.replace(/where: false,/g, 'where: undefined,');

    //   // Keep DateTime and Json scalars - they're needed for field types

    //   return fixedCode;
    // }
  },
  global: {
    builderLocation: './src/api/schema/builder.ts',
  },
};