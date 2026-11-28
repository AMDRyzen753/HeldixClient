package dev.heldixclient.addons.emoterad.test;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;

/**
 * Emotes des eigenen Spielers (Test, angelehnt an Emote-Räder aus Spielen): nur optisch und nur lokal sichtbar.
 * Jedes Emote blendet in {@link #FADE_MS} weich ein und aus; Sitzen hält, bis sich der Spieler bewegt, die anderen
 * laufen eine feste Zeit.
 */
final class Emotes {
	static final float FADE_MS = 350f;

	enum Emote {
		/** Hinsetzen: Körper sinkt zu Boden, Beine nach vorn, Hände auf den Knien; endet beim Bewegen */
		SIT("Sitzen", 0, true),
		/** rechten Arm heben und winken */
		WAVE("Winken", 2600, false),
		/** Oberkörper und Kopf neigen */
		BOW("Verbeugen", 2000, true),
		/** Arme leicht auseinander, die Krallen richten sich auf und spreizen sich */
		FLARE("Krallen zeigen", 2600, false);

		final String label;
		/** Dauer in ms; 0 = bis der Spieler sich bewegt */
		final int duration;
		/** endet, sobald sich der Spieler bewegt */
		final boolean stopsOnMove;

		Emote(String label, int duration, boolean stopsOnMove) {
			this.label = label;
			this.duration = duration;
			this.stopsOnMove = stopsOnMove;
		}
	}

	private Emote current;
	private long started;
	/** Zeitpunkt des Ausblendens, 0 = läuft noch */
	private long stopping;

	/** Emote starten (ersetzt ein laufendes); Sitzen und Verbeugen nur auf dem Boden */
	void play(Emote emote) {
		LocalPlayer player = Minecraft.getInstance().player;
		if (player == null || !canPlay(player, emote)) return;
		current = emote;
		started = System.currentTimeMillis();
		stopping = 0;
	}

	void stop() {
		if (current != null && stopping == 0) stopping = System.currentTimeMillis();
	}

	/** Jeden Tick: Zeit abgelaufen, Spieler bewegt sich oder tut etwas anderes → ausblenden */
	void tick() {
		if (current == null) return;
		long now = System.currentTimeMillis();
		if (stopping != 0) {
			if (now - stopping >= FADE_MS) current = null;
			return;
		}
		LocalPlayer player = Minecraft.getInstance().player;
		if (player == null || !canPlay(player, current)) {
			stop();
			return;
		}
		if (current.duration > 0 && now - started >= current.duration) stop();
		if (current.stopsOnMove) {
			double dx = player.getDeltaMovement().x;
			double dz = player.getDeltaMovement().z;
			if (dx * dx + dz * dz > 0.0004) stop();
		}
	}

	private static boolean canPlay(LocalPlayer player, Emote emote) {
		boolean basic = !player.isPassenger() && !player.isSwimming() && !player.isFallFlying() && !player.isSleeping()
				&& !player.isSpectator();
		if (!emote.stopsOnMove) return basic;
		return basic && player.onGround() && !player.isShiftKeyDown() && !player.isInWater();
	}

	/** laufendes Emote oder null */
	Emote current() {
		return current;
	}

	/** Stärke 0..1 (Ein- und Ausblenden) */
	float blend() {
		if (current == null) return 0f;
		long now = System.currentTimeMillis();
		float in = Math.min(1f, (now - started) / FADE_MS);
		float out = stopping == 0 ? 1f : Math.max(0f, 1f - (now - stopping) / FADE_MS);
		return Math.min(in, out);
	}

	/** Sekunden seit dem Start (für Bewegungen wie Winken) */
	float seconds() {
		return current == null ? 0f : (System.currentTimeMillis() - started) / 1000f;
	}

	boolean isLocal(Entity entity) {
		return entity != null && entity == Minecraft.getInstance().player;
	}
}
