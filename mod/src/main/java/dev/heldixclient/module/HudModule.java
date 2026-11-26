package dev.heldixclient.module;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.HudAnchor;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.HudPointer;
import dev.heldixclient.hud.HudStyles;
import dev.heldixclient.ui.Theme;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayList;
import java.util.List;

/**
 * Ein Modul, das ein verschiebbares Element im HUD zeichnet.
 *
 * <p>Position: gespeichert als Bezugspunkt am Bildschirm ({@link HudAnchor}) plus Abstand, damit das Element bei
 * anderer Fenstergröße oder GUI-Skalierung an „seinem“ Rand bleibt. Es wird immer ganz auf dem Bildschirm gezeichnet.
 * Aussehen: {@link HudStyles} (global und je Element), Größe: HUD-Größe × Größe des Elements, auf ganze
 * Bildschirmpixel gerundet („Scharfe Schrift“).
 *
 * <p>Bedienen im Spiel (Chat offen oder Taste „HUD bedienen“): {@link #onHover} und {@link #onClick}; Bereiche mit
 * Tooltip meldet das Element beim Zeichnen mit {@link #hotspot} an.
 */
public abstract class HudModule extends Module {
	/** Innenabstand der klassischen Boxen (für Module, die selbst zeichnen) */
	protected static final int PADDING = 4;
	/** Breite des farbigen Streifens links im klassischen Stil */
	protected static final int BAR = 2;
	/** Abstand zum Bildschirmrand für Standardpositionen rechts/unten */
	public static final int MARGIN = 4;

	public static final double MIN_SCALE = 0.5;
	public static final double MAX_SCALE = 2.0;

	/** Ein Bereich des Elements mit Tooltip (lokale, ungeskalierte Koordinaten), gilt bis zum nächsten Bild */
	public record Hotspot(String id, float x, float y, float w, float h, List<String> tooltip, boolean highlight) {
		public Hotspot(String id, float x, float y, float w, float h, List<String> tooltip) {
			this(id, x, y, w, h, tooltip, true);
		}

		public boolean contains(float px, float py) {
			return px >= x && px < x + w && py >= y && py < y + h;
		}
	}

	/** Positionen aus alten Konfigurationen umgerechnet: einmal speichern */
	private static boolean migrated;
	/** Element, das gerade gezeichnet wird (für die statischen Zeichenhilfen) */
	private static HudModule drawing;

	private final int defaultX;
	private final int defaultY;
	private int lastX;
	private int lastY;
	private int lastWidth = 40;
	private int lastHeight = 16;
	/** Faktor, mit dem das Element zuletzt gezeichnet wurde (lokal → GUI-Pixel) */
	private float drawScale = 1f;
	private boolean needsMigration;
	private boolean previewing;
	private List<Hotspot> hotspots = List.of();
	private List<Hotspot> collecting;
	/** Breite, die Ziffernwechsel kurz überdauert (sonst zittert ein rechtsbündiges Element) */
	private int stableWidth;
	private long shrinkingSince;

	protected HudModule(String id, String name, String description, boolean defaultEnabled, int defaultX, int defaultY) {
		super(id, name, description, defaultEnabled, defaultX, defaultY);
		this.defaultX = defaultX;
		this.defaultY = defaultY;
		if (HudAnchor.byId(state.anchor) == null) {
			// neu oder noch nie verschoben: Standard; sonst die alte Position beim ersten Zeichnen umrechnen
			if (state.x == defaultX && state.y == defaultY) applyDefaultPosition();
			else needsMigration = true;
		}
	}

	// ======================================================================================
	// Position
	// ======================================================================================

	/** Position, an der das Element zuletzt tatsächlich gezeichnet wurde (auf den Bildschirm begrenzt). */
	public int x() {
		return lastX;
	}

	public int y() {
		return lastY;
	}

	public int width() {
		return lastWidth;
	}

	public int height() {
		return lastHeight;
	}

	/** Bezugspunkt am Bildschirm */
	public HudAnchor anchor() {
		HudAnchor anchor = HudAnchor.byId(state.anchor);
		return anchor != null ? anchor : HudAnchor.TOP_LEFT;
	}

	/** Abstand des Elements zum Bezugspunkt (GUI-Pixel) */
	public int anchorOffsetX() {
		return state.anchorX;
	}

	public int anchorOffsetY() {
		return state.anchorY;
	}

	/** Spalte, an der das Element seinen Abstand hält: 0 links, 1 Mitte, 2 rechts (Ausrichtung oder Bezugspunkt) */
	private int referenceColumn(HudAnchor anchor) {
		String align = styleValue(HudStyles.ALIGN);
		if ("left".equals(align)) return 0;
		if ("center".equals(align)) return 1;
		if ("right".equals(align)) return 2;
		return anchor.column;
	}

	private static int part(int columnOrRow, int size) {
		return Math.round(HudAnchor.fraction(columnOrRow) * size);
	}

	private static int screenWidth() {
		return Minecraft.getInstance().getWindow().getGuiScaledWidth();
	}

	private static int screenHeight() {
		return Minecraft.getInstance().getWindow().getGuiScaledHeight();
	}

	/** Linke obere Ecke setzen (GUI-Pixel); gespeichert wird der Abstand zum nächstgelegenen Bezugspunkt. */
	public void setPosition(int x, int y) {
		setPosition(x, y, screenWidth(), screenHeight());
	}

	public void setPosition(int x, int y, int screenWidth, int screenHeight) {
		HudAnchor anchor = HudAnchor.nearest(x, y, lastWidth, lastHeight, screenWidth, screenHeight);
		state.anchor = anchor.id;
		state.anchorX = x + part(referenceColumn(anchor), lastWidth) - anchor.screenX(screenWidth);
		state.anchorY = y + part(anchor.row, lastHeight) - anchor.screenY(screenHeight);
		state.x = x;
		state.y = y;
		lastX = x;
		lastY = y;
		needsMigration = false;
	}

	/** Linke obere Ecke aus Bezugspunkt und Abstand (ohne Begrenzung auf den Bildschirm) */
	private int[] placed(int screenWidth, int screenHeight) {
		HudAnchor anchor = anchor();
		int x = anchor.screenX(screenWidth) + state.anchorX - part(referenceColumn(anchor), lastWidth);
		int y = anchor.screenY(screenHeight) + state.anchorY - part(anchor.row, lastHeight);
		return new int[] {x, y};
	}

	/** Linke obere Ecke bei einer anderen Bildschirmgröße (GUI-Pixel, auf den Bildschirm begrenzt; mit der jetzigen Größe) */
	public int[] positionFor(int screenWidth, int screenHeight) {
		int[] p = placed(screenWidth, screenHeight);
		return new int[] {Math.clamp(p[0], 0, Math.max(0, screenWidth - lastWidth)), Math.clamp(p[1], 0, Math.max(0, screenHeight - lastHeight))};
	}

	private void place(int screenWidth, int screenHeight) {
		int x;
		int y;
		if (needsMigration) {
			// bis 0.13.1 gespeichert: linke obere Ecke, beim Zeichnen auf den Bildschirm begrenzt
			x = state.x;
			y = state.y;
		} else {
			int[] p = placed(screenWidth, screenHeight);
			x = p[0];
			y = p[1];
		}
		lastX = Math.clamp(x, 0, Math.max(0, screenWidth - lastWidth));
		lastY = Math.clamp(y, 0, Math.max(0, screenHeight - lastHeight));
	}

	/** Standardstelle: oben/links mit den Abständen aus dem Modul, „9999“ = rechts bzw. unten am Rand */
	private void applyDefaultPosition() {
		int column = defaultX >= 5000 ? 2 : 0;
		int row = defaultY >= 5000 ? 2 : 0;
		HudAnchor anchor = HudAnchor.of(column, row);
		state.anchor = anchor.id;
		int reference = referenceColumn(anchor);
		// gewünschte linke Kante bzw. rechte Kante bei MARGIN vom Rand, dann auf den Bezugspunkt des Elements umrechnen
		state.anchorX = column == 0 ? defaultX + part(reference, lastWidth) : -MARGIN - (lastWidth - part(reference, lastWidth));
		state.anchorY = row == 0 ? defaultY : -MARGIN;
		needsMigration = false;
	}

	public void resetPosition() {
		applyDefaultPosition();
		int[] p = placed(screenWidth(), screenHeight());
		lastX = Math.clamp(p[0], 0, Math.max(0, screenWidth() - lastWidth));
		lastY = Math.clamp(p[1], 0, Math.max(0, screenHeight() - lastHeight));
		state.x = lastX;
		state.y = lastY;
	}

	/** Position, Größe, Aussehen und Ebene zurück auf Standard */
	public void resetLayout() {
		for (String key : HudStyles.KEYS) state.options.remove(key);
		state.options.remove("scale");
		state.options.remove("layer");
		resetPosition();
	}

	/** true, wenn seit dem Start Positionen aus einer alten Konfiguration umgerechnet wurden (einmal speichern) */
	public static boolean takeMigrated() {
		boolean value = migrated;
		migrated = false;
		return value;
	}

	// ======================================================================================
	// Größe, Ebene, Aussehen
	// ======================================================================================

	/** Größe des Elements (Untermenü "Größe"), 1 = normal */
	public float scale() {
		return (float) Math.clamp(option("scale", 1.0), MIN_SCALE, MAX_SCALE);
	}

	/** Größe setzen (auf 5 % gerundet); gespeichert wird mit {@link HeldixConfig#save()}. */
	public void setScale(double scale) {
		double snapped = Math.round(Math.clamp(scale, MIN_SCALE, MAX_SCALE) * 20) / 20.0;
		state.options.put("scale", String.valueOf(snapped));
	}

	/** HUD-Größe × Größe des Elements */
	public float effectiveScale() {
		return (float) Math.clamp(scale() * Math.clamp(HeldixConfig.get().hudScale, 0.5f, 2f), 0.25, 4);
	}

	/** Faktor, mit dem zuletzt gezeichnet wurde (lokale Koordinaten → GUI-Pixel) */
	public float drawScale() {
		return drawScale;
	}

	/** Ebene: höhere liegen über niedrigeren (gleiche: Reihenfolge der Module) */
	public int layer() {
		return (int) option("layer", 0.0);
	}

	public void setLayer(int layer) {
		if (layer == 0) state.options.remove("layer");
		else state.options.put("layer", String.valueOf(layer));
	}

	/** Eigene Einstellung des Aussehens ({@link HudStyles#KEYS}), null = wie global */
	public String styleValue(String key) {
		return state.options.get(key);
	}

	/** null entfernt die eigene Einstellung; gespeichert wird mit {@link HeldixConfig#save()} */
	public void setStyleValue(String key, String value) {
		if (value == null) state.options.remove(key);
		else state.options.put(key, value);
	}

	/** Gespeicherter Zustand (für Rückgängig im HUD-Editor) */
	public HeldixConfig.ModuleState snapshot() {
		return state.copy();
	}

	public void restore(HeldixConfig.ModuleState snapshot) {
		boolean wasEnabled = isEnabled();
		boolean enable = snapshot.enabled;
		state.restore(snapshot);
		// an/aus über setEnabled, damit onEnable/onDisable laufen
		state.enabled = wasEnabled;
		setEnabled(enable);
		needsMigration = HudAnchor.byId(state.anchor) == null;
		int[] p = placed(screenWidth(), screenHeight());
		if (!needsMigration) {
			lastX = Math.clamp(p[0], 0, Math.max(0, screenWidth() - lastWidth));
			lastY = Math.clamp(p[1], 0, Math.max(0, screenHeight() - lastHeight));
		}
	}

	/**
	 * Einstellungen für das Aussehen, die der HUD-Editor im Rechtsklick-Menü des Elements zeigt (z. B. „Kompakt“).
	 * Leer = keine eigenen.
	 */
	public List<Setting> styleOptions() {
		return new ArrayList<>();
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	/** Zeichnet das Element und merkt sich Position und Größe (für den HUD-Editor). */
	public final void extract(GuiGraphicsExtractor g, Minecraft mc) {
		extract(g, mc, false);
	}

	/**
	 * Zeichnet das Element im HUD-Editor: fehlen Spieldaten (z. B. im Hauptmenü ohne Welt),
	 * erscheint ein Platzhalter mit dem Namen, damit man es trotzdem anordnen kann.
	 */
	public final void extractPreview(GuiGraphicsExtractor g, Minecraft mc) {
		extract(g, mc, true);
	}

	/** true, solange das Element im HUD-Editor gezeichnet wird */
	protected boolean isPreviewing() {
		return previewing;
	}

	/** true, solange der Spieler das HUD mit der Maus bedient (nicht im HUD-Editor) */
	protected boolean interactive() {
		return !previewing && HudInteraction.active();
	}

	/** Steht die Maus über diesem Bereich (lokale Koordinaten), während das HUD bedienbar ist? */
	protected boolean hovered(float x, float y, float w, float h) {
		if (!interactive()) return false;
		float[] local = HudInteraction.local(this);
		return local != null && local[0] >= x && local[0] < x + w && local[1] >= y && local[1] < y + h;
	}

	/** Bereich mit Tooltip anmelden (beim Zeichnen; lokale Koordinaten) */
	protected void hotspot(String id, float x, float y, float w, float h, List<String> tooltip) {
		if (collecting != null && w > 0 && h > 0) collecting.add(new Hotspot(id == null ? "" : id, x, y, w, h, tooltip == null ? List.of() : tooltip));
	}

	/** Bereiche aus dem letzten Bild */
	public List<Hotspot> hotspots() {
		return hotspots;
	}

	/** Oberster Bereich an dieser lokalen Stelle oder null */
	public Hotspot hotspotAt(float x, float y) {
		for (int i = hotspots.size() - 1; i >= 0; i--) {
			if (hotspots.get(i).contains(x, y)) return hotspots.get(i);
		}
		return null;
	}

	/** Für die Addon-Zeichenfläche: Bereich im Namen des Elements anmelden */
	public void addHotspot(Hotspot hotspot) {
		if (collecting != null) collecting.add(hotspot);
	}

	private void extract(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
		previewing = preview;
		int screenWidth = g.guiWidth();
		int screenHeight = g.guiHeight();
		place(screenWidth, screenHeight);

		HudStyles.Resolved style = HudStyles.resolve(this);
		int gui = Math.max(1, mc.getWindow().getGuiScale());
		float scale = style.scale();
		int pixels = Math.max(1, Math.round(gui * scale));
		float factor = HeldixConfig.get().hudCrisp ? pixels / (float) gui : scale;
		drawScale = factor;

		HudModule previousModule = drawing;
		HudStyles.Resolved previousStyle = HudStyles.begin(style);
		int previousScale = Ui.pushScale(pixels);
		drawing = this;
		collecting = new ArrayList<>();
		long size;
		g.pose().pushMatrix();
		try {
			g.pose().translate(lastX, lastY);
			if (factor != 1f) g.pose().scale(factor, factor);
			size = drawSafely(g, mc, 0, 0, preview);
		} finally {
			g.pose().popMatrix();
			Ui.popScale(previousScale);
			HudStyles.end(previousStyle);
			drawing = previousModule;
		}
		hotspots = collecting;
		collecting = null;
		lastWidth = Math.max(1, (int) Math.ceil((int) (size >> 32) * factor));
		lastHeight = Math.max(1, (int) Math.ceil((int) size * factor));
		if (needsMigration) {
			setPosition(Math.clamp(state.x, 0, Math.max(0, screenWidth - lastWidth)), Math.clamp(state.y, 0, Math.max(0, screenHeight - lastHeight)),
					screenWidth, screenHeight);
			migrated = true;
		}
	}

	private long drawSafely(GuiGraphicsExtractor g, Minecraft mc, int x, int y, boolean preview) {
		if (!preview) return draw(g, mc, x, y);
		long size;
		try {
			size = draw(g, mc, x, y);
		} catch (RuntimeException e) {
			size = 0;
		}
		if ((int) (size >> 32) <= 0 || (int) size <= 0) {
			size = drawLabelValue(g, mc.font, x, y, name(), "Vorschau", Theme.FAINT);
		}
		return size;
	}

	@Override
	public java.util.List<Setting> settings() {
		java.util.List<Setting> settings = super.settings();
		settings.add(slider("scale", "Größe", "Wie groß das Element im HUD ist", 0.5, 2.0, 0.1, 1.0, Setting::percent));
		settings.add(new Setting.Action("Position", "Zurück an die Standardstelle", "Zurücksetzen", () -> {
			resetPosition();
			HeldixConfig.save();
		}));
		return settings;
	}

	/**
	 * Zeichnet das Element an (x, y).
	 * @return Breite und Höhe, gepackt mit {@link #size(int, int)}
	 */
	protected abstract long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y);

	protected static long size(int width, int height) {
		return ((long) width << 32) | (height & 0xFFFFFFFFL);
	}

	// ======================================================================================
	// Bedienen im Spiel
	// ======================================================================================

	/** Maus über dem Element (lokal in pointer): Tooltip und Mauszeiger. Standard: der des Bereichs. */
	public void onHover(Minecraft mc, HudPointer pointer) {
	}

	/** Klick auf das Element. @return true = verbraucht (sonst öffnet ein Rechtsklick die Einstellungen) */
	public boolean onClick(Minecraft mc, HudPointer pointer) {
		return false;
	}

	// ======================================================================================
	// Zeichenhilfen im HUD-Stil
	// ======================================================================================

	/** Fläche im aktuellen HUD-Stil (Heldix: abgerundet mit Rahmen, Klassisch: Streifen links). */
	protected static void background(GuiGraphicsExtractor g, int x, int y, int width, int height) {
		HudStyles.panel(g, x, y, width, height);
	}

	/** Breite, die kurze Ziffernwechsel überdauert (wird erst nach einer Sekunde schmaler) */
	protected static int stable(int width) {
		HudModule module = drawing;
		if (module == null || module.previewing) return width;
		long now = System.currentTimeMillis();
		if (width >= module.stableWidth) {
			module.stableWidth = width;
			module.shrinkingSince = 0;
		} else if (module.shrinkingSince == 0) {
			module.shrinkingSince = now;
		} else if (now - module.shrinkingSince > 1000) {
			module.stableWidth = width;
			module.shrinkingSince = 0;
		}
		return module.stableWidth;
	}

	/** Versatz für Inhalt der Breite content in einer Fläche mit Innenbreite inner, je nach Ausrichtung */
	protected static int alignOffset(int inner, int content) {
		int align = HudStyles.current().alignIndex();
		if (align == 1) return (inner - content) / 2;
		if (align == 2) return inner - content;
		return 0;
	}

	/** Standard-Darstellung: "Label Wert" in einer kleinen Box. */
	public static long drawLabelValue(GuiGraphicsExtractor g, Font font, int x, int y, String label, String value) {
		return drawLabelValue(g, font, x, y, label, value, HudStyles.current().textColor());
	}

	/** Wie {@link #drawLabelValue(GuiGraphicsExtractor, Font, int, int, String, String)}, mit eigener Farbe für den Wert. */
	public static long drawLabelValue(GuiGraphicsExtractor g, Font font, int x, int y, String label, String value, int valueColor) {
		HudStyles.Resolved s = HudStyles.current();
		int labelWidth = HudStyles.width(label, true);
		int gap = label == null || label.isEmpty() ? 0 : 4;
		int content = labelWidth + gap + HudStyles.width(value, false);
		int width = stable(s.padLeft + content + s.padRight);
		int height = s.padY * 2 + 8;
		background(g, x, y, width, height);
		int textX = x + s.padLeft + alignOffset(width - s.padLeft - s.padRight, content);
		int textY = y + s.padY;
		HudStyles.text(g, label, textX, textY, s.labelColor(), true);
		HudStyles.text(g, value, textX + labelWidth + gap, textY, valueColor, false);
		return size(width, height);
	}

	/** Mehrzeilige Box: jede Zeile {label, wert}, Werte bündig untereinander (rechtsbündig bei Ausrichtung rechts). */
	public static long drawLabelValues(GuiGraphicsExtractor g, Font font, int x, int y, String[][] rows) {
		HudStyles.Resolved s = HudStyles.current();
		int labelWidth = 0;
		int valueWidth = 0;
		for (String[] row : rows) {
			labelWidth = Math.max(labelWidth, HudStyles.width(row[0], true));
			valueWidth = Math.max(valueWidth, HudStyles.width(row[1], false));
		}
		int lineHeight = 11;
		int width = stable(s.padLeft + labelWidth + 6 + valueWidth + s.padRight);
		int height = s.padY * 2 + rows.length * lineHeight - 3;
		background(g, x, y, width, height);
		int textX = x + s.padLeft;
		int valueRight = x + width - s.padRight;
		int lineY = y + s.padY;
		int align = s.alignIndex();
		for (String[] row : rows) {
			HudStyles.text(g, row[0], textX, lineY, s.labelColor(), true);
			int w = HudStyles.width(row[1], false);
			int vx = align == 2 ? valueRight - w : align == 1 ? textX + labelWidth + 6 + (valueRight - textX - labelWidth - 6 - w) / 2 : textX + labelWidth + 6;
			HudStyles.text(g, row[1], vx, lineY, s.textColor(), false);
			lineY += lineHeight;
		}
		return size(width, height);
	}
}
