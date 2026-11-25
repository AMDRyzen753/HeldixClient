package dev.heldixclient.module.impl;

import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.util.ArrayList;
import java.util.List;

/** Rüstung und Items in der Hand mit Haltbarkeit (Zahl oder Prozent, farbig je nach Zustand). */
public class ArmorStatusModule extends HudModule {
	private static final int ICON = 16;
	private static final int ROW = 18;
	private static final EquipmentSlot[] ARMOR = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};
	private static final List<String> LAYOUTS = List.of("Untereinander", "Nebeneinander");
	private static final List<String> TEXTS = List.of("Zahl", "Prozent", "Aus");

	public ArmorStatusModule() {
		super("armor", "Rüstung", "Rüstung und Items mit Haltbarkeit", false, 9999, 9999);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		List<ItemStack> stacks = stacks(mc.player);
		if (stacks.isEmpty() && isPreviewing()) stacks = preview();
		if (stacks.isEmpty()) return size(0, 0);

		boolean horizontal = (int) option("layout", 0) == 1;
		int text = (int) option("text", 0);
		int width;
		int height;
		if (horizontal) {
			int cell = ICON + 4;
			if (text != 2) cell = Math.max(cell, widest(mc, stacks, text) + 4);
			width = BAR + PADDING * 2 + stacks.size() * cell - 4;
			height = PADDING * 2 + ICON + (text != 2 ? 10 : 0);
			background(g, x, y, width, height);
			int cx = x + BAR + PADDING;
			for (ItemStack stack : stacks) {
				int iconX = cx + (cell - 4 - ICON) / 2;
				drawItem(g, mc, stack, iconX, y + PADDING);
				String label = label(stack, text);
				if (label != null) {
					int lw = mc.font.width(label);
					g.text(mc.font, label, cx + (cell - 4 - lw) / 2, y + PADDING + ICON + 2, color(stack), true);
				}
				cx += cell;
			}
		} else {
			int textW = text != 2 ? widest(mc, stacks, text) : 0;
			width = BAR + PADDING * 2 + ICON + (textW > 0 ? 4 + textW : 0);
			height = PADDING * 2 + stacks.size() * ROW - 2;
			background(g, x, y, width, height);
			int rowY = y + PADDING;
			for (ItemStack stack : stacks) {
				drawItem(g, mc, stack, x + BAR + PADDING, rowY);
				String label = label(stack, text);
				if (label != null) g.text(mc.font, label, x + BAR + PADDING + ICON + 4, rowY + 4, color(stack), true);
				rowY += ROW;
			}
		}
		return size(width, height);
	}

	private List<ItemStack> stacks(Player player) {
		List<ItemStack> stacks = new ArrayList<>();
		if (player == null) return stacks;
		if (option("hands", true)) {
			add(stacks, player.getItemBySlot(EquipmentSlot.MAINHAND));
			add(stacks, player.getItemBySlot(EquipmentSlot.OFFHAND));
		}
		if (option("armor", true)) {
			for (EquipmentSlot slot : ARMOR) add(stacks, player.getItemBySlot(slot));
		}
		return stacks;
	}

	private static void add(List<ItemStack> stacks, ItemStack stack) {
		if (stack != null && !stack.isEmpty()) stacks.add(stack);
	}

	private static List<ItemStack> preview() {
		return List.of(new ItemStack(Items.DIAMOND_SWORD), new ItemStack(Items.DIAMOND_HELMET), new ItemStack(Items.DIAMOND_CHESTPLATE),
				new ItemStack(Items.DIAMOND_LEGGINGS), new ItemStack(Items.DIAMOND_BOOTS));
	}

	private static void drawItem(GuiGraphicsExtractor g, Minecraft mc, ItemStack stack, int x, int y) {
		g.item(stack, x, y);
		// Haltbarkeitsbalken wie im Inventar; Anzahl schreiben wir selbst daneben
		if (stack.isDamageableItem()) g.itemDecorations(mc.font, stack, x, y, "");
	}

	private int widest(Minecraft mc, List<ItemStack> stacks, int text) {
		int max = 0;
		for (ItemStack stack : stacks) {
			String label = label(stack, text);
			if (label != null) max = Math.max(max, mc.font.width(label));
		}
		return max;
	}

	/** Text neben dem Item: Haltbarkeit (Zahl/Prozent) oder bei stapelbaren Items die Anzahl */
	public static String label(ItemStack stack, int text) {
		if (text == 2) return null;
		if (stack.isDamageableItem() && stack.getMaxDamage() > 0) {
			int left = stack.getMaxDamage() - stack.getDamageValue();
			return text == 1 ? Math.round(100f * left / stack.getMaxDamage()) + " %" : Integer.toString(left);
		}
		return stack.getCount() > 1 ? Integer.toString(stack.getCount()) : null;
	}

	/** Grün → Gelb → Rot je nach verbleibender Haltbarkeit */
	static int color(ItemStack stack) {
		if (!stack.isDamageableItem() || stack.getMaxDamage() <= 0) return Theme.TEXT;
		float left = 1f - (float) stack.getDamageValue() / stack.getMaxDamage();
		if (left > 0.5f) return 0xFF86EFAC;
		if (left > 0.25f) return 0xFFFDE68A;
		return 0xFFFCA5A5;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(0, toggle("armor", "Rüstung", "Helm, Brustpanzer, Hose und Stiefel", true));
		settings.add(1, toggle("hands", "Items in der Hand", "Haupt- und Zweithand", true));
		settings.add(2, choice("text", "Haltbarkeit", "Als Zahl, in Prozent oder gar nicht", TEXTS, 0));
		settings.add(3, choice("layout", "Anordnung", "", LAYOUTS, 0));
		return settings;
	}
}
