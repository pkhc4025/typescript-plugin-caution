import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Diagnostic {
  line: number;
  offset: number;
  code: number;
  category: string;
  source?: string;
  text: string;
}

export interface Fixture {
  files: Record<string, string>;
  pluginConfig?: Record<string, unknown>;
}

interface ProtocolDiagnostic {
  start: { line: number; offset: number };
  code: number;
  category: string;
  source?: string;
  text: string;
}

interface Response {
  type: 'response';
  request_seq: number;
  success: boolean;
  message?: string;
  body?: unknown;
}

const require = createRequire(import.meta.url);
const rootDir = fileURLToPath(new URL('..', import.meta.url));

export const resolveTypescript = (packageName: string) => ({
  version: (require(`${packageName}/package.json`) as { version: string }).version,
  tsserverPath: require.resolve(`${packageName}/lib/tsserver.js`),
});

class TsserverClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (response: Response) => void>();
  private buffer = Buffer.alloc(0);
  private seq = 0;

  constructor(tsserverPath: string, pluginProbeLocation: string) {
    this.child = spawn(process.execPath, [
      tsserverPath,
      '--pluginProbeLocations',
      pluginProbeLocation,
      '--disableAutomaticTypingAcquisition',
    ]);
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
  }

  send(command: string, args: unknown) {
    this.seq += 1;
    this.child.stdin.write(`${JSON.stringify({ seq: this.seq, type: 'request', command, arguments: args })}\n`);
    return this.seq;
  }

  request<T>(command: string, args: unknown) {
    return new Promise<T>((resolve, reject) => {
      const seq = this.send(command, args);
      this.pending.set(seq, (response) =>
        response.success ? resolve(response.body as T) : reject(new Error(response.message)),
      );
    });
  }

  close() {
    this.child.kill();
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const length = Number(/Content-Length: (\d+)/.exec(this.buffer.subarray(0, headerEnd).toString())?.[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;

      const message = JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString()) as { type: string };
      this.buffer = this.buffer.subarray(bodyStart + length);

      if (message.type === 'response') {
        const response = message as Response;
        this.pending.get(response.request_seq)?.(response);
        this.pending.delete(response.request_seq);
      }
    }
  }
}

export async function getSemanticDiagnostics(tsserverPath: string, fixture: Fixture) {
  const projectDir = mkdtempSync(join(tmpdir(), 'typescript-plugin-caution-'));

  try {
    mkdirSync(join(projectDir, 'node_modules'));
    symlinkSync(rootDir, join(projectDir, 'node_modules', 'typescript-plugin-caution'), 'dir');
    writeFileSync(
      join(projectDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'preserve',
          noEmit: true,
          plugins: [{ name: 'typescript-plugin-caution', ...fixture.pluginConfig }],
        },
        include: ['src'],
      }),
    );

    const files = Object.entries(fixture.files).map(([name, content]) => {
      const path = join(projectDir, 'src', name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return { name, path };
    });

    const client = new TsserverClient(tsserverPath, projectDir);

    try {
      for (const { path } of files) client.send('open', { file: path });

      const result: Record<string, Diagnostic[]> = {};
      for (const { name, path } of files) {
        const diagnostics = await client.request<ProtocolDiagnostic[]>('semanticDiagnosticsSync', { file: path });
        result[name] = diagnostics.map(({ start, code, category, source, text }) => ({
          line: start.line,
          offset: start.offset,
          code,
          category,
          source,
          text,
        }));
      }
      return result;
    } finally {
      client.close();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}
