package dev.heldixclient.addon;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.CommandContext;
import dev.heldixclient.api.CommandHandler;
import dev.heldixclient.api.Registration;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.TextColor;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Chat-Befehle der Addons (API 3): „.name …“ im Chat ruft den Befehl auf, statt die Nachricht an den Server zu
 * schicken. „.hilfe“ listet alle Befehle, Tab ergänzt den Namen, über dem Eingabefeld stehen passende Befehle.
 */
public final class AddonCommands {
	public static final String PREFIX = ".";
	private static final List<String> HELP = List.of("hilfe", "help");
	private static final int MAX_HINTS = 8;

	private AddonCommands() {
	}

	/** Ein registrierter Befehl; name ist eindeutig ("np"), bei Doppelbelegung nur "addon-id:np" */
	record Command(LoadedAddon addon, String name, String usage, String description, CommandHandler handler) implements Registration {
		@Override
		public void cancel() {
			COMMANDS.remove(this);
		}

		@Override
		public boolean isActive() {
			return COMMANDS.contains(this) && addon.isActive();
		}

		String line() {
			return PREFIX + name + (usage.isEmpty() ? "" : " " + usage);
		}
	}

	private static final List<Command> COMMANDS = new CopyOnWriteArrayList<>();

	static Registration register(LoadedAddon addon, String name, String usage, String description, CommandHandler handler) {
		if (name == null || !name.matches("[a-z0-9_-]+")) throw new IllegalArgumentException("Befehlsname darf nur a-z, 0-9, _ und - enthalten: " + name);
		Objects.requireNonNull(handler, "handler");
		if (HELP.contains(name)) throw new IllegalArgumentException("Den Befehl ." + name + " hat HeldixClient selbst");
		String id = addon.metadata.id;
		String unique = find(name) == null ? name : id + ":" + name;
		if (find(unique) != null) throw new IllegalArgumentException("Befehl ." + unique + " ist schon registriert");
		if (!unique.equals(name)) HeldixClient.LOGGER.warn("Heldix-Addon {}: Befehl .{} gibt es schon, erreichbar als .{}", addon.name(), name, unique);
		Command command = new Command(addon, unique, AddonSettings.text(usage).strip(), AddonSettings.text(description).strip(), handler);
		COMMANDS.add(command);
		return command;
	}

	private static Command find(String name) {
		for (Command command : COMMANDS) if (command.name().equals(name)) return command;
		return null;
	}

	/** Befehle aktiver Addons, nach Namen sortiert */
	public static List<Command> active() {
		List<Command> list = new ArrayList<>();
		for (Command command : COMMANDS) if (command.addon().isActive()) list.add(command);
		list.sort((a, b) -> a.name().compareTo(b.name()));
		return list;
	}

	/**
	 * ChatScreen.handleChatInput: Ist die Eingabe ein Addon-Befehl, wird er ausgeführt und nichts gesendet.
	 *
	 * @return true = erledigt, die Nachricht nicht an den Server schicken
	 */
	public static boolean handle(String message, boolean addToHistory) {
		if (message == null) return false;
		String text = message.strip();
		if (!text.startsWith(PREFIX) || text.length() < 2 || text.startsWith(PREFIX + PREFIX)) return false;
		String body = text.substring(1);
		int space = body.indexOf(' ');
		String name = (space < 0 ? body : body.substring(0, space)).toLowerCase(Locale.ROOT);
		String rest = space < 0 ? "" : body.substring(space + 1).strip();
		Command command = find(name);
		if (command == null && !HELP.contains(name)) return false;

		Minecraft mc = Minecraft.getInstance();
		if (addToHistory) mc.gui.hud.getChat().addRecentChat(text);
		if (command == null) {
			help();
			return true;
		}
		if (!command.addon().isActive()) {
			// nicht an den Server schicken – sonst landet „.np“ im öffentlichen Chat
			system("Das Addon " + command.addon().name() + " ist abgeschaltet (siehe Heldix-Menü → Addons).");
			return true;
		}
		List<String> args = rest.isEmpty() ? List.of() : List.of(rest.split("\\s+"));
		AddonContext context = command.addon().context;
		CommandContext ctx = new CommandContext() {
			@Override
			public String name() {
				return name;
			}

			@Override
			public List<String> args() {
				return args;
			}

			@Override
			public String arg(int index) {
				return index >= 0 && index < args.size() ? args.get(index).toLowerCase(Locale.ROOT) : "";
			}

			@Override
			public String argsText() {
				return rest;
			}

			@Override
			public void reply(String reply) {
				context.chat(reply);
			}
		};
		AddonManager.userAction(command.addon(), "Befehl ." + command.name(), () -> command.handler().run(ctx));
		return true;
	}

	/** „.hilfe“: alle Addon-Befehle im eigenen Chat */
	private static void help() {
		List<Command> commands = active();
		if (commands.isEmpty()) {
			system("Keine Addon-Befehle. Addons gibt es im Heldix-Menü unter Addons → Addon-Store.");
			return;
		}
		system("Addon-Befehle (Tab ergänzt den Namen):");
		for (Command command : commands) {
			String description = command.description().isEmpty() ? "" : " – " + command.description();
			system("  " + command.line() + description + " (" + command.addon().name() + ")");
		}
	}

	private static void system(String message) {
		Component prefix = Component.literal("[HeldixClient] ").withStyle(style -> style.withColor(TextColor.fromRgb(Theme.ACCENT_LIGHT & 0xFFFFFF)));
		Minecraft.getInstance().gui.hud.getChat().addClientSystemMessage(Component.empty().append(prefix).append(Component.literal(message)));
	}

	// --- Eingabefeld des Chats: Tab und Vorschläge ---------------------------------------------

	/** Namen, die zur Eingabe passen (ohne Punkt), z. B. für ".sp" → [spotify] */
	private static List<String> matches(String typed) {
		List<String> names = new ArrayList<>();
		for (Command command : active()) if (command.name().startsWith(typed)) names.add(command.name());
		if ("hilfe".startsWith(typed)) names.add("hilfe");
		names.sort(String::compareTo);
		return names;
	}

	/**
	 * Tab im Chat: ergänzt den Befehlsnamen (wiederholt drücken schaltet weiter).
	 *
	 * @return der neue Inhalt des Eingabefelds oder null (dann macht Minecraft weiter, z. B. Spielernamen)
	 */
	public static String complete(String value) {
		if (value == null || !value.startsWith(PREFIX) || value.contains(" ") || value.startsWith(PREFIX + PREFIX)) return null;
		if (active().isEmpty()) return null;
		String typed = value.substring(1).toLowerCase(Locale.ROOT);
		List<String> all = matches("");
		int exact = all.indexOf(typed);
		if (exact >= 0) return PREFIX + all.get((exact + 1) % all.size());
		List<String> found = matches(typed);
		return found.isEmpty() ? null : PREFIX + found.getFirst();
	}

	/** Über dem Eingabefeld: passende Befehle mit Beschreibung, solange ein „.“-Befehl getippt wird */
	public static void hints(GuiGraphicsExtractor g, String value, int inputX, int inputY) {
		if (value == null || !value.startsWith(PREFIX) || value.startsWith(PREFIX + PREFIX)) return;
		String body = value.substring(1);
		int space = body.indexOf(' ');
		String typed = (space < 0 ? body : body.substring(0, space)).toLowerCase(Locale.ROOT);
		List<String[]> lines = new ArrayList<>();
		for (Command command : active()) {
			boolean fits = space < 0 ? command.name().startsWith(typed) : command.name().equals(typed);
			if (fits) lines.add(new String[] {command.line(), command.description() + " · " + command.addon().name()});
		}
		if (lines.isEmpty()) return;
		if (space < 0 && "hilfe".startsWith(typed)) lines.add(new String[] {".hilfe", "Alle Addon-Befehle anzeigen"});
		if (lines.size() > MAX_HINTS) lines = lines.subList(0, MAX_HINTS);
		Font font = Minecraft.getInstance().font;
		// nie über den Bildschirmrand: lange Verwendung und Beschreibung werden mit „…“ gekürzt
		int room = Math.max(60, g.guiWidth() - inputX - 12);
		int left = 0;
		for (String[] line : lines) {
			line[0] = cut(font, line[0], room * 2 / 3);
			left = Math.max(left, font.width(line[0]));
		}
		int width = left + 10;
		for (String[] line : lines) {
			line[1] = cut(font, line[1], room - left - 10);
			width = Math.max(width, left + 10 + font.width(line[1]));
		}
		int row = 12;
		int height = lines.size() * row + 4;
		int x = inputX;
		int y = inputY - height - 3;
		g.fill(x, y, x + width + 8, y + height, 0xD0000000);
		g.fill(x, y, x + 1, y + height, Theme.ACCENT);
		int ly = y + 3;
		for (String[] line : lines) {
			g.text(font, line[0], x + 5, ly, Theme.ACCENT_LIGHT, false);
			g.text(font, line[1], x + 5 + left + 10, ly, Theme.MUTED, false);
			ly += row;
		}
	}

	private static String cut(Font font, String text, int maxWidth) {
		if (font.width(text) <= maxWidth) return text;
		if (maxWidth <= font.width("…")) return "";
		return font.plainSubstrByWidth(text, maxWidth - font.width("…")).stripTrailing() + "…";
	}

	/** für Tests: Namen aller aktiven Befehle */
	public static List<String> names() {
		return active().stream().map(Command::name).toList();
	}
}
