import { vi } from 'vitest';
import * as path from 'path';

/**
 * A test-only mock of the `vscode` extension-host API, comprehensive enough to
 * exercise src/webview/catalogPanel.ts and src/webview/catalogTabs/*.ts. Not a
 * real npm package — `vscode` is intercepted via vi.mock('vscode', ...) in each
 * test file (see mockVscodeModule() below), the same way esbuild treats it as
 * `external` in the real build (the real module is only ever provided by the
 * actual VS Code extension host process).
 */

export interface MockWebview {
  html: string;
  cspSource: string;
  postMessage: ReturnType<typeof vi.fn>;
  asWebviewUri: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
}

export interface MockPanel {
  viewType: string;
  title: string;
  iconPath: unknown;
  webview: MockWebview;
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
  /** The handler passed to webview.onDidReceiveMessage, captured for tests to invoke directly. */
  emitMessage(message: unknown): Promise<void> | void;
}

let workspaceFolders: Array<{ uri: { fsPath: string } }> = [];
let isTrusted = true;
const createdPanels: MockPanel[] = [];

function makePanel(viewType: string, title: string): MockPanel {
  let handler: ((message: unknown) => unknown) | undefined;
  const webview: MockWebview = {
    html: '',
    cspSource: 'vscode-webview://mock',
    postMessage: vi.fn(() => Promise.resolve(true)),
    asWebviewUri: vi.fn((uri: unknown) => uri),
    onDidReceiveMessage: vi.fn((fn: (message: unknown) => unknown) => {
      handler = fn;
      return { dispose: vi.fn() };
    }),
  };
  const panel: MockPanel = {
    viewType,
    title,
    iconPath: undefined,
    webview,
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    emitMessage: (message: unknown) => handler?.(message),
  };
  return panel;
}

export function resetVscodeMock(): void {
  workspaceFolders = [];
  isTrusted = true;
  createdPanels.length = 0;
  vscodeMock.window.createWebviewPanel.mockClear();
  vscodeMock.window.showErrorMessage.mockClear();
  vscodeMock.window.showWarningMessage.mockClear();
  vscodeMock.window.showInformationMessage.mockClear();
  vscodeMock.window.showOpenDialog.mockClear();
  vscodeMock.window.showSaveDialog.mockClear();
  vscodeMock.window.showTextDocument.mockClear();
  vscodeMock.window.withProgress.mockClear();
  vscodeMock.commands.executeCommand.mockClear();
  vscodeMock.env.openExternal.mockClear();
}

export function setWorkspaceFolders(paths: string[]): void {
  workspaceFolders = paths.map((p) => ({ uri: { fsPath: p } }));
}

export function setWorkspaceTrusted(value: boolean): void {
  isTrusted = value;
}

/** All panels created via vscode.window.createWebviewPanel since the last reset, in creation order. */
export function getCreatedPanels(): MockPanel[] {
  return createdPanels;
}

export function getLastPanel(): MockPanel {
  const panel = createdPanels[createdPanels.length - 1];
  if (!panel) throw new Error('No panel has been created yet — call vscode.window.createWebviewPanel first.');
  return panel;
}

export const vscodeMock = {
  workspace: {
    get workspaceFolders() {
      return workspaceFolders.length ? workspaceFolders : undefined;
    },
    get isTrusted() {
      return isTrusted;
    },
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    createWebviewPanel: vi.fn((viewType: string, title: string) => {
      const panel = makePanel(viewType, title);
      createdPanels.push(panel);
      return panel;
    }),
    showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
    showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
    showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
    showOpenDialog: vi.fn(() => Promise.resolve(undefined)),
    showSaveDialog: vi.fn(() => Promise.resolve(undefined)),
    showTextDocument: vi.fn(() => Promise.resolve(undefined)),
    withProgress: vi.fn((_options: unknown, task: (progress: { report: () => void }) => unknown) =>
      task({ report: () => {} }),
    ),
    createStatusBarItem: vi.fn(() => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })),
    registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    executeCommand: vi.fn(() => Promise.resolve(undefined)),
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  tasks: {
    executeTask: vi.fn(() => Promise.resolve({})),
    onDidEndTaskProcess: vi.fn(() => ({ dispose: vi.fn() })),
  },
  env: {
    openExternal: vi.fn(() => Promise.resolve(true)),
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath, scheme: 'file' }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({ fsPath: path.join(base.fsPath, ...segments) }),
  },
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  TaskScope: { Global: 1, Workspace: 2 },
  TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
  TaskPanelKind: { Shared: 1, Dedicated: 2, New: 3 },
  ThemeIcon: class ThemeIcon {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  TreeItem: class TreeItem {
    label: string;
    collapsibleState: number;
    constructor(label: string, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState ?? 0;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class EventEmitter {
    event = vi.fn();
    fire = vi.fn();
  },
  Task: class Task {
    args: unknown[];
    presentationOptions: unknown;
    constructor(...args: unknown[]) {
      this.args = args;
    }
  },
  ShellExecution: class ShellExecution {
    args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
    }
  },
};

/**
 * USAGE — each test file that (transitively) imports something which imports
 * 'vscode' must register the mock itself, at the top of the file, using this
 * exact shape (vi.mock calls are hoisted by vitest's static analysis, which
 * only recognizes a literal `vi.mock(...)` call — wrapping it in a helper
 * function here would silently defeat the hoisting):
 *
 *   import { vi } from 'vitest';
 *   vi.mock('vscode', async () => {
 *     const { vscodeMock } = await import('./vscodeMock'); // adjust relative path
 *     return vscodeMock;
 *   });
 *   import { vscodeMock, resetVscodeMock, setWorkspaceFolders, getLastPanel } from './vscodeMock';
 *   import { buildOverviewTab } from '../../src/webview/catalogTabs/overviewTab';
 *
 * The dynamic import() inside the factory (rather than a static import binding)
 * sidesteps temporal-dead-zone ordering issues between the hoisted vi.mock call
 * and this module's own top-level exports.
 */
