import * as path from 'path';
import * as vscode from 'vscode';
import { detectAllProjects, type ProjectInfo } from '../scanner/projectDetector';

export async function selectAemCloudProject(
  requestedRoot?: string,
  placeHolder = 'Select the AEM as a Cloud Service project',
): Promise<ProjectInfo | undefined> {
  const projects = discoverWorkspaceProjects();
  if (!projects.length) {
    vscode.window.showErrorMessage('No AEM as a Cloud Service reactor was found in the open workspace.');
    return undefined;
  }
  if (requestedRoot) {
    const resolved = path.resolve(requestedRoot);
    const matched = projects.find((project) => path.resolve(project.root) === resolved);
    if (!matched) {
      vscode.window.showErrorMessage('The requested project is not a discovered AEMaaCS workspace project.');
    }
    return matched;
  }
  if (projects.length === 1) return projects[0];
  const picked = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.artifactId,
      description: `AEMaaCS · ${project.groupId}:${project.version}`,
      detail: project.root,
      project,
    })),
    { placeHolder },
  );
  return picked?.project;
}

export function discoverWorkspaceProjects(): ProjectInfo[] {
  const projects = new Map<string, ProjectInfo>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const project of detectAllProjects(folder.uri.fsPath)) {
      projects.set(path.resolve(project.root), project);
    }
  }
  return [...projects.values()].sort((left, right) => left.root.localeCompare(right.root));
}

export function requireTrustedWorkspace(action: string): boolean {
  if (vscode.workspace.isTrusted) return true;
  vscode.window.showWarningMessage(`${action} is disabled until you trust this workspace.`);
  return false;
}
