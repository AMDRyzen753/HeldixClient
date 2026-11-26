package dev.heldixclient.addon;

import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.screen.FriendWidget;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.ItemStack;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** HudCanvas für Addons: zeichnet relativ zur Position des HUD-Elements und merkt sich die belegte Größe. */
final class AddonCanvas implements HudCanvas {
	private final GuiGraphicsExtractor g;
	private final Font font;
	private final int originX;
	private final int originY;
	private final boolean preview;
	private int width;
	private int height;

	AddonCanvas(GuiGraphicsExtractor g, Font font, int originX, int originY, boolean preview) {
		this.g = g;
		this.font = font;
		this.originX = originX;
		this.originY = originY;
		this.preview = preview;
	}

	int width() {
		return width;
	}

	int height() {
		return height;
	}

	private void grow(float right, float bottom) {
		width = Math.max(width, (int) Math.ceil(right));
		height = Math.max(height, (int) Math.ceil(bottom));
	}

	private static Ui.Font uiFont(TextStyle style) {
		return switch (style) {
			case SMALL -> Ui.Font.SMALL;
			case BOLD -> Ui.Font.LABEL;
			case TITLE -> Ui.Font.TITLE;
			default -> Ui.Font.BODY;
		};
	}

	@Override
	public int textWidth(String text) {
		return font.width(text);
	}

	@Override
	public int lineHeight() {
		return font.lineHeight;
	}

	@Override
	public void text(String text, int x, int y, int color) {
		g.text(font, text, originX + x, originY + y, color, true);
		grow(x + font.width(text), y + font.lineHeight);
	}

	@Override
	public void rect(int x, int y, int width, int height, int color) {
		g.fill(originX + x, originY + y, originX + x + width, originY + y + height, color);
		grow(x + width, y + height);
	}

	@Override
	public void labelValue(String label, String value) {
		long size = HudModule.drawLabelValue(g, font, originX, originY, label, value);
		grow((int) (size >> 32), (int) size);
	}

	@Override
	public void labelValues(String[][] rows) {
		long size = HudModule.drawLabelValues(g, font, originX, originY, rows);
		grow((int) (size >> 32), (int) size);
	}

	@Override
	public int screenWidth() {
		return g.guiWidth();
	}

	@Override
	public int screenHeight() {
		return g.guiHeight();
	}

	// --- API 2 ------------------------------------------------------------------------------

	@Override
	public int textWidth(String text, TextStyle style) {
		if (text == null || text.isEmpty()) return 0;
		if (style == null || style == TextStyle.MINECRAFT) return font.width(text);
		return Ui.width(text, uiFont(style));
	}

	@Override
	public void text(String text, int x, int y, int color, TextStyle style) {
		if (text == null || text.isEmpty()) return;
		if (style == null || style == TextStyle.MINECRAFT) {
			text(text, x, y, color);
			return;
		}
		Ui.text(g, text, originX + x, originY + y, color, uiFont(style));
		grow(x + Ui.width(text, uiFont(style)), y + style.height);
	}

	@Override
	public String ellipsize(String text, int maxWidth, TextStyle style) {
		if (text == null) return "";
		if (style == null || style == TextStyle.MINECRAFT) {
			if (font.width(text) <= maxWidth) return text;
			String dots = "…";
			int end = text.length();
			while (end > 0 && font.width(text.substring(0, end)) + font.width(dots) > maxWidth) end--;
			return text.substring(0, end).stripTrailing() + dots;
		}
		return Ui.ellipsize(text, maxWidth, uiFont(style));
	}

	@Override
	public void roundedRect(float x, float y, float width, float height, float radius, int color) {
		Ui.rect(g, originX + x, originY + y, width, height, radius, color);
		grow(x + width, y + height);
	}

	@Override
	public void roundedOutline(float x, float y, float width, float height, float radius, int color) {
		Ui.outline(g, originX + x, originY + y, width, height, radius, color);
		grow(x + width, y + height);
	}

	@Override
	public boolean image(Path png, int x, int y, int width, int height) {
		grow(x + width, y + height);
		return Ui.image(g, png, originX + x, originY + y, width, height, 1f);
	}

	@Override
	public void icon(String name, int x, int y, int size, int color) {
		if (name == null || !Ui.hasIcon(name)) return;
		Ui.icon(g, name, originX + x, originY + y, size, color);
		grow(x + size, y + size);
	}

	@Override
	public boolean isPreview() {
		return preview;
	}

	// --- API 3 ------------------------------------------------------------------------------

	@Override
	public void progressBar(float x, float y, float width, float height, float progress, int background, int foreground) {
		if (width <= 0 || height <= 0) return;
		float radius = height / 2f;
		Ui.rect(g, originX + x, originY + y, width, height, radius, background);
		float fraction = Float.isNaN(progress) ? 0 : Math.clamp(progress, 0f, 1f);
		if (fraction > 0) Ui.rect(g, originX + x, originY + y, Math.max(height, width * fraction), height, radius, foreground);
		grow(x + width, y + height);
	}

	@Override
	public void gradientRect(int x, int y, int width, int height, int startColor, int endColor, boolean horizontal) {
		if (width <= 0 || height <= 0) return;
		int ax = originX + x;
		int ay = originY + y;
		if (horizontal) {
			// fillGradient verläuft nur von oben nach unten: um 90° gedreht zeichnen
			g.pose().pushMatrix();
			g.pose().translate(ax, ay + height);
			g.pose().rotate((float) (-Math.PI / 2));
			g.fillGradient(0, 0, height, width, startColor, endColor);
			g.pose().popMatrix();
		} else {
			g.fillGradient(ax, ay, ax + width, ay + height, startColor, endColor);
		}
		grow(x + width, y + height);
	}

	@Override
	public void line(float x1, float y1, float x2, float y2, float thickness, int color) {
		float dx = x2 - x1;
		float dy = y2 - y1;
		float length = (float) Math.sqrt(dx * dx + dy * dy);
		if (length <= 0 || thickness <= 0) return;
		g.pose().pushMatrix();
		g.pose().translate(originX + x1, originY + y1);
		g.pose().rotate((float) Math.atan2(dy, dx));
		Ui.rect(g, 0, -thickness / 2f, length, thickness, 0, color);
		g.pose().popMatrix();
		grow(Math.max(x1, x2) + thickness / 2f, Math.max(y1, y2) + thickness / 2f);
	}

	@Override
	public void circle(float centerX, float centerY, float radius, int color) {
		if (radius <= 0) return;
		Ui.circle(g, originX + centerX, originY + centerY, radius, color);
		grow(centerX + radius, centerY + radius);
	}

	/** Item-Stapel je ID (unbekannte IDs als leerer Stapel, damit nicht jedes Bild neu gesucht wird) */
	private static final Map<String, ItemStack> ITEMS = new HashMap<>();

	@Override
	public boolean item(String itemId, int x, int y, int size) {
		if (itemId == null || itemId.isBlank() || size <= 0) return false;
		if (ITEMS.size() > 256) ITEMS.clear();
		ItemStack stack = ITEMS.computeIfAbsent(itemId.strip().toLowerCase(Locale.ROOT), id -> {
			Identifier key = Identifier.tryParse(id.contains(":") ? id : "minecraft:" + id);
			if (key == null) return ItemStack.EMPTY;
			return BuiltInRegistries.ITEM.getOptional(key).map(ItemStack::new).orElse(ItemStack.EMPTY);
		});
		if (stack.isEmpty()) return false;
		if (size == 16) {
			g.item(stack, originX + x, originY + y);
		} else {
			g.pose().pushMatrix();
			g.pose().translate(originX + x, originY + y);
			g.pose().scale(size / 16f, size / 16f);
			g.item(stack, 0, 0);
			g.pose().popMatrix();
		}
		grow(x + size, y + size);
		return true;
	}

	@Override
	public boolean playerHead(String nameOrUuid, int x, int y, int size) {
		if (nameOrUuid == null || nameOrUuid.isBlank() || size <= 0) return false;
		PlayerSkin skin = skin(nameOrUuid.strip());
		if (skin == null) return false;
		PlayerFaceExtractor.extractRenderState(g, skin, originX + x, originY + y, size);
		grow(x + size, y + size);
		return true;
	}

	private static PlayerSkin skin(String nameOrUuid) {
		UUID uuid = uuid(nameOrUuid);
		if (uuid != null) return FriendWidget.skinOf(uuid, null);
		Minecraft mc = Minecraft.getInstance();
		if (mc.player != null && mc.player.getName().getString().equalsIgnoreCase(nameOrUuid)) return mc.player.getSkin();
		ClientPacketListener connection = mc.getConnection();
		if (connection == null) return null;
		PlayerInfo info = connection.getPlayerInfoIgnoreCase(nameOrUuid);
		return info != null ? info.getSkin() : null;
	}

	private static UUID uuid(String text) {
		String plain = text.replace("-", "");
		if (!plain.matches("[0-9a-fA-F]{32}")) return null;
		try {
			return UUID.fromString(plain.replaceFirst("(.{8})(.{4})(.{4})(.{4})(.{12})", "$1-$2-$3-$4-$5"));
		} catch (IllegalArgumentException e) {
			return null;
		}
	}

	/** Laufschrift: 25 GUI-Pixel pro Sekunde, an beiden Enden 1,5 Sekunden Pause */
	private static final double SCROLL_SPEED = 25;
	private static final double SCROLL_PAUSE = 1.5;

	@Override
	public void scrollingText(String text, int x, int y, int maxWidth, int color, TextStyle style) {
		if (text == null || text.isEmpty() || maxWidth <= 0) return;
		int width = textWidth(text, style);
		if (width <= maxWidth) {
			text(text, x, y, color, style);
			return;
		}
		int height = style == null || style == TextStyle.MINECRAFT ? font.lineHeight : style.height;
		double overflow = width - maxWidth;
		double travel = overflow / SCROLL_SPEED;
		double cycle = 2 * (travel + SCROLL_PAUSE);
		double t = (System.currentTimeMillis() / 1000.0) % cycle;
		double offset;
		if (t < SCROLL_PAUSE) offset = 0;
		else if (t < SCROLL_PAUSE + travel) offset = (t - SCROLL_PAUSE) * SCROLL_SPEED;
		else if (t < 2 * SCROLL_PAUSE + travel) offset = overflow;
		else offset = overflow - (t - 2 * SCROLL_PAUSE - travel) * SCROLL_SPEED;
		g.enableScissor(originX + x, originY + y - 1, originX + x + maxWidth, originY + y + height + 1);
		g.pose().pushMatrix();
		g.pose().translate((float) -offset, 0);
		if (style == null || style == TextStyle.MINECRAFT) g.text(font, text, originX + x, originY + y, color, true);
		else Ui.text(g, text, originX + x, originY + y, color, uiFont(style));
		g.pose().popMatrix();
		g.disableScissor();
		grow(x + maxWidth, y + height);
	}

	@Override
	public int imageColor(Path png) {
		return png == null ? 0 : Ui.imageColor(png);
	}
}
