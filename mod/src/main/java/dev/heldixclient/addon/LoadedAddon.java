package dev.heldixclient.addon;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.loader.api.LoaderAddon;
import dev.heldixclient.module.Module;
import dev.heldixclient.ui.Ui;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Ein Heldix-Addon aus heldix-addons/ samt Zustand. */
public final class LoadedAddon {
	/** ACTIVE = läuft, FAILED = Fehler (Grund in error()), DISABLED = ausgeschaltet (.jar.disabled oder im Menü aus) */
	public enum State { ACTIVE, FAILED, DISABLED }

	final Path file;
	AddonMetadata metadata;
	State state = State.FAILED;
	String error;
	HeldixAddon instance;
	/** eigener URLClassLoader (reine API-Addons) bzw. der des Heldix Loaders (Addons mit Zugriff auf Minecraft) */
	ClassLoader classLoader;
	/** Sicht des Heldix Loaders auf ein Addon mit Zugriff auf Minecraft (sonst null) */
	LoaderAddon loaderAddon;
	AddonContext context;
	/** API 3: erst beim ersten Aufruf von scheduler() angelegt */
	AddonScheduler scheduler;
	final List<Module> modules = new ArrayList<>();
	int errorCount;

	LoadedAddon(Path file) {
		this.file = file;
	}

	public boolean isActive() {
		return state == State.ACTIVE;
	}

	public State state() {
		return state;
	}

	public String error() {
		return error;
	}

	public String fileName() {
		return file.getFileName().toString();
	}

	/** Pfad der JAR beim Start (abgeschaltete enden auf .jar.disabled) */
	public Path file() {
		return file;
	}

	public String name() {
		return metadata != null ? metadata.displayName() : fileName();
	}

	public String version() {
		return metadata != null ? metadata.version : "?";
	}

	public String description() {
		return metadata != null ? metadata.description : "";
	}

	public List<String> authors() {
		return metadata != null && metadata.authors != null ? metadata.authors : List.of();
	}

	/** Im Addon-Store entfernt – die Datei verschwindet beim nächsten Start */
	public boolean pendingRemoval() {
		return AddonStore.pendingRemoval(fileName());
	}

	/** ID aus der heldix.addon.json (null, wenn sie nicht lesbar war) */
	public String id() {
		return metadata != null ? metadata.id : null;
	}

	public int moduleCount() {
		return modules.size();
	}

	/** Fehler zur Laufzeit bisher (ab drei wird das Addon abgeschaltet) */
	public int errorCount() {
		return errorCount;
	}

	/** Die API, wie das Addon sie sieht (null, wenn es nicht geladen wurde oder keinen entrypoint hat) – z. B. für den Autotest */
	public dev.heldixclient.api.HeldixApi api() {
		return context;
	}

	// --- Version 2: Zugriff auf Minecraft ------------------------------------------------------

	/** Greift das Addon direkt in Minecraft ein (clientEntrypoint oder transformers)? Chip „Greift in Minecraft ein“ */
	public boolean minecraftAccess() {
		return metadata != null && metadata.minecraftAccess();
	}

	/** Was der Heldix Loader zu diesem Addon weiß (null = kein Addon mit Zugriff auf Minecraft) */
	public LoaderAddon loaderAddon() {
		return loaderAddon;
	}

	/** Classloader des Addons (null = nicht geladen); bei Zugriff auf Minecraft derselbe wie im Heldix Loader */
	public ClassLoader classLoader() {
		return classLoader;
	}

	/** Die HeldixAddon-Instanz (null ohne entrypoint oder wenn sie nicht geladen wurde) – für den Autotest */
	public HeldixAddon instance() {
		return instance;
	}

	/** Läuft etwas vom Addon im Spiel, das sich nicht abschalten lässt (Transformer, clientEntrypoint)? */
	public boolean runsInMinecraft() {
		return loaderAddon != null && loaderAddon.loaded();
	}

	/**
	 * Probleme, die der Heldix Loader während des Spiels meldet (z. B. ein gescheiterter Eingriff in eine Klasse,
	 * nachdem das Addon schon lief); leer, wenn alles passt.
	 */
	public List<String> loaderProblems() {
		return loaderAddon != null && loaderAddon.active() ? loaderAddon.problems() : List.of();
	}

	/** An im Menü bzw. im Launcher, also beim nächsten Start geladen? (Datei .jar, nicht zum Ausschalten vorgemerkt) */
	public boolean switchedOn() {
		return AddonFiles.switchedOn(this);
	}

	/** Weicht der Schalter vom laufenden Zustand ab? Dann „Wirkt nach dem Neustart“. */
	public boolean restartNeeded() {
		return switchedOn() != (state != State.DISABLED);
	}

	/** Icon für die Liste: aus dem Addon-Store, sonst das eigene Icon des ersten Moduls, sonst das Puzzleteil */
	public String icon() {
		String id = id();
		if (id != null) {
			for (AddonStore.Entry entry : AddonStore.entries()) {
				if (entry.id().equals(id) && Ui.hasIcon(entry.icon()) && !"addons".equals(entry.icon())) return entry.icon();
			}
		}
		for (Module module : modules) {
			String icon = module.icon();
			if (icon != null && !"addons".equals(icon)) return icon;
		}
		return "addons";
	}
}
