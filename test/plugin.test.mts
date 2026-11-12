import { beforeAll, describe, expect, it } from 'vitest';
import { getSemanticDiagnostics, resolveTypescript, type Diagnostic } from './tsserver.mjs';

const TYPESCRIPT_PACKAGES = ['typescript-5.8', 'typescript', 'typescript-6.0'];
const USAGE = 990001;
const SPREAD = 990002;

const entity = `export class Comment {
  private _content = 'secret';
  deletedAt: Date | null = null;

  /** @caution Spreading the entity drops content */
  get content() {
    return this.deletedAt ? '' : this._content;
  }
  set content(value: string) {
    this._content = value;
  }

  /** @caution */
  static create() {
    return new Comment();
  }
}

/** @caution Calls an external API */
export function risky() {}

/** @see Comment */
export function safe() {}

/** @experimental Not stable yet */
export const preview = 1;
`;

const usage = `import { Comment, preview, risky, safe } from './entity';
import * as entity from './entity';

const comment = new Comment();
comment.content;
const { content } = comment;
const { content: renamed } = comment;
risky();
entity.risky();
safe();
preview;
Comment.create();
const shorthand = { risky };
const spread = { ...comment };
const generic = <T extends Comment>(value: T) => ({ ...value });
declare const picked: Pick<Comment, 'content'>;
const pickedSpread = { ...picked };
const plainSpread = { ...{ value: 1 } };
const typeError: number = 'text';

export { content, renamed, shorthand, spread, generic, pickedSpread, plainSpread, typeError };
`;

const view = `import { Comment } from './entity';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [name: string]: any;
    }
  }
}

export const View = (comment: Comment) => <div {...comment} />;
`;

const files = { 'entity.ts': entity, 'usage.ts': usage, 'view.tsx': view };

const warning = (source: string, snippet: string, target: string, code: number, text: string) => {
  const index = source.indexOf(snippet);
  if (index === -1) throw new Error(`Snippet not found: ${snippet}`);

  const lines = source.slice(0, index + snippet.indexOf(target)).split('\n');
  return { line: lines.length, offset: lines[lines.length - 1].length + 1, code, category: 'warning', text };
};

const byPosition = <T extends { line: number; offset: number }>(items: T[]) =>
  [...items].sort((a, b) => a.line - b.line || a.offset - b.offset);

const pluginDiagnostics = (diagnostics: Diagnostic[]) =>
  byPosition(
    diagnostics
      .filter((diagnostic) => diagnostic.source === 'caution')
      .map(({ line, offset, code, category, text }) => ({ line, offset, code, category, text })),
  );

const contentText = "@caution 'content': Spreading the entity drops content";
const contentSpreadText = "@caution 'content' in spread: Spreading the entity drops content";
const riskyText = "@caution 'risky': Calls an external API";

const usageWarnings = [
  warning(usage, 'comment.content;', 'content', USAGE, contentText),
  warning(usage, 'const { content } = comment;', 'content', USAGE, contentText),
  warning(usage, 'const { content: renamed }', 'content', USAGE, contentText),
  warning(usage, '\nrisky();', 'risky', USAGE, riskyText),
  warning(usage, 'entity.risky();', 'risky', USAGE, riskyText),
  warning(usage, 'Comment.create();', 'create', USAGE, "@caution 'create'"),
  warning(usage, '{ risky }', 'risky', USAGE, riskyText),
];

const spreadWarnings = [
  warning(usage, '{ ...comment }', '...comment', SPREAD, contentSpreadText),
  warning(usage, '({ ...value })', '...value', SPREAD, contentSpreadText),
  warning(usage, '{ ...picked }', '...picked', SPREAD, contentSpreadText),
];

describe.each(TYPESCRIPT_PACKAGES.map(resolveTypescript))('TypeScript $version', ({ tsserverPath }) => {
  let defaults: Record<string, Diagnostic[]>;
  let customTags: Record<string, Diagnostic[]>;
  let withSpread: Record<string, Diagnostic[]>;

  beforeAll(async () => {
    [defaults, customTags, withSpread] = await Promise.all([
      getSemanticDiagnostics(tsserverPath, { files }),
      getSemanticDiagnostics(tsserverPath, { files, pluginConfig: { tags: ['experimental'] } }),
      getSemanticDiagnostics(tsserverPath, { files, pluginConfig: { spread: true } }),
    ]);
  }, 60_000);

  it('warns at usages of symbols tagged with @caution', () => {
    expect(pluginDiagnostics(defaults['usage.ts'])).toEqual(byPosition(usageWarnings));
  });

  it('does not warn at declarations', () => {
    expect(pluginDiagnostics(defaults['entity.ts'])).toEqual([]);
  });

  it('keeps diagnostics reported by TypeScript', () => {
    expect(
      defaults['usage.ts'].filter((diagnostic) => diagnostic.source !== 'caution').map(({ code }) => code),
    ).toEqual([2322]);
  });

  it('does not warn at spreads by default', () => {
    expect(pluginDiagnostics(defaults['view.tsx'])).toEqual([]);
  });

  it('reads tag names from the tags option', () => {
    expect(pluginDiagnostics(customTags['usage.ts'])).toEqual([
      warning(usage, '\npreview;', 'preview', USAGE, "@experimental 'preview': Not stable yet"),
    ]);
  });

  it('warns at spreads of values with tagged members when spread is enabled', () => {
    expect(pluginDiagnostics(withSpread['usage.ts'])).toEqual(byPosition([...usageWarnings, ...spreadWarnings]));
    expect(pluginDiagnostics(withSpread['view.tsx'])).toEqual([
      warning(view, '{...comment}', '{...comment}', SPREAD, contentSpreadText),
    ]);
  });
});
