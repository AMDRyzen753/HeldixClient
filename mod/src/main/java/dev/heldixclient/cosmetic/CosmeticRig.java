package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.platform.NativeImage;
import org.joml.Matrix4f;
import org.joml.Quaternionf;

import java.util.List;
import java.util.Map;

/**
 * Ein Cosmetic im Format 2 (Mesh mit starren Knochen und Keyframe-Animationen), einmal beim Laden aufbereitet: Vertices
 * als Gleitkommazahlen, Dreiecke paarweise zu Vierecken zusammengefasst (Minecraft zeichnet Entities als Vierecke),
 * Animationen je Knochen als Felder und die Zuordnung Zustand → Animation als Indizes. Beim Zeichnen werden nur noch
 * Knochen-Matrizen gerechnet ({@link #sample}, {@link #matrices}), ohne neue Objekte.
 *
 * <p>Bedeutung (verbindlich, wie Dienst und Launcher):
 * <ul>
 *   <li>Body-Modellraum in Pixeln: Ursprung am Hals-Pivot, +X links vom Spieler, +Y unten, +Z hinten – also genau der
 *       Modellraum des Rumpfs nach {@code body.translateAndRotate} (dann 1/16).</li>
 *   <li>Knochen-Matrix {@code W_b = W_parent · T(move_b) · T(pivot_b) · R_b · S_b · T(−pivot_b)}; Vertex {@code v' = W_bone · v},
 *       Normale mit dem 3×3-Anteil (danach normiert).</li>
 *   <li>Zwischen Keys: Drehung per slerp (kürzester Weg), Verschiebung und Größe linear. Zeit in Frames
 *       {@code t = Sekunden · fps}; mit {@code loop} modulo {@code frames} und nach dem letzten Key zurück auf Key 0
 *       (Schleifenlänge {@code frames}, wie Blender), ohne {@code loop} am letzten Frame gehalten.</li>
 *   <li>Leucht-Streifen: Bild {@code (ticks / frametimeTicks) % frames}, {@code v_glow = (v + bild) / frames}, Stärke
 *       {@code min + (max − min) · (0,5 + 0,5 · sin(2π · t / period))}.</li>
 * </ul>
 */
public final class CosmeticRig {
	final int vertexCount;
	final int boneCount;
	/** je Vertex x, y, z in Pixeln */
	final float[] pos;
	/** je Vertex die Normale (normiert) */
	final float[] nrm;
	/** je Vertex u, v (0..1, v = 0 oben) */
	final float[] uv;
	final int[] vertexBone;
	/**
	 * Weiche Haut (mesh.joints/weights, z. B. Membranen): je Vertex der Index in {@link #softJoint}/{@link #softWeight}
	 * (je 4 Einträge) oder -1 für starre Vertices; null, wenn alles starr ist.
	 */
	final int[] softIndex;
	final int[] softJoint;
	final float[] softWeight;
	/** je Viereck vier Vertex-Indizes; Minecraft teilt es in (0, 1, 2) und (2, 3, 0) – genau die beiden Dreiecke der Quelle */
	final int[] quads;
	final int quadCount;
	/** Vierecke mit leuchtenden Pixeln in irgendeinem Bild des Streifens (nur sie gehen in den Glow-Pass) */
	final int[] glowQuads;
	final int glowCount;
	final int[] parent;
	final float[] pivot;
	final float[] tail;
	final String[] boneNames;
	final Clip[] clips;
	/** je Eintrag in {@link CosmeticFormat#STATE_KEYS}: Index der Animation oder -1 */
	final int[] stateClip;
	final float blendSeconds;
	final Particle[] particles;
	// Leuchten
	final int glowFrames;
	final int frametimeTicks;
	final float pulsePeriod;
	final float pulseMin;
	final float pulseMax;
	// Anbringen (Begleiter)
	final float[] origin;
	final boolean mirrored;
	/** Ausdehnung in der Pose idle, Frame 0 (Pixel): minX, minY, minZ, maxX, maxY, maxZ */
	final float[] bounds = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};

	/** Eine Animation, je Knochen die Spuren (null = keine Spur, also Ruhelage) */
	static final class Clip {
		final String name;
		final float fps;
		final int frames;
		final boolean loop;
		final int[][] rotKeys;
		final float[][] rotValues;
		final int[][] moveKeys;
		final float[][] moveValues;
		final int[][] scaleKeys;
		final float[][] scaleValues;

		Clip(CosmeticFormat.Clip clip, int bones) {
			name = clip.name();
			fps = clip.fps();
			frames = clip.frames();
			loop = clip.loop();
			rotKeys = new int[bones][];
			rotValues = new float[bones][];
			moveKeys = new int[bones][];
			moveValues = new float[bones][];
			scaleKeys = new int[bones][];
			scaleValues = new float[bones][];
			for (CosmeticFormat.Track track : clip.tracks()) {
				int b = track.bone();
				if (track.rot() != null) {
					rotKeys[b] = track.rot().keys();
					rotValues[b] = track.rot().values();
				}
				if (track.move() != null) {
					moveKeys[b] = track.move().keys();
					moveValues[b] = track.move().values();
				}
				if (track.scale() != null) {
					scaleKeys[b] = track.scale().keys();
					scaleValues[b] = track.scale().values();
				}
			}
		}

		/** Länge in Sekunden */
		double seconds() {
			return frames / (double) fps;
		}

		/** Frame zur Zeit (Sekunden seit dem Start) */
		float frameAt(double seconds) {
			double t = Math.max(0, seconds) * fps;
			if (loop) t %= frames;
			else t = Math.min(t, frames - 1);
			return (float) t;
		}

		/** Ist eine einmalige Animation durchgelaufen? (eine Schleife zählt nach einem Durchgang als fertig) */
		boolean finished(double seconds) {
			return seconds * fps >= (loop ? frames : frames - 1);
		}
	}

	/** Partikel an einem Knochen (zur Laufzeit aufgelöst) */
	static final class Particle {
		final int bone;
		final boolean tail;
		final String particle;
		final float perSecond;
		final int color;
		/** Bitmaske der Animationen, in denen er läuft (alle Bits = immer) */
		final long clips;
		Object options;

		Particle(int bone, boolean tail, String particle, float perSecond, int color, long clips) {
			this.bone = bone;
			this.tail = tail;
			this.particle = particle;
			this.perSecond = perSecond;
			this.color = color;
			this.clips = clips;
		}
	}

	CosmeticRig(CosmeticFormat.Manifest manifest, NativeImage glowImage) {
		CosmeticFormat.Rig rig = manifest.rig();
		vertexCount = rig.vertexCount();
		List<CosmeticFormat.RigBone> bones = rig.bones();
		boneCount = bones.size();
		pos = new float[vertexCount * 3];
		nrm = new float[vertexCount * 3];
		uv = new float[vertexCount * 2];
		vertexBone = new int[vertexCount];
		for (int i = 0; i < vertexCount; i++) {
			for (int k = 0; k < 3; k++) pos[i * 3 + k] = rig.positions()[i * 3 + k] / 32f;
			float nx = rig.normals()[i * 3] / 127f;
			float ny = rig.normals()[i * 3 + 1] / 127f;
			float nz = rig.normals()[i * 3 + 2] / 127f;
			float length = (float) Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (length < 1e-4f) {
				nx = 0;
				ny = -1;
				nz = 0;
				length = 1;
			}
			nrm[i * 3] = nx / length;
			nrm[i * 3 + 1] = ny / length;
			nrm[i * 3 + 2] = nz / length;
			uv[i * 2] = rig.uvs()[i * 2] / 65535f;
			uv[i * 2 + 1] = rig.uvs()[i * 2 + 1] / 65535f;
			vertexBone[i] = rig.vertexBones()[i] & 0xFF;
		}
		// weiche Haut: nur Vertices mit mehr als einem Einfluss mischen, die übrigen bleiben starr (schneller)
		int k = CosmeticFormat.RIG_INFLUENCES;
		int soft = 0;
		int[] softOf = null;
		if (rig.joints() != null) {
			softOf = new int[vertexCount];
			for (int i = 0; i < vertexCount; i++) {
				int full = 0;
				for (int j = 0; j < k; j++) if ((rig.weights()[i * k + j] & 0xFF) == 255) full++;
				softOf[i] = full == 1 ? -1 : soft++;
			}
		}
		if (soft > 0) {
			softIndex = softOf;
			softJoint = new int[soft * k];
			softWeight = new float[soft * k];
			for (int i = 0; i < vertexCount; i++) {
				int s = softOf[i];
				if (s < 0) continue;
				for (int j = 0; j < k; j++) {
					softJoint[s * k + j] = rig.joints()[i * k + j] & 0xFF;
					softWeight[s * k + j] = (rig.weights()[i * k + j] & 0xFF) / 255f;
				}
			}
		} else {
			softIndex = null;
			softJoint = null;
			softWeight = null;
		}
		quads = pairTriangles(rig.triangles(), rig.triangleCount());
		quadCount = quads.length / 4;

		parent = new int[boneCount];
		pivot = new float[boneCount * 3];
		tail = new float[boneCount * 3];
		boneNames = new String[boneCount];
		for (int b = 0; b < boneCount; b++) {
			CosmeticFormat.RigBone bone = bones.get(b);
			parent[b] = bone.parent();
			boneNames[b] = bone.name();
			System.arraycopy(bone.pivot(), 0, pivot, b * 3, 3);
			System.arraycopy(bone.tail(), 0, tail, b * 3, 3);
		}

		Map<String, CosmeticFormat.Clip> animations = rig.animations();
		clips = new Clip[animations.size()];
		java.util.Map<String, Integer> index = new java.util.HashMap<>();
		int c = 0;
		for (CosmeticFormat.Clip clip : animations.values()) {
			index.put(clip.name(), c);
			clips[c++] = new Clip(clip, boneCount);
		}
		stateClip = new int[CosmeticFormat.STATE_KEYS.size()];
		for (int s = 0; s < stateClip.length; s++) {
			String clip = rig.states().get(CosmeticFormat.STATE_KEYS.get(s));
			stateClip[s] = clip == null ? -1 : index.get(clip);
		}
		blendSeconds = (float) rig.blendSeconds();

		particles = new Particle[rig.particles().size()];
		for (int i = 0; i < particles.length; i++) {
			CosmeticFormat.RigParticle p = rig.particles().get(i);
			long mask = p.states().isEmpty() ? -1L : 0L;
			for (String clip : p.states()) mask |= 1L << index.get(clip);
			// gespiegelt wird nichts: für „.L“ und „.R“ stehen eigene Einträge im Manifest
			particles[i] = new Particle(p.bone(), p.tail(), p.particle(), (float) p.perSecond(), p.color(), mask);
		}

		CosmeticFormat.Emissive emissive = rig.emissive();
		glowFrames = emissive == null ? 1 : emissive.frames();
		frametimeTicks = emissive == null ? 1 : emissive.frametimeTicks();
		pulsePeriod = emissive == null ? 1 : (float) emissive.period();
		pulseMin = emissive == null ? 1 : (float) emissive.min();
		pulseMax = emissive == null ? 1 : (float) emissive.max();
		glowQuads = glowImage != null ? glowQuads(glowImage) : new int[0];
		glowCount = glowQuads.length;

		CosmeticFormat.Attach attach = rig.attach();
		origin = attach == null ? null : new float[] {(float) attach.origin()[0], (float) attach.origin()[1], (float) attach.origin()[2]};
		mirrored = attach != null && attach.right();
		computeBounds();
	}

	/**
	 * Leuchtebene im Format 2 für Minecraft aufbereiten. Die Quelle ist additiv gedacht (deckend, Schwarz = kein Leuchten;
	 * so zeigen es Blender, Launcher und Webseite), {@code RenderTypes.eyes} mischt in Minecraft 26.x aber transparent
	 * (Farbe · Alpha + Untergrund · (1 − Alpha)). Ohne Umrechnung übermalt das deckende Schwarz die Textur in jedem
	 * Leucht-Viereck, und die Cosmetics wirken dunkel und fleckig. Hier wird Alpha = hellster Kanal (mal Quell-Alpha) und
	 * die Farbe entsprechend aufgehellt: Farbe · Alpha ist wieder genau die Quellfarbe, Schwarz wird durchsichtig.
	 */
	public static void glowToAlpha(NativeImage image) {
		for (int y = 0; y < image.getHeight(); y++) {
			for (int x = 0; x < image.getWidth(); x++) {
				int argb = image.getPixel(x, y);
				int r = (argb >> 16) & 0xFF;
				int g = (argb >> 8) & 0xFF;
				int b = argb & 0xFF;
				int max = Math.max(r, Math.max(g, b));
				int alpha = Math.round(max * (argb >>> 24) / 255f);
				if (alpha == 0) {
					image.setPixel(x, y, 0);
					continue;
				}
				float up = 255f / max;
				image.setPixel(x, y, alpha << 24 | Math.round(r * up) << 16 | Math.round(g * up) << 8 | Math.round(b * up));
			}
		}
	}

	public int vertexCount() {
		return vertexCount;
	}

	public int boneCount() {
		return boneCount;
	}

	/** Vierecke je Bild (Albedo-Pass) */
	public int quadCount() {
		return quadCount;
	}

	/** Vierecke im Glow-Pass */
	public int glowQuadCount() {
		return glowCount;
	}

	/** Namen der Animationen in der Reihenfolge des Manifests */
	public List<String> clipNames() {
		String[] names = new String[clips.length];
		for (int i = 0; i < clips.length; i++) names[i] = clips[i].name;
		return List.of(names);
	}

	/** Animation zum Zustand (ohne Zuordnung: idle) */
	public String clipFor(String state) {
		int s = CosmeticFormat.STATE_KEYS.indexOf(state);
		int c = s < 0 ? -1 : stateClip[s];
		return clips[c >= 0 ? c : stateClip[0]].name;
	}

	/** Index der Animation zum Zustand, -1 = keine Zuordnung */
	int stateClip(int state) {
		return stateClip[state];
	}

	/** Ordnet das Cosmetic dem Zustand eine eigene Animation zu? */
	public boolean has(String state) {
		int s = CosmeticFormat.STATE_KEYS.indexOf(state);
		return s >= 0 && stateClip[s] >= 0;
	}

	/** Länge einer Animation in Sekunden (0 = unbekannt) */
	public double clipSeconds(String name) {
		for (Clip clip : clips) if (clip.name.equals(name)) return clip.seconds();
		return 0;
	}

	/** Pivot eines Knochens (Pixel, Body-Modellraum bzw. relativ zu attach.origin) */
	public float[] pivot(int bone) {
		return new float[] {pivot[bone * 3], pivot[bone * 3 + 1], pivot[bone * 3 + 2]};
	}

	/** attach.origin (nur Begleiter, sonst null) */
	public float[] origin() {
		return origin == null ? null : origin.clone();
	}

	/** Begleiter für die rechte Seite (an x gespiegelt)? */
	public boolean mirrored() {
		return mirrored;
	}

	/** Partikel, die in der Animation zum Zustand laufen (z. B. „idle“) */
	public int particlesIn(String state) {
		int s = CosmeticFormat.STATE_KEYS.indexOf(state);
		int c = s < 0 || stateClip[s] < 0 ? stateClip[0] : stateClip[s];
		int count = 0;
		for (Particle p : particles) if ((p.clips & (1L << c)) != 0) count++;
		return count;
	}

	public float[] bounds() {
		return bounds.clone();
	}

	/** Gibt es leuchtende Teile mit einem Streifen aus mehreren Bildern? */
	public int glowFrames() {
		return glowFrames;
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	/**
	 * Dreiecke paarweise zu Vierecken: Teilen zwei aufeinanderfolgende Dreiecke eine Kante (x, y), wird daraus
	 * [x, gegenüber im ersten, y, gegenüber im zweiten] – Minecraft zeichnet davon (0, 1, 2) und (2, 3, 0), also genau die
	 * beiden Dreiecke. Sonst ein Viereck mit doppeltem letztem Vertex.
	 */
	static int[] pairTriangles(char[] triangles, int count) {
		int[] out = new int[count * 4];
		int n = 0;
		int i = 0;
		while (i < count) {
			int a = triangles[i * 3];
			int b = triangles[i * 3 + 1];
			int c = triangles[i * 3 + 2];
			if (i + 1 < count) {
				int d = triangles[i * 3 + 3];
				int e = triangles[i * 3 + 4];
				int f = triangles[i * 3 + 5];
				int[] quad = pair(a, b, c, d, e, f);
				if (quad != null) {
					System.arraycopy(quad, 0, out, n, 4);
					n += 4;
					i += 2;
					continue;
				}
			}
			out[n++] = a;
			out[n++] = b;
			out[n++] = c;
			out[n++] = c;
			i++;
		}
		return java.util.Arrays.copyOf(out, n);
	}

	private static int[] pair(int a, int b, int c, int d, int e, int f) {
		if (a == b || b == c || a == c || d == e || e == f || d == f) return null;
		int[] first = {a, b, c};
		int[] second = {d, e, f};
		int shared = 0;
		int opposite1 = -1;
		for (int v : first) {
			if (v == d || v == e || v == f) shared++;
			else opposite1 = v;
		}
		if (shared != 2) return null;
		int opposite2 = -1;
		for (int v : second) if (v != a && v != b && v != c) opposite2 = v;
		// gemeinsame Kante (x, y) in der Reihenfolge des ersten Dreiecks, nach dem gegenüberliegenden Vertex:
		// (o1, x, y) ist das erste Dreieck; [y, o1, x, o2] ergibt (y, o1, x) und (x, o2, y)
		int o = opposite1 == a ? 0 : opposite1 == b ? 1 : 2;
		int x = first[(o + 1) % 3];
		int y = first[(o + 2) % 3];
		return new int[] {y, opposite1, x, opposite2};
	}

	/** Vierecke, deren UV-Fläche in irgendeinem Bild des Streifens ein leuchtendes Pixel trifft */
	private int[] glowQuads(NativeImage glow) {
		int w = glow.getWidth();
		int frameH = Math.max(1, glow.getHeight() / glowFrames);
		int[] out = new int[quadCount];
		int n = 0;
		for (int q = 0; q < quadCount; q++) {
			float u0 = Float.MAX_VALUE;
			float v0 = Float.MAX_VALUE;
			float u1 = -Float.MAX_VALUE;
			float v1 = -Float.MAX_VALUE;
			for (int k = 0; k < 4; k++) {
				int v = quads[q * 4 + k];
				u0 = Math.min(u0, uv[v * 2]);
				u1 = Math.max(u1, uv[v * 2]);
				v0 = Math.min(v0, uv[v * 2 + 1]);
				v1 = Math.max(v1, uv[v * 2 + 1]);
			}
			int x0 = Math.clamp((int) Math.floor(u0 * w), 0, w - 1);
			int x1 = Math.clamp((int) Math.ceil(u1 * w) - 1, x0, w - 1);
			int y0 = Math.clamp((int) Math.floor(v0 * frameH), 0, frameH - 1);
			int y1 = Math.clamp((int) Math.ceil(v1 * frameH) - 1, y0, frameH - 1);
			if (lit(glow, x0, x1, y0, y1, frameH)) out[n++] = q;
		}
		return java.util.Arrays.copyOf(out, n);
	}

	private boolean lit(NativeImage glow, int x0, int x1, int y0, int y1, int frameH) {
		for (int f = 0; f < glowFrames; f++) {
			for (int y = y0; y <= y1; y++) {
				for (int x = x0; x <= x1; x++) {
					int argb = glow.getPixel(x, y + f * frameH);
					if ((argb >>> 24) > 8 && ((argb >> 16) & 0xFF) + ((argb >> 8) & 0xFF) + (argb & 0xFF) > 12) return true;
				}
			}
		}
		return false;
	}

	/** Weiche Vertices im Mesh? */
	public boolean soft() {
		return softIndex != null;
	}

	/** Lage eines Vertex mit den Knochen-Matrizen (starr oder gemischt aus bis zu vier Knochen); nicht zum Zeichnen */
	void skin(int v, Matrix4f[] world, org.joml.Vector3f out, org.joml.Vector3f scratch) {
		float x = pos[v * 3];
		float y = pos[v * 3 + 1];
		float z = pos[v * 3 + 2];
		int s = softIndex == null ? -1 : softIndex[v];
		if (s < 0) {
			world[vertexBone[v]].transformPosition(x, y, z, out);
			return;
		}
		out.zero();
		int k = CosmeticFormat.RIG_INFLUENCES;
		for (int j = 0; j < k; j++) {
			float w = softWeight[s * k + j];
			if (w <= 0) continue;
			world[softJoint[s * k + j]].transformPosition(x, y, z, scratch);
			out.fma(w, scratch);
		}
	}

	private void computeBounds() {
		Matrix4f[] world = restPose(new Quaternionf());
		org.joml.Vector3f p = new org.joml.Vector3f();
		org.joml.Vector3f scratch = new org.joml.Vector3f();
		for (int i = 0; i < vertexCount; i++) {
			skin(i, world, p, scratch);
			bounds[0] = Math.min(bounds[0], p.x);
			bounds[1] = Math.min(bounds[1], p.y);
			bounds[2] = Math.min(bounds[2], p.z);
			bounds[3] = Math.max(bounds[3], p.x);
			bounds[4] = Math.max(bounds[4], p.y);
			bounds[5] = Math.max(bounds[5], p.z);
		}
		if (bounds[0] > bounds[3]) java.util.Arrays.fill(bounds, 0f);
	}

	/** Knochen-Matrizen in der Pose idle, Frame 0 (für Vorschaubilder und Ausdehnung; legt neue Objekte an) */
	Matrix4f[] restPose(Quaternionf scratch) {
		float[] q = new float[boneCount * 4];
		float[] m = new float[boneCount * 3];
		float[] s = new float[boneCount];
		sample(clips[stateClip[0]], 0f, q, m, s);
		Matrix4f[] world = new Matrix4f[boneCount];
		for (int b = 0; b < boneCount; b++) world[b] = new Matrix4f();
		matrices(q, m, s, world, scratch);
		return world;
	}

	// ======================================================================================
	// Pose
	// ======================================================================================

	/**
	 * Knochen-Lage (Drehung, Verschiebung, Größe) einer Animation zum Frame {@code f}. Zwischen zwei Keys interpoliert;
	 * in einer Schleife nach dem letzten Key zurück auf Key 0 (der bei Frame {@code frames} wieder beginnt, wie in
	 * Blender), sonst nach dem letzten Key gehalten.
	 */
	void sample(Clip clip, float f, float[] q, float[] m, float[] s) {
		for (int b = 0; b < boneCount; b++) {
			int[] keys = clip.rotKeys[b];
			if (keys == null) {
				q[b * 4] = 0;
				q[b * 4 + 1] = 0;
				q[b * 4 + 2] = 0;
				q[b * 4 + 3] = 1;
			} else {
				float[] values = clip.rotValues[b];
				int i = segment(keys, f);
				int j = next(keys, i, clip.loop);
				float a = weight(keys, i, j, f, clip.frames);
				if (a <= 0f) System.arraycopy(values, i * 4, q, b * 4, 4);
				else slerp(values, i * 4, values, j * 4, a, q, b * 4);
			}
			keys = clip.moveKeys[b];
			if (keys == null) {
				m[b * 3] = 0;
				m[b * 3 + 1] = 0;
				m[b * 3 + 2] = 0;
			} else {
				float[] values = clip.moveValues[b];
				int i = segment(keys, f);
				int j = next(keys, i, clip.loop);
				float a = weight(keys, i, j, f, clip.frames);
				for (int k = 0; k < 3; k++) m[b * 3 + k] = values[i * 3 + k] + (values[j * 3 + k] - values[i * 3 + k]) * a;
			}
			keys = clip.scaleKeys[b];
			if (keys == null) s[b] = 1;
			else {
				float[] values = clip.scaleValues[b];
				int i = segment(keys, f);
				int j = next(keys, i, clip.loop);
				s[b] = values[i] + (values[j] - values[i]) * weight(keys, i, j, f, clip.frames);
			}
		}
	}

	/** Nächster Key nach i: i + 1, in einer Schleife nach dem letzten wieder 0, sonst i selbst (halten) */
	private static int next(int[] keys, int i, boolean loop) {
		if (i + 1 < keys.length) return i + 1;
		return loop ? 0 : i;
	}

	/** Anteil von Key j zwischen Key i und j zum Frame f (0 = genau Key i); der Key 0 nach dem letzten liegt bei frames */
	private static float weight(int[] keys, int i, int j, float f, int frames) {
		if (j == i || f <= keys[i]) return 0f;
		float end = j > i ? keys[j] : frames;
		if (end <= keys[i]) return 0f;
		return Math.min(1f, (f - keys[i]) / (end - keys[i]));
	}

	/** Letzter Key, der nicht nach {@code f} liegt (binäre Suche; die erste Frame-Nummer ist immer 0) */
	private static int segment(int[] keys, float f) {
		int lo = 0;
		int hi = keys.length - 1;
		while (lo < hi) {
			int mid = (lo + hi + 1) >>> 1;
			if (keys[mid] <= f) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	/** Quaternion-slerp auf dem kürzesten Weg zwischen a[ia..] und b[ib..], Ergebnis normiert nach out[io..] */
	static void slerp(float[] a, int ia, float[] b, int ib, float t, float[] out, int io) {
		float ax = a[ia];
		float ay = a[ia + 1];
		float az = a[ia + 2];
		float aw = a[ia + 3];
		float bx = b[ib];
		float by = b[ib + 1];
		float bz = b[ib + 2];
		float bw = b[ib + 3];
		float dot = ax * bx + ay * by + az * bz + aw * bw;
		if (dot < 0) {
			bx = -bx;
			by = -by;
			bz = -bz;
			bw = -bw;
			dot = -dot;
		}
		float s0;
		float s1;
		if (dot > 0.9995f) {
			// fast gleich: linear (und unten normiert)
			s0 = 1 - t;
			s1 = t;
		} else {
			float theta = (float) Math.acos(dot);
			float sin = (float) Math.sin(theta);
			s0 = (float) Math.sin((1 - t) * theta) / sin;
			s1 = (float) Math.sin(t * theta) / sin;
		}
		float x = s0 * ax + s1 * bx;
		float y = s0 * ay + s1 * by;
		float z = s0 * az + s1 * bz;
		float w = s0 * aw + s1 * bw;
		float length = (float) Math.sqrt(x * x + y * y + z * z + w * w);
		if (length < 1e-6f) {
			x = y = z = 0;
			w = length = 1;
		}
		out[io] = x / length;
		out[io + 1] = y / length;
		out[io + 2] = z / length;
		out[io + 3] = w / length;
	}

	/**
	 * Knochen-Matrizen aus der Lage: {@code W_b = W_parent · T(move_b) · T(pivot_b) · R_b · S_b · T(−pivot_b)} (Eltern stehen
	 * vor ihren Kindern).
	 */
	void matrices(float[] q, float[] m, float[] s, Matrix4f[] out, Quaternionf scratch) {
		for (int b = 0; b < boneCount; b++) {
			Matrix4f w = out[b];
			if (parent[b] >= 0) w.set(out[parent[b]]);
			else w.identity();
			float px = pivot[b * 3];
			float py = pivot[b * 3 + 1];
			float pz = pivot[b * 3 + 2];
			w.translate(m[b * 3] + px, m[b * 3 + 1] + py, m[b * 3 + 2] + pz);
			w.rotate(scratch.set(q[b * 4], q[b * 4 + 1], q[b * 4 + 2], q[b * 4 + 3]));
			float scale = s[b];
			if (scale != 1f) w.scale(scale);
			w.translate(-px, -py, -pz);
		}
	}
}
