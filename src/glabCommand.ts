import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GlabCommandResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
}

export interface GlabBinaryCommandResult {
  ok: boolean;
  stdout: Buffer;
}

export async function runGlab(args: string[], timeout = 20_000): Promise<GlabCommandResult> {
  try {
    const result = await execFileAsync("glab", args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const commandError = error as { stdout?: unknown; stderr?: unknown };
    return {
      ok: false,
      stdout: typeof commandError.stdout === "string" ? commandError.stdout : "",
      stderr: typeof commandError.stderr === "string" ? commandError.stderr : ""
    };
  }
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
