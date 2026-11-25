package dev.heldixclient.addon;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.module.Module;

import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Ein vom Heldix Loader gefundenes Addon samt Zustand. */
public final class LoadedAddon {
	public enum State { ACTIVE, FAILED }

	final Path file;
	AddonMetadata metadata;
	State state = State.FAILED;
	String error;
	HeldixAddon instance;
	URLClassLoader classLoader;
	AddonContext context;
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

	/** Icon für die Addon-Liste: das eigene Icon des ersten Moduls, sonst das Puzzleteil */
	public String icon() {
		for (Module module : modules) {
			String icon = module.icon();
			if (!"addons".equals(icon) && !"cube".equals(icon)) return icon;
		}
		return "addons";
	}
}
