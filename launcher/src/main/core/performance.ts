// Leistung beim Spielstart: Grafik-API (Vulkan) und abgestimmte JVM-Einstellungen.

import AdmZip from 'adm-zip';
import type { GraphicsApi } from '../../shared/api';

/** Klasse, an der man Minecraft-Versionen mit wählbarer Grafik-API (Vulkan-Backend) erkennt */
const VULKAN_BACKEND_CLASS = 'com/mojang/renderpearl/backend/vulkan/VulkanBackend.class';
const vulkanSupport = new Map<string, boolean>();

/** true, wenn diese Client-JAR ein Vulkan-Backend hat und damit --graphicsBackend versteht (ab 26.x). */
export function supportsGraphicsApi(clientJar: string): boolean {
  let supported = vulkanSupport.get(clientJar);
  if (supported === undefined) {
    try {
      supported = new AdmZip(clientJar).getEntry(VULKAN_BACKEND_CLASS) != null;
    } catch {
      supported = false;
    }
    vulkanSupport.set(clientJar, supported);
  }
  return supported;
}

/**
 * Spielargumente für die Grafik-API. Mit "--graphicsBackend vulkan" probiert Minecraft zuerst Vulkan
 * und nimmt OpenGL, falls der PC kein Vulkan kann. "default" überlässt Minecraft die Wahl.
 */
export function graphicsArguments(api: GraphicsApi, clientJar: string): string[] {
  if (api === 'default' || !supportsGraphicsApi(clientJar)) return [];
  return ['--graphicsBackend', api];
}

/** Hat der Spieler in seinen JVM-Argumenten schon selbst einen Garbage Collector oder Heap-Optionen gewählt? */
function choosesOwnGc(userArgs: string[]): boolean {
  return userArgs.some((arg) => /^-XX:[+-]Use\w*GC$/.test(arg) || arg.startsWith('-XX:G1') || arg.startsWith('-XX:MaxGCPauseMillis'));
}

/**
 * Abgestimmte JVM-Einstellungen:
 * - G1 mit den Werten des offiziellen Launchers: kürzere GC-Pausen, also weniger Ruckler
 * - kompakte Objekt-Header ab Java 25 (JEP 519): weniger Speicher, weniger GC-Arbeit
 * Unbekanntes Java (eigener Pfad) bekommt nur Flags, die jede Version seit Java 8 versteht.
 */
export function tunedJvmArguments(javaMajor: number | null, userArgs: string[]): string[] {
  if (choosesOwnGc(userArgs)) return [];
  const args = [
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:MaxGCPauseMillis=50',
    '-XX:G1HeapRegionSize=32M',
    '-XX:+ParallelRefProcEnabled',
  ];
  if (javaMajor != null && javaMajor >= 25 && !userArgs.some((a) => a.includes('CompactObjectHeaders'))) {
    args.push('-XX:+UseCompactObjectHeaders');
  }
  return args;
}

/** Erkennt im Spiel-Log, welche Grafik-API Minecraft tatsächlich benutzt. */
export class GraphicsWatch {
  /** "Vulkan", "OpenGL" … sobald Minecraft das Grafikgerät erstellt hat */
  backend: string | null = null;
  /** Minecraft hat angefangen, die Grafik zu starten */
  starting = false;

  constructor(readonly requested: GraphicsApi) {}

  push(text: string): void {
    if (/Backend library: /.test(text)) this.starting = true;
    const match = /Using graphics backend (\w+)/.exec(text);
    if (match) this.backend = match[1];
  }

  /** Vulkan war gewünscht, der PC hat aber auf OpenGL zurückgeschaltet */
  get fellBack(): boolean {
    return this.requested === 'vulkan' && this.backend != null && !/vulkan/i.test(this.backend);
  }

  /** Spiel ist beim Starten der Grafik abgestürzt, während Vulkan erzwungen war */
  crashedDuringGraphicsStart(exitCode: number | null): boolean {
    return this.requested === 'vulkan' && exitCode !== 0 && this.starting && this.backend == null;
  }
}
