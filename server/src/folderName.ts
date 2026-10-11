/** Derive a readable folder name from the Claude project dir hash. Shared by adopted agents and the token ledger so
 *  `areaMappings` keys match both. */
export function folderNameFromProjectDir(dirName: string): string {
  const parts = dirName.replace(/^-+/, '').split('-');
  return parts[parts.length - 1] || dirName;
}
