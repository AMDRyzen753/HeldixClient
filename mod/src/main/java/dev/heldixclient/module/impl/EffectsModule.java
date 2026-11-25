package dev.heldixclient.module.impl;

import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.Hud;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectCategory;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffectUtil;
import net.minecraft.world.effect.MobEffects;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Aktive Trank-Effekte mit Symbol, Stufe und Restzeit; kurz vor dem Ende blinkt der Eintrag. */
public class EffectsModule extends HudModule {
	private static final int ICON = 18;
	private static final int ROW = 22;
	private static final String[] ROMAN = {"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};

	public EffectsModule() {
		super("effects", "Trank-Effekte", "Aktive Effekte mit Restzeit", false, 9999, 4);
	}

	/** true = die Vanilla-Symbole oben rechts ausblenden (Hooks.hudEffects) */
	public boolean hidesVanilla() {
		return isEnabled() && option("hideVanilla", true);
	}

	private record Entry(Holder<MobEffect> effect, Component name, Component time, boolean harmful, boolean ending) {
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		List<Entry> entries = entries(mc);
		if (entries.isEmpty()) return size(0, 0);
		boolean names = option("names", true);
		int textW = 0;
		for (Entry entry : entries) {
			textW = Math.max(textW, mc.font.width(entry.time()));
			if (names) textW = Math.max(textW, mc.font.width(entry.name()));
		}
		int width = BAR + PADDING * 2 + ICON + 5 + textW;
		int height = PADDING * 2 + entries.size() * ROW - 4;
		background(g, x, y, width, height);
		int rowY = y + PADDING;
		long now = System.currentTimeMillis();
		for (Entry entry : entries) {
			// letzte 10 Sekunden: Symbol blinkt sanft
			float alpha = entry.ending() ? 0.45f + 0.55f * (float) Math.abs(Math.sin(now / 260.0)) : 1f;
			int iconColor = ((int) (alpha * 255) << 24) | 0xFFFFFF;
			g.blitSprite(RenderPipelines.GUI_TEXTURED, Hud.getMobEffectSprite(entry.effect()), x + BAR + PADDING, rowY, ICON, ICON, iconColor);
			int textX = x + BAR + PADDING + ICON + 5;
			int nameColor = entry.harmful() ? 0xFFFCA5A5 : Theme.TEXT;
			if (names) {
				g.text(mc.font, entry.name(), textX, rowY, nameColor, true);
				g.text(mc.font, entry.time(), textX, rowY + 10, entry.ending() ? 0xFFFDE68A : Theme.ACCENT_LIGHT, true);
			} else {
				g.text(mc.font, entry.time(), textX, rowY + 5, entry.ending() ? 0xFFFDE68A : nameColor, true);
			}
			rowY += ROW;
		}
		return size(width, height);
	}

	private List<Entry> entries(Minecraft mc) {
		List<Entry> entries = new ArrayList<>();
		if (mc.player != null && mc.level != null) {
			float tickrate = mc.level.tickRateManager().tickrate();
			List<MobEffectInstance> active = new ArrayList<>(mc.player.getActiveEffects());
			active.removeIf(effect -> !effect.showIcon());
			// länger laufende oben, unendliche ganz oben
			active.sort(Comparator.comparingInt((MobEffectInstance e) -> e.isInfiniteDuration() ? Integer.MAX_VALUE : e.getDuration()).reversed());
			for (MobEffectInstance effect : active) {
				entries.add(new Entry(effect.getEffect(), name(effect.getEffect(), effect.getAmplifier()),
						MobEffectUtil.formatDuration(effect, 1f, tickrate),
						effect.getEffect().value().getCategory() == MobEffectCategory.HARMFUL,
						!effect.isInfiniteDuration() && effect.endsWithin(200)));
			}
		}
		if (entries.isEmpty() && isPreviewing()) {
			entries.add(new Entry(MobEffects.SPEED, name(MobEffects.SPEED, 1), Component.literal("1:30"), false, false));
			entries.add(new Entry(MobEffects.STRENGTH, name(MobEffects.STRENGTH, 0), Component.literal("0:08"), false, true));
		}
		return entries;
	}

	private static Component name(Holder<MobEffect> effect, int amplifier) {
		Component name = effect.value().getDisplayName();
		int level = amplifier + 1;
		if (level <= 1) return name;
		return name.copy().append(" " + (level < ROMAN.length ? ROMAN[level] : Integer.toString(level)));
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(0, toggle("names", "Namen zeigen", "Name und Stufe des Effekts über der Restzeit", true));
		settings.add(1, toggle("hideVanilla", "Vanilla-Symbole ausblenden", "Die kleinen Symbole oben rechts von Minecraft", true));
		return settings;
	}
}
