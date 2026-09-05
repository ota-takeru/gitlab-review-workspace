import type { Memento } from "vscode";

/** Never attribute data from one GitLab instance to another, including subpaths. */
export function instanceStorage(storage: Memento, instanceUrl: string): Pick<Memento, "get" | "update"> {
  const prefix = `gitlabReview.instance.${encodeURIComponent(instanceUrl)}.`;
  return {
    get<T>(key: string, fallback?: T): T {
      return storage.get<T>(`${prefix}${key}`, fallback as T);
    },
    update: (key: string, value: unknown) => storage.update(`${prefix}${key}`, value)
  };
}
