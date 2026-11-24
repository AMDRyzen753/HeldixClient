package dev.heldixclient.loader.api.transform;

/** Ein Patch konnte nicht angewendet werden, meist weil sich Minecraft geändert hat. */
public class PatchException extends RuntimeException {
	public PatchException(String message) {
		super(message);
	}
}
