(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
    if (!target) return;
    const container = target.closest('[data-project]');
    const action = target.getAttribute('data-action');
    const projectId = container && container.getAttribute('data-project');
    if (!action || !projectId) return;
    target.setAttribute('disabled', 'true');
    vscode.postMessage({ action: action, projectId: projectId });
  });
})();
