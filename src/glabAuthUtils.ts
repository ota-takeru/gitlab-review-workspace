export function getGitLabHostname(baseUrl: string): string | undefined {
  const value = baseUrl.trim();
  if (!value) {
    return "gitlab.com";
  }

  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
      return undefined;
    }

    return url.hostname;
  } catch {
    return undefined;
  }
}

export function glabLoginCommand(hostname: string): string {
  return `glab auth login --hostname ${hostname}`;
}
