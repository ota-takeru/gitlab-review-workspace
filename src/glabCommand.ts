import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GlabCommandResult {
  ok: boolean;
  stdout: string;
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
    return { ok: true, stdout: result.stdout };
  } catch {
    return { ok: false, stdout: "" };
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
