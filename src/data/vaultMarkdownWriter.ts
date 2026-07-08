import { App, normalizePath, TFile, TFolder } from "obsidian";

import { upsertWordCardMarkdown } from "./markdownWriter";

const DEFAULT_CONTEXT_HASH = "default";

export async function writeWordCardToVault(
  app: App,
  targetPath: string,
  cardMarkdown: string,
  word: string,
  contextHash = DEFAULT_CONTEXT_HASH
): Promise<TFile> {
  const normalizedPath = normalizePath(targetPath);
  const existingFile = app.vault.getAbstractFileByPath(normalizedPath);

  if (existingFile instanceof TFolder) {
    throw new Error(`Word card target path is a folder: ${normalizedPath}`);
  }

  if (existingFile instanceof TFile) {
    const existingMarkdown = await app.vault.read(existingFile);
    const updatedMarkdown = upsertWordCardMarkdown(existingMarkdown, cardMarkdown, word, contextHash);
    await app.vault.modify(existingFile, updatedMarkdown);
    return existingFile;
  }

  await ensureParentFolders(app, normalizedPath);
  return app.vault.create(normalizedPath, upsertWordCardMarkdown("", cardMarkdown, word, contextHash));
}

async function ensureParentFolders(app: App, filePath: string): Promise<void> {
  const folderParts = filePath.split("/").slice(0, -1).filter(Boolean);
  let currentPath = "";

  for (const folderPart of folderParts) {
    currentPath = currentPath ? `${currentPath}/${folderPart}` : folderPart;

    const existing = app.vault.getAbstractFileByPath(currentPath);
    if (existing instanceof TFolder) continue;

    if (existing instanceof TFile) {
      throw new Error(`Cannot create folder because a file exists at: ${currentPath}`);
    }

    await app.vault.createFolder(currentPath);
  }
}
