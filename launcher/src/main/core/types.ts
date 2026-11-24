// Formate der Mojang-/Fabric-Versionsdateien (versions/<id>/<id>.json)

export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; version?: string; arch?: string };
  features?: Record<string, boolean>;
}

export type Argument = string | { rules?: Rule[]; value: string | string[] };

export interface Artifact {
  path?: string;
  sha1?: string;
  size?: number;
  url: string;
}

export interface Library {
  name: string;
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> };
  /** Maven-Repository (Fabric-Stil, ohne downloads-Block) */
  url?: string;
  sha1?: string;
  size?: number;
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
  rules?: Rule[];
}

export interface VersionJson {
  id: string;
  type: string;
  mainClass: string;
  inheritsFrom?: string;
  jar?: string;
  minecraftArguments?: string;
  arguments?: { game?: Argument[]; jvm?: Argument[] };
  assetIndex?: { id: string; sha1: string; size: number; totalSize?: number; url: string };
  assets?: string;
  downloads?: { client?: Artifact; [key: string]: Artifact | undefined };
  javaVersion?: { component: string; majorVersion: number };
  libraries: Library[];
  logging?: {
    client?: {
      argument: string;
      file: { id: string; sha1: string; size: number; url: string };
      type: string;
    };
  };
}

/** Version mit aufgelöster Vererbung (z. B. Fabric-Profil + Vanilla). */
export interface ResolvedVersion extends VersionJson {
  /** ID der Version, deren client.jar verwendet wird */
  jarId: string;
  /** Die eigentliche Minecraft-Version (Wurzel der Vererbung) */
  baseId: string;
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  virtual?: boolean;
  map_to_resources?: boolean;
}
