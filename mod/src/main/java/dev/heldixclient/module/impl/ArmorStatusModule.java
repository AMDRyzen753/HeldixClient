package dev.heldixclient.module.impl;

import dev.heldixclient.hud.HudStyles;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import it.unimi.dsi.fastutil.objects.Object2IntMap;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.core.Holder;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;

import java.util.ArrayList;
import java.util.List;

/**
 * Rüstung und Items in der Hand mit Haltbarkeit: Zahl oder Prozent und ein Balken, farbig je nach Zustand. Bei
 * offenem Chat zeigt der Tooltip Name, genaue Haltbarkeit und Verzauberungen des Items unter der Maus.
 */
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

		HudStyles.Resolved s = HudStyles.current();
		boolean horizontal = (int) option("layout", 0) == 1;
		int text = (int) option("text", 0);
		boolean bars = option("bars", true);
		int width;
		int height;
		if (horizontal) {
			int cell = ICON + 4;
			if (text != 2) cell = Math.max(cell, widest(stacks, text) + 4);
			width = s.padLeft + stacks.size() * cell - 4 + s.padRight;
			height = s.padY * 2 + ICON + (bars ? 3 : 0) + (text != 2 ? 10 : 0);
			background(g, x, y, width, height);
			int cx = x + s.padLeft;
			for (ItemStack stack : stacks) {
				int iconX = cx + (cell - 4 - ICON) / 2;
				g.item(stack, iconX, y + s.padY);
				int below = y + s.padY + ICON;
				if (bars && durable(stack)) HudStyles.bar(g, iconX + 1, below + 0.5f, ICON - 2, 1.5f, fraction(stack), color(stack));
				String label = label(stack, text);
				if (label != null) {
					int lw = HudStyles.width(label, false);
					HudStyles.text(g, label, cx + (cell - 4 - lw) / 2, below + (bars ? 4 : 2), color(stack), false);
				}
				hotspot("item:" + stacks.indexOf(stack), cx - 2 - x, s.padY - 1, cell, height - s.padY * 2 + 2, details(stack));
				cx += cell;
			}
		} else {
			int textW = text != 2 ? widest(stacks, text) : 0;
			int column = Math.max(textW, bars ? 22 : 0);
			width = s.padLeft + ICON + (column > 0 ? 4 + column : 0) + s.padRight;
			height = s.padY * 2 + stacks.size() * ROW - 2;
			background(g, x, y, width, height);
			boolean mirror = s.alignIndex() == 2;
			int rowY = y + s.padY;
			for (ItemStack stack : stacks) {
				int iconX = mirror ? x + width - s.padRight - ICON : x + s.padLeft;
				int columnX = mirror ? iconX - 4 - column : iconX + ICON + 4;
				g.item(stack, iconX, rowY);
				String label = label(stack, text);
				boolean bar = bars && durable(stack);
				if (label != null) {
					int lw = HudStyles.width(label, false);
					int lx = mirror ? columnX + column - lw : columnX;
					HudStyles.text(g, label, lx, rowY + (bar ? 2 : 4), color(stack), false);
				}
				if (bar) HudStyles.bar(g, columnX, rowY + (label != null ? 12 : 7), column, 2, fraction(stack), color(stack));
				hotspot("item:" + stacks.indexOf(stack), s.padLeft - 2, rowY - y - 1, width - s.padLeft - s.padRight + 4, ROW, details(stack));
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
		ItemStack sword = new ItemStack(Items.DIAMOND_SWORD);
		sword.setDamageValue(900);
		ItemStack chest = new ItemStack(Items.DIAMOND_CHESTPLATE);
		chest.setDamageValue(420);
		return List.of(sword, new ItemStack(Items.DIAMOND_HELMET), chest, new ItemStack(Items.DIAMOND_LEGGINGS), new ItemStack(Items.DIAMOND_BOOTS));
	}

	private static boolean durable(ItemStack stack) {
		return stack.isDamageableItem() && stack.getMaxDamage() > 0;
	}

	private static float fraction(ItemStack stack) {
		return 1f - (float) stack.getDamageValue() / stack.getMaxDamage();
	}

	private int widest(List<ItemStack> stacks, int text) {
		int max = 0;
		for (ItemStack stack : stacks) {
			String label = label(stack, text);
			if (label != null) max = Math.max(max, HudStyles.width(label, false));
		}
		return max;
	}

	/** Text neben dem Item: Haltbarkeit (Zahl/Prozent) oder bei stapelbaren Items die Anzahl */
	public static String label(ItemStack stack, int text) {
		if (text == 2) return null;
		if (durable(stack)) {
			int left = stack.getMaxDamage() - stack.getDamageValue();
			return text == 1 ? Math.round(100f * left / stack.getMaxDamage()) + " %" : Integer.toString(left);
		}
		return stack.getCount() > 1 ? Integer.toString(stack.getCount()) : null;
	}

	/** Tooltip: Name, Haltbarkeit, Verzauberungen */
	private static List<String> details(ItemStack stack) {
		List<String> lines = new ArrayList<>();
		lines.add(stack.getHoverName().getString());
		if (durable(stack)) {
			int left = stack.getMaxDamage() - stack.getDamageValue();
			lines.add("Haltbarkeit " + left + " / " + stack.getMaxDamage() + " (" + Math.round(100f * left / stack.getMaxDamage()) + " %)");
		} else if (stack.getCount() > 1) {
			lines.add(stack.getCount() + " Stück");
		}
		int shown = 0;
		for (Object2IntMap.Entry<Holder<Enchantment>> entry : stack.getEnchantments().entrySet()) {
			if (shown++ >= 5) {
				lines.add("…");
				break;
			}
			lines.add(Enchantment.getFullname(entry.getKey(), entry.getIntValue()).getString());
		}
		return lines;
	}

	/** Grün → Gelb → Rot je nach verbleibender Haltbarkeit */
	static int color(ItemStack stack) {
		if (!durable(stack)) return HudStyles.current().textColor();
		float left = fraction(stack);
		if (left > 0.5f) return FpsModule.GOOD;
		if (left > 0.25f) return FpsModule.OK;
		return FpsModule.BAD;
	}

	@Override
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.add(choice("layout", "Anordnung", "", LAYOUTS, 0));
		options.add(choice("text", "Haltbarkeit", "", TEXTS, 0));
		options.add(toggle("bars", "Balken", "", true));
		return options;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(0, toggle("armor", "Rüstung", "Helm, Brustpanzer, Hose und Stiefel", true));
		settings.add(1, toggle("hands", "Items in der Hand", "Haupt- und Zweithand", true));
		settings.add(2, choice("text", "Haltbarkeit", "Als Zahl, in Prozent oder gar nicht", TEXTS, 0));
		settings.add(3, toggle("bars", "Haltbarkeitsbalken", "Balken unter bzw. neben dem Item, grün bis rot", true));
		settings.add(4, choice("layout", "Anordnung", "", LAYOUTS, 0));
		return settings;
	}
}
