package dev.heldixclient.cosmetic;

import org.joml.Matrix4f;
import org.joml.Quaternionf;

/**
 * Laufzeit eines Cosmetics im Format 2 an einem Träger (ein Spieler oder eine Menüfigur, je Slot): eigene Uhr, laufende
 * Animation, Überblenden und die Knochen-Matrizen des aktuellen Bildes.
 *
 * <p>Zustandsautomat: Der Zustand des Spielers ({@link RigMotion}) wählt über {@code states} die Animation, ohne Zuordnung
 * idle. Übergänge (start_flying, land, hurt, celebrate, beim Anlegen summon bzw. enable) spielen ihre Animation einmal; sie
 * läuft zu Ende und kehrt dann zum Zustand zurück ({@code start_flying} → danach z. B. der Glide-Zustand elytra). Jeder
 * Wechsel blendet über {@code blendSeconds}: Die Pose beim Wechsel wird festgehalten und je Knochen per slerp (Drehung)
 * bzw. linear (Verschiebung, Größe) in die neue Animation übergeblendet – auch mitten in einer anderen Überblendung
 * springt nichts. Beim Ablegen spielt {@code disable} (falls zugeordnet) und das Cosmetic verschwindet danach.
 *
 * <p>Weit entfernte Spieler werden vereinfacht aktualisiert: neue Pose höchstens zehnmal je Sekunde, ohne Überblenden.
 * Alles im Render-Thread; Felder werden beim Anlegen einmal angelegt und danach nur überschrieben.
 */
final class RigAnimator {
	private static final double FAR_INTERVAL = 0.1;

	CosmeticCatalog.Item item;
	CosmeticRig rig;
	/** Sekunden seit dem Anlegen */
	double clock;
	private long lastNanos;
	/** laufende Animation (Index) und ihr Start auf der eigenen Uhr */
	int clip;
	double clipStart;
	/** läuft eine einmalige Animation (danach zurück zum Zustand)? */
	boolean oneShot;
	/** spielt die Animation zum Ablegen und verschwindet danach */
	boolean leaving;
	/** fertig abgelegt: nicht mehr zeichnen */
	boolean done;
	/** aktueller Zustand des Trägers (Index in STATE_KEYS) */
	int state = RigMotion.IDLE;
	// Überblenden
	boolean blending;
	private double blendStart;
	private float blendLength;
	private final float[] q;
	private final float[] m;
	private final float[] s;
	private final float[] fromQ;
	private final float[] fromM;
	private final float[] fromS;
	private final float[] targetQ;
	private final float[] targetM;
	private final float[] targetS;
	final Matrix4f[] world;
	private final Quaternionf scratch = new Quaternionf();
	private boolean posed;
	private double lastPose = -1;
	// gesehene Zählerstände der Übergänge
	long seenStart;
	long seenLand;
	long seenHurt;
	long seenCelebrate;
	long seenEffect;
	// Partikel: Sekunden bis zum nächsten (je Eintrag, Poisson-Verteilung)
	final double[] nextParticle;
	final java.util.SplittableRandom random = new java.util.SplittableRandom(System.nanoTime());
	/** Uhrzeit beim letzten Erzeugen von Partikeln (je Bild höchstens einmal, auch wenn der Spieler mehrfach gezeichnet wird) */
	double particleClock;
	// Messwerte
	long particlesSpawned;
	/** Lage beim Einreichen im Spielerrenderer (für Partikel und Messwerte, bestätigt in entity()) */
	final Matrix4f pendingPose = new Matrix4f();
	boolean pending;
	final double[] anchor = new double[3];
	final double[] rootPivot = new double[3];
	long frame;

	RigAnimator(CosmeticCatalog.Item item) {
		this.item = item;
		this.rig = item.rig();
		int n = rig.boneCount;
		q = new float[n * 4];
		m = new float[n * 3];
		s = new float[n];
		fromQ = new float[n * 4];
		fromM = new float[n * 3];
		fromS = new float[n];
		targetQ = new float[n * 4];
		targetM = new float[n * 3];
		targetS = new float[n];
		world = new Matrix4f[n];
		for (int b = 0; b < n; b++) world[b] = new Matrix4f();
		nextParticle = new double[rig.particles.length];
		for (int i = 0; i < nextParticle.length; i++) nextParticle[i] = interval(rig.particles[i].perSecond);
		clip = idleClip();
	}

	private int idleClip() {
		return rig.stateClip(RigMotion.IDLE);
	}

	/** Animation des Zustands (ohne Zuordnung idle) */
	private int clipOf(int state) {
		int c = rig.stateClip(state);
		return c >= 0 ? c : idleClip();
	}

	/** Zuordnung vorhanden? */
	boolean has(int state) {
		return rig.stateClip(state) >= 0;
	}

	/** Beim Anlegen: summon (Begleiter) bzw. enable (Auren), falls zugeordnet */
	void intro() {
		if (has(RigMotion.SUMMON)) play(rig.stateClip(RigMotion.SUMMON), true);
		else if (has(RigMotion.ENABLE)) play(rig.stateClip(RigMotion.ENABLE), true);
	}

	/** Beim Ablegen: disable spielen und danach verschwinden; ohne Zuordnung sofort weg */
	void leave() {
		if (!has(RigMotion.DISABLE)) {
			done = true;
			return;
		}
		play(rig.stateClip(RigMotion.DISABLE), true);
		leaving = true;
	}

	/** Übergang (start_flying, land, hurt, celebrate …): einmal abspielen, falls zugeordnet */
	void trigger(int state) {
		if (leaving || !has(state)) return;
		play(rig.stateClip(state), true);
	}

	/** Animation wechseln: aktuelle Pose festhalten und überblenden */
	private void play(int next, boolean once) {
		if (posed && rig.blendSeconds > 0) {
			System.arraycopy(q, 0, fromQ, 0, q.length);
			System.arraycopy(m, 0, fromM, 0, m.length);
			System.arraycopy(s, 0, fromS, 0, s.length);
			blending = true;
			blendStart = clock;
			blendLength = rig.blendSeconds;
		} else blending = false;
		clip = next;
		clipStart = clock;
		oneShot = once;
	}

	/**
	 * Uhr weiterstellen, Zustand und Übergänge übernehmen und die Pose rechnen.
	 *
	 * @param motion Zustand des Spielers (null = Menüfigur: idle)
	 * @param forced Zustand, der alles andere übersteuert (z. B. emote beim Darüberfahren im Menü), -1 = keiner
	 * @param far    weit entfernt: vereinfacht (höchstens zehnmal je Sekunde, ohne Überblenden)
	 */
	void update(long now, RigMotion motion, int forced, boolean far) {
		if (lastNanos == 0) lastNanos = now;
		double dt = Math.min(0.25, Math.max(0, (now - lastNanos) / 1e9));
		lastNanos = now;
		clock += dt;

		if (motion != null && !leaving) {
			// Übergänge, die dieses Cosmetic noch nicht gesehen hat (beim ersten Bild nur merken: die waren vor dem Anlegen).
			// Mehrere auf einmal: das Wichtigste zuletzt, es gewinnt (Jubeln < Abheben/Landen < Schaden)
			boolean first = !posed;
			if (seenCelebrate != motion.celebrate) {
				seenCelebrate = motion.celebrate;
				if (!first) trigger(RigMotion.CELEBRATE);
			}
			if (seenLand != motion.land) {
				seenLand = motion.land;
				if (!first) trigger(RigMotion.LAND);
			}
			if (seenStart != motion.startFlying) {
				seenStart = motion.startFlying;
				if (!first) trigger(RigMotion.START_FLYING);
			}
			if (seenHurt != motion.hurt) {
				seenHurt = motion.hurt;
				if (!first) trigger(RigMotion.HURT);
			}
		}
		state = forced >= 0 ? forced : motion != null ? motion.state : RigMotion.IDLE;
		int target = clipOf(state);
		CosmeticRig.Clip current = rig.clips[clip];
		if (leaving) {
			if (current.finished(clock - clipStart)) done = true;
		} else if (oneShot) {
			if (current.finished(clock - clipStart)) play(target, false);
		} else if (target != clip) play(target, false);

		if (far && posed && lastPose >= 0 && clock - lastPose < FAR_INTERVAL) return;
		lastPose = clock;
		pose(far);
	}

	private void pose(boolean far) {
		CosmeticRig.Clip current = rig.clips[clip];
		float f = current.frameAt(clock - clipStart);
		if (blending && !far) {
			float w = (float) ((clock - blendStart) / blendLength);
			if (w >= 1f) {
				blending = false;
				rig.sample(current, f, q, m, s);
			} else {
				// weich ein- und auslaufen
				w = w * w * (3 - 2 * w);
				rig.sample(current, f, targetQ, targetM, targetS);
				int n = rig.boneCount;
				for (int b = 0; b < n; b++) {
					CosmeticRig.slerp(fromQ, b * 4, targetQ, b * 4, w, q, b * 4);
					for (int k = 0; k < 3; k++) m[b * 3 + k] = fromM[b * 3 + k] + (targetM[b * 3 + k] - fromM[b * 3 + k]) * w;
					s[b] = fromS[b] + (targetS[b] - fromS[b]) * w;
				}
			}
		} else {
			blending = false;
			rig.sample(current, f, q, m, s);
		}
		rig.matrices(q, m, s, world, scratch);
		posed = true;
	}

	/** Name der laufenden Animation */
	String clipName() {
		return rig.clips[clip].name;
	}

	/** Ist die laufende Animation in der Bitmaske eines Partikels? */
	boolean active(CosmeticRig.Particle particle) {
		return (particle.clips & (1L << clip)) != 0;
	}

	/** Sekunden bis zum nächsten Partikel bei {@code perSecond} (exponentiell verteilt: Poisson-Prozess) */
	double interval(double perSecond) {
		return -Math.log(1 - random.nextDouble()) / perSecond;
	}

	/** Summe einiger Matrixwerte: ändert sich, wenn sich das Modell bewegt (für Tests) */
	float fingerprint() {
		float sum = 0;
		for (int b = 0; b < world.length; b++) {
			Matrix4f w = world[b];
			sum += w.m00() * 1.3f + w.m01() * 2.1f + w.m02() * 0.7f + w.m10() * 1.9f + w.m12() * 0.3f + w.m30() * 0.11f + w.m31() * 0.13f + w.m32() * 0.17f;
		}
		return sum;
	}
}
