import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { runGlab } from "./glabCommand";
import {
  getGitLabApiProtocol,
  getGitLabHostname,
  getGitLabLoginHostname,
  parseAuthenticatedGlabHosts,
  selectGitLabHost,
  type GitLabApiProtocol
} from "./glabAuthUtils";
import { normalizeGitLabRemoteUrl } from "./localGitUtils";

const execFileAsync = promisify(execFile);
const defaultGitLabBaseUrl = "https://gitlab.com";

export interface ResolvedGitLabHost {
  baseUrl: string;
  hostname: string;
  loginHostname: string;
  apiProtocol: GitLabApiProtocol;
  source: "setting" | "glab" | "remote" | "default";
}

export class GitLabHostResolver {
  private autoDetectedBaseUrl?: string;
  private resolutionPromise?: Promise<ResolvedGitLabHost | undefined>;

  constructor(
    private readonly workspaceRootProvider: () => string | undefined = () =>
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  ) {}

  getBaseUrl(): string {
    return this.getConfiguredBaseUrl() ?? this.autoDetectedBaseUrl ?? defaultGitLabBaseUrl;
  }

  async resolve(): Promise<ResolvedGitLabHost | undefined> {
    if (this.resolutionPromise) return this.resolutionPromise;
    this.resolutionPromise = this.resolveInternal().finally(() => {
      this.resolutionPromise = undefined;
    });
    return this.resolutionPromise;
  }

  private async resolveInternal(): Promise<ResolvedGitLabHost | undefined> {
    const configuredBaseUrl = this.getConfiguredBaseUrl();
    if (configuredBaseUrl) {
      this.autoDetectedBaseUrl = undefined;
      return resolveBaseUrl(configuredBaseUrl, "setting");
    }

    const [authResult, remoteUrl] = await Promise.all([
      runGlab(["auth", "status", "--all"], 10_000),
      this.readOriginRemote()
    ]);
    const authOutput = `${authResult.stdout}\n${authResult.stderr ?? ""}`;
    const authenticatedHosts = parseAuthenticatedGlabHosts(authOutput);
    const remoteBaseUrl = baseUrlFromRemote(remoteUrl);
    const remoteHost = remoteBaseUrl ? getGitLabHostname(remoteBaseUrl) : undefined;
    const authenticatedHost = selectGitLabHost(authenticatedHosts, remoteHost);

    let baseUrl = defaultGitLabBaseUrl;
    let source: ResolvedGitLabHost["source"] = "default";
    if (authenticatedHost) {
      baseUrl = `https://${authenticatedHost}`;
      source = "glab";
    } else if (remoteBaseUrl) {
      baseUrl = remoteBaseUrl;
      source = "remote";
    }

    this.autoDetectedBaseUrl = baseUrl;
    return resolveBaseUrl(baseUrl, source);
  }

  private async readOriginRemote(): Promise<string | undefined> {
    const workspaceRoot = this.workspaceRootProvider();
    if (!workspaceRoot) return undefined;

    try {
      const result = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: workspaceRoot,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsHide: true
      });
      return result.stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private getConfiguredBaseUrl(): string | undefined {
    const configuration = vscode.workspace.getConfiguration("gitlabReview");
    const inspected = configuration.inspect<string>("gitlabBaseUrl");
    const configuredValue = inspected?.workspaceFolderValue
      ?? inspected?.workspaceValue
      ?? inspected?.globalValue;
    return typeof configuredValue === "string" && configuredValue.trim() ? configuredValue : undefined;
  }
}

function resolveBaseUrl(baseUrl: string, source: ResolvedGitLabHost["source"]): ResolvedGitLabHost | undefined {
  const hostname = getGitLabHostname(baseUrl);
  const loginHostname = getGitLabLoginHostname(baseUrl);
  const apiProtocol = getGitLabApiProtocol(baseUrl);
  if (!hostname || !loginHostname || !apiProtocol) return undefined;
  return { baseUrl, hostname, loginHostname, apiProtocol, source };
}

function baseUrlFromRemote(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;

  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.protocol}//${parsed.host}`;
    }
    if (parsed.protocol === "ssh:" && parsed.hostname) {
      return `https://${parsed.hostname}`;
    }
  } catch {
    // Fall through to the scp-like remote parser.
  }

  const normalized = normalizeGitLabRemoteUrl(remoteUrl);
  return normalized ? `https://${normalized.hostname}` : undefined;
}
