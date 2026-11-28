package dev.heldixclient.server;

import dev.heldixclient.server.api.HeldixClientInfo;
import dev.heldixclient.server.api.HeldixServer;
import dev.heldixclient.server.api.HudAnchor;
import dev.heldixclient.server.api.HudElement;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.PluginCommand;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Plugin „HeldixClient Server“ für Paper: verbindet den Server mit HeldixClient über den Kanal {@code heldixclient:server}
 * (Regeln, HUD-Elemente, Einblendungen) und – mit Partner-Schlüssel – mit dem Heldix-Dienst (Voice-Gruppen, Belohnungen).
 * Schnittstelle für andere Plugins: {@link HeldixServer} über den ServicesManager. Befehl {@code /heldix} (Recht
 * {@code heldix.admin}). Doku: docs/server-plugin.md.
 */
public final class HeldixServerPlugin extends JavaPlugin implements Listener {
	/** 2 Minuten in Ticks: so oft geht der ganze Stand der Voice-Gruppen an den Dienst */
	private static final long VOICE_REFRESH_TICKS = 20L * 120;

	private ServerCore core;
	private BukkitTask refresh;

	@Override
	public void onEnable() {
		saveDefaultConfig();
		reloadConfig();
		Settings settings = Settings.read(getConfig(), getLogger());
		core = new ServerCore(this, settings);
		getServer().getMessenger().registerOutgoingPluginChannel(this, HeldixServer.CHANNEL);
		getServer().getMessenger().registerIncomingPluginChannel(this, HeldixServer.CHANNEL, core);
		getServer().getServicesManager().register(HeldixServer.class, core, this, ServicePriority.Normal);
		getServer().getPluginManager().registerEvents(this, this);
		PluginCommand command = getCommand("heldix");
		if (command != null) {
			command.setExecutor(this);
			command.setTabCompleter((TabCompleter) this);
		}
		refresh = Bukkit.getScheduler().runTaskTimer(this, core::refreshVoiceGroups, VOICE_REFRESH_TICKS, VOICE_REFRESH_TICKS);
		core.checkPartner();
		getLogger().info("HeldixClient Server " + getPluginMeta().getVersion() + " bereit (Kanal " + HeldixServer.CHANNEL + ", Regeln: "
				+ (settings.rules().isEmpty() ? "keine" : String.join(", ", settings.rules())) + ").");
	}

	@Override
	public void onDisable() {
		if (refresh != null) refresh.cancel();
		if (core != null) {
			// Voice-Gruppen beim Dienst leeren (im Hintergrund; sonst verfallen sie dort nach 10 Minuten)
			if (core.partner() && !core.voiceGroups().all().isEmpty()) core.voiceGroups().clear();
			core.close();
		}
		getServer().getMessenger().unregisterIncomingPluginChannel(this);
		getServer().getMessenger().unregisterOutgoingPluginChannel(this);
		getServer().getServicesManager().unregisterAll(this);
	}

	/** Aufgabe im Hauptthread ausführen (sofort, wenn wir schon dort sind) */
	void runSync(Runnable task) {
		if (!isEnabled()) return;
		if (Bukkit.isPrimaryThread()) task.run();
		else Bukkit.getScheduler().runTask(this, task);
	}

	@EventHandler
	public void onQuit(PlayerQuitEvent event) {
		core.quit(event.getPlayer());
	}

	// ======================================================================================
	// /heldix status | reload | test-hud <spieler>
	// ======================================================================================

	@Override
	public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
		if (!sender.hasPermission("heldix.admin")) {
			sender.sendMessage(Component.text("Dafür fehlt dir das Recht heldix.admin.", NamedTextColor.RED));
			return true;
		}
		String sub = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
		switch (sub) {
			case "status" -> status(sender);
			case "reload" -> {
				reloadConfig();
				core.reload(Settings.read(getConfig(), getLogger()));
				sender.sendMessage(Component.text("Die config.yml ist neu geladen; die Regeln sind an alle HeldixClient-Spieler gegangen.", NamedTextColor.GREEN));
			}
			case "test-hud" -> {
				if (args.length < 2) {
					sender.sendMessage(Component.text("So geht es: /heldix test-hud <Spieler>", NamedTextColor.YELLOW));
					return true;
				}
				Player target = Bukkit.getPlayerExact(args[1]);
				if (target == null) {
					sender.sendMessage(Component.text("Der Spieler " + args[1] + " ist nicht online.", NamedTextColor.RED));
					return true;
				}
				testHud(sender, target);
			}
			default -> sender.sendMessage(Component.text("So geht es: /heldix status | reload | test-hud <Spieler>", NamedTextColor.YELLOW));
		}
		return true;
	}

	@Override
	public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
		if (!sender.hasPermission("heldix.admin")) return List.of();
		List<String> out = new ArrayList<>();
		if (args.length == 1) {
			for (String sub : List.of("status", "reload", "test-hud")) if (sub.startsWith(args[0].toLowerCase(Locale.ROOT))) out.add(sub);
		} else if (args.length == 2 && args[0].equalsIgnoreCase("test-hud")) {
			for (Player player : Bukkit.getOnlinePlayers()) {
				if (player.getName().toLowerCase(Locale.ROOT).startsWith(args[1].toLowerCase(Locale.ROOT))) out.add(player.getName());
			}
		}
		return out;
	}

	private void status(CommandSender sender) {
		Settings settings = core.settings();
		sender.sendMessage(Component.text("HeldixClient Server " + getPluginMeta().getVersion() + " · Kanal " + HeldixServer.CHANNEL, NamedTextColor.AQUA));
		sender.sendMessage(Component.text("Heldix-Dienst: " + settings.apiUrl(), NamedTextColor.GRAY));
		if (core.partner()) {
			sender.sendMessage(Component.text("Partner: " + core.partnerName().orElse("?") + " · Server " + String.join(", ", core.partnerServers()), NamedTextColor.GREEN));
			String voice = core.voiceServer();
			sender.sendMessage(Component.text("Voice-Gruppen: " + core.voiceGroups().all().size() + " Spieler für " + (voice == null ? "(keine Adresse)" : voice)
					+ " · zuletzt " + core.lastSync(), NamedTextColor.GRAY));
		} else {
			sender.sendMessage(Component.text("Partner: " + core.partnerProblem(), NamedTextColor.YELLOW));
		}
		sender.sendMessage(Component.text("Regeln: " + (core.rules().global().isEmpty() ? "keine" : String.join(", ", core.rules().global()))
				+ " · bekannt: " + String.join(", ", core.knownRules()), NamedTextColor.GRAY));
		Map<UUID, HeldixClientInfo> clients = core.clients();
		List<String> names = new ArrayList<>();
		for (Map.Entry<UUID, HeldixClientInfo> entry : clients.entrySet()) {
			Player player = Bukkit.getPlayer(entry.getKey());
			if (player != null) names.add(player.getName() + " (" + entry.getValue().version() + ", " + entry.getValue().language() + ")");
		}
		sender.sendMessage(Component.text("HeldixClient-Spieler online: " + (names.isEmpty() ? "keine" : names.size() + " – " + String.join(", ", names)),
				NamedTextColor.GRAY));
	}

	/** Beispiel-Elemente (Text, Fortschritt, Liste) und eine Einblendung für 15 Sekunden */
	private void testHud(CommandSender sender, Player target) {
		if (!core.isHeldix(target)) {
			sender.sendMessage(Component.text(target.getName() + " spielt nicht mit HeldixClient (oder hat sich noch nicht gemeldet).", NamedTextColor.YELLOW));
			return;
		}
		var hud = core.hud(target);
		hud.set(HudElement.ofText("heldix-test").anchor(HudAnchor.TOP_RIGHT).title("HeldixClient Server").text("Das ist ein Test-Element vom Server.")
				.clickable(true));
		hud.set(HudElement.ofProgress("heldix-test-progress").anchor(HudAnchor.TOP).title("Fortschritt").text("Füllt sich in 10 Sekunden").value(0)
				.color(0x22C55E));
		hud.set(HudElement.ofList("heldix-test-list").anchor(HudAnchor.RIGHT).title("Liste").lines(List.of("Erste Zeile", "Zweite Zeile", "Dritte Zeile")));
		core.toast(target, "HeldixClient Server", "Test-HUD für 15 Sekunden.");
		for (int i = 1; i <= 10; i++) {
			double value = i / 10.0;
			Bukkit.getScheduler().runTaskLater(this, () -> {
				if (target.isOnline()) {
					core.hud(target).set(HudElement.ofProgress("heldix-test-progress").anchor(HudAnchor.TOP).title("Fortschritt")
							.text(Math.round(value * 100) + " %").value(value).color(0x22C55E));
				}
			}, i * 20L);
		}
		Bukkit.getScheduler().runTaskLater(this, () -> {
			if (!target.isOnline()) return;
			var later = core.hud(target);
			later.remove("heldix-test");
			later.remove("heldix-test-progress");
			later.remove("heldix-test-list");
		}, 15 * 20L);
		sender.sendMessage(Component.text("Test-HUD an " + target.getName() + " geschickt (15 Sekunden).", NamedTextColor.GREEN));
	}
}
