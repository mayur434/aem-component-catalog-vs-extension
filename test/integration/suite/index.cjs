const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('aem-catalog.aem-component-library-generator');
  assert.ok(extension, 'Extension is installed in the test host.');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'aemComponentLibrary.openCatalog',
    'aemComponentLibrary.configure',
    'aemComponentLibrary.audit',
    'aemComponentLibrary.doctor',
    'aemComponentLibrary.generate',
    'aemComponentLibrary.rollback',
    'aemComponentLibrary.exportSupportBundle',
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered.`);
  }
  assert.equal(extension.packageJSON.capabilities.untrustedWorkspaces.supported, 'limited');
  assert.equal(extension.packageJSON.capabilities.virtualWorkspaces, false);
}

module.exports = { run };
