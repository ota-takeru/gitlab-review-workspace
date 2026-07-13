import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GlabCommandResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  reason?: "failed" | "timeout" | "too-large";
}

export interface GlabBinaryCommandResult {
  ok: boolean;
  stdout: Buffer;
}

export function runGlab(
  args: string[],
  timeout = 20_000,
  maxBuffer = 32 * 1024 * 1024
): Promise<GlabCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("glab", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (result: GlabCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const stopForSize = () => {
      child.kill();
      finish({
        ok: false,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        reason: "too-large"
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBuffer) {
        stopForSize();
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 1024 * 1024) stderr.push(Buffer.from(chunk));
    });
    child.on("error", () => finish({ ok: false, stdout: "", reason: "failed" }));
    child.on("close", (code) => finish({
      ok: code === 0,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      reason: code === 0 ? undefined : "failed"
    }));

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        reason: "timeout"
      });
    }, timeout);
  });
}

export async function runGlabBinary(
  args: string[],
  timeout = 20_000,
  maxBuffer = 11 * 1024 * 1024
): Promise<GlabBinaryCommandResult> {
  try {
    const result = await execFileAsync("glab", args, {
      timeout,
      maxBuffer,
      encoding: "buffer",
      windowsHide: true
    });
    return { ok: true, stdout: Buffer.from(result.stdout) };
  } catch {
    return { ok: false, stdout: Buffer.alloc(0) };
  }
}
