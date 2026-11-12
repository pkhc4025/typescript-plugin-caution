import type * as ts from 'typescript';

interface PluginConfig {
  tags: string[];
  spread: boolean;
}

const USAGE_CODE = 990001;
const SPREAD_CODE = 990002;
const SOURCE = 'caution';
const LOG_PREFIX = '[typescript-plugin-caution]';

const init: ts.server.PluginModuleFactory = ({ typescript }) => {
  const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined) =>
    symbol && symbol.flags & typescript.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

  const getReferencedSymbol = (checker: ts.TypeChecker, node: ts.Identifier | ts.PrivateIdentifier) => {
    const parent = node.parent;

    if (
      typescript.isImportSpecifier(parent) ||
      typescript.isExportSpecifier(parent) ||
      typescript.isImportClause(parent) ||
      typescript.isNamespaceImport(parent)
    ) {
      return undefined;
    }

    if (
      typescript.isBindingElement(parent) &&
      parent.name === node &&
      !parent.propertyName &&
      typescript.isObjectBindingPattern(parent.parent)
    ) {
      return checker.getTypeAtLocation(parent.parent).getProperty(node.text);
    }

    if (typescript.isShorthandPropertyAssignment(parent) && parent.name === node) {
      return resolveAlias(checker, checker.getShorthandAssignmentValueSymbol(parent));
    }

    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || symbol.declarations?.some((declaration) => typescript.getNameOfDeclaration(declaration) === node)) {
      return undefined;
    }

    return resolveAlias(checker, symbol);
  };

  const formatMessage = (tag: ts.JSDocTagInfo, subject: string) => {
    const text = typescript.displayPartsToString(tag.text).trim();
    return text ? `@${tag.name} ${subject}: ${text}` : `@${tag.name} ${subject}`;
  };

  const collect = (program: ts.Program, sourceFile: ts.SourceFile, config: PluginConfig) => {
    const checker = program.getTypeChecker();
    const tagNames = new Set(config.tags);
    const tagCache = new Map<ts.Symbol, ts.JSDocTagInfo[]>();
    const diagnostics: ts.Diagnostic[] = [];

    const getMatchedTags = (symbol: ts.Symbol) => {
      let matched = tagCache.get(symbol);
      if (!matched) {
        matched = symbol.getJsDocTags(checker).filter((tag) => tagNames.has(tag.name));
        tagCache.set(symbol, matched);
      }
      return matched;
    };

    const report = (node: ts.Node, code: number, messageText: string) => {
      diagnostics.push({
        file: sourceFile,
        start: node.getStart(sourceFile),
        length: node.getWidth(sourceFile),
        category: typescript.DiagnosticCategory.Warning,
        code,
        source: SOURCE,
        messageText,
      });
    };

    const checkUsage = (node: ts.Identifier | ts.PrivateIdentifier) => {
      const symbol = getReferencedSymbol(checker, node);
      if (!symbol) return;

      for (const tag of getMatchedTags(symbol)) {
        report(node, USAGE_CODE, formatMessage(tag, `'${node.text}'`));
      }
    };

    const checkSpread = (node: ts.SpreadAssignment | ts.JsxSpreadAttribute) => {
      const type = checker.getTypeAtLocation(node.expression);
      const visited = new Set<ts.Symbol>();

      for (const part of type.isUnion() ? type.types : [type]) {
        for (const property of checker.getPropertiesOfType(part)) {
          if (visited.has(property)) continue;
          visited.add(property);

          for (const tag of getMatchedTags(property)) {
            report(node, SPREAD_CODE, formatMessage(tag, `'${property.getName()}' in spread`));
          }
        }
      }
    };

    const visit = (node: ts.Node): void => {
      if (typescript.isIdentifier(node) || typescript.isPrivateIdentifier(node)) {
        checkUsage(node);
      } else if (config.spread && (typescript.isSpreadAssignment(node) || typescript.isJsxSpreadAttribute(node))) {
        checkSpread(node);
      }

      typescript.forEachChild(node, visit);
    };

    visit(sourceFile);
    return diagnostics;
  };

  return {
    create(info) {
      const raw = (info.config ?? {}) as Partial<PluginConfig>;
      const config: PluginConfig = {
        tags: Array.isArray(raw.tags) ? raw.tags : ['caution'],
        spread: raw.spread === true,
      };
      const languageService = info.languageService;
      const logger = info.project.projectService.logger;

      logger.info(`${LOG_PREFIX} tags=${config.tags.join(',')} spread=${config.spread}`);

      const proxy = Object.create(null) as ts.LanguageService;
      for (const key of Object.keys(languageService) as (keyof ts.LanguageService)[]) {
        const value = languageService[key];
        (proxy as unknown as Record<string, unknown>)[key] =
          typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(languageService) : value;
      }

      proxy.getSemanticDiagnostics = (fileName) => {
        const prior = languageService.getSemanticDiagnostics(fileName);

        try {
          const program = languageService.getProgram();
          const sourceFile = program?.getSourceFile(fileName);
          if (!program || !sourceFile || sourceFile.isDeclarationFile) return prior;

          return [...prior, ...collect(program, sourceFile, config)];
        } catch (error) {
          logger.info(`${LOG_PREFIX} ${error instanceof Error ? error.stack : String(error)}`);
          return prior;
        }
      };

      return proxy;
    },
  };
};

export = init;
