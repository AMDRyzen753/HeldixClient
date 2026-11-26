package dev.heldixclient.loader.api;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Ein Heldix-Addon mit Zugriff auf Minecraft (heldix.addon.json mit {@code clientEntrypoint} oder {@code transformers}),
 * wie der Heldix Loader es beim Start gesehen hat. HeldixClient lädt danach den {@code entrypoint} des Addons über
 * {@link #classLoader()} und zeigt {@link #problems()} im Heldix-Menü an.
 */
public final class LoaderAddon {
	private final Path file;
	private final AddonManifest manifest;
	private final List<String> problems = new CopyOnWriteArrayList<>();
	private volatile ClassLoader classLoader;
	private volatile boolean failed;
	private volatile boolean heldixOnly;
	private volatile boolean started;

	public LoaderAddon(Path file, AddonManifest manifest) {
		this.file = file;
		this.manifest = manifest;
	}

	/** JAR im Ordner heldix-addons */
	public Path file() {
		return file;
	}

	public AddonManifest manifest() {
		return manifest;
	}

	public String id() {
		return manifest.id();
	}

	public String name() {
		return manifest.displayName();
	}

	public String version() {
		return manifest.version();
	}

	/** Liegt die JAR auf dem Classpath des Spiels (Transformer angemeldet)? */
	public boolean loaded() {
		return classLoader != null;
	}

	/** Geladen und ohne Fehler beim Laden der Transformer oder beim Start (clientEntrypoint)? */
	public boolean active() {
		return loaded() && !failed;
	}

	/** Lief der clientEntrypoint ohne Fehler (bzw. hat das Addon keinen)? */
	public boolean started() {
		return started;
	}

	/** In Fabric übersprungen, weil der Loader dort nicht alle Ziel-Klassen verändern kann („Läuft nur in Heldix-Instanzen“) */
	public boolean heldixOnly() {
		return heldixOnly;
	}

	/** Der Classloader, über den die Klassen des Addons geladen werden (null = nicht geladen) */
	public ClassLoader classLoader() {
		return classLoader;
	}

	/** Gründe, warum das Addon nicht (ganz) läuft: falsche Version, Transformer gescheitert, Fehler beim Start … */
	public List<String> problems() {
		return Collections.unmodifiableList(problems);
	}

	/** Erster Grund oder null */
	public String problem() {
		return problems.isEmpty() ? null : problems.getFirst();
	}

	// --- nur für den Loader -------------------------------------------------------------------

	/** @hidden */
	public void markLoaded(ClassLoader loader) {
		this.classLoader = loader;
	}

	/** @hidden Addon läuft nicht (weiter): Grund merken */
	public void fail(String reason) {
		failed = true;
		problems.add(reason);
	}

	/** @hidden Addon läuft, aber ein Teil fehlt (z. B. ein Eingriff in eine Klasse ist gescheitert) */
	public void warn(String reason) {
		problems.add(reason);
	}

	/** @hidden */
	public void markHeldixOnly(String reason) {
		heldixOnly = true;
		fail(reason);
	}

	/** @hidden */
	public void markStarted() {
		started = true;
	}
}
