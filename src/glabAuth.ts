import * as vscode from "vscode";
import { runGlab } from "./glabCommand";
import { getGitLabHostname, glabLoginCommand } from "./glabAuthUtils";

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
  private state: GlabAuthState = {
    phase: "checking",
    hostname: "gitlab.com"
  };

  readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  getState(): GlabAuthState {
    return this.state;
  }

  async refreshStatus(): Promise<GlabAuthState> {
    const hostname = getGitLabHostname(
      vscode.workspace.getConfiguration("gitlabReview").get<string>("gitlabBaseUrl", "https://gitlab.com")
    );

    if (!hostname) {
      this.setState({
        phase: "unavailable",
        hostname: "gitlab.com",
        reason: "invalidBaseUrl"
      });
      return this.state;
    }

    this.setState({ phase: "checking", hostname });

    const version = await runGlab(["--version"], 10_000);
    if (!version.ok) {
      this.setState({ phase: "unavailable", hostname });
      return this.state;
    }

    const status = await runGlab(["auth", "status", "--hostname", hostname], 10_000);
    this.setState({
      phase: status.ok ? "available" : "signedOut",
      hostname,
      version: firstLine(version.stdout)
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
    terminal.sendText(glabLoginCommand(state.hostname), true);
  }

  dispose(): void {
    this.loginTerminalCloseListener?.dispose();
    this.onDidChangeStateEmitter.dispose();
  }

  private setState(state: GlabAuthState): void {
    this.state = state;
    this.onDidChangeStateEmitter.fire(state);
  }
}

function firstLine(value: string): string | undefined {
  const line = value.trim().split(/\r?\n/, 1)[0];
  return line || undefined;
}
