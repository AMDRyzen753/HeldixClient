package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.Model;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.resources.Identifier;
import org.joml.Matrix4f;
import org.joml.Vector3f;

import java.util.HashMap;
import java.util.Map;

/**
 * Cape als wehender Stoff statt als starre Platte: Das Cape besteht aus vielen waagrechten Streifen, die sich nach
 * unten hin immer stärker nach hinten biegen. Darüber läuft eine Welle von oben nach unten – beim Laufen kräftiger,
 * im Stehen ganz leicht. Die Grundneigung kommt wie bei Minecraft aus der Bewegung des Spielers (capeLean, capeFlap).
 *
 * <p>Ruhig statt zuckend: Neigung, Seitenneigung und Flattern werden je Spieler über die Bildzeit geglättet (das
 * Schritt-Wippen in capeFlap, 4–5 Hz, fällt dabei heraus; Sprung und Fall bleiben), und die Welle läuft über eine
 * aufsummierte Phase – sie springt nicht, wenn sich das Tempo ändert.
 *
 * <p>Ohne Durchstechen: Das Cape kippt nie zum Körper hin und pendelt seitlich nur in der Rückenebene. Schwingen die
 * Beine nach hinten, hebt sich der Stoff so weit an, dass sie frei bleiben (auch im weitesten Rückschwung beim jetzigen
 * Lauftempo; setzt weich ein und klingt langsam ab – kein Anstoßen bei jedem Schritt). Die Breite bleibt wie bei
 * Minecraft. Gegen schwarze Pixel in Bewegung: {@link #bleed} färbt die durchsichtigen Bereiche der Cape-Bilder in der
 * Farbe des nächsten Motivpixels, damit beim Verkleinern (Mipmaps) und Filtern kein Schwarz an die Ränder gemischt
 * wird. Prüfstand ohne Spiel: tools/cape-autotest.
 *
 * <p>Koordinaten in Modell-Pixeln (1/16 Block) wie bei Minecraft-Modellen: y zeigt nach unten, z vom Rücken weg.
 * Die Texturaufteilung ist die der normalen Cape-Vorlage (64 × 32), daher passt es für jedes Cape.
 */
public final class CapeCloth {
	/** Streifen von oben nach unten */
	private static final int ROWS = 16;
	/** Spalten quer (für die leichte Wölbung) */
	private static final int COLS = 6;
	private static final float WIDTH = 10f;
	private static final float LENGTH = 16f;
	private static final float THICKNESS = 1f;
	/** Abstand des Stoffs zu Armen und Beinen, wenn sie nach hinten schwingen (Pixel; deckt Ärmel- und Hosenebene ab) */
	private static final float CLEARANCE = 0.6f;
	/** Glättung in Ticks: Neigung, Seitenneigung, Flattern (filtert das Schritt-Wippen heraus) */
	private static final float TAU_LEAN = 3f, TAU_LEAN2 = 4f, TAU_FLAP = 5f;
	/** Ausweichen: Anstieg und Abklingen in Ticks */
	private static final float TAU_RISE = 0.75f, TAU_FALL = 15f;
	/** höchstens so viel zusätzliche Neigung (Grad) für die Beine */
	private static final float MAX_LIFT = 70f;
	/** Bewegungszustand je Spieler (Entity-ID) */
	private static final Map<Integer, Motion> MOTION = new HashMap<>();
	private static int calls;

	private CapeCloth() {
	}

	/** Kann dieses Modell als Stoff gezeichnet werden? (Cape-Teil am Körper vorhanden) */
	public static boolean supports(Model<?> model) {
		return model instanceof HumanoidModel<?> humanoid && humanoid.body.hasChild("cape");
	}

	/**
	 * Zeichnet das Cape. pose ist die Lage, die Minecraft dem Cape-Modell mitgeben würde (Spieler, ggf. Rüstung).
	 *
	 * @param glow Leuchtbild (null = keins); wird voll hell (unabhängig vom Licht) über die Außenseite gelegt
	 */
	@SuppressWarnings({"unchecked", "rawtypes"})
	public static void submit(SubmitNodeCollector collector, Model model, AvatarRenderState state, PoseStack pose, Identifier texture,
			Identifier glow, int light, int overlay) {
		HumanoidModel<?> humanoid = (HumanoidModel<?>) model;
		// Körperhaltung (z. B. Schleichen) und Arme/Beine wie beim normalen Modell
		model.setupAnim(state);
		ModelPart cape = humanoid.body.getChild("cape");
		Motion motion = motion(state);
		float sideways = motion.lean2 / 2f;
		PoseStack space = new PoseStack();
		capeSpace(space, humanoid, cape, sideways);
		Matrix4f capeInverse = new Matrix4f(space.last().pose()).invert();
		// Hüllkurve: das größere aus geglättetem und aktuellem Lauftempo (beim Losgehen schwingen die Glieder schon weiter)
		float walk = Math.clamp(Math.max(motion.walk, state.walkAnimationSpeed), 0f, 1f);
		float rise = 1f - (float) Math.exp(-motion.dt / TAU_RISE);
		float keep = (float) Math.exp(-motion.dt / TAU_FALL);

		// Beine: Anheben, bis sie frei sind (nachgemessen, weil sich der Stoff dabei nach oben schiebt)
		float lift = 0f;
		for (int pass = 0; pass < 3; pass++) {
			float more = legLift(shape(motion, lift), humanoid, capeInverse, walk);
			if (more <= 0.05f) break;
			lift = Math.min(MAX_LIFT, lift + more * 1.1f);
		}
		motion.lift = follow(motion.lift, lift, rise, keep);
		// volle Breite wie bei Minecraft: die Arme streifen die Kanten wie beim normalen Cape
		Shape shape = shape(motion, motion.lift);

		pose.pushPose();
		capeSpace(pose, humanoid, cape, sideways);
		collector.submitCustomGeometry(pose, RenderTypes.entityCutout(texture), (p, consumer) -> emit(p, consumer, shape, light, overlay));
		if (glow != null) {
			collector.submitCustomGeometry(pose, RenderTypes.eyes(glow), (p, consumer) -> emitGlow(p, consumer, shape, overlay));
		}
		pose.popPose();
	}

	/** steigt weich auf das Ziel, fällt langsam ab */
	private static float follow(float now, float target, float rise, float keep) {
		return target > now ? now + (target - now) * rise : Math.max(target, now * keep);
	}

	/**
	 * Cape-Raum: Körper, Aufhängepunkt, Pixel-Maßstab wie beim Cape-Modell von Minecraft. Die Seitenneigung pendelt nur
	 * in der Rückenebene (Minecraft dreht zusätzlich um die Hochachse – dabei taucht eine Kante in den Rücken).
	 */
	private static void capeSpace(PoseStack pose, HumanoidModel<?> humanoid, ModelPart cape, float sideways) {
		humanoid.root().translateAndRotate(pose);
		humanoid.body.translateAndRotate(pose);
		pose.translate(cape.x / 16f, cape.y / 16f, cape.z / 16f);
		pose.rotateDegrees(Axis.ZP, sideways);
		pose.scale(1 / 16f, 1 / 16f, 1 / 16f);
	}

	/** geglätteter Bewegungszustand eines Spielers; Phase der Welle in Bogenmaß, Anheben in Grad, Einzug in Pixeln */
	private static final class Motion {
		float lean, lean2, flap, walk, phase, lift, age, dt;
		long used;
	}

	private static Motion motion(AvatarRenderState state) {
		long now = System.nanoTime();
		if (++calls % 512 == 0) MOTION.values().removeIf(m -> now - m.used > 10_000_000_000L);
		Motion m = MOTION.get(state.id);
		float dt = m == null ? -1f : state.ageInTicks - m.age;
		if (m == null || !Float.isFinite(dt) || dt < 0f || dt > 40f) {
			// neu, Zeitsprung (Welt gewechselt, Vorschau) oder ungültige Zeit: direkt übernehmen
			if (m == null) {
				m = new Motion();
				MOTION.put(state.id, m);
			}
			m.lean = state.capeLean;
			m.lean2 = state.capeLean2;
			m.flap = state.capeFlap;
			m.walk = state.walkAnimationSpeed;
			m.phase = (state.id % 97) * 0.37f;
			m.lift = 0f;
			dt = 0f;
		}
		m.age = state.ageInTicks;
		m.used = now;
		m.dt = dt;
		if (dt > 0f) {
			m.lean += (state.capeLean - m.lean) * (1f - (float) Math.exp(-dt / TAU_LEAN));
			m.lean2 += (state.capeLean2 - m.lean2) * (1f - (float) Math.exp(-dt / TAU_LEAN2));
			m.flap += (state.capeFlap - m.flap) * (1f - (float) Math.exp(-dt / TAU_FLAP));
			m.walk += (state.walkAnimationSpeed - m.walk) * (1f - (float) Math.exp(-dt / TAU_LEAN));
			float motion = Math.clamp(m.lean / 70f, 0f, 1f);
			m.phase = (m.phase + dt / 20f * (2.6f + motion * 5.5f)) % (float) (Math.PI * 200);
		}
		return m;
	}

	/**
	 * Form des Stoffs: Punkte der Innenseite, Richtung nach außen je Gitterpunkt, Winkel der Streifen (Grad) und halbe
	 * Breite je Reihe zur +x-Seite (Spalte 0, links im Bild) und zur −x-Seite (Spalte COLS).
	 */
	private record Shape(float[][] y, float[][] z, float[][] ny, float[][] nz, float[] angle, float[] halfLeft, float[] halfRight) {
	}

	/** @param lift zusätzliche Neigung in Grad (für die Beine), unten etwas stärker als oben */
	private static Shape shape(Motion m, float lift) {
		// nie zum Körper hin: auch beim Hochspringen (negatives Flattern) bleibt eine kleine Grundneigung; beim Gehen
		// (auch seitwärts und rückwärts, wo capeLean klein bleibt) hebt das Lauftempo den Stoff etwas von den Beinen
		float base = Math.max(3f + 20f * Math.clamp(m.walk, 0f, 1f), 6f + m.lean / 2f + m.flap);
		float motion = Math.clamp(m.lean / 70f, 0f, 1f);
		float amplitude = 2.2f + motion * 7f;
		float phase = m.phase;

		// Winkel der Streifen: oben nah am Körper, unten weiter nach hinten, mit wandernder Welle
		float[] angle = new float[ROWS];
		for (int i = 0; i < ROWS; i++) {
			float s = (i + 0.5f) / ROWS;
			float bend = base * (0.45f + 1.1f * s) + lift * (0.8f + 0.4f * s);
			float wave = amplitude * s * (float) Math.sin(phase - s * 6.5f)
					+ amplitude * 0.35f * s * (float) Math.sin(phase * 1.7f - s * 11f + 1.3f);
			angle[i] = Math.clamp(bend + wave, 0f, 110f);
		}

		float segment = LENGTH / ROWS;
		float[] cy = new float[ROWS + 1];
		float[] cz = new float[ROWS + 1];
		float[] na = new float[ROWS + 1];
		for (int i = 0; i < ROWS; i++) {
			double a = Math.toRadians(angle[i]);
			cy[i + 1] = cy[i] + (float) Math.cos(a) * segment;
			cz[i + 1] = cz[i] + (float) Math.sin(a) * segment;
		}
		for (int j = 0; j <= ROWS; j++) {
			float a = j == 0 ? angle[0] : j == ROWS ? angle[ROWS - 1] : (angle[j - 1] + angle[j]) / 2f;
			na[j] = (float) Math.toRadians(a);
		}

		// quer: leichte Wölbung in der Mitte und ein Flattern an den Kanten, beides unten stärker
		float[][] y = new float[ROWS + 1][COLS + 1];
		float[][] z = new float[ROWS + 1][COLS + 1];
		float[][] ny = new float[ROWS + 1][COLS + 1];
		float[][] nz = new float[ROWS + 1][COLS + 1];
		float[] halfLeft = new float[ROWS + 1];
		float[] halfRight = new float[ROWS + 1];
		for (int j = 0; j <= ROWS; j++) {
			float s = (float) j / ROWS;
			float nY = -(float) Math.sin(na[j]);
			float nZ = (float) Math.cos(na[j]);
			halfLeft[j] = WIDTH / 2f;
			halfRight[j] = WIDTH / 2f;
			for (int c = 0; c <= COLS; c++) {
				float u = (float) c / COLS * 2f - 1f;
				float bulge = (0.25f + motion * 0.6f) * s * (1f - u * u);
				float flutter = (0.12f + motion * 0.35f) * s * (float) Math.sin(phase * 1.3f + u * 2.4f - s * 4f);
				float offset = bulge + flutter;
				y[j][c] = cy[j] + nY * offset;
				z[j][c] = cz[j] + nZ * offset;
				ny[j][c] = nY;
				nz[j][c] = nZ;
			}
		}
		return new Shape(y, z, ny, nz, angle, halfLeft, halfRight);
	}

	/**
	 * Wie viel Grad muss der Stoff zusätzlich nach hinten, damit die Beine frei bleiben? Je Gitterpunkt wird entlang z
	 * gemessen, wie weit das Bein (in der aktuellen Haltung und im weitesten Rückschwung beim jetzigen Lauftempo –
	 * Minecraft: 1,4 × Tempo) nach hinten reicht; daraus ergibt sich über die Streifen darüber der nötige Winkel.
	 */
	private static float legLift(Shape shape, HumanoidModel<?> humanoid, Matrix4f capeInverse, float walk) {
		float[][] push = new float[ROWS + 1][COLS + 1];
		swing(shape, push, humanoid, humanoid.rightLeg, -2f, 0f, -2f, 2f, 12f, 2f, walk * 1.4f, capeInverse);
		swing(shape, push, humanoid, humanoid.leftLeg, -2f, 0f, -2f, 2f, 12f, 2f, walk * 1.4f, capeInverse);
		float segment = LENGTH / ROWS;
		float lever = 0f;
		float most = 0f;
		for (int j = 1; j <= ROWS; j++) {
			// z wächst mit mehr Neigung um cos(Winkel) je Streifen darüber
			lever += (float) Math.cos(Math.toRadians(shape.angle()[j - 1])) * segment;
			float need = 0f;
			for (int c = 0; c <= COLS; c++) need = Math.max(need, push[j][c]);
			if (need > 0f && lever > 2f) most = Math.max(most, (float) Math.toDegrees(need / lever));
		}
		return most;
	}

	/**
	 * Gegen schwarze Pixel in Bewegung: Die durchsichtigen Teile eines Cape-Bildes sind schwarz (RGB 0). Beim Filtern und
	 * in den Mipmaps (kleinere Stufen bei Abstand und schrägen Flächen – ein wehendes Cape hat ständig solche) wird dieses
	 * Schwarz an die Ränder der Bildbereiche gemischt. Hier bekommt jeder durchsichtige Pixel die Farbe der nächsten
	 * sichtbaren Pixel; er bleibt durchsichtig, das Motiv ändert sich nicht. Für Cape- und Leuchtbilder (beide werden mit
	 * normaler Alpha-Mischung gezeichnet, die Leuchtebene über RenderTypes.eyes = TRANSLUCENT).
	 */
	public static void bleed(com.mojang.blaze3d.platform.NativeImage image) {
		int w = image.getWidth(), h = image.getHeight();
		int[] argb = new int[w * h];
		for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) argb[y * w + x] = image.getPixel(x, y);
		if (!bleed(argb, w, h)) return;
		for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) image.setPixel(x, y, argb[y * w + x]);
	}

	/**
	 * Wie {@link #bleed(com.mojang.blaze3d.platform.NativeImage)} auf ARGB-Werten: Schicht für Schicht von den sichtbaren
	 * Pixeln nach außen; jeder durchsichtige Pixel bekommt den Mittelwert seiner schon gefärbten Nachbarn (8er-Umgebung),
	 * so entstehen weiche, zum Motiv passende Farben statt eines zufälligen Nachbarn. Alpha bleibt unverändert.
	 * true, wenn sich etwas geändert hat.
	 */
	public static boolean bleed(int[] argb, int w, int h) {
		boolean[] done = new boolean[w * h];
		int[] layer = new int[w * h];
		int count = 0;
		for (int i = 0; i < argb.length; i++) {
			if ((argb[i] >>> 24) != 0) {
				done[i] = true;
				count++;
			}
		}
		if (count == 0 || count == argb.length) return false;
		// erste Schicht: durchsichtige Pixel neben sichtbaren
		int size = 0;
		boolean[] queued = new boolean[w * h];
		for (int i = 0; i < argb.length; i++) {
			if (!done[i] && touches(done, i, w, h)) {
				layer[size++] = i;
				queued[i] = true;
			}
		}
		boolean changed = false;
		int[] colors = new int[w * h];
		int[] next = new int[w * h];
		while (size > 0) {
			// Farben der ganzen Schicht aus den bisherigen Nachbarn, erst danach übernehmen
			for (int k = 0; k < size; k++) {
				int i = layer[k], x = i % w, y = i / w, r = 0, g = 0, b = 0, n = 0;
				for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
					int nx = x + dx, ny = y + dy;
					if ((dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= w || ny >= h || !done[ny * w + nx]) continue;
					int p = argb[ny * w + nx];
					r += (p >> 16) & 0xFF;
					g += (p >> 8) & 0xFF;
					b += p & 0xFF;
					n++;
				}
				colors[k] = n == 0 ? 0 : (r / n) << 16 | (g / n) << 8 | b / n;
			}
			int nextSize = 0;
			for (int k = 0; k < size; k++) {
				int i = layer[k];
				if ((argb[i] & 0xFFFFFF) != colors[k]) changed = true;
				argb[i] = (argb[i] & 0xFF000000) | colors[k];
				done[i] = true;
			}
			for (int k = 0; k < size; k++) {
				int i = layer[k], x = i % w, y = i / w;
				for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
					int nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					int n = ny * w + nx;
					if (done[n] || queued[n]) continue;
					queued[n] = true;
					next[nextSize++] = n;
				}
			}
			int[] t = layer;
			layer = next;
			next = t;
			size = nextSize;
		}
		return changed;
	}

	private static boolean touches(boolean[] done, int i, int w, int h) {
		int x = i % w, y = i / w;
		for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
			int nx = x + dx, ny = y + dy;
			if (nx >= 0 && ny >= 0 && nx < w && ny < h && done[ny * w + nx]) return true;
		}
		return false;
	}

	/** Glied in der aktuellen Haltung und – falls weiter hinten – im weitesten Rückschwung (xRot in Bogenmaß) */
	private static void swing(Shape shape, float[][] push, HumanoidModel<?> humanoid, ModelPart part, float x0, float y0, float z0,
			float x1, float y1, float z1, float backSwing, Matrix4f capeInverse) {
		limb(shape, push, humanoid, part, x0, y0, z0, x1, y1, z1, capeInverse);
		if (backSwing > part.xRot + 0.05f) {
			float now = part.xRot;
			part.xRot = backSwing;
			try {
				limb(shape, push, humanoid, part, x0, y0, z0, x1, y1, z1, capeInverse);
			} finally {
				part.xRot = now;
			}
		}
	}

	/** Cape-Raum → Raum des Körperteils (Pixel) */
	private static Matrix4f toPart(HumanoidModel<?> humanoid, ModelPart part, Matrix4f capeInverse) {
		PoseStack ps = new PoseStack();
		humanoid.root().translateAndRotate(ps);
		part.translateAndRotate(ps);
		ps.scale(1 / 16f, 1 / 16f, 1 / 16f);
		return new Matrix4f(capeInverse).mul(ps.last().pose()).invert();
	}

	/** Wie weit muss jeder Gitterpunkt nach hinten, um an diesem Würfel (Körperteil-Pixel) vorbeizukommen? */
	private static void limb(Shape shape, float[][] push, HumanoidModel<?> humanoid, ModelPart part, float x0, float y0, float z0,
			float x1, float y1, float z1, Matrix4f capeInverse) {
		Matrix4f toPart = toPart(humanoid, part, capeInverse);
		Vector3f dir = toPart.transformDirection(0f, 0f, 1f, new Vector3f());
		Vector3f o = new Vector3f();
		float[] mins = {x0, y0, z0}, maxs = {x1, y1, z1};
		for (int j = 0; j <= ROWS; j++) {
			for (int c = 0; c <= COLS; c++) {
				// die Beine hängen an der Hüfte (12 px unter der Schulter): weiter oben erreichen sie den Stoff nie
				if (shape.y[j][c] < 6f) continue;
				// Strahlen am Gitterpunkt und eine halbe Masche daneben (Kreuz: links/rechts, oben/unten), damit auch
				// ein Glied zwischen zwei Gitterpunkten erkannt wird
				float best = -1e6f;
				float halfCol = (shape.halfLeft()[j] + shape.halfRight()[j]) / COLS / 2f;
				float gx = x(shape, j, c), gy = shape.y[j][c];
				for (int k = 0; k < 5; k++) {
					float dx = k == 1 ? -halfCol : k == 2 ? halfCol : 0f;
					float dy = k == 3 ? -0.5f : k == 4 ? 0.5f : 0f;
					toPart.transformPosition(Math.clamp(gx + dx, -shape.halfRight()[j], shape.halfLeft()[j]), gy + dy, 0f, o);
					best = Math.max(best, exitDepth(o, dir, mins, maxs));
				}
				if (best < -1e5f) continue;
				// Abstand erst, wenn das Glied hinter die Rückenebene schwingt (im Stehen liegt der Stoff wie bei
				// Minecraft an), und stufenlos, damit nichts springt
				float need = best + CLEARANCE * Math.clamp(best / 0.5f, 0f, 1f) - shape.z[j][c];
				if (need > push[j][c]) push[j][c] = need;
			}
		}
	}

	/** Strahl o + t·dir durch den Würfel: größtes t, bei dem er noch innen liegt (sehr klein = verfehlt) */
	private static float exitDepth(Vector3f o, Vector3f dir, float[] mins, float[] maxs) {
		float lo = -1e6f, hi = 1e6f;
		for (int a = 0; a < 3; a++) {
			float oa = a == 0 ? o.x : a == 1 ? o.y : o.z;
			float da = a == 0 ? dir.x : a == 1 ? dir.y : dir.z;
			if (Math.abs(da) < 1e-6f) {
				if (oa < mins[a] || oa > maxs[a]) return -1e7f;
				continue;
			}
			float t0 = (mins[a] - oa) / da, t1 = (maxs[a] - oa) / da;
			lo = Math.max(lo, Math.min(t0, t1));
			hi = Math.min(hi, Math.max(t0, t1));
			if (lo > hi) return -1e7f;
		}
		return hi;
	}

	/** x eines Gitterpunkts: Spalte 0 an der +x-Kante, Spalte COLS an der −x-Kante (Breite je Reihe) */
	private static float x(Shape shape, int j, int c) {
		return shape.halfLeft()[j] - (float) c / COLS * (shape.halfLeft()[j] + shape.halfRight()[j]);
	}

	private static void vertex(PoseStack.Pose pose, VertexConsumer consumer, float x, float y, float z, float u, float v, int light, int overlay,
			float nx, float ny, float nz) {
		consumer.addVertex(pose, x, y, z).setColor(-1).setUv(u, v).setOverlay(overlay).setLight(light).setNormal(pose, nx, ny, nz);
	}

	private static void emit(PoseStack.Pose pose, VertexConsumer consumer, Shape shape, int light, int overlay) {
		float t = THICKNESS;
		for (int j = 0; j < ROWS; j++) {
			float v0 = (1f + LENGTH * j / ROWS) / 32f;
			float v1 = (1f + LENGTH * (j + 1) / ROWS) / 32f;
			for (int c = 0; c < COLS; c++) {
				float xa0 = x(shape, j, c), xb0 = x(shape, j, c + 1), xa1 = x(shape, j + 1, c), xb1 = x(shape, j + 1, c + 1);
				// Außenseite (1,1)–(11,17): x = +5 links im Bild
				float ua = (1f + WIDTH * c / COLS) / 64f;
				float ub = (1f + WIDTH * (c + 1) / COLS) / 64f;
				quad(pose, consumer, light, overlay,
						xa0, outerY(shape, j, c, t), outerZ(shape, j, c, t), ua, v0, 0, shape.ny[j][c], shape.nz[j][c],
						xb0, outerY(shape, j, c + 1, t), outerZ(shape, j, c + 1, t), ub, v0, 0, shape.ny[j][c + 1], shape.nz[j][c + 1],
						xb1, outerY(shape, j + 1, c + 1, t), outerZ(shape, j + 1, c + 1, t), ub, v1, 0, shape.ny[j + 1][c + 1], shape.nz[j + 1][c + 1],
						xa1, outerY(shape, j + 1, c, t), outerZ(shape, j + 1, c, t), ua, v1, 0, shape.ny[j + 1][c], shape.nz[j + 1][c]);
				// Innenseite (12,1)–(22,17): gespiegelt, x = +5 rechts im Bild
				float ia = (22f - WIDTH * c / COLS) / 64f;
				float ib = (22f - WIDTH * (c + 1) / COLS) / 64f;
				quad(pose, consumer, light, overlay,
						xa0, shape.y[j][c], shape.z[j][c], ia, v0, 0, -shape.ny[j][c], -shape.nz[j][c],
						xa1, shape.y[j + 1][c], shape.z[j + 1][c], ia, v1, 0, -shape.ny[j + 1][c], -shape.nz[j + 1][c],
						xb1, shape.y[j + 1][c + 1], shape.z[j + 1][c + 1], ib, v1, 0, -shape.ny[j + 1][c + 1], -shape.nz[j + 1][c + 1],
						xb0, shape.y[j][c + 1], shape.z[j][c + 1], ib, v0, 0, -shape.ny[j][c + 1], -shape.nz[j][c + 1]);
			}
			// Seitenkanten (0,1)–(1,17) und (11,1)–(12,17)
			edge(pose, consumer, shape, j, 0, v0, v1, 0f, 1f / 64f, 1f, light, overlay, t);
			edge(pose, consumer, shape, j, COLS, v0, v1, 11f / 64f, 12f / 64f, -1f, light, overlay, t);
		}
		// Oberkante (1,0)–(11,1) und Unterkante (11,0)–(21,1)
		for (int c = 0; c < COLS; c++) {
			float ua = (1f + WIDTH * c / COLS) / 64f;
			float ub = (1f + WIDTH * (c + 1) / COLS) / 64f;
			cap(pose, consumer, shape, 0, c, ua, ub, 0f, 1f / 32f, light, overlay, t, -1f);
			float da = (11f + WIDTH * c / COLS) / 64f;
			float db = (11f + WIDTH * (c + 1) / COLS) / 64f;
			cap(pose, consumer, shape, ROWS, c, da, db, 0f, 1f / 32f, light, overlay, t, 1f);
		}
	}

	/** nur die Außenseite, für die leuchtenden Teile (beide Umlaufrichtungen, damit sie nie weggeschnitten wird) */
	private static void emitGlow(PoseStack.Pose pose, VertexConsumer consumer, Shape shape, int overlay) {
		int light = 0xF000F0;
		float t = THICKNESS + 0.01f;
		for (int j = 0; j < ROWS; j++) {
			float v0 = (1f + LENGTH * j / ROWS) / 32f;
			float v1 = (1f + LENGTH * (j + 1) / ROWS) / 32f;
			for (int c = 0; c < COLS; c++) {
				float ua = (1f + WIDTH * c / COLS) / 64f;
				float ub = (1f + WIDTH * (c + 1) / COLS) / 64f;
				float[][] p = {
						{x(shape, j, c), outerY(shape, j, c, t), outerZ(shape, j, c, t), ua, v0},
						{x(shape, j, c + 1), outerY(shape, j, c + 1, t), outerZ(shape, j, c + 1, t), ub, v0},
						{x(shape, j + 1, c + 1), outerY(shape, j + 1, c + 1, t), outerZ(shape, j + 1, c + 1, t), ub, v1},
						{x(shape, j + 1, c), outerY(shape, j + 1, c, t), outerZ(shape, j + 1, c, t), ua, v1}};
				float nY = shape.ny[j][c];
				float nZ = shape.nz[j][c];
				for (int k = 0; k < 4; k++) vertex(pose, consumer, p[k][0], p[k][1], p[k][2], p[k][3], p[k][4], light, overlay, 0, nY, nZ);
				for (int k = 3; k >= 0; k--) vertex(pose, consumer, p[k][0], p[k][1], p[k][2], p[k][3], p[k][4], light, overlay, 0, nY, nZ);
			}
		}
	}

	private static float outerY(Shape shape, int j, int c, float thickness) {
		return shape.y[j][c] + shape.ny[j][c] * thickness;
	}

	private static float outerZ(Shape shape, int j, int c, float thickness) {
		return shape.z[j][c] + shape.nz[j][c] * thickness;
	}

	private static void edge(PoseStack.Pose pose, VertexConsumer consumer, Shape shape, int j, int c, float v0, float v1, float u0, float u1,
			float side, int light, int overlay, float t) {
		float x0 = x(shape, j, c), x1 = x(shape, j + 1, c);
		quad(pose, consumer, light, overlay,
				x0, shape.y[j][c], shape.z[j][c], u0, v0, side, 0, 0,
				x0, outerY(shape, j, c, t), outerZ(shape, j, c, t), u1, v0, side, 0, 0,
				x1, outerY(shape, j + 1, c, t), outerZ(shape, j + 1, c, t), u1, v1, side, 0, 0,
				x1, shape.y[j + 1][c], shape.z[j + 1][c], u0, v1, side, 0, 0);
	}

	private static void cap(PoseStack.Pose pose, VertexConsumer consumer, Shape shape, int j, int c, float ua, float ub, float v0, float v1,
			int light, int overlay, float t, float up) {
		float xa = x(shape, j, c);
		float xb = x(shape, j, c + 1);
		quad(pose, consumer, light, overlay,
				xa, shape.y[j][c], shape.z[j][c], ua, v0, 0, up, 0,
				xb, shape.y[j][c + 1], shape.z[j][c + 1], ub, v0, 0, up, 0,
				xb, outerY(shape, j, c + 1, t), outerZ(shape, j, c + 1, t), ub, v1, 0, up, 0,
				xa, outerY(shape, j, c, t), outerZ(shape, j, c, t), ua, v1, 0, up, 0);
	}

	private static void quad(PoseStack.Pose pose, VertexConsumer consumer, int light, int overlay,
			float x0, float y0, float z0, float u0, float v0, float nx0, float ny0, float nz0,
			float x1, float y1, float z1, float u1, float v1, float nx1, float ny1, float nz1,
			float x2, float y2, float z2, float u2, float v2, float nx2, float ny2, float nz2,
			float x3, float y3, float z3, float u3, float v3, float nx3, float ny3, float nz3) {
		vertex(pose, consumer, x0, y0, z0, u0, v0, light, overlay, nx0, ny0, nz0);
		vertex(pose, consumer, x1, y1, z1, u1, v1, light, overlay, nx1, ny1, nz1);
		vertex(pose, consumer, x2, y2, z2, u2, v2, light, overlay, nx2, ny2, nz2);
		vertex(pose, consumer, x3, y3, z3, u3, v3, light, overlay, nx3, ny3, nz3);
	}
}
