package dev.heldixclient.autotest;

import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.social.Badge;
import dev.heldixclient.social.BadgeDisplay;
import dev.heldixclient.social.Social;
import dev.heldixclient.transform.Hooks;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.RemotePlayer;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;
import net.minecraft.util.Unit;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.Team;
import net.minecraft.world.scores.TeamColor;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Heldix-Symbol je Rolle (normal, Team-Admin, Moderator, Addon-Entwickler): vor Namen in der Tab-Liste (Teamfarbe färbt
 * das Symbol nicht), Zeile „HeldixClient: … Spieler hier“ in der Fußzeile und im Namensschild über dem Kopf – mit
 * Schleichen, Unsichtbarkeit, F1 und vom Server ausgeblendeten Namensschildern.
 *
 * <p>Die Rollen kommen über {@link Social#testLookup} (dieselbe Auswertung wie echte Antworten des Dienstes), die
 * Spieler stehen nur auf dem Client: Einträge in der Tab-Liste und {@link RemotePlayer} vor der Kamera.
 */
final class BadgeTests {
	private record Fake(String name, String badge, Badge.Role role) {
		UUID uuid() {
			return UUID.nameUUIDFromBytes(("HeldixSymbol:" + name).getBytes(StandardCharsets.UTF_8));
		}
	}

	private static final List<Fake> FAKES = List.of(
			new Fake("Spielerin", null, Badge.Role.PLAYER),
			new Fake("TeamAdmin", "admin", Badge.Role.ADMIN),
			new Fake("Moderatorin", "moderator", Badge.Role.MODERATOR),
			new Fake("Entwickler", "developer", Badge.Role.DEVELOPER),
			// kein HeldixClient-Spieler: bekommt nichts
			new Fake("Vanilla", "-", null));
	private static final String RED_TEAM = "heldix_rot";
	private static final String HIDDEN_TEAM = "heldix_versteckt";

	private BadgeTests() {
	}

	static void run(TestContext t) {
		boolean online = t.compute(mc -> Social.online());
		t.log("Heldix-Symbole: Dienst " + (online ? "verbunden" : "nicht verbunden (ohne eigenes Symbol und Fußzeile)"));
		List<PlayerInfo> infos = new ArrayList<>();
		List<RemotePlayer> remotes = new ArrayList<>();
		try {
			t.run(mc -> {
				for (Fake fake : FAKES) {
					JsonObject entry = null;
					if (fake.role() != null) {
						entry = new JsonObject();
						entry.addProperty("cape", "");
						if (fake.badge() != null) entry.addProperty("badge", fake.badge());
						else entry.add("badge", com.google.gson.JsonNull.INSTANCE);
					}
					Social.testLookup(fake.uuid(), entry);
				}
				Scoreboard scoreboard = mc.level.getScoreboard();
				PlayerTeam red = scoreboard.addPlayerTeam(RED_TEAM);
				red.setColor(Optional.of(TeamColor.RED));
				scoreboard.addPlayerToTeam("TeamAdmin", red);
				scoreboard.addPlayerToTeam("Entwickler", red);
				PlayerTeam hidden = scoreboard.addPlayerTeam(HIDDEN_TEAM);
				hidden.setNameTagVisibility(Team.Visibility.NEVER);
			});
			tabList(t, online, infos);
			nameTags(t, remotes);
		} catch (Exception e) {
			AutoTest.LOG.error("Test der Heldix-Symbole fehlgeschlagen", e);
			t.check("Test der Heldix-Symbole ohne Fehler (" + e + ")", false);
		} finally {
			t.run(mc -> {
				HeldixConfig.get().badgeTabList = true;
				HeldixConfig.get().badgeNameTags = true;
				mc.options.keyPlayerList.setDown(false);
				if (mc.gui.hud.isHidden()) mc.gui.hud.toggle();
				mc.gui.hud.getTabList().setHeader(null);
				mc.gui.hud.getTabList().setFooter(null);
				for (RemotePlayer remote : remotes) mc.level.removeEntity(remote.getId(), Entity.RemovalReason.DISCARDED);
				removeTabEntries(mc, infos);
				Scoreboard scoreboard = mc.level.getScoreboard();
				for (String name : List.of(RED_TEAM, HIDDEN_TEAM)) {
					PlayerTeam team = scoreboard.getPlayerTeam(name);
					if (team != null) scoreboard.removePlayerTeam(team);
				}
				Social.forgetPlayers();
				BadgeDisplay.refresh();
			});
		}
	}

	// --- Tab-Liste --------------------------------------------------------------------------

	private static void tabList(TestContext t, boolean online, List<PlayerInfo> infos) {
		t.run(mc -> {
			for (Fake fake : FAKES) {
				PlayerInfo info = new PlayerInfo(new GameProfile(fake.uuid(), fake.name()), false);
				infos.add(info);
			}
			addTabEntries(mc, infos);
		});
		for (int i = 0; i < FAKES.size(); i++) {
			Fake fake = FAKES.get(i);
			PlayerInfo info = infos.get(i);
			// über die echte (veränderte) Methode der Tab-Liste, nicht direkt über den Hook
			Component name = t.compute(mc -> mc.gui.hud.getTabList().getNameForDisplay(info));
			Badge.Role shown = Badge.roleAtStart(name);
			t.check("Tab-Liste: " + fake.name() + " → " + (fake.role() == null ? "kein Symbol" : fake.role().label()) + " (" + shown + ")", shown == fake.role());
			if (fake.role() != null) {
				t.check("Tab-Liste: " + fake.name() + " – Name bleibt erhalten", name.getString().endsWith(" " + fake.name()));
			}
		}
		// Teamfarbe des Servers: Name rot, Symbol bleibt in seinen eigenen Farben (weiß = Bild unverändert)
		Component admin = t.compute(mc -> mc.gui.hud.getTabList().getNameForDisplay(infos.get(1)));
		t.check("Tab-Liste: Teamfarbe färbt das Symbol nicht (" + colorOfGlyph(admin) + ")", Integer.valueOf(0xFFFFFF).equals(colorOfGlyph(admin)));
		t.check("Tab-Liste: Name behält die Teamfarbe (" + colorOfText(admin, "TeamAdmin") + ")",
				Integer.valueOf(TeamColor.RED.rgb()).equals(colorOfText(admin, "TeamAdmin")));
		if (online) {
			boolean own = t.compute(mc -> Badge.roleAtStart(mc.gui.hud.getTabList().getNameForDisplay(
					mc.getConnection().getPlayerInfo(mc.getUser().getProfileId()))) == Badge.Role.PLAYER);
			t.check("Tab-Liste: eigenes Heldix-Symbol (normal)", own);
		}

		// Fußzeile: unter der des Servers bzw. allein; zählt alle mit Symbol (die vier oben, dazu man selbst)
		int expected = 4 + (online && t.compute(mc -> HeldixConfig.get().socialVisible) ? 1 : 0);
		t.run(mc -> BadgeDisplay.refresh());
		String alone = t.compute(mc -> {
			Component footer = Hooks.tabFooter(null);
			return footer == null ? "" : footer.getString();
		});
		String withServer = t.compute(mc -> Hooks.tabFooter(Component.literal("Willkommen auf dem Testserver")).getString());
		if (online) {
			String line = Badge.CHAR + " HeldixClient: " + expected + " Spieler hier";
			t.check("Fußzeile ohne Server-Fußzeile: „" + alone + "“", alone.equals(line));
			t.check("Fußzeile unter der des Servers: „" + withServer.replace("\n", " | ") + "“", withServer.equals("Willkommen auf dem Testserver\n" + line));
		} else {
			t.check("Ohne Dienst keine Zeile in der Fußzeile", alone.isEmpty() && withServer.equals("Willkommen auf dem Testserver"));
		}

		// Bild: Tab-Liste mit Kopf- und Fußzeile wie auf einem Server
		t.setScreen(() -> null);
		t.run(mc -> {
			mc.gui.hud.getTabList().setHeader(Component.literal("HeldixClient-Testserver"));
			mc.gui.hud.getTabList().setFooter(Component.literal("Willkommen auf dem Testserver"));
		});
		for (int i = 0; i < 6; i++) {
			t.run(mc -> mc.options.keyPlayerList.setDown(true));
			t.waitTicks(1);
		}
		t.screenshot("heldix-28b-tabliste-rollen");
		if (online) {
			Component drawn = t.compute(mc -> BadgeDisplay.lastFooter());
			t.check("Fußzeile beim Zeichnen ergänzt (Eingriff in die Tab-Liste wirkt)", drawn != null && drawn.getString().contains("HeldixClient: " + expected + " Spieler hier"));
		}

		// Einstellung „Heldix-Symbol in der Tab-Liste“ aus: keine Symbole, keine Zeile
		t.run(mc -> {
			HeldixConfig.get().badgeTabList = false;
			BadgeDisplay.refresh();
		});
		boolean off = t.compute(mc -> infos.stream().allMatch(info -> Badge.roleAtStart(mc.gui.hud.getTabList().getNameForDisplay(info)) == null)
				&& Hooks.tabFooter(null) == null);
		t.check("Einstellung aus: keine Symbole und keine Zeile in der Tab-Liste", off);
		t.run(mc -> {
			HeldixConfig.get().badgeTabList = true;
			BadgeDisplay.refresh();
			mc.options.keyPlayerList.setDown(false);
		});
	}

	// --- Namensschilder über Köpfen -----------------------------------------------------------

	private static void nameTags(TestContext t, List<RemotePlayer> remotes) {
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			mc.player.setYRot(0f);
			mc.player.setXRot(0f);
			mc.player.yRotO = 0f;
			mc.player.xRotO = 0f;
			for (int i = 0; i < FAKES.size(); i++) {
				Fake fake = FAKES.get(i);
				RemotePlayer remote = new RemotePlayer(mc.level, new GameProfile(fake.uuid(), fake.name()));
				remote.setId(-4300 - i); // nur auf dem Client: eigene, freie Nummer
				// nebeneinander vor der Kamera (Blick nach Süden = +z), Gesicht zur Kamera
				remote.snapTo(mc.player.getX() + (i - (FAKES.size() - 1) / 2.0) * 2.2, mc.player.getY(), mc.player.getZ() + 6.5, 180f, 0f);
				remote.yBodyRot = 180f;
				remote.yHeadRot = 180f;
				mc.level.addEntity(remote);
				remotes.add(remote);
			}
		});
		t.waitTicks(10);
		for (int i = 0; i < FAKES.size(); i++) {
			Fake fake = FAKES.get(i);
			RemotePlayer remote = remotes.get(i);
			Component tag = nameTag(t, remote);
			Badge.Role shown = Badge.roleAtStart(tag);
			t.check("Namensschild: " + fake.name() + " → " + (fake.role() == null ? "kein Symbol" : fake.role().label()) + " (" + shown + ", „"
					+ (tag == null ? "kein Schild" : tag.getString()) + "“)", tag != null && shown == fake.role());
		}
		Component adminTag = nameTag(t, remotes.get(1));
		t.check("Namensschild: Teamfarbe färbt das Symbol nicht", adminTag != null && Integer.valueOf(0xFFFFFF).equals(colorOfGlyph(adminTag)));
		t.screenshot("heldix-30-namensschilder");

		// Schleichen: Minecraft zeigt das Schild blass und nicht durch Wände – das Symbol gehört dazu
		RemotePlayer moderator = remotes.get(2);
		t.run(mc -> {
			moderator.setShiftKeyDown(true);
			moderator.setPose(Pose.CROUCHING);
		});
		t.waitTicks(2);
		EntityRenderState sneaking = t.compute(mc -> mc.getEntityRenderDispatcher().extractEntity(moderator, 1f));
		t.check("Schleichen: Schild blass (isDiscrete) mit Symbol", sneaking.isDiscrete && Badge.roleAtStart(sneaking.nameTag) == Badge.Role.MODERATOR);
		t.screenshot("heldix-30b-namensschilder-schleichen");
		t.run(mc -> {
			moderator.setShiftKeyDown(false);
			moderator.setPose(Pose.STANDING);
		});

		// unsichtbar: kein Schild, also auch kein Symbol
		RemotePlayer admin = remotes.get(1);
		t.run(mc -> admin.setInvisible(true));
		t.check("Unsichtbarer Spieler: kein Schild, kein Symbol", nameTag(t, admin) == null);
		t.run(mc -> admin.setInvisible(false));

		// F1: kein Symbol. Minecraft blendet das Schild aus – außer bei Spielern in einem Team (Sichtbarkeit „immer“),
		// deren Namen es auch mit F1 noch zeigt; dann bleibt es beim Namen ohne Symbol.
		t.run(mc -> mc.gui.hud.toggle());
		Component hiddenPlain = nameTag(t, remotes.get(0));
		Component hiddenTeam = nameTag(t, admin);
		t.check("F1: kein Schild ohne Team (" + (hiddenPlain == null ? "kein Schild" : hiddenPlain.getString()) + ")",
				t.compute(mc -> mc.gui.hud.isHidden()) && hiddenPlain == null);
		t.check("F1: Spieler im Team ohne Symbol (" + (hiddenTeam == null ? "kein Schild" : hiddenTeam.getString()) + ")",
				hiddenTeam == null || Badge.roleAtStart(hiddenTeam) == null);
		t.run(mc -> mc.gui.hud.toggle());

		// Server blendet Namensschilder über ein Team aus (nameTagVisibility never)
		RemotePlayer developer = remotes.get(3);
		t.run(mc -> mc.level.getScoreboard().addPlayerToTeam("Entwickler", mc.level.getScoreboard().getPlayerTeam(HIDDEN_TEAM)));
		t.check("Vom Server ausgeblendetes Schild: kein Symbol", nameTag(t, developer) == null);
		t.run(mc -> mc.level.getScoreboard().addPlayerToTeam("Entwickler", mc.level.getScoreboard().getPlayerTeam(RED_TEAM)));
		t.check("Schild wieder da, mit Symbol", Badge.roleAtStart(nameTag(t, developer)) == Badge.Role.DEVELOPER);

		// Einstellung „Heldix-Symbol über Köpfen“ aus: Schild ohne Symbol
		t.run(mc -> HeldixConfig.get().badgeNameTags = false);
		Component plain = nameTag(t, admin);
		t.check("Einstellung aus: Schild ohne Symbol („" + (plain == null ? "kein Schild" : plain.getString()) + "“)",
				plain != null && Badge.roleAtStart(plain) == null && plain.getString().equals("TeamAdmin"));
		t.run(mc -> HeldixConfig.get().badgeNameTags = true);

		// näher heran: Symbol und Name gut lesbar
		t.run(mc -> {
			for (RemotePlayer remote : remotes) remote.snapTo(remote.getX(), remote.getY(), mc.player.getZ() + 4.5, 180f, 0f);
		});
		t.waitTicks(4);
		t.screenshot("heldix-30c-namensschilder-nah");
	}

	/** Namensschild, wie Minecraft es für dieses Bild bestimmt (über den echten, veränderten Renderer); null = keins */
	private static Component nameTag(TestContext t, RemotePlayer player) {
		return t.compute(mc -> mc.getEntityRenderDispatcher().extractEntity(player, 1f).nameTag);
	}

	// --- Hilfen ---------------------------------------------------------------------------

	/** Farbe, mit der das Heldix-Symbol gezeichnet wird (null = keine eigene, z. B. von einer Teamfarbe geerbt) */
	private static Integer colorOfGlyph(Component text) {
		Integer[] color = {-1};
		text.visit((style, part) -> {
			if (!part.isEmpty() && Badge.roleAtStart(Component.literal(part.substring(0, 1))) != null) {
				TextColor value = style.getColor();
				color[0] = value == null ? null : value.getValue();
				return Optional.of(Unit.INSTANCE);
			}
			return Optional.empty();
		}, Style.EMPTY);
		return color[0];
	}

	/** Farbe eines Textteils (null = ohne Farbe) */
	private static Integer colorOfText(Component text, String wanted) {
		Integer[] color = {-1};
		text.visit((style, part) -> {
			if (part.contains(wanted)) {
				TextColor value = style.getColor();
				color[0] = value == null ? null : value.getValue();
				return Optional.of(Unit.INSTANCE);
			}
			return Optional.empty();
		}, Style.EMPTY);
		return color[0];
	}

	/** Einträge nur auf dem Client in die Tab-Liste legen (wie ein Server, der Spieler meldet) */
	@SuppressWarnings("unchecked")
	private static void addTabEntries(Minecraft mc, List<PlayerInfo> infos) {
		ClientPacketListener connection = mc.getConnection();
		Map<UUID, PlayerInfo> map = (Map<UUID, PlayerInfo>) field(connection, "playerInfoMap");
		Set<PlayerInfo> listed = (Set<PlayerInfo>) field(connection, "listedPlayers");
		for (PlayerInfo info : infos) {
			map.put(info.getProfile().id(), info);
			listed.add(info);
		}
	}

	@SuppressWarnings("unchecked")
	private static void removeTabEntries(Minecraft mc, List<PlayerInfo> infos) {
		ClientPacketListener connection = mc.getConnection();
		if (connection == null) return;
		Map<UUID, PlayerInfo> map = (Map<UUID, PlayerInfo>) field(connection, "playerInfoMap");
		Set<PlayerInfo> listed = (Set<PlayerInfo>) field(connection, "listedPlayers");
		for (PlayerInfo info : infos) {
			map.remove(info.getProfile().id());
			listed.remove(info);
		}
	}

	private static Object field(Object target, String name) {
		try {
			Field field = ClientPacketListener.class.getDeclaredField(name);
			field.setAccessible(true);
			return field.get(target);
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException("Feld " + name + " nicht gefunden", e);
		}
	}
}
