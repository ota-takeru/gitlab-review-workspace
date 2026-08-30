import * as vscode from "vscode";
import { runGlab } from "./glabCommand";
import { glabLoginCommand, type GitLabApiProtocol } from "./glabAuthUtils";
import { GitLabHostResolver } from "./gitlabHostResolver";

export type GlabAuthPhase = "checking" | "available" | "signedOut" | "unavailable";

export interface GlabAuthState {
  phase: GlabAuthPhase;
  hostname: string;
  version?: string;
  reason?: "invalidBaseUrl";
}

export class GlabAuthService implements vscode.Disposable {
  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<GlabAuthState>();
  private loginTerminal?: vscode.Terminal;
  private loginTerminalCloseListener?: vscode.Disposable;
  private loginHostname = "gitlab.com";
  private loginApiProtocol: GitLabApiProtocol = "https";
  private glabVersion?: string;
  private glabVersionOk = false;
  private glabVersionResolved = false;
  private glabVersionLoad?: Promise<string | undefined>;
  private state: GlabAuthState = {
    phase: "checking",
    hostname: "gitlab.com"
  };

  constructor(private readonly hostResolver = new GitLabHostResolver()) {}

  readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  getState(): GlabAuthState {
    return this.state;
  }

  async refreshStatus(): Promise<GlabAuthState> {
    const resolvedHost = await this.hostResolver.resolve();
    if (!resolvedHost) {
      this.loginHostname = "gitlab.com";
      this.loginApiProtocol = "https";
      this.setState({
        phase: "unavailable",
        hostname: "gitlab.com",
        reason: "invalidBaseUrl"
      });
      return this.state;
    }

    const { hostname } = resolvedHost;
    this.loginHostname = resolvedHost.loginHostname;
    this.loginApiProtocol = resolvedHost.apiProtocol;
    this.setState({ phase: "checking", hostname });

    const [version, status] = await Promise.all([
      this.getGlabVersion(),
      runGlab(["auth", "status", "--hostname", hostname], 10_000)
    ]);
    if (!this.glabVersionOk) {
      this.setState({ phase: "unavailable", hostname });
      return this.state;
    }

    this.setState({
      phase: status.ok ? "available" : "signedOut",
      hostname,
      version
    });
    return this.state;
  }

  async startLogin(): Promise<void> {
    const state = await this.refreshStatus();
    if (state.phase === "unavailable") {
      const detail =
        state.reason === "invalidBaseUrl"
          ? "GitLab Base URL setting is invalid."
          : "glab was not found on the VS Code extension host PATH.";
      void vscode.window.showErrorMessage(detail);
      return;
    }

    if (state.phase === "available") {
      void vscode.window.showInformationMessage(`Already signed in to ${state.hostname} with glab.`);
      return;
    }

    if (this.loginTerminal) {
      this.loginTerminal.show(true);
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: "GitLab CLI Login",
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    });
    this.loginTerminal = terminal;
    this.loginTerminalCloseListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal !== terminal) {
        return;
      }

      this.loginTerminal = undefined;
      this.loginTerminalCloseListener?.dispose();
      this.loginTerminalCloseListener = undefined;
      void this.refreshStatus();
    });

    terminal.show(true);
    terminal.sendText(glabLoginCommand(this.loginHostname, this.loginApiProtocol), true);
  }

  dispose(): void {
    this.loginTerminalCloseListener?.dispose();
    this.onDidChangeStateEmitter.dispose();
  }

  private setState(state: GlabAuthState): void {
    this.state = state;
    this.onDidChangeStateEmitter.fire(state);
  }

  private getGlabVersion(): Promise<string | undefined> {
    if (this.glabVersionResolved) return Promise.resolve(this.glabVersion);
    if (this.glabVersionLoad) return this.glabVersionLoad;

    let load: Promise<string | undefined>;
    load = runGlab(["--version"], 10_000)
      .then((result) => {
        this.glabVersionOk = result.ok;
        this.glabVersion = result.ok ? firstLine(result.stdout) : undefined;
        // Cache successful detection for the session, but retry transient failures.
        this.glabVersionResolved = result.ok;
        return this.glabVersion;
      })
      .finally(() => {
        if (this.glabVersionLoad === load) this.glabVersionLoad = undefined;
      });
    this.glabVersionLoad = load;
    return load;
  }
}

function firstLine(value: string): string | undefined {
  const line = value.trim().split(/\r?\n/, 1)[0];
  return line || undefined;
}
