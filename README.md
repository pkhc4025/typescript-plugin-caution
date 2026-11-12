# typescript-plugin-caution

[![CI](https://github.com/pkhc4025/typescript-plugin-caution/actions/workflows/ci.yml/badge.svg)](https://github.com/pkhc4025/typescript-plugin-caution/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/typescript-plugin-caution)](https://www.npmjs.com/package/typescript-plugin-caution)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A TypeScript language service plugin that shows a warning wherever a symbol marked with a JSDoc tag such as `@caution` is used.

It works like `@deprecated` does in your editor, but it means "use with care" instead of "do not use".

```ts
export class Comment {
  private _content = '';
  deletedAt: Date | null = null;

  /** @caution Spreading the entity drops `content` because it is a getter. */
  get content() {
    return this.deletedAt ? '' : this._content;
  }
}
```

```ts
comment.content;
//      ~~~~~~~ caution(990001): @caution 'content': Spreading the entity drops `content` because it is a getter.
```

## Why

TypeScript only gives `@deprecated` special treatment at usage sites. Other tags, such as `@experimental` ([microsoft/TypeScript#56808](https://github.com/microsoft/TypeScript/issues/56808)), only show up in hover text, so the person calling the API never notices them.

This plugin reads the JSDoc tags of every referenced symbol and reports a warning at the reference, with the tag text as the message.

## Installation

```sh
npm install --save-dev typescript-plugin-caution
# or
yarn add --dev typescript-plugin-caution
# or
pnpm add --save-dev typescript-plugin-caution
```

## Setup

Add the plugin to `compilerOptions.plugins` in your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "typescript-plugin-caution" }],
  },
}
```

`plugins` is not merged through `extends`. If a project already declares its own plugins (for example `{ "name": "next" }`), list this plugin next to them in that project's `tsconfig.json`.

### VS Code

Language service plugins are loaded by the TypeScript version that runs the language server, so VS Code has to use the workspace version of TypeScript:

1. Point VS Code at the workspace TypeScript in `.vscode/settings.json`:

   ```jsonc
   {
     "js/ts.tsdk.path": "node_modules/typescript/lib",
   }
   ```

   Older VS Code versions use `"typescript.tsdk"` instead.

2. Run **TypeScript: Select TypeScript Version** and choose **Use Workspace Version**.
3. After installing the plugin or changing its options, run **TypeScript: Restart TS Server**.

## Options

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "typescript-plugin-caution",
        "tags": ["caution", "experimental"],
        "spread": true,
      },
    ],
  },
}
```

| Option   | Type       | Default       | Description                                                                                                        |
| -------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tags`   | `string[]` | `["caution"]` | JSDoc tag names to report, without the leading `@`.                                                                |
| `spread` | `boolean`  | `false`       | Also warn when a value whose type has a tagged member is spread with `{ ...value }` or `<Component {...value} />`. |

## What is reported

Usages of a tagged symbol are reported, including:

- property access, calls and `new` expressions
- type references and JSX tag names
- namespace access such as `entity.risky()`
- shorthand properties such as `{ risky }`
- destructuring such as `const { content } = comment` and `const { content: renamed } = comment`

The declaration itself and `import` / `export` specifiers are not reported.

Tags are read from every declaration of a symbol, so a tag on a getter is honored even when the setter has no JSDoc.

With `spread: true`, spreading a value reports one warning for each tagged member of its type. This also covers generic values such as `T extends Comment` and mapped types such as `Pick<Comment, 'content'>`.

## Diagnostics

All diagnostics are warnings with `caution` as their source.

| Code     | Reported at                              |
| -------- | ---------------------------------------- |
| `990001` | a usage of a tagged symbol               |
| `990002` | a spread of a value with a tagged member |

## Limitations

- **Editor only.** Language service plugins run inside tsserver. `tsc` and build tools ignore them, so the warnings guide people but do not fail builds.
- **TypeScript 7 is not supported.** The native TypeScript 7 language server does not load tsserver plugins. The editor has to run a TypeScript 5.x or 6.x language service.
- **JSDoc must reach the type checker.** If the tagged code is consumed through emitted `.d.ts` files built with `removeComments: true`, the tags are stripped and nothing is reported.
- **The spread check does not look at how members are defined.** It reports any tagged member, not only getters.

## Compatibility

Tested with TypeScript 5.8.3, 5.9.3 and 6.0.3 on Node.js 22, 24 and 26.

## Development

```sh
yarn install
yarn build         # compile src to dist
yarn test          # build, then run tsserver against fixtures for every tested TypeScript version
yarn lint
yarn format:check
yarn typecheck
```

The tests start a real tsserver for each TypeScript version and load the built plugin by name, so they cover the same path an editor uses.

## Releasing

1. Update `version` in `package.json` and merge it into `main`.
2. Publish a GitHub release whose tag is `v<version>`, for example `v0.1.0`.
3. The [Release workflow](.github/workflows/release.yml) runs the tests and publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in the repository.

Trusted publishing cannot create a new package. Publish the first version manually with `npm publish`, then add this repository and `release.yml` as a trusted publisher in the package settings on npmjs.com.

## License

[MIT](LICENSE) © pkhc4025
