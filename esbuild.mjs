import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const outputDirectory = path.resolve('out');
fs.rmSync(outputDirectory, { recursive: true, force: true });

const options = {
  entryPoints: {
    extension: 'src/extension.ts',
    cli: 'src/cli.ts',
  },
  outdir: outputDirectory,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: false,
  minify: false,
  metafile: true,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
  process.stdout.write('Watching extension and CLI sources…\n');
} else {
  await esbuild.build(options);
}
