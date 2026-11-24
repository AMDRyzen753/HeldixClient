import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { LogLine } from '../../shared/api';
import { GameLogParser } from './gamelog';
import type { LauncherPaths } from './paths';
import { flattenArguments } from './rules';
import type { ResolvedVersion } from './types';

export interface GameAccount {
  name: string;
  /** UUID ohne Bindestriche */
  uuid: string;
  accessToken: string;
  xuid?: string;
  userType: 'msa' | 'legacy';
}

export interface LaunchContext {
  paths: LauncherPaths;
  version: ResolvedVersion;
  javaPath: string;
  classpath: string[];
  gameDir: string;
  nativesDir: string;
  /** Wert für ${game_assets} (nur sehr alte Versionen) */
  legacyAssetsDir: string;
  loggingConfig: string | null;
  account: GameAccount;
  memoryMb: number;
  resolution: { width: number; height: number } | null;
  extraJvmArgs: string[];
  launcherName: string;
  launcherVersion: string;
}

/** Baut die komplette Java-Kommandozeile für Minecraft. */
export function buildLaunchArguments(ctx: LaunchContext): string[] {
  const { version, account } = ctx;
  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: ctx.resolution != null,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };

  const vars: Record<string, string> = {
    auth_player_name: account.name,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_session: `token:${account.accessToken}:${account.uuid}`,
    auth_xuid: account.xuid ?? '0',
    clientid: '',
    user_type: account.userType,
    user_properties: '{}',
    version_name: version.id,
    version_type: version.type,
    game_directory: ctx.gameDir,
    assets_root: ctx.paths.assets,
    game_assets: ctx.legacyAssetsDir,
    assets_index_name: version.assetIndex?.id ?? version.assets ?? 'legacy',
    natives_directory: ctx.nativesDir,
    library_directory: ctx.paths.libraries,
    classpath: ctx.classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    launcher_name: ctx.launcherName,
    launcher_version: ctx.launcherVersion,
    resolution_width: String(ctx.resolution?.width ?? 854),
    resolution_height: String(ctx.resolution?.height ?? 480),
  };
  const fill = (arg: string) => arg.replace(/\$\{([a-zA-Z_]+)\}/g, (match, key: string) => vars[key] ?? match);

  const jvm = flattenArguments(version.arguments?.jvm, features);
  if (!jvm.some((arg) => arg.includes('${classpath}'))) {
    // Alte Versionen (vor 1.13) bringen keine JVM-Argumente mit
    jvm.unshift('-Djava.library.path=${natives_directory}', '-cp', '${classpath}');
    if (process.platform === 'win32') {
      jvm.unshift('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    }
  }

  let game: string[];
  if (version.minecraftArguments) {
    game = [...version.minecraftArguments.split(' ').filter(Boolean), ...flattenArguments(version.arguments?.game, features)];
    if (ctx.resolution) game.push('--width', '${resolution_width}', '--height', '${resolution_height}');
  } else {
    game = flattenArguments(version.arguments?.game, features);
  }

  const args = [`-Xmx${ctx.memoryMb}M`, `-Xms${Math.min(ctx.memoryMb, 512)}M`, ...jvm.map(fill)];
  if (ctx.loggingConfig && version.logging?.client) {
    args.push(version.logging.client.argument.replace('${path}', ctx.loggingConfig));
  }
  args.push(...ctx.extraJvmArgs, version.mainClass, ...game.map(fill));
  return args;
}

export interface RunningGame {
  process: ChildProcess;
  exited: Promise<number | null>;
}

/** Startet Minecraft und leitet die Log-Ausgabe zeilenweise an onLog weiter. */
export function startGame(javaPath: string, args: string[], gameDir: string, onLog: (lines: LogLine[]) => void): RunningGame {
  const child = spawn(javaPath, args, {
    cwd: gameDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  const stdout = new GameLogParser('INFO');
  const stderr = new GameLogParser('ERROR');
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    const lines = stdout.push(chunk);
    if (lines.length) onLog(lines);
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    const lines = stderr.push(chunk);
    if (lines.length) onLog(lines);
  });

  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      const rest = [...stdout.flush(), ...stderr.flush()];
      if (rest.length) onLog(rest);
      resolve(code);
    });
  });
  return { process: child, exited };
}
