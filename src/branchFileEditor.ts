import * as vscode from "vscode";
import { ReviewStore } from "./reviewStore";
import { BranchFileContent } from "./reviewTypes";

interface CachedBranchFile {
  contents: Uint8Array;
  updatedAt: number;
}

export class BranchFileEditor implements vscode.FileSystemProvider, vscode.Disposable {
  readonly scheme = "gitlab-review";

  private readonly files = new Map<string, CachedBranchFile>();
  private readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  constructor(private readonly store: ReviewStore) {}

  async open(branch: string, filePath: string): Promise<void> {
    try {
      const file = await this.store.loadBranchFile(branch, filePath);
      const uri = this.toUri(file);
      this.files.set(uri.toString(), {
        contents: new TextEncoder().encode(file.content),
        updatedAt: Date.now()
      });
      this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);

      const document = await vscode.workspace.openTextDocument(uri);
      const languageDocument = await vscode.languages.setTextDocumentLanguage(document, file.language);
      await vscode.window.showTextDocument(languageDocument, {
        preview: true,
        viewColumn: vscode.ViewColumn.One
      });
    } catch {
      void vscode.window.showErrorMessage(`ブランチ上の ${filePath} を開けませんでした。`);
    }
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const file = this.getFile(uri);
    return {
      type: vscode.FileType.File,
      ctime: file.updatedAt,
      mtime: file.updatedAt,
      size: file.contents.byteLength
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions("Branch files are opened directly from the review tree.");
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("Branch files are read-only.");
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return this.getFile(uri).contents;
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("Branch files are read-only.");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Branch files are read-only.");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Branch files are read-only.");
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  dispose(): void {
    this.onDidChangeFileEmitter.dispose();
    this.files.clear();
  }

  private toUri(file: BranchFileContent): vscode.Uri {
    return vscode.Uri.from({
      scheme: this.scheme,
      authority: file.projectId,
      path: `/${file.branch}/${file.path}`
    });
  }

  private getFile(uri: vscode.Uri): CachedBranchFile {
    const file = this.files.get(uri.toString());
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    return file;
  }
}
