import { executeGeneration } from './generate';

export async function updateCommand(requestedRoot?: string): Promise<void> {
  await executeGeneration('Update', requestedRoot);
}
