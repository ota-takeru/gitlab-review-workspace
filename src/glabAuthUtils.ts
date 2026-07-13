export type GitLabApiProtocol = "https" | "http";

export function parseAuthenticatedGlabHosts(output: string): string[] {
  const hosts = new Set<string>();
  for (const match of output.matchAll(/Logged in to\s+(\S+)\s+as\b/g)) {
    const host = match[1]?.trim();
    if (host) hosts.add(host);
  }
  return [...hosts];
}

export function selectGitLabHost(
  authenticatedHosts: readonly string[],
  remoteHost?: string
): string | undefined {
  const normalizedRemoteHost = remoteHost?.toLowerCase();
  if (normalizedRemoteHost) {
    const matchingHost = authenticatedHosts.find((host) => host.split("/", 1)[0]?.toLowerCase() === normalizedRemoteHost);
    if (matchingHost) return matchingHost;
  }

  if (authenticatedHosts.length === 1) return authenticatedHosts[0];
  return authenticatedHosts.find((host) => host.split("/", 1)[0]?.toLowerCase() === "gitlab.com");
}

export function getGitLabHostname(baseUrl: string): string | undefined {
  return parseGitLabBaseUrl(baseUrl)?.host;
}

/**
 * Returns the hostname accepted by `glab auth login`.
 *
 * Recent glab versions accept an optional subfolder in this value, for
 * example `gitlab.example.com/gitlab`, and store the subfolder separately.
 */
export function getGitLabLoginHostname(baseUrl: string): string | undefined {
  const url = parseGitLabBaseUrl(baseUrl);
  if (!url) return undefined;

  const subfolder = url.pathname.replace(/^\/+|\/+$/g, "");
  return subfolder ? `${url.host}/${subfolder}` : url.host;
}

export function getGitLabApiProtocol(baseUrl: string): GitLabApiProtocol | undefined {
  const protocol = parseGitLabBaseUrl(baseUrl)?.protocol;
  return protocol === "http:" ? "http" : protocol === "https:" ? "https" : undefined;
}

export function glabLoginCommand(hostname: string, apiProtocol: GitLabApiProtocol = "https"): string {
  const protocolOption = apiProtocol === "http" ? " --api-protocol http" : "";
  return `glab auth login --hostname ${hostname}${protocolOption}`;
}

function parseGitLabBaseUrl(baseUrl: string): URL | undefined {
  const value = baseUrl.trim();
  const input = value ? (value.includes("://") ? value : `https://${value}`) : "https://gitlab.com";

  try {
    const url = new URL(input);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.host ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }

    return url;
  } catch {
    return undefined;
  }
}
