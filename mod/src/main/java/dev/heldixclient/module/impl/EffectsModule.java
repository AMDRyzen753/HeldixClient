package dev.heldixclient.module.impl;

import dev.heldixclient.hud.HudStyles;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Aktive Trank-Effekte mit Symbol, Stufe, Restzeit und einem Balken, der mit der Zeit kürzer wird; kurz vor dem Ende
 * blinkt der Eintrag. Bei offenem Chat zeigt der Tooltip Details zum Effekt unter der Maus.
 */
public class EffectsModule extends HudModule {
	private static final int ICON = 18;
	private static final int ROW = 24;
	private static final String[] ROMAN = {"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};
	/** längste gesehene Dauer je Effekt (für den Balken; wird bei neuem Trank größer) */
	private final Map<Holder<MobEffect>, Integer> longest = new HashMap<>();

	public EffectsModule() {
		super("effects", "Trank-Effekte", "Aktive Effekte mit Restzeit", false, 9999, 4);
	}

	/** true = die Vanilla-Symbole oben rechts ausblenden (Hooks.hudEffects) */
	public boolean hidesVanilla() {
		return isEnabled() && option("hideVanilla", true);
	}

	private record Entry(Holder<MobEffect> effect, Component name, Component time, MobEffectCategory category, boolean ending,
			boolean infinite, boolean ambient, float remaining) {
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		List<Entry> entries = entries(mc);
		if (entries.isEmpty()) return size(0, 0);
		HudStyles.Resolved s = HudStyles.current();
		boolean names = option("names", true);
		boolean bars = option("bars", true);
		int textW = 0;
		for (Entry entry : entries) {
			textW = Math.max(textW, HudStyles.width(entry.time(), false));
			if (names) textW = Math.max(textW, HudStyles.width(entry.name(), false));
		}
		textW = Math.max(textW, bars ? 30 : 0);
		int width = stable(s.padLeft + ICON + 5 + textW + s.padRight);
		int height = s.padY * 2 + entries.size() * ROW - 4;
		background(g, x, y, width, height);
		boolean mirror = s.alignIndex() == 2;
		int rowY = y + s.padY;
		long now = System.currentTimeMillis();
		for (Entry entry : entries) {
			// letzte 10 Sekunden: Symbol blinkt sanft
			float alpha = entry.ending() ? 0.45f + 0.55f * (float) Math.abs(Math.sin(now / 260.0)) : 1f;
			int iconColor = ((int) (alpha * 255) << 24) | 0xFFFFFF;
			int iconX = mirror ? x + width - s.padRight - ICON : x + s.padLeft;
			int textX = mirror ? iconX - 5 - textW : iconX + ICON + 5;
			g.blitSprite(RenderPipelines.GUI_TEXTURED, Hud.getMobEffectSprite(entry.effect()), iconX, rowY, ICON, ICON, iconColor);
			int nameColor = entry.category() == MobEffectCategory.HARMFUL ? FpsModule.BAD : s.textColor();
			int timeColor = entry.ending() ? FpsModule.OK : s.labelColor();
			if (names) {
				int nw = HudStyles.width(entry.name(), false);
				HudStyles.text(g, entry.name(), mirror ? textX + textW - nw : textX, rowY, nameColor, false);
				int tw = HudStyles.width(entry.time(), false);
				HudStyles.text(g, entry.time(), mirror ? textX + textW - tw : textX, rowY + 10, timeColor, false);
			} else {
				int tw = HudStyles.width(entry.time(), false);
				HudStyles.text(g, entry.time(), mirror ? textX + textW - tw : textX, rowY + 4, entry.ending() ? FpsModule.OK : nameColor, false);
			}
			if (bars && !entry.infinite()) {
				int barColor = entry.ending() ? FpsModule.OK : entry.category() == MobEffectCategory.HARMFUL ? FpsModule.BAD : s.accent();
				HudStyles.bar(g, textX, rowY + 19.5f, textW, 1.5f, entry.remaining(), barColor);
			}
			hotspot("effect:" + entries.indexOf(entry), s.padLeft - 2, rowY - y - 1, width - s.padLeft - s.padRight + 4, ROW - 2, details(entry));
			rowY += ROW;
		}
		return size(width, height);
	}

	private static List<String> details(Entry entry) {
		List<String> lines = new ArrayList<>();
		lines.add(entry.name().getString());
		lines.add(entry.infinite() ? "Ohne Zeitlimit" : "Restzeit " + entry.time().getString());
		lines.add(switch (entry.category()) {
			case HARMFUL -> "Schädlicher Effekt";
			case BENEFICIAL -> "Nützlicher Effekt";
			default -> "Neutraler Effekt";
		});
		if (entry.ambient()) lines.add("Von einem Leuchtfeuer oder einer Quelle in der Nähe");
		return lines;
	}

	private List<Entry> entries(Minecraft mc) {
		List<Entry> entries = new ArrayList<>();
		if (mc.player != null && mc.level != null) {
			float tickrate = mc.level.tickRateManager().tickrate();
			List<MobEffectInstance> active = new ArrayList<>(mc.player.getActiveEffects());
			active.removeIf(effect -> !effect.showIcon());
			// länger laufende oben, unendliche ganz oben
			active.sort(Comparator.comparingInt((MobEffectInstance e) -> e.isInfiniteDuration() ? Integer.MAX_VALUE : e.getDuration()).reversed());
			longest.keySet().removeIf(effect -> active.stream().noneMatch(e -> e.getEffect().equals(effect)));
			for (MobEffectInstance effect : active) {
				int duration = effect.getDuration();
				int max = longest.merge(effect.getEffect(), duration, Math::max);
				float remaining = effect.isInfiniteDuration() || max <= 0 ? 1f : Math.clamp(duration / (float) max, 0f, 1f);
				entries.add(new Entry(effect.getEffect(), name(effect.getEffect(), effect.getAmplifier()),
						MobEffectUtil.formatDuration(effect, 1f, tickrate),
						effect.getEffect().value().getCategory(),
						!effect.isInfiniteDuration() && effect.endsWithin(200), effect.isInfiniteDuration(), effect.isAmbient(), remaining));
			}
		}
		if (entries.isEmpty() && isPreviewing()) {
			entries.add(new Entry(MobEffects.SPEED, name(MobEffects.SPEED, 1), Component.literal("1:30"), MobEffectCategory.BENEFICIAL, false, false, false, 0.75f));
			entries.add(new Entry(MobEffects.STRENGTH, name(MobEffects.STRENGTH, 0), Component.literal("0:08"), MobEffectCategory.BENEFICIAL, true, false, false, 0.1f));
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
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.add(toggle("names", "Namen zeigen", "", true));
		options.add(toggle("bars", "Restzeit als Balken", "", true));
		return options;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(0, toggle("names", "Namen zeigen", "Name und Stufe des Effekts über der Restzeit", true));
		settings.add(1, toggle("bars", "Restzeit als Balken", "Balken unter der Zeit, der mit der Zeit kürzer wird", true));
		settings.add(2, toggle("hideVanilla", "Vanilla-Symbole ausblenden", "Die kleinen Symbole oben rechts von Minecraft", true));
		return settings;
	}
}
