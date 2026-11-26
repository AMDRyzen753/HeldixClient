package dev.heldixclient.module.impl;

import dev.heldixclient.api.HudHover;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.HudPointer;
import dev.heldixclient.hud.HudStyles;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Draw;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * Position, Blickrichtung und Biom – kompakt in zwei Zeilen oder als Liste. Bei offenem Chat fügt ein Klick die
 * Block-Koordinaten in die Eingabe ein (Shift+Klick bzw. mit der Taste „HUD bedienen“: kopieren).
 */
public class CoordinatesModule extends HudModule {
	private static final List<String> LAYOUTS = List.of("Kompakt", "Zeilen");
	private static final String[] EIGHT = {"S", "SW", "W", "NW", "N", "NO", "O", "SO"};

	public CoordinatesModule() {
		super("coordinates", "Koordinaten", "Position, Richtung, Biom", true, 4, 58);
	}

	private record Place(double x, double y, double z, BlockPos block, String direction, String shortDirection, float yaw, String biome) {
	}

	private Place place(Minecraft mc) {
		LocalPlayer player = mc.player;
		if (player == null) {
			if (!isPreviewing()) return null;
			return new Place(128.5, 64, -342.3, new BlockPos(128, 64, -343), "Nord (-Z)", "N", 180, "Ebene");
		}
		float yaw = net.minecraft.util.Mth.wrapDegrees(player.getYRot());
		int sector = Math.floorMod(Math.round(yaw / 45f), 8);
		return new Place(player.getX(), player.getY(), player.getZ(), player.blockPosition(), direction(player), EIGHT[sector], yaw, biome(mc, player.blockPosition()));
	}

	private String format(double value) {
		int decimals = Math.clamp((int) option("decimals", 1.0), 0, 2);
		return String.format("%." + decimals + "f", value);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		Place place = place(mc);
		if (place == null) return size(0, 0);
		boolean showDirection = option("direction", true);
		boolean showBiome = option("biome", true);
		if ((int) option("layout", 0.0) == 1) {
			List<String[]> rows = new ArrayList<>();
			rows.add(new String[] {"XYZ", format(place.x()) + "  " + format(place.y()) + "  " + format(place.z())});
			if (showDirection) rows.add(new String[] {"Richtung", place.direction()});
			if (showBiome) rows.add(new String[] {"Biom", place.biome()});
			return drawLabelValues(g, mc.font, x, y, rows.toArray(new String[0][]));
		}

		// kompakt: „X 128,5  Y 64,0  Z -342,3“, darunter „N · Nord (-Z) · Ebene“
		HudStyles.Resolved s = HudStyles.current();
		String[] labels = {"X", "Y", "Z"};
		String[] values = {format(place.x()), format(place.y()), format(place.z())};
		int line1 = 0;
		for (int i = 0; i < 3; i++) line1 += HudStyles.width(labels[i], true) + 3 + HudStyles.width(values[i], false) + (i < 2 ? 7 : 0);
		List<String> second = new ArrayList<>();
		if (showDirection) second.add(place.direction());
		if (showBiome) second.add(place.biome());
		String line2 = String.join(" · ", second);
		int line2Width = HudStyles.width(line2, false);
		int content = Math.max(line1, line2Width);
		int width = stable(s.padLeft + content + s.padRight);
		int height = s.padY * 2 + 8 + (line2.isEmpty() ? 0 : 11);
		background(g, x, y, width, height);
		int inner = width - s.padLeft - s.padRight;
		int tx = x + s.padLeft + alignOffset(inner, line1);
		int ty = y + s.padY;
		for (int i = 0; i < 3; i++) {
			HudStyles.text(g, labels[i], tx, ty, s.labelColor(), true);
			tx += HudStyles.width(labels[i], true) + 3;
			HudStyles.text(g, values[i], tx, ty, s.textColor(), false);
			tx += HudStyles.width(values[i], false) + 7;
		}
		if (!line2.isEmpty()) {
			int dim = Draw.lerp(s.textColor(), 0xFF8B95A7, 0.35f);
			HudStyles.text(g, line2, x + s.padLeft + alignOffset(inner, line2Width), ty + 11, dim, false);
		}
		return size(width, height);
	}

	@Override
	public void onHover(Minecraft mc, HudPointer pointer) {
		Place place = place(mc);
		if (place == null) return;
		pointer.tooltip("X " + format(place.x()) + " · Y " + format(place.y()) + " · Z " + format(place.z()),
				"Blickrichtung " + place.direction() + " · " + Math.round(place.yaw()) + "°",
				"Biom " + place.biome(),
				pointer.chatOpen() ? "Klick: in den Chat einfügen · Shift+Klick: kopieren" : "Klick: kopieren");
		pointer.cursor(HudHover.Cursor.HAND);
	}

	@Override
	public boolean onClick(Minecraft mc, HudPointer pointer) {
		if (pointer.button() != 0) return false;
		Place place = place(mc);
		if (place == null) return false;
		String text = place.block().getX() + " " + place.block().getY() + " " + place.block().getZ();
		if (!pointer.shift() && pointer.insertIntoChat(text)) {
			HudInteraction.action("coordinates:chat");
			return true;
		}
		pointer.copyToClipboard(text);
		HudInteraction.action("coordinates:copy");
		Notifications.show("coordinates", "Koordinaten kopiert", text, null);
		return true;
	}

	@Override
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.add(choice("layout", "Darstellung", "", LAYOUTS, 0));
		options.add(toggle("direction", "Richtung", "", true));
		options.add(toggle("biome", "Biom", "", true));
		return options;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(0, choice("layout", "Darstellung", "Kompakt in zwei Zeilen oder als Liste", LAYOUTS, 0));
		settings.add(1, choice("decimals", "Nachkommastellen", "Genauigkeit der Position", List.of("0", "1", "2"), 1));
		settings.add(2, toggle("direction", "Richtung", "Himmelsrichtung anzeigen", true));
		settings.add(3, toggle("biome", "Biom", "Aktuelles Biom anzeigen", true));
		return settings;
	}

	private static String direction(LocalPlayer player) {
		return switch (player.getDirection()) {
			case NORTH -> "Nord (-Z)";
			case SOUTH -> "Süd (+Z)";
			case EAST -> "Ost (+X)";
			case WEST -> "West (-X)";
			default -> player.getDirection().getName();
		};
	}

	/** Biom-Name in der Sprache des Spiels, z. B. „Ebene“ */
	private static String biome(Minecraft mc, BlockPos pos) {
		if (mc.level == null) return "–";
		return mc.level.getBiome(pos).unwrapKey().map(key -> {
			Identifier id = key.identifier();
			String translationKey = "biome." + id.getNamespace() + "." + id.getPath();
			String name = Component.translatable(translationKey).getString();
			if (name.equals(translationKey)) name = id.getPath().replace('_', ' ');
			return name;
		}).orElse("–");
	}

	/** für Tests: Darstellung „Kompakt“ (0) oder „Zeilen“ (1) */
	public int layout() {
		return (int) option("layout", 0.0);
	}
}
