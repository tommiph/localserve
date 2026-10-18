/** Registry commands may identify only this fixture's own numbered uninstaller.
 * Arguments are supplied separately; no registry command is passed to a shell. */
import path from 'node:path';

export function ownedUninstaller(command,installation) {
  const match=typeof command==='string' && /^"([^"\0\r\n]+)"$/.exec(command.trim());
  if (!match || !path.isAbsolute(match[1])) throw new Error('Invalid uninstaller registration.');
  const file=path.resolve(match[1]);
  const directory=path.resolve(installation,'uninstall');
  if (path.dirname(file).toLowerCase()!==directory.toLowerCase()
    || !/^unins\d{3}\.exe$/i.test(path.basename(file))) {
    throw new Error('Uninstaller registration does not belong to this test installation.');
  }
  return file;
}
