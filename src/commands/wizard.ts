/**
 * Minimal multi-step input controller for guided flows.
 *
 * Modeled on the canonical VS Code multi-step sample: each step can go Back
 * (QuickInputButtons.Back), Next, or Cancel. Steps are authored as async
 * functions that call {@link MultiStepInput.showInputBox} or
 * {@link MultiStepInput.showQuickPick} and return the next step, or undefined to
 * finish. Throwing {@link FlowCancelled} aborts the whole flow cleanly.
 */
import * as vscode from 'vscode';

export class FlowCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'FlowCancelled';
  }
}

export type InputStep = (input: MultiStepInput) => Promise<InputStep | void>;

export interface QuickPickParameters<T extends vscode.QuickPickItem> {
  title: string;
  step: number;
  totalSteps: number;
  items: T[];
  activeItem?: T;
  placeholder: string;
}

export interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  prompt: string;
  password?: boolean;
  validate: (value: string) => Promise<string | undefined> | string | undefined;
}

export class MultiStepInput {
  private current?: vscode.QuickInput;

  static async run(start: InputStep): Promise<boolean> {
    const input = new MultiStepInput();
    try {
      await input.stepThrough(start);
      return true;
    } catch (error) {
      if (error instanceof FlowCancelled) return false;
      throw error;
    } finally {
      input.current?.dispose();
    }
  }

  private async stepThrough(start: InputStep): Promise<void> {
    let step: InputStep | void = start;
    const history: InputStep[] = [];
    while (step) {
      history.push(step);
      try {
        step = await step(this);
      } catch (error) {
        if (error === MultiStepInput.BackSignal) {
          history.pop();
          step = history.pop();
          if (!step) throw new FlowCancelled();
        } else {
          throw error;
        }
      }
    }
  }

  static readonly BackSignal = Symbol('back');

  async showQuickPick<T extends vscode.QuickPickItem>(parameters: QuickPickParameters<T>): Promise<T> {
    return this.show((resolve, reject) => {
      const picker = vscode.window.createQuickPick<T>();
      picker.title = parameters.title;
      picker.step = parameters.step;
      picker.totalSteps = parameters.totalSteps;
      picker.placeholder = parameters.placeholder;
      picker.items = parameters.items;
      if (parameters.activeItem) picker.activeItems = [parameters.activeItem];
      picker.ignoreFocusOut = true;
      picker.buttons = parameters.step > 1 ? [vscode.QuickInputButtons.Back] : [];
      picker.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) reject(MultiStepInput.BackSignal);
      });
      picker.onDidAccept(() => {
        if (picker.selectedItems[0]) resolve(picker.selectedItems[0]);
      });
      picker.onDidHide(() => reject(new FlowCancelled()));
      return picker;
    });
  }

  async showInputBox(parameters: InputBoxParameters): Promise<string> {
    return this.show((resolve, reject) => {
      const box = vscode.window.createInputBox();
      box.title = parameters.title;
      box.step = parameters.step;
      box.totalSteps = parameters.totalSteps;
      box.value = parameters.value;
      box.prompt = parameters.prompt;
      box.password = parameters.password ?? false;
      box.ignoreFocusOut = true;
      box.buttons = parameters.step > 1 ? [vscode.QuickInputButtons.Back] : [];
      let validating: Promise<string | undefined> = Promise.resolve(undefined);
      box.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) reject(MultiStepInput.BackSignal);
      });
      box.onDidChangeValue(async (text) => {
        const currentValidation = Promise.resolve(parameters.validate(text));
        validating = currentValidation;
        const message = await currentValidation;
        if (validating === currentValidation) box.validationMessage = message ?? '';
      });
      box.onDidAccept(async () => {
        const value = box.value;
        box.enabled = false;
        box.busy = true;
        const message = await Promise.resolve(parameters.validate(value));
        if (!message) resolve(value);
        else box.validationMessage = message;
        box.enabled = true;
        box.busy = false;
      });
      box.onDidHide(() => reject(new FlowCancelled()));
      return box;
    });
  }

  private async show<T>(create: (resolve: (value: T) => void, reject: (reason: unknown) => void) => vscode.QuickInput): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.current?.dispose();
      const input = create(resolve, reject);
      this.current = input;
      input.show();
    });
  }
}
