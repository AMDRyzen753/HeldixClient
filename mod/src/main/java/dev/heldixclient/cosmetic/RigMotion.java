package dev.heldixclient.cosmetic;

import dev.heldixclient.loader.api.event.ClientEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.player.LocalPlayer;

/**
 * Was ein Spieler gerade tut, für die Animationen der Cosmetics im Format 2: ein Zustand (Schlüssel aus
 * {@link CosmeticFormat#STATE_KEYS}: idle, walk, sneak, …) und Zähler für Übergänge (Abheben, Landen, Schaden, Jubeln).
 * Jedes Cosmetic des Spielers merkt sich, welche Zählerstände es schon abgespielt hat – so sieht jedes jeden Übergang
 * genau einmal.
 *
 * <p>Gerechnet wird einmal je Spiel-Tick des Spielers (beim ersten Zeichnen danach), aus Werten, die es auch für andere
 * Spieler gibt (Position im letzten Tick, am Boden, Schleichen, Elytra …). Nur für den eigenen Spieler: Creative-Flug aus
 * den Fähigkeiten, AFK (30 s ohne Eingabe), Emotes des Emote-Rads und Jubeln bei einem neuen Fortschritt. Bei anderen
 * Spielern gilt als Creative-Flug, wer im Kreativ- oder Zuschauermodus in der Luft steht, statt zu fallen.
 */
final class RigMotion {
	/** so lange ohne Eingabe gilt der eigene Spieler als AFK */
	static final long AFK_NANOS = 30_000_000_000L;
	/** Systemeigenschaft, über die das Emote-Rad das laufende Emote meldet („NAME;STÄRKE“, leer = keins) */
	private static final String EMOTE_PROPERTY = "heldix.emote.lokal";

	static final int IDLE = CosmeticFormat.STATE_KEYS.indexOf("idle");
	static final int WALK = CosmeticFormat.STATE_KEYS.indexOf("walk");
	static final int SNEAK = CosmeticFormat.STATE_KEYS.indexOf("sneak");
	static final int SIT = CosmeticFormat.STATE_KEYS.indexOf("sit_or_ride");
	static final int SWIM = CosmeticFormat.STATE_KEYS.indexOf("swim");
	static final int SPRINT = CosmeticFormat.STATE_KEYS.indexOf("sprint");
	static final int ELYTRA = CosmeticFormat.STATE_KEYS.indexOf("elytra");
	static final int JUMP = CosmeticFormat.STATE_KEYS.indexOf("jump");
	static final int FALL = CosmeticFormat.STATE_KEYS.indexOf("fall");
	static final int FLY = CosmeticFormat.STATE_KEYS.indexOf("creative_fly");
	static final int START_FLYING = CosmeticFormat.STATE_KEYS.indexOf("start_flying");
	static final int LAND = CosmeticFormat.STATE_KEYS.indexOf("land");
	static final int HURT = CosmeticFormat.STATE_KEYS.indexOf("hurt");
	static final int EMOTE = CosmeticFormat.STATE_KEYS.indexOf("emote");
	static final int CELEBRATE = CosmeticFormat.STATE_KEYS.indexOf("celebrate");
	static final int AFK = CosmeticFormat.STATE_KEYS.indexOf("afk");
	static final int SLEEP = CosmeticFormat.STATE_KEYS.indexOf("sleep");
	static final int ENABLE = CosmeticFormat.STATE_KEYS.indexOf("enable");
	static final int DISABLE = CosmeticFormat.STATE_KEYS.indexOf("disable");
	static final int SUMMON = CosmeticFormat.STATE_KEYS.indexOf("summon");

	/** aktueller Zustand (Index in STATE_KEYS) */
	int state = IDLE;
	// Zähler der Übergänge
	long startFlying;
	long land;
	long hurt;
	long celebrate;
	// Verlauf
	private int lastTick = Integer.MIN_VALUE;
	private int airTicks;
	private boolean wasFlight;
	private boolean wasGround = true;
	private boolean wasFalling;
	private int lastHurtTime;
	private long seenCelebrate = -1;

	// ---- eigener Spieler (ein Tick-Beobachter für alle) ----
	private static volatile long lastInput = System.nanoTime();
	private static float lastYaw;
	private static float lastPitch;
	/** Jubeln des eigenen Spielers (neuer Fortschritt, Addon-Effekt, Test) */
	private static volatile long ownCelebrate;
	private static int advancementBaseline = -1;
	private static int ticksInWorld;

	private RigMotion() {
	}

	static RigMotion create() {
		return new RigMotion();
	}

	/** Beim Start: AFK-Erkennung und Fortschritte des eigenen Spielers beobachten */
	static void init() {
		ClientEvents.TICK_END.register(RigMotion::tickOwn);
	}

	private static void tickOwn(Minecraft mc) {
		LocalPlayer player = mc.player;
		if (player == null) {
			advancementBaseline = -1;
			ticksInWorld = 0;
			return;
		}
		ticksInWorld++;
		var o = mc.options;
		boolean input = player.getYRot() != lastYaw || player.getXRot() != lastPitch || o.keyUp.isDown() || o.keyDown.isDown() || o.keyLeft.isDown()
				|| o.keyRight.isDown() || o.keyJump.isDown() || o.keyShift.isDown() || o.keySprint.isDown() || o.keyAttack.isDown() || o.keyUse.isDown();
		lastYaw = player.getYRot();
		lastPitch = player.getXRot();
		if (input) lastInput = System.nanoTime();
		// Fortschritte: wächst die Zahl erreichter (sichtbarer) Fortschritte, jubeln die Cosmetics. In den ersten
		// Sekunden nach dem Betreten kommt die Liste erst an – das zählt nicht.
		if (ticksInWorld % 20 == 0) {
			int done = 0;
			try {
				for (var entry : player.connection.getAdvancements().progress().entrySet()) {
					if (entry.getValue().isDone() && entry.getKey().value().display().isPresent()) done++;
				}
			} catch (RuntimeException e) {
				return;
			}
			if (ticksInWorld < 100 || advancementBaseline < 0) advancementBaseline = done;
			else if (done > advancementBaseline) {
				advancementBaseline = done;
				ownCelebrate++;
			} else advancementBaseline = done;
		}
	}

	/** Eingabe vermerken (z. B. für Tests, die AFK zurücksetzen) */
	static void markInput() {
		lastInput = System.nanoTime();
	}

	/** Nur für Tests: AFK sofort (als wäre seit 30 s nichts gedrückt worden) */
	static void forceAfk() {
		lastInput = System.nanoTime() - AFK_NANOS - 1;
	}

	/** Eigener Spieler jubelt (Fortschritt, Addon-Effekt, Test) */
	static void celebrateOwn() {
		ownCelebrate++;
	}

	/** Läuft gerade ein Emote des Emote-Rads (eigener Spieler)? */
	static boolean ownEmote() {
		String value = System.getProperty(EMOTE_PROPERTY, "");
		return !value.isEmpty();
	}

	/** Zustand und Übergänge aktualisieren (jedes Bild aufgerufen, rechnet einmal je Tick des Spielers) */
	void update(AbstractClientPlayer player, boolean own) {
		if (own && seenCelebrate != ownCelebrate) {
			if (seenCelebrate >= 0) celebrate++;
			seenCelebrate = ownCelebrate;
		}
		if (player.tickCount == lastTick) return;
		lastTick = player.tickCount;
		boolean ground = player.onGround();
		double vy = player.getY() - player.yo;
		double dx = player.getX() - player.xo;
		double dz = player.getZ() - player.zo;
		double speed = Math.sqrt(dx * dx + dz * dz);
		int airBefore = airTicks;
		airTicks = ground ? 0 : airTicks + 1;
		boolean flying = own ? player.getAbilities().flying
				: !ground && (player.isCreative() || player.isSpectator()) && airTicks > 5 && vy > -0.45;
		int next;
		if (player.isSleeping()) next = SLEEP;
		else if (player.isPassenger()) next = SIT;
		else if (player.isFallFlying()) next = ELYTRA;
		else if (flying) next = FLY;
		else if (player.isVisuallySwimming() || (player.isInWater() && !ground)) next = SWIM;
		else if (player.isCrouching()) next = SNEAK;
		else if (!ground) next = vy > 0 || (airTicks <= 10 && vy > -0.5) ? JUMP : FALL;
		else if (player.isSprinting() && speed > 0.05) next = SPRINT;
		else if (speed > 0.015) next = WALK;
		else if (own && System.nanoTime() - lastInput >= AFK_NANOS) next = AFK;
		else next = IDLE;

		boolean flight = next == ELYTRA || next == FLY;
		if (flight && !wasFlight) startFlying++;
		// Landen: nach einem Flug, einem Fall oder langer Zeit in der Luft (ein einfacher Sprung zählt nicht)
		if (ground && !wasGround && (wasFlight || wasFalling || airBefore >= 16)) land++;
		int hurtTime = player.hurtTime;
		if (hurtTime > 0 && hurtTime > lastHurtTime) hurt++;
		lastHurtTime = hurtTime;
		wasFlight = flight;
		wasGround = ground;
		wasFalling = next == FALL;
		state = next;
	}
}
