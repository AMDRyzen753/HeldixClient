package dev.heldixclient.account;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.PatchException;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Konto-Wechsel: nimmt {@code final} von den Feldern in {@code Minecraft}, die an der angemeldeten Sitzung hängen,
 * damit {@link SessionSwitcher} sie neu setzen kann (Spieler, Dienste von Mojang, Chat-Signatur, Telemetrie, Freunde,
 * Realms). Sonst ändert sich nichts an der Klasse.
 *
 * <p>Läuft auf dem Heldix Loader und in Fabric (Minecraft steht dort schon in den Zielen der Brücke,
 * {@code heldix-loader-fabric/.../Targets.MINECRAFT}). Fehlt ein Feld (andere Minecraft-Version), bleibt die Klasse
 * unverändert und der Loader meldet es; der Konto-Wechsel meldet sich dann als nicht verfügbar.
 *
 * <p>Wie alle Transformer: keine Minecraft-Klassen benutzen, nur ihre Namen als Text.
 */
public final class AccountPatches implements ClassTransformer, Opcodes {
	static final String MINECRAFT = "net/minecraft/client/Minecraft";

	/** Felder in Minecraft, die beim Wechsel ersetzt werden (reportingContext ist schon veränderlich) */
	static final List<String> FIELDS = List.of(
			"user",
			"userApiService",
			"userPropertiesFuture",
			"profileFuture",
			"profileKeyPairManager",
			"telemetryManager",
			"playerSocialManager",
			"remoteFriendListUpdateHandler",
			"realmsDataFetcher");

	@Override
	public Set<String> targets() {
		return Set.of(MINECRAFT);
	}

	@Override
	public void transform(String className, ClassNode node) {
		// erst alles prüfen, dann ändern: in Fabric gibt es kein Zurück (die Klasse wird an Ort und Stelle verändert)
		List<FieldNode> found = new ArrayList<>();
		List<String> missing = new ArrayList<>();
		for (String name : FIELDS) {
			FieldNode field = node.fields.stream().filter(f -> f.name.equals(name) && (f.access & ACC_STATIC) == 0).findFirst().orElse(null);
			if (field == null) missing.add(name);
			else found.add(field);
		}
		if (!missing.isEmpty()) throw new PatchException("Konto-Wechsel: Felder in Minecraft fehlen: " + String.join(", ", missing));
		for (FieldNode field : found) field.access &= ~ACC_FINAL;
	}
}
