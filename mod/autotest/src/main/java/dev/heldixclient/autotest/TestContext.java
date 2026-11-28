package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.chat.contents.TranslatableContents;

import java.lang.reflect.Field;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Hilfen für den Autotest. Der Test läuft in einem eigenen Thread; alles, was Minecraft
 * anfasst, wird mit {@link #compute}/{@link #run} im Hauptthread ausgeführt.
 * Klicks gehen über den echten MouseHandler (gleicher Weg wie eine echte Maus).
 */
final class TestContext {
	static final int LEFT = InputConstants.MOUSE_BUTTON_LEFT;

	private final AtomicLong ticks = new AtomicLong();
	private int checks;

	void tick() {
		ticks.incrementAndGet();
	}

	int checks() {
		return checks;
	}

	<T> T compute(Function<Minecraft, T> action) {
		Minecraft minecraft = Minecraft.getInstance();
		try {
			return minecraft.submit((Supplier<T>) () -> action.apply(minecraft)).get(60, TimeUnit.SECONDS);
		} catch (ExecutionException e) {
			Throwable cause = e.getCause();
			if (cause instanceof RuntimeException runtime) throw runtime;
			if (cause instanceof Error error) throw error;
			throw new IllegalStateException(cause);
		} catch (Exception e) {
			throw new IllegalStateException("Hauptthread antwortet nicht", e);
		}
	}

	void run(Consumer<Minecraft> action) {
		compute(minecraft -> {
			action.accept(minecraft);
			return Boolean.TRUE;
		});
	}

	void waitTicks(int count) {
		long target = ticks.get() + count;
		long deadline = System.currentTimeMillis() + 30_000L + count * 200L;
		while (ticks.get() < target) {
			if (System.currentTimeMillis() > deadline) throw new AssertionError("Spiel tickt nicht mehr");
			sleep(5);
		}
	}

	void waitFor(String what, Predicate<Minecraft> condition, int timeoutSeconds) {
		long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;
		while (!compute(condition::test)) {
			if (System.currentTimeMillis() > deadline) throw new AssertionError("Zeitüberschreitung: " + what);
			sleep(50);
		}
	}

	/** Wie waitFor, aber ohne Fehler bei Zeitüberschreitung. */
	boolean waitSoft(Predicate<Minecraft> condition, int timeoutSeconds) {
		long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;
		while (!compute(condition::test)) {
			if (System.currentTimeMillis() > deadline) return false;
			sleep(50);
		}
		return true;
	}

	void waitForScreen(Class<? extends Screen> type, int timeoutSeconds) {
		waitFor("Menü " + type.getSimpleName(), minecraft -> type.isInstance(minecraft.gui.screen()), timeoutSeconds);
	}

	void check(String what, boolean ok) {
		checks++;
		if (!ok) throw new AssertionError(what);
		AutoTest.LOG.info("AUTOTEST [OK] {}", what);
	}

	void log(String message) {
		AutoTest.LOG.info("AUTOTEST {}", message);
	}

	void setScreen(Supplier<Screen> screen) {
		run(minecraft -> minecraft.gui.setScreen(screen.get()));
		waitTicks(3);
	}

	/** Speichert das aktuelle Bild nach screenshots/<name>.png im Spielordner. */
	void screenshot(String name) {
		waitTicks(3);
		run(minecraft -> Screenshot.grab(minecraft.gameDirectory, name + ".png", minecraft.gameRenderer.mainRenderTarget(), 1, message -> {
		}));
		waitTicks(5);
		log("Screenshot " + name);
	}

	// --- Eingaben ---------------------------------------------------------------------------

	/** Setzt die Maus auf GUI-Koordinaten (rechnet in Fensterpixel um). */
	void moveMouse(double guiX, double guiY) {
		run(minecraft -> placeMouse(minecraft, guiX, guiY));
	}

	private static void placeMouse(Minecraft minecraft, double guiX, double guiY) {
		Window window = minecraft.getWindow();
		double x = (guiX + 0.5) * window.getScreenWidth() / window.getGuiScaledWidth();
		double y = (guiY + 0.5) * window.getScreenHeight() / window.getGuiScaledHeight();
		setDouble(minecraft.mouseHandler, "xpos", x);
		setDouble(minecraft.mouseHandler, "ypos", y);
	}

	/**
	 * Linksklick über den echten MouseHandler an GUI-Koordinaten. Position und Klick passieren im
	 * selben Schritt, damit eine echte Mausbewegung über dem Fenster nicht dazwischenfunkt.
	 */
	void click(double guiX, double guiY) {
		run(minecraft -> {
			placeMouse(minecraft, guiX, guiY);
			minecraft.mouseHandler.onButton(minecraft.getWindow().handle(), new MouseButtonInfo(LEFT, 0), InputConstants.PRESS);
		});
		waitTicks(1);
		run(minecraft -> {
			placeMouse(minecraft, guiX, guiY);
			minecraft.mouseHandler.onButton(minecraft.getWindow().handle(), new MouseButtonInfo(LEFT, 0), InputConstants.RELEASE);
		});
		waitTicks(2);
	}

	/** Klickt das Element mit genau dieser Beschriftung im offenen Menü. */
	void clickWidget(String label) {
		int[] center = widgetCenter(widget -> widget.getMessage().getString().equals(label), "\"" + label + "\"");
		click(center[0], center[1]);
	}

	/** Klickt das Element, dessen Beschriftung diesen Übersetzungsschlüssel hat. */
	void clickTranslatable(String key) {
		int[] center = widgetCenter(widget -> widget.getMessage().getContents() instanceof TranslatableContents contents
				&& contents.getKey().equals(key), key);
		click(center[0], center[1]);
	}

	int[] widgetCenter(Predicate<AbstractWidget> filter, String description) {
		int[] center = compute(minecraft -> {
			Screen screen = minecraft.gui.screen();
			if (screen == null) return null;
			for (GuiEventListener child : screen.children()) {
				if (child instanceof AbstractWidget widget && widget.visible && filter.test(widget)) {
					return new int[] {widget.getX() + widget.getWidth() / 2, widget.getY() + widget.getHeight() / 2};
				}
			}
			return null;
		});
		if (center == null) throw new AssertionError("Element " + description + " nicht gefunden");
		return center;
	}

	/** Taste drücken und loslassen über den echten KeyboardHandler. */
	void pressKey(int key) {
		pressKey(key, 0);
	}

	/** Taste mit Umschalt-/Strg-Tasten ({@code InputConstants.MOD_CONTROL} …) drücken und loslassen. */
	void pressKey(int key, int modifiers) {
		run(minecraft -> minecraft.keyboardHandler.keyPress(minecraft.getWindow().handle(), InputConstants.PRESS, new KeyEvent(key, 0, modifiers)));
		waitTicks(1);
		run(minecraft -> minecraft.keyboardHandler.keyPress(minecraft.getWindow().handle(), InputConstants.RELEASE, new KeyEvent(key, 0, modifiers)));
		waitTicks(2);
	}

	/** Befehl auf dem integrierten Server (Einzelspieler) ausführen. */
	void serverCommand(String command) {
		run(minecraft -> {
			IntegratedServer server = minecraft.getSingleplayerServer();
			if (server == null) throw new AssertionError("Kein Einzelspieler-Server für /" + command);
			server.execute(() -> server.getCommands().performPrefixedCommand(server.createCommandSourceStack(), command));
		});
		waitTicks(5);
	}

	private static void setDouble(Object target, String name, double value) {
		try {
			Field field = target.getClass().getDeclaredField(name);
			field.setAccessible(true);
			field.setDouble(target, value);
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException("Feld " + name + " nicht gefunden", e);
		}
	}

	static void sleep(long millis) {
		try {
			Thread.sleep(millis);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException(e);
		}
	}

	/** Versionsnummer wie „1.3.0“ mindestens {@code minimum}? (Zahlen je Stelle verglichen, Fehlendes zählt als 0) */
	static boolean versionAtLeast(String version, String minimum) {
		if (version == null) return false;
		String[] a = version.split("\\.");
		String[] b = minimum.split("\\.");
		for (int i = 0; i < Math.max(a.length, b.length); i++) {
			int x;
			int y;
			try {
				x = i < a.length ? Integer.parseInt(a[i].replaceAll("[^0-9].*$", "")) : 0;
				y = i < b.length ? Integer.parseInt(b[i]) : 0;
			} catch (NumberFormatException e) {
				return false;
			}
			if (x != y) return x > y;
		}
		return true;
	}
}
