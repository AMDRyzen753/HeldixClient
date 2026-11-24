import os from 'node:os';
import path from 'node:path';

export interface LauncherPaths {
  root: string;
  versions: string;
  libraries: string;
  assets: string;
  runtime: string;
  instances: string;
  natives: string;
  cache: string;
}

/** Standard-Datenordner, z. B. %APPDATA%\.heldixclient unter Windows. */
export function defaultDataRoot(dirName: string): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), dirName);
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', dirName.replace(/^\./, ''));
  }
  return path.join(home, dirName);
}

export function createPaths(root: string): LauncherPaths {
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
    instances: path.join(root, 'instances'),
    natives: path.join(root, 'natives'),
    cache: path.join(root, 'cache'),
  };
}
