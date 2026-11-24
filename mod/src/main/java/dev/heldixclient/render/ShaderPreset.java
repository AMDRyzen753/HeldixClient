package dev.heldixclient.render;

import dev.heldixclient.HeldixClient;
import net.minecraft.resources.Identifier;

/**
 * Die eingebauten Shader-Stile. Jeder Stil ist ein Post-Effekt aus den Ressourcen der Mod
 * (assets/heldixclient/post_effect/&lt;key&gt;.json) und nutzt den Shader post/grade.fsh.
 * Läuft mit Vulkan und OpenGL, weil Minecraft die Shader für beide Backends übersetzt.
 */
public enum ShaderPreset {
	OFF("aus", "Aus", "Originale Minecraft-Farben"),
	KLAR("klar", "Klar", "Schärfer, etwas mehr Kontrast – gut für PvP"),
	LEBENDIG("lebendig", "Lebendig", "Kräftige Farben, leichte Vignette"),
	KINO("kino", "Kino", "Starker Kontrast und dunkle Ränder"),
	WARM("warm", "Warm", "Goldene, warme Töne"),
	KUEHL("kuehl", "Kühl", "Bläuliche, kühle Töne"),
	HELL("hell", "Hell", "Hellt dunkle Bereiche auf"),
	SCHWARZWEISS("schwarzweiss", "Schwarzweiß", "Klassische Graustufen"),
	RETRO("retro", "Retro", "Sepia und weniger Farbstufen");

	private final String key;
	private final String label;
	private final String description;

	ShaderPreset(String key, String label, String description) {
		this.key = key;
		this.label = label;
		this.description = description;
	}

	public String key() {
		return key;
	}

	public String label() {
		return label;
	}

	public String description() {
		return description;
	}

	/** Post-Effekt dieses Stils, null bei {@link #OFF}. */
	public Identifier effect() {
		return this == OFF ? null : Identifier.fromNamespaceAndPath(HeldixClient.MOD_ID, key);
	}

	public static ShaderPreset byKey(String key) {
		for (ShaderPreset preset : values()) {
			if (preset.key.equals(key)) return preset;
		}
		return OFF;
	}
}
