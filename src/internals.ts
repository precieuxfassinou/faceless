import type { App } from 'obsidian';

/** Parties non documentées de l'application, typées au plus juste. */
export interface AppInternals {
  commands?: { executeCommandById(id: string): boolean };
  plugins?: { enabledPlugins?: Set<string>; getPlugin?(id: string): unknown };
}
export const internals = (app: App): AppInternals => app as unknown as AppInternals;
