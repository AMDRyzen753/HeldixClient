package dev.heldixclient.loader.api.event;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Renderable;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.narration.NarratableEntry;
import net.minecraft.client.gui.screens.Screen;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

/** Menüs (Screens): nach dem Aufbau eigene Elemente hinzufügen. */
public final class ScreenEvents {
	@FunctionalInterface
	public interface AfterInit {
		void afterInit(Minecraft minecraft, Screen screen, int width, int height);
	}

	/** Nachdem ein Menü seine Elemente aufgebaut hat (auch nach Größenänderungen des Fensters). */
	public static final Event<AfterInit> AFTER_INIT = new Event<>();

	private static volatile MethodHandle addRenderableWidget;

	private ScreenEvents() {
	}

	/** Fügt einem Menü ein Element hinzu (Button usw.), z. B. in {@link #AFTER_INIT}. */
	public static <T extends GuiEventListener & Renderable & NarratableEntry> T addWidget(Screen screen, T widget) {
		try {
			MethodHandle handle = addRenderableWidget;
			if (handle == null) {
				handle = MethodHandles.privateLookupIn(Screen.class, MethodHandles.lookup())
						.findVirtual(Screen.class, "addRenderableWidget", MethodType.methodType(GuiEventListener.class, GuiEventListener.class));
				addRenderableWidget = handle;
			}
			handle.invoke(screen, widget);
			return widget;
		} catch (Throwable t) {
			throw new IllegalStateException("Element konnte nicht zum Menü hinzugefügt werden", t);
		}
	}
}
