package dev.heldixclient.serverlink;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.HeldixLoader;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;

/**
 * Kanal {@code heldixclient:server} in Fabric-Instanzen mit Fabric API.
 *
 * <p>Fabric API kennt {@code minecraft:register} selbst (eigener Payload-Typ): Würde HeldixClient dort seine eigene
 * Anmeldung schicken, scheiterte das Schreiben des Pakets und die Verbindung bräche ab. Deshalb meldet HeldixClient den
 * Kanal bei Fabric API an (Payload-Typ in beide Richtungen, Empfänger für Nachrichten vom Server) – Fabric API schickt die
 * Anmeldung beim Betreten des Servers dann von selbst mit. Alles über Reflexion, damit HeldixClient ohne Fabric API läuft;
 * die Namen der Methoden sind die der Fabric-API-Fassungen für Minecraft 26.x (ältere Namen werden mit versucht).
 *
 * <p>Ohne Fabric API (Heldix-Instanzen, Fabric ohne Fabric API) schickt {@link ServerLink} die Anmeldung selbst.
 */
public final class FabricNetworking {
	/** Fabric API ist da und kennt minecraft:register (dann darf HeldixClient die Anmeldung nicht selbst schicken) */
	private static boolean fabricApi;
	/** Kanal bei Fabric API angemeldet */
	private static boolean registered;

	private FabricNetworking() {
	}

	/** Beim Start: Fabric API suchen und den Kanal dort anmelden. */
	static void init() {
		if (!"fabric".equals(HeldixLoader.platform())) return;
		ClassLoader loader = FabricNetworking.class.getClassLoader();
		Class<?> registry = find(loader, "net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry");
		Class<?> client = find(loader, "net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking");
		if (registry == null && client == null) return;
		fabricApi = true;
		try {
			Object toServer = registryFor(registry, "serverboundPlay", "playC2S");
			Object toClient = registryFor(registry, "clientboundPlay", "playS2C");
			Method register = method(registry, "register", 2);
			register.invoke(toServer, ServerPayload.TYPE, ServerPayload.fabricCodec());
			register.invoke(toClient, ServerPayload.TYPE, ServerPayload.fabricCodec());
			Method receiver = staticMethod(client, "registerGlobalReceiver", 2);
			Class<?> handlerType = receiver.getParameterTypes()[1];
			Object handler = Proxy.newProxyInstance(loader, new Class<?>[] {handlerType}, (proxy, method, args) -> {
				if (method.getDeclaringClass() == Object.class) {
					return switch (method.getName()) {
						case "hashCode" -> System.identityHashCode(proxy);
						case "equals" -> proxy == args[0];
						default -> "HeldixClient-Empfänger für heldixclient:server";
					};
				}
				// receive(payload, context) – Fabric API ruft im Haupt-Thread auf
				if (args != null && args.length > 0 && args[0] instanceof ServerPayload payload) {
					try {
						ServerLink.receive(payload.data());
					} catch (Throwable t) {
						HeldixClient.LOGGER.warn("Kanal heldixclient:server: Nachricht nicht lesbar", t);
					}
				}
				return null;
			});
			receiver.invoke(null, ServerPayload.TYPE, handler);
			registered = true;
			HeldixClient.LOGGER.info("Kanal heldixclient:server bei Fabric API angemeldet");
		} catch (Throwable t) {
			HeldixClient.LOGGER.warn("Kanal heldixclient:server: Anmeldung bei Fabric API fehlgeschlagen – Server-Plugins erreichen diesen Client nicht", t);
		}
	}

	/** Fabric API ist geladen (dann übernimmt sie die Anmeldung des Kanals) */
	public static boolean present() {
		return fabricApi;
	}

	/** Kanal ist bei Fabric API angemeldet */
	public static boolean registered() {
		return registered;
	}

	private static Object registryFor(Class<?> registry, String... names) throws ReflectiveOperationException {
		for (String name : names) {
			try {
				Method method = registry.getMethod(name);
				if (Modifier.isStatic(method.getModifiers())) return method.invoke(null);
			} catch (NoSuchMethodException e) {
				// nächsten Namen versuchen
			}
		}
		throw new NoSuchMethodException("PayloadTypeRegistry." + String.join("/", names));
	}

	private static Method method(Class<?> type, String name, int parameters) throws NoSuchMethodException {
		for (Method method : type.getMethods()) {
			if (method.getName().equals(name) && method.getParameterCount() == parameters && !Modifier.isStatic(method.getModifiers())
					&& method.getParameterTypes()[0].isAssignableFrom(CustomPacketPayload.Type.class)) {
				return method;
			}
		}
		throw new NoSuchMethodException(type.getName() + "." + name);
	}

	private static Method staticMethod(Class<?> type, String name, int parameters) throws NoSuchMethodException {
		if (type == null) throw new NoSuchMethodException("ClientPlayNetworking");
		for (Method method : type.getMethods()) {
			if (method.getName().equals(name) && method.getParameterCount() == parameters && Modifier.isStatic(method.getModifiers())
					&& method.getParameterTypes()[0].isAssignableFrom(CustomPacketPayload.Type.class) && method.getParameterTypes()[1].isInterface()) {
				return method;
			}
		}
		throw new NoSuchMethodException(type.getName() + "." + name);
	}

	private static Class<?> find(ClassLoader loader, String name) {
		try {
			return Class.forName(name, false, loader);
		} catch (Throwable t) {
			return null;
		}
	}
}
