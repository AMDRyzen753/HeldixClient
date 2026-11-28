// Platzhalter: wird vom Helfer „Welten-Wächter“ ersetzt (AgentRunner spricht über den Unix-Socket mit src/agent/).
// Der Dienst-Kern importiert nur diese Klasse; bis zur Umsetzung meldet jeder Aufruf, dass der Wächter fehlt.
import type { HostingRunner } from './runner';

export class AgentRunner implements Partial<HostingRunner> {
  constructor(readonly socketPath: string) {}
}
