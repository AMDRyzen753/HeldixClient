// Nachgebauter Session-Server für Skin-Tests: Profile mit textures und ein Host für Skin-Dateien (nur Loopback).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Kleines gültiges PNG (Signatur plus Füllbytes). */
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);

/** Nachgebauter Session-Server mit Profilen (textures) und einem Host für Skin-Dateien. */
export interface FakeSkins {
  url: string;
  /** Skin-Adresse pro UUID (wie in Mojangs textures-Eigenschaft) */
  skinUrls: Map<string, string>;
  /** Inhalt pro Pfad unter /texture/ */
  files: Map<string, { body: Buffer; chunked?: boolean }>;
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeSkins(): Promise<FakeSkins> {
  const skinUrls = new Map<string, string>();
  const files = new Map<string, { body: Buffer; chunked?: boolean }>();
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    requests.push(path);
    const profile = /^\/session\/minecraft\/profile\/([0-9a-f]{32})$/.exec(path);
    if (profile) {
      const url = skinUrls.get(profile[1]!);
      if (url === undefined) {
        res.writeHead(204).end();
        return;
      }
      const value = Buffer.from(JSON.stringify({ timestamp: 1, profileId: profile[1], textures: { SKIN: { url } } })).toString('base64');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: profile[1], name: 'X', properties: [{ name: 'textures', value }] }));
      return;
    }
    const file = files.get(path);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    if (file.chunked) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      // ohne Content-Length, in Stücken
      for (let i = 0; i < file.body.length; i += 16 * 1024) res.write(file.body.subarray(i, i + 16 * 1024));
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(file.body.length) }).end(file.body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    skinUrls,
    files,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
