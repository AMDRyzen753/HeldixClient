package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.device.GpuDevice;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.render.Performance;
import dev.heldixclient.render.ShaderEngine;
import dev.heldixclient.render.ShaderPreset;
import dev.heldixclient.render.Shaders;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.DoubleSupplier;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

/**
 * Heldix-Bereiche der gemeinsamen Oberfläche: Module, Shader, Leistung, Addons und Einstellungen.
 * Module erscheinen als Kacheln mit Icon; das Regler-Symbol öffnet die Einstellungen eines Moduls.
 * Im Spiel öffnet die Rechte Umschalttaste diese Seite.
 */
public class HeldixMenuScreen extends ShellScreen {
	private static final int GAP = 8;
	private static final int TILE_H = 66;
	private static final int TILE_MIN_W = 118;
	private static final int CHIP_H = 22;
	private static final int ADDON_H = 46;

	/** Filter auf der Seite Module */
	private enum Filter {
		ALL("Alle"),
		HUD("HUD"),
		FEATURES("Funktionen"),
		ADDONS("Addons");

		final String label;

		Filter(String label) {
			this.label = label;
		}

		boolean matches(Module module) {
			return switch (this) {
				case ALL -> true;
				case HUD -> module instanceof HudModule && module.source() == null;
				case FEATURES -> !(module instanceof HudModule) && module.source() == null;
				case ADDONS -> module.source() != null;
			};
		}
	}

	private final Screen parent;
	/** direkt mit Untermenü geöffnet (z. B. aus dem HUD-Editor): "Zurück" führt dorthin zurück */
	private final boolean directSubmenu;
	/** Animationswerte (Schalter, Hover) je Objekt */
	private final Map<Object, Float> anim = new HashMap<>();
	private long lastFrame = System.nanoTime();
	private float frameDt;
	/** geöffnetes Untermenü (Einstellungen eines Moduls), sonst null */
	private Module openModule;
	private double scroll;
	private SearchField search;
	private String searchText = "";
	private Filter filter = Filter.ALL;
	private List<Row> rows = List.of();

	private Setting.Slider dragging;
	private float dragX;
	private float dragW;

	private int bodyX;
	private int bodyW;
	private int bodyY;
	private int bodyH;

	public HeldixMenuScreen(Screen parent) {
		this(parent, Shell.Page.MODULES);
	}

	public HeldixMenuScreen(Screen parent, Shell.Page page) {
		this(parent, page, null);
	}

	/** Mit geöffnetem Untermenü eines Moduls (z. B. aus dem HUD-Editor per Rechtsklick). */
	public HeldixMenuScreen(Screen parent, Shell.Page page, Module module) {
		super(Component.literal(page.label), page);
		this.parent = parent;
		this.openModule = module;
		this.directSubmenu = module != null;
	}

	// ======================================================================================
	// Layout
	// ======================================================================================

	private void layout() {
		bodyX = contentX;
		bodyW = contentW - 8;
		bodyY = contentY;
		bodyH = contentH;
		rows = buildRows();
		scroll = Math.clamp(scroll, 0, maxScroll());
	}

	private int contentHeight() {
		int total = 0;
		for (Row row : rows) total += row.height(bodyW) + row.gapAfter();
		return Math.max(0, total);
	}

	private int maxScroll() {
		return Math.max(0, contentHeight() - bodyH);
	}

	/** Y-Position einer Zeile (für Klicks und den Autotest). */
	private int rowY(Row target) {
		int y = bodyY - (int) scroll;
		for (Row row : rows) {
			if (row == target) return y;
			y += row.height(bodyW) + row.gapAfter();
		}
		return y;
	}

	// ======================================================================================
	// Autotest-Hilfen
	// ======================================================================================

	/** Mitte eines Eintrags der Seitenleiste (MODULES, SHADER, PERFORMANCE, ADDONS, SETTINGS; INFO = SETTINGS). */
	public int[] tabCenter(String name) {
		Shell.Page target = name.equals("INFO") ? Shell.Page.SETTINGS : Shell.Page.valueOf(name);
		for (ShellNavButton button : nav) {
			if (button.page() == target) return new int[] {button.getX() + button.getWidth() / 2, button.getY() + button.getHeight() / 2};
		}
		throw new IllegalStateException("Kein Eintrag " + name + " in der Seitenleiste");
	}

	/** Mitte des Eintrags Addons (älterer Name, gleich {@code tabCenter("ADDONS")}). */
	public int[] addonsTabCenter() {
		return tabCenter("ADDONS");
	}

	/** Mitte der Modul-Kachel Nummer {@code index} (Seite Module). Ein Klick dort schaltet das Modul um. */
	public int[] cardCenter(int index) {
		layout();
		ModuleGrid grid = first(ModuleGrid.class);
		int[] cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		return new int[] {cell[0] + cell[2] / 2, cell[1] + TILE_H / 2 + 4};
	}

	/** Mitte des Regler-Symbols der Modul-Kachel Nummer {@code index} (öffnet das Untermenü). */
	public int[] settingsIconCenter(int index) {
		layout();
		ModuleGrid grid = first(ModuleGrid.class);
		int[] cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		return new int[] {cell[0] + cell[2] - 16, cell[1] + 17};
	}

	/** Mitte der Kachel Nummer {@code index} in der ersten Kachelreihe (Seite Shader: Farbstile). */
	public int[] shaderCenter(int index) {
		layout();
		Chips chips = first(Chips.class);
		int[] cell = chips.cell(index, bodyX, rowY(chips), bodyW);
		return new int[] {cell[0] + cell[2] / 2, cell[1] + CHIP_H / 2};
	}

	/** ID des Moduls, dessen Untermenü offen ist (null = keins). */
	public String openModuleId() {
		return openModule == null ? null : openModule.id();
	}

	public String currentTab() {
		return page.name();
	}

	private <T extends Row> T first(Class<T> type) {
		for (Row row : rows) {
			if (type.isInstance(row)) return type.cast(row);
		}
		throw new IllegalStateException("Keine " + type.getSimpleName() + " auf der Seite " + page);
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	@Override
	protected void initContent() {
		layout();
		search = null;
		if (openModule != null) {
			String back = "Zurück";
			int w = ActionButton.widthFor(back, "back");
			addRenderableWidget(new ActionButton(headerRight() - w, headerButtonY(), w, 20, back, false, this::closeSubmenu).withIcon("back"));
		} else if (page == Shell.Page.MODULES) {
			String hud = "HUD-Editor";
			int hw = ActionButton.widthFor(hud, "hud");
			boolean roomy = contentW >= 300;
			if (roomy) {
				addRenderableWidget(new ActionButton(headerRight() - hw, headerButtonY(), hw, 20, hud, true,
						() -> minecraft.gui.setScreen(new HudEditorScreen(this))).withIcon("hud"));
			}
			int w = Math.min(150, contentW / 3);
			int right = roomy ? headerRight() - hw - 6 : headerRight();
			search = new SearchField(right - w, headerButtonY(), w, 20, "Module suchen");
			search.setValue(searchText);
			search.setResponder(text -> {
				searchText = text;
				scroll = 0;
			});
			addRenderableWidget(search);
		}
	}

	@Override
	protected Component headerTitle() {
		return openModule != null ? Component.literal(openModule.name()) : super.headerTitle();
	}

	@Override
	protected String headerIcon() {
		return openModule != null ? openModule.icon() : super.headerIcon();
	}

	@Override
	protected String subtitle() {
		if (openModule != null) return openModule.source() != null ? "Addon: " + openModule.source() : "Einstellungen des Moduls";
		return switch (page) {
			case MODULES -> {
				long on = ModuleManager.all().stream().filter(Module::isEnabled).count();
				yield on + " von " + ModuleManager.all().size() + " Modulen aktiv";
			}
			case SHADER -> "Farbstile und Shader-Engine";
			case PERFORMANCE -> "Mehr FPS, weniger Last";
			case ADDONS -> AddonManager.addons().size() + (AddonManager.addons().size() == 1 ? " Addon installiert" : " Addons installiert");
			case SETTINGS -> "Design, HUD, Tasten und Versionen";
			default -> null;
		};
	}

	private List<Row> buildRows() {
		List<Row> list = new ArrayList<>();
		if (openModule != null) {
			list.add(new ModuleHeader(openModule));
			List<Setting> settings = openModule.settings();
			if (!settings.isEmpty()) list.add(new Section("Einstellungen", null));
			for (Setting setting : settings) list.add(new SettingRow(setting));
			return list;
		}
		switch (page) {
			case MODULES -> {
				boolean anyAddon = ModuleManager.all().stream().anyMatch(m -> m.source() != null);
				List<Filter> filters = new ArrayList<>(List.of(Filter.ALL, Filter.HUD, Filter.FEATURES));
				if (anyAddon) filters.add(Filter.ADDONS);
				if (!filters.contains(filter)) filter = Filter.ALL;
				list.add(new Filters(filters));
				List<Module> modules = new ArrayList<>();
				String query = searchText.trim().toLowerCase(Locale.ROOT);
				for (Module module : ModuleManager.all()) {
					if (!filter.matches(module)) continue;
					if (query.isEmpty() || module.name().toLowerCase(Locale.ROOT).contains(query)
							|| module.description().toLowerCase(Locale.ROOT).contains(query)) {
						modules.add(module);
					}
				}
				if (modules.isEmpty()) list.add(new Text(query.isEmpty() ? "Keine Module in diesem Bereich." : "Kein Modul passt zu „" + searchText.trim() + "“.", Ui.MUTED));
				else list.add(new ModuleGrid(modules));
			}
			case SHADER -> buildShaderRows(list);
			case PERFORMANCE -> buildPerformanceRows(list);
			case ADDONS -> buildAddonRows(list);
			case SETTINGS -> {
				buildSettingsRows(list);
				buildInfoRows(list);
			}
			default -> {
			}
		}
		return list;
	}

	private void buildShaderRows(List<Row> list) {
		if (dev.heldixclient.render.IrisCompat.shaderPackActive()) {
			list.add(new Notice("warning", "Ein Iris-Shaderpack ist aktiv. Die Heldix-Shader sind so lange pausiert; ändern unter Optionen → Grafik → Shaderpacks.", Ui.WARNING));
		}
		ShaderPreset current = Shaders.current();
		list.add(new Section("Farbstil", current.label() + ": " + current.description()));
		ShaderPreset[] presets = ShaderPreset.values();
		List<String> labels = new ArrayList<>();
		for (ShaderPreset preset : presets) labels.add(preset.label());
		list.add(new Chips(labels, 4, () -> Shaders.current().ordinal(), index -> Shaders.select(presets[index])));

		list.add(new Section("Shader-Engine", "Effekte mit Tiefeninformation"));
		list.add(new Chips(List.of("Aus", "Dezent", "Kräftig"), 3, ShaderEngine::currentLevel, ShaderEngine::applyLevel));
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new SettingRow(engineSlider("Leuchten (Bloom)", "Helle Stellen strahlen", () -> config.bloom, v -> config.bloom = v)));
		list.add(new SettingRow(engineSlider("Tiefenunschärfe", "Ferne Dinge werden weich", () -> config.depthOfField, v -> config.depthOfField = v)));
		list.add(new SettingRow(engineSlider("Nebel", "Dunst in der Ferne", () -> config.fog, v -> config.fog = v)));
		list.add(new SettingRow(engineSlider("Umgebungsverdeckung", "Schatten in Ecken und Spalten (SSAO)",
				() -> config.ambientOcclusion, v -> config.ambientOcclusion = v)));
		list.add(new Notice("info", "Shaderpacks wie BSL laufen über Iris in Fabric-Instanzen (Launcher → Instanz → Shader).", Ui.ACCENT_TEXT));
	}

	private Setting.Slider engineSlider(String label, String description, DoubleSupplier get, Consumer<Float> set) {
		return new Setting.Slider(label, description, 0, 1, 0.05, get, value -> {
			set.accept((float) value);
			ShaderEngine.changed();
		}, Setting::percent);
	}

	private void buildPerformanceRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new SettingRow(new Setting.Toggle("FPS-Boost", "Teure Grafik-Effekte aus; ausschalten stellt alles wieder her",
				Performance::boostEnabled, Performance::setBoost)));
		list.add(new SettingRow(configToggle("Hintergrund-FPS", "Weniger Bilder, solange das Fenster nicht aktiv ist",
				() -> config.backgroundFps, v -> config.backgroundFps = v)));
		list.add(new SettingRow(new Setting.Slider("Grenze im Hintergrund", "", 5, 60, 5, () -> config.backgroundFpsLimit, value -> {
			config.backgroundFpsLimit = (int) value;
			HeldixConfig.save();
		}, value -> Math.round(value) + " FPS")));
		list.add(new Section("Grafik", null));
		list.add(new Info("Grafik-API", DebugOverlay.backend()));
		list.add(new Info("Grafikkarte", gpuName()));
		list.add(new Notice("info", "Die Grafik-API stellst du im Launcher um (Einstellungen → Leistung).", Ui.ACCENT_TEXT));
	}

	private void buildAddonRows(List<Row> list) {
		List<LoadedAddon> addons = AddonManager.addons();
		list.add(new Section("Installiert", addons.size() + (addons.size() == 1 ? " Addon" : " Addons")));
		if (addons.isEmpty()) {
			list.add(new Text("Keine Addons installiert. Lege Heldix-Addons (.jar) in den Ordner " + AddonManager.ADDON_DIR
					+ " deiner Instanz oder installiere sie im Launcher.", Ui.MUTED));
		}
		for (LoadedAddon addon : addons) list.add(new AddonCard(addon));
		list.add(new Text("Heldix Loader " + HeldixLoader.version() + "  ·  Addon-API " + HeldixApi.API_VERSION, Ui.FAINT));
	}

	private void buildSettingsRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new Section("Design", null));
		list.add(new SettingRow(configToggle("Heldix-Design für Menüs", "Startseite, Einzel- und Mehrspieler sowie Knöpfe im Heldix-Stil",
				() -> config.customMenus, v -> config.customMenus = v)));
		list.add(new SettingRow(configToggle("Heldix-Hintergrund", "Eigenes Motiv statt des Minecraft-Panoramas",
				() -> config.heldixBackground, v -> config.heldixBackground = v)));
		list.add(new SettingRow(configToggle("Ladebildschirm", "Heldix-Logo statt Mojang beim Laden",
				() -> config.customLoadingScreen, v -> config.customLoadingScreen = v)));
		list.add(new SettingRow(configToggle("F3-Menü im Heldix-Design", "Dunkle Zeilen mit Akzentlinie",
				() -> config.customDebugScreen, v -> config.customDebugScreen = v)));
		list.add(new SettingRow(configToggle("HUD-Hintergrund", "Dunkle Box hinter den HUD-Elementen",
				() -> config.hudBackground, v -> config.hudBackground = v)));
		list.add(new Section("HUD", null));
		list.add(new SettingRow(new Setting.Action("HUD-Editor", "Elemente verschieben, vergrößern, ein- und ausblenden", "Öffnen",
				() -> minecraft.gui.setScreen(new HudEditorScreen(this)))));
		list.add(new SettingRow(new Setting.Action("Positionen", "Alle Elemente an ihre Standardstelle", "Zurücksetzen", () -> {
			ModuleManager.hud().forEach(HudModule::resetPosition);
			HeldixConfig.save();
		})));
		list.add(new Section("Tasten", null));
		list.add(new Info("Heldix-Menü", HeldixClient.menuKey.getTranslatedKeyMessage().getString()));
		list.add(new Info("Zoom", HeldixClient.zoomKey.getTranslatedKeyMessage().getString()));
		list.add(new Text("Ändern unter Optionen → Steuerung → HeldixClient.", Ui.FAINT));
	}

	private Setting.Toggle configToggle(String label, String description, BooleanSupplier get, Consumer<Boolean> set) {
		return new Setting.Toggle(label, description, get, value -> {
			set.accept(value);
			HeldixConfig.save();
		});
	}

	private void buildInfoRows(List<Row> list) {
		list.add(new Section("Version", null));
		list.add(new Info("HeldixClient", HeldixClient.version));
		list.add(new Info("Heldix Loader", HeldixLoader.version()));
		list.add(new Info("Minecraft", HeldixLoader.minecraftVersion()));
		list.add(new Info("Java", System.getProperty("java.version")));
		list.add(new Info("Grafik", DebugOverlay.backend() + " · " + gpuName()));
		list.add(new Section("Mods", HeldixLoader.mods().size() + " geladen"));
		for (ModInfo mod : HeldixLoader.mods()) list.add(new Info(mod.name(), mod.version()));
		List<String> problems = HeldixLoader.problems();
		if (!problems.isEmpty()) {
			list.add(new Section("Hinweise beim Start", Integer.toString(problems.size())));
			for (String problem : problems) list.add(new Text(problem, Ui.DANGER));
		}
		list.add(new Text("Schrift: Inter (SIL Open Font License 1.1)", Ui.FAINT));
	}

	private static String gpuName() {
		GpuDevice device = RenderSystem.tryGetDevice();
		return device == null ? "?" : device.getDeviceInfo().name();
	}

	// ======================================================================================
	// Zeilen
	// ======================================================================================

	/** Ein Element im Inhaltsbereich; Position und Breite werden beim Zeichnen übergeben. */
	private interface Row {
		int height(int width);

		void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY);

		default boolean click(double mouseX, double mouseY, int x, int y, int w) {
			return false;
		}

		/** Abstand zur nächsten Zeile */
		default int gapAfter() {
			return 6;
		}
	}

	/** Überschrift eines Abschnitts mit optionalem Hinweis daneben. */
	private final class Section implements Row {
		private final String title;
		private final String hint;

		Section(String title, String hint) {
			this.title = title;
			this.hint = hint;
		}

		@Override
		public int height(int width) {
			return 18;
		}

		@Override
		public int gapAfter() {
			return 4;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String head = title.toUpperCase(Locale.ROOT);
			Ui.text(g, head, x + 2, y + 8, Ui.FAINT, Ui.Font.SMALL);
			if (hint != null) {
				int hx = x + 2 + Ui.width(head, Ui.Font.SMALL) + 8;
				Ui.text(g, Ui.ellipsize(hint, x + w - hx, Ui.Font.SMALL), hx, y + 8, Ui.MUTED, Ui.Font.SMALL);
			}
		}
	}

	/** Mehrzeiliger Text (umgebrochen). */
	private final class Text implements Row {
		private final String text;
		private final int color;

		Text(String text, int color) {
			this.text = text;
			this.color = color;
		}

		@Override
		public int height(int width) {
			return Ui.wrap(text, width - 4, Ui.Font.BODY).size() * 11 + 2;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int lineY = y + 2;
			for (FormattedCharSequence line : Ui.wrap(text, w - 4, Ui.Font.BODY)) {
				g.text(font, line, x + 2, lineY, color, false);
				lineY += 11;
			}
		}
	}

	/** Hinweis mit Icon in einer getönten Fläche */
	private final class Notice implements Row {
		private final String icon;
		private final String text;
		private final int color;

		Notice(String icon, String text, int color) {
			this.icon = icon;
			this.text = text;
			this.color = color;
		}

		@Override
		public int height(int width) {
			return Ui.wrap(text, width - 34, Ui.Font.BODY).size() * 11 + 14;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			Ui.rect(g, x, y, w, h, 8, (color & 0xFFFFFF) | 0x14000000);
			Ui.outline(g, x, y, w, h, 8, (color & 0xFFFFFF) | 0x33000000);
			Ui.icon(g, icon, x + 10, y + 7, 11, color);
			int lineY = y + 8;
			for (FormattedCharSequence line : Ui.wrap(text, w - 34, Ui.Font.BODY)) {
				g.text(font, line, x + 28, lineY, 0xFFD5DCE8, false);
				lineY += 11;
			}
		}
	}

	/** "Bezeichnung …… Wert" */
	private final class Info implements Row {
		private final String label;
		private final String value;

		Info(String label, String value) {
			this.label = label;
			this.value = value == null ? "-" : value;
		}

		@Override
		public int height(int width) {
			return 16;
		}

		@Override
		public int gapAfter() {
			return 0;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String shownLabel = Ui.ellipsize(label, w / 2, Ui.Font.BODY);
			Ui.text(g, shownLabel, x + 2, y + 4, Ui.MUTED, Ui.Font.BODY);
			String shown = Ui.ellipsize(value, w - Ui.width(shownLabel, Ui.Font.BODY) - 16, Ui.Font.BODY);
			Ui.textRight(g, shown, x + w - 2, y + 4, Ui.TEXT, Ui.Font.BODY);
			Ui.hline(g, x, x + w, y + 15, Ui.LINE);
		}
	}

	/** Kopf eines Untermenüs: großes Icon, Name, Beschreibung und Hauptschalter */
	private final class ModuleHeader implements Row {
		private final Module module;

		ModuleHeader(Module module) {
			this.module = module;
		}

		@Override
		public int height(int width) {
			return 48;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean on = module.isEnabled();
			float t = animate(module, on ? 1f : 0f);
			int accent = module.source() != null ? Ui.SUCCESS : Ui.ACCENT;
			Ui.rect(g, x, y, w, 48, 10, Ui.lerp(Ui.SURFACE, (accent & 0xFFFFFF) | 0x1A000000, t));
			Ui.outline(g, x, y, w, 48, 10, Ui.lerp(Ui.LINE, (accent & 0xFFFFFF) | 0x66000000, t));
			Ui.rect(g, x + 10, y + 9, 30, 30, 8, Ui.lerp(0x1AFFFFFF, accent, t));
			Ui.icon(g, module.icon(), x + 17, y + 16, 16, Ui.lerp(Ui.MUTED, 0xFFFFFFFF, t));
			int textW = w - 50 - 70;
			Ui.text(g, Ui.ellipsize(module.name(), textW, Ui.Font.LABEL), x + 50, y + 12, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(module.description(), textW, Ui.Font.SMALL), x + 50, y + 26, Ui.MUTED, Ui.Font.SMALL);
			String state = on ? "Aktiv" : "Aus";
			Ui.textRight(g, state, x + w - 36, y + 20, on ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
			Ui.toggle(g, x + w - 30, y + 19, t);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			module.toggle();
			return true;
		}

		@Override
		public int gapAfter() {
			return 10;
		}
	}

	/** Eine Einstellung: Schalter, Regler, Auswahl oder Knopf. */
	private final class SettingRow implements Row {
		private final Setting setting;

		SettingRow(Setting setting) {
			this.setting = setting;
		}

		private boolean hasDescription() {
			return setting.description() != null && !setting.description().isEmpty();
		}

		@Override
		public int height(int width) {
			if (setting instanceof Setting.Slider) return hasDescription() ? 44 : 34;
			return hasDescription() ? 34 : 26;
		}

		/** Breite des Bedienelements rechts */
		private int controlWidth() {
			return switch (setting) {
				case Setting.Toggle toggle -> 18;
				case Setting.Choice choice -> {
					int max = 0;
					for (String option : choice.options()) max = Math.max(max, Ui.width(option, Ui.Font.LABEL));
					yield max + 34;
				}
				case Setting.Action action -> Ui.width(action.button(), Ui.Font.LABEL) + 20;
				case Setting.Slider slider -> 0;
			};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, h);
			float t = animate(this, hover ? 1f : 0f);
			Ui.rect(g, x, y, w, h, 9, Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, t));
			Ui.outline(g, x, y, w, h, 9, Ui.LINE);
			boolean slider = setting instanceof Setting.Slider;
			int textW = slider ? w - 80 : w - 24 - controlWidth() - 8;
			int labelY = hasDescription() ? y + 8 : y + (h - 8) / 2;
			if (slider) labelY = y + 8;
			Ui.text(g, Ui.ellipsize(setting.label(), textW, Ui.Font.LABEL), x + 12, labelY, Ui.TEXT, Ui.Font.LABEL);
			if (hasDescription()) {
				Ui.text(g, Ui.ellipsize(setting.description(), slider ? w - 24 : textW, Ui.Font.SMALL), x + 12, labelY + 12, Ui.MUTED, Ui.Font.SMALL);
			}
			switch (setting) {
				case Setting.Toggle toggle -> {
					float on = animate(setting.label() + "#toggle", toggle.get().getAsBoolean() ? 1f : 0f);
					Ui.toggle(g, x + w - 30, y + (h - 10) / 2f, on);
				}
				case Setting.Slider s -> drawSlider(g, s, x, y, w, h, mouseX, mouseY);
				case Setting.Choice choice -> {
					int cw = controlWidth();
					int cx = x + w - 12 - cw;
					int cy = y + (h - 18) / 2;
					boolean over = Ui.inside(mouseX, mouseY, cx, cy, cw, 18);
					Ui.rect(g, cx, cy, cw, 18, 9, over ? Ui.SURFACE_STRONG : 0x14FFFFFF);
					Ui.icon(g, "chevron-left", cx + 4, cy + 4, 10, Ui.ACCENT_TEXT);
					Ui.icon(g, "chevron-right", cx + cw - 14, cy + 4, 10, Ui.ACCENT_TEXT);
					String value = choice.current();
					Ui.textCentered(g, value, cx + cw / 2, cy + 5, Ui.TEXT, Ui.Font.LABEL);
				}
				case Setting.Action action -> {
					int bw = controlWidth();
					int bx = x + w - 12 - bw;
					int by = y + (h - 18) / 2;
					boolean over = Ui.inside(mouseX, mouseY, bx, by, bw, 18);
					Ui.rect(g, bx, by, bw, 18, 9, over ? Ui.ACCENT_HOVER : Ui.ACCENT);
					Ui.textCentered(g, action.button(), bx + bw / 2, by + 5, 0xFFFFFFFF, Ui.Font.LABEL);
				}
			}
		}

		private void drawSlider(GuiGraphicsExtractor g, Setting.Slider slider, int x, int y, int w, int h, int mouseX, int mouseY) {
			double value = slider.get().getAsDouble();
			String shown = slider.format().apply(value);
			Ui.textRight(g, shown, x + w - 12, y + 8, Ui.ACCENT_TEXT, Ui.Font.LABEL);
			float tx = x + 12;
			float tw = w - 24;
			float ty = y + h - 11;
			float t = (float) ((value - slider.min()) / (slider.max() - slider.min()));
			Ui.rect(g, tx, ty, tw, 4, 2, 0x24FFFFFF);
			float fill = tw * Math.clamp(t, 0f, 1f);
			if (fill > 0) Ui.rect(g, tx, ty, fill, 4, 2, Ui.ACCENT);
			boolean active = dragging == slider || Ui.inside(mouseX, mouseY, tx - 3, ty - 6, tw + 6, 16);
			float knob = active ? 5.5f : 4.5f;
			Ui.circle(g, tx + fill, ty + 2, knob + 1, 0x55000000);
			Ui.circle(g, tx + fill, ty + 2, knob, 0xFFFFFFFF);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int h = height(w);
			switch (setting) {
				case Setting.Toggle toggle -> {
					toggle.set().accept(!toggle.get().getAsBoolean());
					HeldixMenuScreen.this.click();
					return true;
				}
				case Setting.Slider slider -> {
					float tx = x + 12;
					float tw = w - 24;
					float ty = y + h - 11;
					if (!Ui.inside(mouseX, mouseY, tx - 6, ty - 9, tw + 12, 20)) return false;
					dragging = slider;
					dragX = tx;
					dragW = tw;
					dragTo(mouseX);
					return true;
				}
				case Setting.Choice choice -> {
					int cw = controlWidth();
					boolean back = mouseX < x + w - 12 - cw / 2.0 && mouseX >= x + w - 12 - cw;
					int size = choice.options().size();
					choice.set().accept(Math.floorMod(choice.get().getAsInt() + (back ? -1 : 1), size));
					HeldixMenuScreen.this.click();
					return true;
				}
				case Setting.Action action -> {
					int bw = controlWidth();
					if (!Ui.inside(mouseX, mouseY, x + w - 12 - bw, y, bw, h)) return false;
					HeldixMenuScreen.this.click();
					action.run().run();
					return true;
				}
			}
		}
	}

	/** Kacheln zum Auswählen (Shader-Stile, Stufen). */
	private final class Chips implements Row {
		private final List<String> labels;
		private final int cols;
		private final IntSupplier active;
		private final IntConsumer select;

		Chips(List<String> labels, int cols, IntSupplier active, IntConsumer select) {
			this.labels = labels;
			this.cols = cols;
			this.active = active;
			this.select = select;
		}

		private int columns(int w) {
			return Math.max(1, Math.min(cols, (w + 6) / (76 + 6)));
		}

		int[] cell(int index, int x, int y, int w) {
			int c = columns(w);
			int cw = (w - 6 * (c - 1)) / c;
			return new int[] {x + (index % c) * (cw + 6), y + (index / c) * (CHIP_H + 6), cw};
		}

		@Override
		public int height(int width) {
			int c = columns(width);
			return (labels.size() + c - 1) / c * (CHIP_H + 6) - 6;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int current = active.getAsInt();
			for (int i = 0; i < labels.size(); i++) {
				int[] cell = cell(i, x, y, w);
				boolean on = i == current;
				boolean hover = Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], CHIP_H);
				Ui.rect(g, cell[0], cell[1], cell[2], CHIP_H, 8, on ? Ui.ACCENT_SOFT : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
				Ui.outline(g, cell[0], cell[1], cell[2], CHIP_H, 8, on ? Ui.ACCENT_LINE : Ui.LINE);
				String label = Ui.ellipsize(labels.get(i), cell[2] - 10, Ui.Font.LABEL);
				Ui.textCentered(g, label, cell[0] + cell[2] / 2, cell[1] + 7, on ? Ui.TEXT : Ui.MUTED, Ui.Font.LABEL);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < labels.size(); i++) {
				int[] cell = cell(i, x, y, w);
				if (Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], CHIP_H)) {
					HeldixMenuScreen.this.click();
					select.accept(i);
					return true;
				}
			}
			return false;
		}
	}

	/** Filter der Modulliste als Pillen in einer Reihe */
	private final class Filters implements Row {
		private final List<Filter> filters;

		Filters(List<Filter> filters) {
			this.filters = filters;
		}

		private String label(Filter f) {
			long count = ModuleManager.all().stream().filter(f::matches).count();
			return f.label + "  " + count;
		}

		@Override
		public int height(int width) {
			return 20;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int fx = x;
			for (Filter f : filters) {
				String label = label(f);
				int fw = Ui.width(label, Ui.Font.LABEL) + 18;
				boolean on = f == filter;
				boolean hover = Ui.inside(mouseX, mouseY, fx, y, fw, 20);
				Ui.rect(g, fx, y, fw, 20, 10, on ? Ui.ACCENT : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
				if (!on) Ui.outline(g, fx, y, fw, 20, 10, Ui.LINE);
				Ui.text(g, label, fx + 9, y + 6, on ? 0xFFFFFFFF : Ui.MUTED, Ui.Font.LABEL);
				fx += fw + 6;
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int fx = x;
			for (Filter f : filters) {
				int fw = Ui.width(label(f), Ui.Font.LABEL) + 18;
				if (Ui.inside(mouseX, mouseY, fx, y, fw, 20)) {
					HeldixMenuScreen.this.click();
					filter = f;
					scroll = 0;
					return true;
				}
				fx += fw + 6;
			}
			return false;
		}
	}

	/** Module als Kacheln: Klick schaltet um, das Regler-Symbol öffnet das Untermenü. */
	private final class ModuleGrid implements Row {
		private final List<Module> modules;

		ModuleGrid(List<Module> modules) {
			this.modules = modules;
		}

		private int columns(int w) {
			return Math.clamp((w + GAP) / (TILE_MIN_W + GAP), 1, 5);
		}

		int[] cell(int index, int x, int y, int w) {
			int c = columns(w);
			int cw = (w - GAP * (c - 1)) / c;
			return new int[] {x + (index % c) * (cw + GAP), y + (index / c) * (TILE_H + GAP), cw};
		}

		@Override
		public int height(int width) {
			int c = columns(width);
			return (modules.size() + c - 1) / c * (TILE_H + GAP) - GAP;
		}

		private boolean onSettings(Module module, double mouseX, double mouseY, int[] cell) {
			return !module.settings().isEmpty() && Ui.inside(mouseX, mouseY, cell[0] + cell[2] - 26, cell[1] + 7, 20, 20);
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			for (int i = 0; i < modules.size(); i++) {
				Module module = modules.get(i);
				int[] cell = cell(i, x, y, w);
				int cx = cell[0];
				int cy = cell[1];
				int cw = cell[2];
				boolean on = module.isEnabled();
				boolean hover = Ui.inside(mouseX, mouseY, cx, cy, cw, TILE_H);
				float t = animate(module, on ? 1f : 0f);
				float h = animate("hover#" + module.id(), hover ? 1f : 0f);
				int accent = module.source() != null ? Ui.SUCCESS : Ui.ACCENT;

				int base = Ui.lerp(Ui.SURFACE, (accent & 0xFFFFFF) | 0x17000000, t);
				Ui.rect(g, cx, cy, cw, TILE_H, 10, Ui.lerp(base, Ui.lerp(Ui.SURFACE_HOVER, (accent & 0xFFFFFF) | 0x26000000, t), h));
				Ui.outline(g, cx, cy, cw, TILE_H, 10, Ui.lerp(Ui.LINE, (accent & 0xFFFFFF) | 0x80000000, t));

				// Icon
				Ui.rect(g, cx + 10, cy + 10, 26, 26, 8, Ui.lerp(0x16FFFFFF, accent, t));
				Ui.icon(g, module.icon(), cx + 16, cy + 16, 14, Ui.lerp(Ui.MUTED, 0xFFFFFFFF, t));

				// Regler-Symbol
				boolean hasSettings = !module.settings().isEmpty();
				if (hasSettings) {
					boolean overGear = onSettings(module, mouseX, mouseY, cell);
					if (overGear) Ui.rect(g, cx + cw - 26, cy + 7, 20, 20, 6, Ui.SURFACE_STRONG);
					Ui.icon(g, "options", cx + cw - 21, cy + 12, 10, overGear ? Ui.TEXT : Ui.FAINT);
					if (overGear) Ui.requestTooltip("Einstellungen", mouseX, mouseY);
				}

				// Name, Beschreibung, Schalter
				int textW = cw - 20 - 24;
				Ui.text(g, Ui.ellipsize(module.name(), textW, Ui.Font.LABEL), cx + 10, cy + 42, Ui.TEXT, Ui.Font.LABEL);
				String description = module.source() != null ? module.source() : module.description();
				Ui.text(g, Ui.ellipsize(description, cw - 20, Ui.Font.SMALL), cx + 10, cy + 54, module.source() != null ? 0xFF6EE7B7 : Ui.MUTED, Ui.Font.SMALL);
				Ui.toggle(g, cx + cw - 28, cy + 41, t);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < modules.size(); i++) {
				int[] cell = cell(i, x, y, w);
				if (!Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], TILE_H)) continue;
				Module module = modules.get(i);
				HeldixMenuScreen.this.click();
				if (onSettings(module, mouseX, mouseY, cell)) openSubmenu(module);
				else module.toggle();
				return true;
			}
			return false;
		}
	}

	/** Ein Heldix-Addon mit Status. */
	private final class AddonCard implements Row {
		private final LoadedAddon addon;

		AddonCard(LoadedAddon addon) {
			this.addon = addon;
		}

		@Override
		public int height(int width) {
			return ADDON_H;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean ok = addon.isActive();
			int color = ok ? Ui.SUCCESS : Ui.DANGER;
			Ui.rect(g, x, y, w, ADDON_H, 10, Ui.SURFACE);
			Ui.outline(g, x, y, w, ADDON_H, 10, (color & 0xFFFFFF) | 0x44000000);
			Ui.rect(g, x + 10, y + 10, 26, 26, 8, (color & 0xFFFFFF) | 0x33000000);
			Ui.icon(g, ok ? "addons" : "warning", x + 16, y + 16, 14, color);

			String status = ok ? "Aktiv · " + addon.moduleCount() + (addon.moduleCount() == 1 ? " Modul" : " Module") : "Fehler";
			int statusW = Ui.width(status, Ui.Font.SMALL) + 14;
			int statusX = x + w - statusW - 10;
			Ui.rect(g, statusX, y + 9, statusW, 14, 7, (color & 0xFFFFFF) | 0x2A000000);
			Ui.text(g, status, statusX + 7, y + 12, color, Ui.Font.SMALL);

			int textX = x + 46;
			String title = addon.name();
			Ui.text(g, Ui.ellipsize(title, statusX - textX - 40, Ui.Font.LABEL), textX, y + 11, Ui.TEXT, Ui.Font.LABEL);
			int titleW = Math.min(Ui.width(title, Ui.Font.LABEL), statusX - textX - 40);
			Ui.text(g, addon.version(), textX + titleW + 6, y + 12, Ui.FAINT, Ui.Font.SMALL);
			String line = ok ? addon.description() : addon.error();
			Ui.text(g, Ui.ellipsize(line == null ? "" : line, w - 56, Ui.Font.SMALL), textX, y + 26, ok ? Ui.MUTED : Ui.DANGER, Ui.Font.SMALL);
		}
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		long now = System.nanoTime();
		frameDt = Math.min((now - lastFrame) / 1_000_000_000f, 0.1f);
		lastFrame = now;
		layout();

		g.enableScissor(bodyX - 2, bodyY, bodyX + bodyW + 2, bodyY + bodyH);
		boolean inBody = Ui.inside(mouseX, mouseY, bodyX, bodyY, bodyW, bodyH);
		int y = bodyY - (int) scroll;
		for (Row row : rows) {
			int h = row.height(bodyW);
			if (y + h >= bodyY && y <= bodyY + bodyH) row.draw(g, bodyX, y, bodyW, mouseX, inBody ? mouseY : -1000);
			y += h + row.gapAfter();
		}
		g.disableScissor();
		Ui.scrollbar(g, bodyX + bodyW + 4, bodyY, bodyH, scroll, maxScroll());
	}

	/** Weicher Übergang zum Zielwert (für Schalter und Hover). */
	private float animate(Object key, float target) {
		float value = anim.getOrDefault(key, target);
		value += (target - value) * Math.min(1f, frameDt * 16f);
		if (Math.abs(target - value) < 0.002f) value = target;
		anim.put(key, value);
		return value;
	}

	private void click() {
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	private void openSubmenu(Module module) {
		openModule = module;
		scroll = 0;
		rebuildWidgets();
	}

	private void closeSubmenu() {
		if (directSubmenu) {
			onClose();
			return;
		}
		openModule = null;
		scroll = 0;
		rebuildWidgets();
	}

	private void dragTo(double mouseX) {
		if (dragging == null) return;
		double t = Math.clamp((mouseX - dragX) / Math.max(1, dragW), 0, 1);
		double value = dragging.snap(dragging.min() + t * (dragging.max() - dragging.min()));
		if (value != dragging.get().getAsDouble()) dragging.set().accept(value);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (maxScroll() > 0) {
			scroll = Math.clamp(scroll - scrollY * 20, 0, maxScroll());
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		if (search != null && !search.isMouseOver(event.x(), event.y())) {
			search.setFocused(false);
			if (getFocused() == search) setFocused(null);
		}
		if (event.button() != InputConstants.MOUSE_BUTTON_LEFT) return false;
		layout();
		double mx = event.x();
		double my = event.y();
		if (Ui.inside(mx, my, bodyX, bodyY, bodyW, bodyH)) {
			int y = bodyY - (int) scroll;
			for (Row row : rows) {
				int h = row.height(bodyW);
				if (my >= y && my < y + h && row.click(mx, my, bodyX, y, bodyW)) return true;
				y += h + row.gapAfter();
			}
		}
		return false;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		if (dragging != null) {
			dragTo(event.x());
			return true;
		}
		return super.mouseDragged(event, dragX, dragY);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (dragging != null) {
			dragging = null;
			HeldixConfig.save();
			return true;
		}
		return super.mouseReleased(event);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		boolean typing = search != null && search.isFocused();
		if (!typing && HeldixClient.menuKey.matches(event)) {
			onClose();
			return true;
		}
		if (!typing && openModule != null && event.key() == InputConstants.KEY_BACKSPACE) {
			closeSubmenu();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		if (parent != null) minecraft.gui.setScreen(parent);
		else Shell.close(minecraft);
	}
}
