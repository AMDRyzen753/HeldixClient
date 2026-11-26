package dev.heldixclient.cosmetic;

import org.joml.Matrix4f;

import java.util.List;

/**
 * Das Modell eines Cosmetics, einmal beim Laden aufbereitet: je Bone die Flächen als fertige Vertex-Liste und die
 * Animationen als Zahlen. Beim Zeichnen werden nur noch die Bone-Matrizen gerechnet ({@link #pose}), ohne neue Objekte.
 *
 * <p>Bedeutung genau wie launcher/src/main/core/cosmetics.ts (verbindlich, siehe dort):
 * <ul>
 *   <li>Modellraum in Pixeln, +Y oben, +Z vorn, +X = linke Seite des Trägers. Pivots und Würfel sind absolut.</li>
 *   <li>Bone-Matrix = Eltern · T(pivot + bob) · Rz · Ry · Rx · T(−pivot), Grad, Rechte-Hand-Regel.</li>
 *   <li>Box-UV wie Minecraft ({@code cosmeticCubeFaces}); mirror spiegelt den Würfel an seiner Mitte in x; Flächen mit
 *       Fläche 0 fallen weg, Würfel mit einer Kante 0 sind Ebenen mit Vorder- und Rückseite.</li>
 *   <li>Animationen additiv ({@code cosmeticPose}): flap/sway Winkel += A·sin(2π(speed·t + phase)), spin Winkel +=
 *       360·(speed·t + phase), bob Pivot += A·sin(…).</li>
 * </ul>
 * Jede Fläche wird so herum abgelegt, dass Minecraft sie von außen sieht (gegen den Uhrzeigersinn); Ebenen bekommen so
 * zwei Flächen, je eine für jede Seite.
 */
public final class CosmeticMesh {
	/** Werte je Vertex: x, y, z (Pixel), u, v (0..1), nx, ny, nz */
	public static final int STRIDE = 8;

	final int boneCount;
	final int[] parent;
	final float[] pivot;
	final float[] rest;
	/** Vertices je Bone (je vier hintereinander eine Fläche) */
	final float[][] vertices;
	final int vertexCount;
	// Animationen
	final int[] animBone;
	final int[] animType;
	final int[] animAxis;
	final float[] animAmplitude;
	final float[] animSpeed;
	final float[] animPhase;
	/** Ausdehnung in der Ruhelage (Pixel): minX, minY, minZ, maxX, maxY, maxZ */
	final float[] bounds = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};

	static final int FLAP = 0;
	static final int SWAY = 1;
	static final int SPIN = 2;
	static final int BOB = 3;

	CosmeticMesh(CosmeticFormat.Model model, List<CosmeticFormat.Animation> animations) {
		List<CosmeticFormat.Bone> bones = model.bones();
		boneCount = bones.size();
		parent = new int[boneCount];
		pivot = new float[boneCount * 3];
		rest = new float[boneCount * 3];
		vertices = new float[boneCount][];
		int total = 0;
		float texW = model.textureWidth();
		float texH = model.textureHeight();
		for (int b = 0; b < boneCount; b++) {
			CosmeticFormat.Bone bone = bones.get(b);
			parent[b] = bone.parent();
			for (int k = 0; k < 3; k++) {
				pivot[b * 3 + k] = (float) bone.pivot()[k];
				rest[b * 3 + k] = (float) bone.rotation()[k];
			}
			FloatList list = new FloatList();
			for (CosmeticFormat.Cube cube : bone.cubes()) addCube(list, cube, texW, texH);
			vertices[b] = list.toArray();
			total += vertices[b].length / STRIDE;
		}
		vertexCount = total;
		int n = animations.size();
		animBone = new int[n];
		animType = new int[n];
		animAxis = new int[n];
		animAmplitude = new float[n];
		animSpeed = new float[n];
		animPhase = new float[n];
		for (int i = 0; i < n; i++) {
			CosmeticFormat.Animation a = animations.get(i);
			animBone[i] = a.bone();
			animType[i] = switch (a.type()) {
				case "flap" -> FLAP;
				case "sway" -> SWAY;
				case "spin" -> SPIN;
				default -> BOB;
			};
			animAxis[i] = a.axis();
			animAmplitude[i] = (float) a.amplitude();
			animSpeed[i] = (float) a.speed();
			animPhase[i] = (float) a.phase();
		}
		computeBounds();
	}

	public int boneCount() {
		return boneCount;
	}

	public int vertexCount() {
		return vertexCount;
	}

	/** Gibt es flap-Animationen (Flügel)? */
	public boolean flaps() {
		for (int type : animType) if (type == FLAP) return true;
		return false;
	}

	// ======================================================================================
	// Flächen (wie cosmeticCubeFaces)
	// ======================================================================================

	private void addCube(FloatList out, CosmeticFormat.Cube cube, float texW, float texH) {
		float w = (float) cube.size()[0];
		float h = (float) cube.size()[1];
		float d = (float) cube.size()[2];
		float u = cube.uv()[0];
		float v = cube.uv()[1];
		float i = (float) cube.inflate();
		float x0 = (float) cube.origin()[0] - i;
		float y0 = (float) cube.origin()[1] - i;
		float z0 = (float) cube.origin()[2] - i;
		float x1 = (float) cube.origin()[0] + w + i;
		float y1 = (float) cube.origin()[1] + h + i;
		float z1 = (float) cube.origin()[2] + d + i;
		// je Fläche: Fläche (ohne inflate), Normale, vier Ecken (oben links, oben rechts, unten rechts, unten links), UV-Rechteck
		face(out, cube, d * h, -1, 0, 0, new float[] {x0, y1, z0, x0, y1, z1, x0, y0, z1, x0, y0, z0}, u, v + d, u + d, v + d + h, x0, x1, texW, texH);
		face(out, cube, w * h, 0, 0, 1, new float[] {x0, y1, z1, x1, y1, z1, x1, y0, z1, x0, y0, z1}, u + d, v + d, u + d + w, v + d + h, x0, x1, texW, texH);
		face(out, cube, d * h, 1, 0, 0, new float[] {x1, y1, z1, x1, y1, z0, x1, y0, z0, x1, y0, z1}, u + d + w, v + d, u + 2 * d + w, v + d + h, x0, x1, texW, texH);
		face(out, cube, w * h, 0, 0, -1, new float[] {x1, y1, z0, x0, y1, z0, x0, y0, z0, x1, y0, z0}, u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h, x0, x1, texW, texH);
		face(out, cube, w * d, 0, 1, 0, new float[] {x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1}, u + d, v, u + d + w, v + d, x0, x1, texW, texH);
		face(out, cube, w * d, 0, -1, 0, new float[] {x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1}, u + d + w, v, u + d + 2 * w, v + d, x0, x1, texW, texH);
	}

	private static void face(FloatList out, CosmeticFormat.Cube cube, float area, float nx, float ny, float nz, float[] c,
			float ua, float va, float ub, float vb, float x0, float x1, float texW, float texH) {
		if (area <= 0) return;
		if (cube.mirror()) {
			// an der Würfelmitte in x spiegeln: Textur seitenverkehrt, linke und rechte Fläche tauschen die Seite
			for (int k = 0; k < 4; k++) c[k * 3] = x0 + x1 - c[k * 3];
			nx = -nx;
		}
		float[] uvs = {ua, va, ub, va, ub, vb, ua, vb};
		// Umlaufsinn: Minecraft zeichnet Flächen, deren (c1 − c0) × (c3 − c0) nach außen zeigt
		float ax = c[3] - c[0];
		float ay = c[4] - c[1];
		float az = c[5] - c[2];
		float bx = c[9] - c[0];
		float by = c[10] - c[1];
		float bz = c[11] - c[2];
		float cx = ay * bz - az * by;
		float cy = az * bx - ax * bz;
		float cz = ax * by - ay * bx;
		boolean outward = cx * nx + cy * ny + cz * nz > 0;
		int[] order = outward ? new int[] {0, 1, 2, 3} : new int[] {0, 3, 2, 1};
		for (int k : order) {
			out.add(c[k * 3], c[k * 3 + 1], c[k * 3 + 2], uvs[k * 2] / texW, uvs[k * 2 + 1] / texH, nx, ny, nz);
		}
	}

	private void computeBounds() {
		Matrix4f[] matrices = new Matrix4f[boneCount];
		for (int b = 0; b < boneCount; b++) matrices[b] = new Matrix4f();
		float[] rotation = rest.clone();
		float[] offset = new float[boneCount * 3];
		matrices(rotation, offset, matrices);
		org.joml.Vector3f p = new org.joml.Vector3f();
		for (int b = 0; b < boneCount; b++) {
			float[] data = vertices[b];
			for (int i = 0; i < data.length; i += STRIDE) {
				matrices[b].transformPosition(data[i], data[i + 1], data[i + 2], p);
				bounds[0] = Math.min(bounds[0], p.x);
				bounds[1] = Math.min(bounds[1], p.y);
				bounds[2] = Math.min(bounds[2], p.z);
				bounds[3] = Math.max(bounds[3], p.x);
				bounds[4] = Math.max(bounds[4], p.y);
				bounds[5] = Math.max(bounds[5], p.z);
			}
		}
		if (bounds[0] > bounds[3]) java.util.Arrays.fill(bounds, 0f);
	}

	/** Ausdehnung in der Ruhelage (Pixel): minX, minY, minZ, maxX, maxY, maxZ */
	public float[] bounds() {
		return bounds.clone();
	}

	/** Bone-Matrizen in der Ruhelage (ohne Animationen) */
	Matrix4f[] restMatrices() {
		Matrix4f[] matrices = new Matrix4f[boneCount];
		for (int b = 0; b < boneCount; b++) matrices[b] = new Matrix4f();
		matrices(rest.clone(), new float[boneCount * 3], matrices);
		return matrices;
	}

	// ======================================================================================
	// Lage (wie cosmeticPose und cosmeticBoneMatrices)
	// ======================================================================================

	/**
	 * Bone-Matrizen zur Zeit {@code t} (Sekunden). flap-Animationen laufen mit eigener Zeit {@code flapTime} (beim Fliegen
	 * oder Fallen schneller, aufsummiert, damit die Bewegung nicht springt).
	 *
	 * @param scratch mindestens 6 · boneCount Zahlen (Drehung und Verschiebung je Bone)
	 * @param out     mindestens boneCount Matrizen; werden überschrieben
	 */
	public void pose(double t, double flapTime, float[] scratch, Matrix4f[] out) {
		int n = boneCount * 3;
		System.arraycopy(rest, 0, scratch, 0, n);
		java.util.Arrays.fill(scratch, n, 2 * n, 0f);
		for (int i = 0; i < animBone.length; i++) {
			int index = animBone[i] * 3 + animAxis[i];
			double time = animType[i] == FLAP ? flapTime : t;
			double cycle = animSpeed[i] * time + animPhase[i];
			switch (animType[i]) {
				case SPIN -> scratch[index] += (float) (360.0 * (cycle - Math.floor(cycle)));
				case BOB -> scratch[n + index] += (float) (animAmplitude[i] * Math.sin(2 * Math.PI * cycle));
				default -> scratch[index] += (float) (animAmplitude[i] * Math.sin(2 * Math.PI * cycle));
			}
		}
		matrices(scratch, scratch, out);
	}

	/** rotation: 3 Werte je Bone ab 0; offset: 3 Werte je Bone ab boneCount · 3 (dasselbe Feld wie rotation erlaubt) */
	private void matrices(float[] rotation, float[] offset, Matrix4f[] out) {
		int n = boneCount * 3;
		int offsetBase = offset == rotation ? n : 0;
		for (int b = 0; b < boneCount; b++) {
			Matrix4f m = out[b];
			if (parent[b] >= 0) m.set(out[parent[b]]);
			else m.identity();
			float px = pivot[b * 3];
			float py = pivot[b * 3 + 1];
			float pz = pivot[b * 3 + 2];
			m.translate(px + offset[offsetBase + b * 3], py + offset[offsetBase + b * 3 + 1], pz + offset[offsetBase + b * 3 + 2]);
			m.rotateZ((float) Math.toRadians(rotation[b * 3 + 2]));
			m.rotateY((float) Math.toRadians(rotation[b * 3 + 1]));
			m.rotateX((float) Math.toRadians(rotation[b * 3]));
			m.translate(-px, -py, -pz);
		}
	}

	/** Wachsende Liste von float ohne Boxing (nur beim Aufbau benutzt) */
	private static final class FloatList {
		private float[] data = new float[64];
		private int size;

		void add(float... values) {
			if (size + values.length > data.length) data = java.util.Arrays.copyOf(data, Math.max(data.length * 2, size + values.length));
			System.arraycopy(values, 0, data, size, values.length);
			size += values.length;
		}

		float[] toArray() {
			return java.util.Arrays.copyOf(data, size);
		}
	}
}
