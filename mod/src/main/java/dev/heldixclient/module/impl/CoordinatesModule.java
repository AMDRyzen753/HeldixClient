package dev.heldixclient.module.impl;

import dev.heldixclient.module.Setting;

import dev.heldixclient.ui.Theme;
import dev.heldixclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;

public class CoordinatesModule extends HudModule {
	public CoordinatesModule() {
		super("coordinates", "Koordinaten", "Position, Richtung, Biom", true, 4, 58);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		LocalPlayer player = mc.player;
		if (player == null) return size(0, 0);
		Font font = mc.font;

		int decimals = (int) option("decimals", 1.0);
		String format = "%." + decimals + "f %." + decimals + "f %." + decimals + "f";
		java.util.List<String[]> list = new java.util.ArrayList<>();
		list.add(new String[] {"XYZ", String.format(format, player.getX(), player.getY(), player.getZ())});
		if (option("direction", true)) list.add(new String[] {"Richtung", direction(player)});
		if (option("biome", true)) list.add(new String[] {"Biom", biome(mc, player.blockPosition())});
		String[][] rows = list.toArray(new String[0][]);

		int labelWidth = 0;
		int valueWidth = 0;
		for (String[] row : rows) {
			labelWidth = Math.max(labelWidth, font.width(row[0]));
			valueWidth = Math.max(valueWidth, font.width(row[1]));
		}
		int lineHeight = font.lineHeight + 2;
		int width = BAR + PADDING * 2 + labelWidth + 6 + valueWidth;
		int height = PADDING * 2 + rows.length * lineHeight - 3;

		background(g, x, y, width, height);
		int textX = x + BAR + PADDING;
		int lineY = y + PADDING;
		for (String[] row : rows) {
			g.text(font, row[0], textX, lineY, Theme.ACCENT_LIGHT, true);
			g.text(font, row[1], textX + labelWidth + 6, lineY, Theme.TEXT, true);
			lineY += lineHeight;
		}
		return size(width, height);
	}

	@Override
	public java.util.List<Setting> settings() {
		java.util.List<Setting> settings = super.settings();
		settings.add(0, choice("decimals", "Nachkommastellen", "Genauigkeit der Position", java.util.List.of("0", "1", "2"), 1));
		settings.add(1, toggle("direction", "Richtung", "Himmelsrichtung anzeigen", true));
		settings.add(2, toggle("biome", "Biom", "Aktuelles Biom anzeigen", true));
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

	private static String biome(Minecraft mc, BlockPos pos) {
		if (mc.level == null) return "-";
		return mc.level.getBiome(pos).unwrapKey()
				.map(key -> key.identifier().getPath())
				.orElse("-");
	}
}
