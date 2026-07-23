import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  await runTests({
    extensionDevelopmentPath: repositoryRoot,
    extensionTestsPath: path.join(repositoryRoot, 'test', 'integration', 'suite', 'index.cjs'),
    launchArgs: ['--disable-extensions'],
  });
} catch (error) {
  process.stderr.write(
    `VS Code integration tests failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
