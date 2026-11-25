package dev.heldixclient.module.impl;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.Setting;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.ActiveTextCollector;
import net.minecraft.client.gui.TextAlignment;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.multiplayer.chat.GuiMessage;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import org.joml.Matrix3x2f;
import org.joml.Vector2f;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Chat-Verbesserungen: Uhrzeit vor jeder Nachricht, gleiche Nachrichten hintereinander zusammenfassen („(3×)“)
 * und Nachrichten mit Strg+Klick kopieren. Greift in ChatComponent.addMessage und ChatScreen.mouseClicked ein.
 */
public class ChatModule extends Module {
	private static final List<String> FORMATS = List.of("14:05", "14:05:09");
	private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("HH:mm");
	private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("HH:mm:ss");
	/** Uhrzeit vorn und Zähler hinten, beim Kopieren wieder entfernt */
	private static final Pattern DECORATION = Pattern.compile("^\\[\\d{2}:\\d{2}(:\\d{2})?] |\\s\\(\\d+×\\)$");

	private String lastText;
	private Component lastShown;
	private int count;

	private static Field allMessages;
	private static Field trimmedMessages;
	private static Method refreshTrimmed;
	private static boolean reflectionFailed;

	public ChatModule() {
		super("chat", "Chat", "Uhrzeit, gleiche Nachrichten stapeln, Strg+Klick kopiert", false, 0, 0);
	}

	/** Hook ChatComponent.addMessage: Inhalt der neuen Nachricht (Uhrzeit, Zähler). */
	public Component process(ChatComponent chat, Component content) {
		if (!isEnabled() || content == null) {
			lastText = null;
			return content;
		}
		String text = content.getString();
		Component result = content;
		if (option("stack", true) && text.equals(lastText) && removeNewest(chat, lastShown)) {
			count++;
			result = content.copy().append(Component.literal(" (" + count + "×)").withStyle(ChatFormatting.GRAY));
		} else {
			count = 1;
		}
		lastText = text;
		if (option("time", true)) {
			String time = LocalTime.now().format((int) option("format", 0) == 1 ? LONG : SHORT);
			result = Component.literal("[" + time + "] ").withStyle(ChatFormatting.DARK_GRAY).append(result);
		}
		lastShown = result;
		return result;
	}

	/** Entfernt die neueste Nachricht, wenn es die zuletzt von uns gezeigte ist (für das Stapeln). */
	@SuppressWarnings("unchecked")
	private static boolean removeNewest(ChatComponent chat, Component shown) {
		if (shown == null || !reflect()) return false;
		try {
			List<GuiMessage> messages = (List<GuiMessage>) allMessages.get(chat);
			if (messages.isEmpty() || messages.getFirst().content() != shown) return false;
			messages.removeFirst();
			refreshTrimmed.invoke(chat);
			return true;
		} catch (ReflectiveOperationException | RuntimeException e) {
			HeldixClient.LOGGER.warn("Chat: Nachricht nicht stapelbar", e);
			reflectionFailed = true;
			return false;
		}
	}

	private static boolean reflect() {
		if (reflectionFailed) return false;
		if (allMessages != null) return true;
		try {
			allMessages = ChatComponent.class.getDeclaredField("allMessages");
			trimmedMessages = ChatComponent.class.getDeclaredField("trimmedMessages");
			refreshTrimmed = ChatComponent.class.getDeclaredMethod("refreshTrimmedMessages");
			allMessages.setAccessible(true);
			trimmedMessages.setAccessible(true);
			refreshTrimmed.setAccessible(true);
			return true;
		} catch (ReflectiveOperationException | RuntimeException e) {
			HeldixClient.LOGGER.warn("Chat-Verbesserungen: Zugriff auf den Chat nicht möglich", e);
			reflectionFailed = true;
			return false;
		}
	}

	/** Hook ChatScreen.mouseClicked: Strg+Klick auf eine Nachricht kopiert sie. true = Klick verbraucht. */
	public boolean click(MouseButtonEvent event) {
		if (!isEnabled() || !option("copy", true) || !Minecraft.getInstance().hasControlDown()) return false;
		String text = messageAt(event.x(), event.y());
		if (text == null) return false;
		Minecraft.getInstance().keyboardHandler.setClipboard(text);
		Notifications.show("chat-copy", "Nachricht kopiert", text, null);
		return true;
	}

	/** Text der Nachricht unter dem Mauszeiger (ohne Uhrzeit und Zähler), null = keine */
	@SuppressWarnings("unchecked")
	public static String messageAt(double mouseX, double mouseY) {
		Minecraft mc = Minecraft.getInstance();
		ChatComponent chat = mc.gui.hud.getChat();
		LineFinder finder = new LineFinder((float) mouseX, (float) mouseY, mc.font.lineHeight);
		chat.captureClickableText(finder, mc.getWindow().getGuiScaledHeight(), mc.gui.hud.getGuiTicks(), ChatComponent.DisplayMode.FOREGROUND);
		if (finder.hit == null || !reflect()) return null;
		try {
			for (GuiMessage.Line line : (List<GuiMessage.Line>) trimmedMessages.get(chat)) {
				if (line.content() == finder.hit) return DECORATION.matcher(line.parent().content().getString()).replaceAll("");
			}
		} catch (ReflectiveOperationException | RuntimeException e) {
			HeldixClient.LOGGER.warn("Chat: Nachricht nicht lesbar", e);
		}
		return null;
	}

	/** Sammelt die gezeichneten Chat-Zeilen und merkt sich die unter dem Mauszeiger. */
	private static final class LineFinder implements ActiveTextCollector {
		private final float mouseX;
		private final float mouseY;
		private final int lineHeight;
		private Parameters parameters = new Parameters(new Matrix3x2f());
		FormattedCharSequence hit;

		LineFinder(float mouseX, float mouseY, int lineHeight) {
			this.mouseX = mouseX;
			this.mouseY = mouseY;
			this.lineHeight = lineHeight;
		}

		@Override
		public Parameters defaultParameters() {
			return parameters;
		}

		@Override
		public void defaultParameters(Parameters parameters) {
			this.parameters = parameters;
		}

		@Override
		public void accept(TextAlignment alignment, int x, int y, Parameters params, FormattedCharSequence text) {
			Vector2f local = new Matrix3x2f(params.pose()).invert().transformPosition(new Vector2f(mouseX, mouseY));
			int width = Minecraft.getInstance().font.width(text);
			int left = alignment.calculateLeft(x, width);
			// Zeilen füllen die volle Chat-Breite; gezählt wird ab dem linken Rand bis zum Textende (+ etwas Luft)
			if (local.y >= y - 1 && local.y < y + lineHeight && local.x >= left - 4 && local.x <= left + Math.max(width, 20) + 4) hit = text;
		}

		@Override
		public void acceptScrolling(Component message, int centerX, int left, int right, int top, int bottom, Parameters params) {
			// im Chat nicht benutzt
		}
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(toggle("time", "Uhrzeit", "Zeit vor jeder Nachricht", true));
		settings.add(choice("format", "Uhrzeit-Format", "", FORMATS, 0));
		settings.add(toggle("stack", "Gleiche Nachrichten stapeln", "Wiederholungen direkt hintereinander als „(3×)“ zusammenfassen", true));
		settings.add(toggle("copy", "Strg+Klick kopiert", "Mit gedrückter Strg-Taste auf eine Nachricht klicken kopiert ihren Text", true));
		return settings;
	}
}
