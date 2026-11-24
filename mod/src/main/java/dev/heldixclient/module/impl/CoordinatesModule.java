package dev.heldixclient.module.impl;

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

		String[][] rows = {
				{"XYZ", String.format("%.1f %.1f %.1f", player.getX(), player.getY(), player.getZ())},
				{"Richtung", direction(player)},
				{"Biom", biome(mc, player.blockPosition())},
		};

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
