export type State = 'queued' | 'running' | 'completed' | 'failed';
const transitions: Record<State, readonly State[]> = { queued: ['running'], running: ['completed', 'failed'], completed: [], failed: [] };
export function canTransition(from: State, to: State): boolean { return transitions[from].includes(to); }
