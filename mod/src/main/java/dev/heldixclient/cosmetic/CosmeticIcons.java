package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.platform.NativeImage;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * Kleine Vorschaubilder der Cosmetics für die Kacheln im Heldix-Menü, einmal beim Laden auf der CPU gezeichnet (das Menü
 * kann pro Bild nur eine 3D-Figur zeigen). Modelle: schräg von vorn (Rücken-Cosmetics von hinten), mit Tiefenpuffer,
 * einfachem Licht und der Leuchtebene ohne Licht; Partikel: das erste Bild des Streifens, getönt.
 */
public final class CosmeticIcons {
	public static final int SIZE = 96;

	private CosmeticIcons() {
	}

	/** Vorschau eines Modells; texture/glow im Format ARGB (NativeImage.getPixel) */
	static NativeImage model(CosmeticMesh mesh, NativeImage texture, NativeImage glow, boolean fromBehind) {
		Matrix4f view = new Matrix4f().rotateX((float) Math.toRadians(18)).rotateY((float) Math.toRadians(fromBehind ? 180 + 28 : -28));
		Matrix4f[] bones = mesh.restMatrices();
		int faces = mesh.vertexCount() / 4;
		float[] sx = new float[faces * 4];
		float[] sy = new float[faces * 4];
		float[] sz = new float[faces * 4];
		float[] su = new float[faces * 4];
		float[] sv = new float[faces * 4];
		float[] light = new float[faces];
		Vector3f p = new Vector3f();
		Vector3f n = new Vector3f();
		Vector3f lightDir = new Vector3f(0.35f, 0.85f, 0.6f).normalize();
		int k = 0;
		for (int b = 0; b < mesh.boneCount; b++) {
			Matrix4f m = new Matrix4f(view).mul(bones[b]);
			float[] v = mesh.vertices[b];
			for (int i = 0; i < v.length; i += CosmeticMesh.STRIDE) {
				m.transformPosition(v[i], v[i + 1], v[i + 2], p);
				sx[k] = p.x;
				sy[k] = -p.y;
				sz[k] = p.z;
				su[k] = v[i + 3];
				sv[k] = v[i + 4];
				if (k % 4 == 0) {
					m.transformDirection(v[i + 5], v[i + 6], v[i + 7], n);
					n.normalize();
					light[k / 4] = 0.5f + 0.5f * Math.max(0f, n.dot(lightDir)) + (n.z > 0 ? 0.08f : 0f);
				}
				k++;
			}
		}
		NativeImage image = new NativeImage(SIZE, SIZE, true);
		if (k == 0) return image;
		float minX = Float.MAX_VALUE;
		float minY = Float.MAX_VALUE;
		float maxX = -Float.MAX_VALUE;
		float maxY = -Float.MAX_VALUE;
		for (int i = 0; i < k; i++) {
			minX = Math.min(minX, sx[i]);
			maxX = Math.max(maxX, sx[i]);
			minY = Math.min(minY, sy[i]);
			maxY = Math.max(maxY, sy[i]);
		}
		float margin = SIZE * 0.08f;
		float scale = (SIZE - 2 * margin) / Math.max(1e-3f, Math.max(maxX - minX, maxY - minY));
		float ox = (SIZE - (maxX - minX) * scale) / 2f - minX * scale;
		float oy = (SIZE - (maxY - minY) * scale) / 2f - minY * scale;
		for (int i = 0; i < k; i++) {
			sx[i] = sx[i] * scale + ox;
			sy[i] = sy[i] * scale + oy;
		}
		float[] depth = new float[SIZE * SIZE];
		java.util.Arrays.fill(depth, -Float.MAX_VALUE);
		int[] color = new int[SIZE * SIZE];
		int tw = texture.getWidth();
		int th = texture.getHeight();
		for (int f = 0; f < faces; f++) {
			int i0 = f * 4;
			int i1 = i0 + 1;
			int i3 = i0 + 3;
			float e1x = sx[i1] - sx[i0];
			float e1y = sy[i1] - sy[i0];
			float e2x = sx[i3] - sx[i0];
			float e2y = sy[i3] - sy[i0];
			float det = e1x * e2y - e1y * e2x;
			if (Math.abs(det) < 1e-4f) continue;
			int x0 = Math.max(0, (int) Math.floor(Math.min(Math.min(sx[i0], sx[i1]), Math.min(sx[i0 + 2], sx[i3]))));
			int x1 = Math.min(SIZE - 1, (int) Math.ceil(Math.max(Math.max(sx[i0], sx[i1]), Math.max(sx[i0 + 2], sx[i3]))));
			int y0 = Math.max(0, (int) Math.floor(Math.min(Math.min(sy[i0], sy[i1]), Math.min(sy[i0 + 2], sy[i3]))));
			int y1 = Math.min(SIZE - 1, (int) Math.ceil(Math.max(Math.max(sy[i0], sy[i1]), Math.max(sy[i0 + 2], sy[i3]))));
			for (int y = y0; y <= y1; y++) {
				for (int x = x0; x <= x1; x++) {
					float dx = x + 0.5f - sx[i0];
					float dy = y + 0.5f - sy[i0];
					float s = (dx * e2y - dy * e2x) / det;
					float t = (e1x * dy - e1y * dx) / det;
					if (s < -0.001f || s > 1.001f || t < -0.001f || t > 1.001f) continue;
					float z = sz[i0] + s * (sz[i1] - sz[i0]) + t * (sz[i3] - sz[i0]);
					int index = y * SIZE + x;
					if (z <= depth[index]) continue;
					// Texel innerhalb der Fläche (Ränder nicht in die Nachbarfläche der Textur rutschen lassen)
					float cs = Math.clamp(s, 0.002f, 0.998f);
					float ct = Math.clamp(t, 0.002f, 0.998f);
					float u = su[i0] + cs * (su[i1] - su[i0]) + ct * (su[i3] - su[i0]);
					float v = sv[i0] + cs * (sv[i1] - sv[i0]) + ct * (sv[i3] - sv[i0]);
					int px = Math.clamp((int) Math.floor(u * tw), 0, tw - 1);
					int py = Math.clamp((int) Math.floor(v * th), 0, th - 1);
					int argb = texture.getPixel(px, py);
					int glowArgb = glow != null ? glow.getPixel(px, py) : 0;
					if ((argb >>> 24) < 26 && (glowArgb >>> 24) < 26) continue;
					depth[index] = z;
					float l = light[f];
					int a = argb >>> 24;
					int r = Math.min(255, Math.round(((argb >> 16) & 0xFF) * l));
					int g = Math.min(255, Math.round(((argb >> 8) & 0xFF) * l));
					int bl = Math.min(255, Math.round((argb & 0xFF) * l));
					if ((glowArgb >>> 24) > 0) {
						// Leuchtebene ohne Licht darüber (wie im Spiel)
						float ga = (glowArgb >>> 24) / 255f;
						r = Math.round(r * (1 - ga) + ((glowArgb >> 16) & 0xFF) * ga);
						g = Math.round(g * (1 - ga) + ((glowArgb >> 8) & 0xFF) * ga);
						bl = Math.round(bl * (1 - ga) + (glowArgb & 0xFF) * ga);
						a = Math.max(a, glowArgb >>> 24);
					}
					color[index] = Math.max(a, 26) << 24 | r << 16 | g << 8 | bl;
				}
			}
		}
		for (int y = 0; y < SIZE; y++) {
			for (int x = 0; x < SIZE; x++) image.setPixel(x, y, color[y * SIZE + x]);
		}
		return image;
	}

	/**
	 * Vorschau eines Cosmetics im Format 2 in der Pose idle (Frame 0): Flügel schräg von hinten, alles andere schräg von
	 * vorn (Auren etwas von oben), Dreiecke mit Tiefenpuffer, einfachem Licht und dem ersten Bild des Leucht-Streifens.
	 */
	static NativeImage rig(CosmeticRig rig, NativeImage texture, NativeImage glow, String slot) {
		boolean back = slot.equals("back");
		boolean aura = slot.equals("aura");
		// Body-Modellraum (+X links, +Y unten, +Z hinten) → Bild (+x rechts, +y oben, +z zum Betrachter)
		Matrix4f base = back ? new Matrix4f().scaling(-1, -1, 1) : new Matrix4f().scaling(1, -1, -1);
		Matrix4f view = new Matrix4f().rotateX((float) Math.toRadians(aura ? 32 : 18)).rotateY((float) Math.toRadians(back ? 28 : -28)).mul(base);
		Matrix4f[] bones = rig.restPose(new org.joml.Quaternionf());
		int n = rig.vertexCount;
		float[] sx = new float[n];
		float[] sy = new float[n];
		float[] sz = new float[n];
		Vector3f p = new Vector3f();
		Vector3f scratch = new Vector3f();
		Matrix4f m = new Matrix4f();
		for (int i = 0; i < n; i++) {
			rig.skin(i, bones, p, scratch);
			view.transformPosition(p);
			sx[i] = p.x;
			sy[i] = -p.y;
			sz[i] = p.z;
		}
		NativeImage image = new NativeImage(SIZE, SIZE, true);
		float minX = Float.MAX_VALUE;
		float minY = Float.MAX_VALUE;
		float maxX = -Float.MAX_VALUE;
		float maxY = -Float.MAX_VALUE;
		for (int i = 0; i < n; i++) {
			minX = Math.min(minX, sx[i]);
			maxX = Math.max(maxX, sx[i]);
			minY = Math.min(minY, sy[i]);
			maxY = Math.max(maxY, sy[i]);
		}
		float margin = SIZE * 0.08f;
		float scale = (SIZE - 2 * margin) / Math.max(1e-3f, Math.max(maxX - minX, maxY - minY));
		float ox = (SIZE - (maxX - minX) * scale) / 2f - minX * scale;
		float oy = (SIZE - (maxY - minY) * scale) / 2f - minY * scale;
		for (int i = 0; i < n; i++) {
			sx[i] = sx[i] * scale + ox;
			sy[i] = sy[i] * scale + oy;
		}
		float[] depth = new float[SIZE * SIZE];
		java.util.Arrays.fill(depth, -Float.MAX_VALUE);
		int[] color = new int[SIZE * SIZE];
		int tw = texture.getWidth();
		int th = texture.getHeight();
		int glowFrameH = glow == null ? 1 : Math.max(1, glow.getHeight() / rig.glowFrames);
		Vector3f lightDir = new Vector3f(0.35f, 0.85f, 0.6f).normalize();
		Vector3f normal = new Vector3f();
		int[] quads = rig.quads;
		for (int q = 0; q < rig.quadCount; q++) {
			// Viereck = Dreiecke (0, 1, 2) und (2, 3, 0), wie Minecraft es zeichnet
			for (int half = 0; half < 2; half++) {
				int a = quads[q * 4 + (half == 0 ? 0 : 2)];
				int b = quads[q * 4 + (half == 0 ? 1 : 3)];
				int c = quads[q * 4 + (half == 0 ? 2 : 0)];
				if (a == b || b == c || a == c) continue;
				float det = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
				if (Math.abs(det) < 1e-5f) continue;
				m.set(view).mul(bones[rig.vertexBone[a]]).transformDirection(rig.nrm[a * 3], rig.nrm[a * 3 + 1], rig.nrm[a * 3 + 2], normal);
				normal.normalize();
				// ohne Culling: Rückseiten wie Vorderseiten beleuchten
				if (normal.z < 0) normal.negate();
				float light = 0.5f + 0.5f * Math.max(0f, normal.dot(lightDir)) + 0.08f;
				int x0 = Math.max(0, (int) Math.floor(Math.min(sx[a], Math.min(sx[b], sx[c]))));
				int x1 = Math.min(SIZE - 1, (int) Math.ceil(Math.max(sx[a], Math.max(sx[b], sx[c]))));
				int y0 = Math.max(0, (int) Math.floor(Math.min(sy[a], Math.min(sy[b], sy[c]))));
				int y1 = Math.min(SIZE - 1, (int) Math.ceil(Math.max(sy[a], Math.max(sy[b], sy[c]))));
				for (int y = y0; y <= y1; y++) {
					for (int x = x0; x <= x1; x++) {
						float px = x + 0.5f;
						float py = y + 0.5f;
						float wb = ((px - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (py - sy[a])) / det;
						float wc = ((sx[b] - sx[a]) * (py - sy[a]) - (px - sx[a]) * (sy[b] - sy[a])) / det;
						float wa = 1 - wb - wc;
						if (wa < -0.01f || wb < -0.01f || wc < -0.01f) continue;
						float z = wa * sz[a] + wb * sz[b] + wc * sz[c];
						int index = y * SIZE + x;
						if (z <= depth[index]) continue;
						float ca = Math.clamp(wa, 0f, 1f);
						float cb = Math.clamp(wb, 0f, 1f);
						float cc = Math.clamp(wc, 0f, 1f);
						float sum = Math.max(1e-6f, ca + cb + cc);
						float u = (ca * rig.uv[a * 2] + cb * rig.uv[b * 2] + cc * rig.uv[c * 2]) / sum;
						float v = (ca * rig.uv[a * 2 + 1] + cb * rig.uv[b * 2 + 1] + cc * rig.uv[c * 2 + 1]) / sum;
						int tx = Math.clamp((int) Math.floor(u * tw), 0, tw - 1);
						int ty = Math.clamp((int) Math.floor(v * th), 0, th - 1);
						int argb = texture.getPixel(tx, ty);
						int glowArgb = 0;
						if (glow != null) {
							int gx = Math.clamp((int) Math.floor(u * glow.getWidth()), 0, glow.getWidth() - 1);
							int gy = Math.clamp((int) Math.floor(v * glowFrameH), 0, glowFrameH - 1);
							glowArgb = glow.getPixel(gx, gy);
						}
						if ((argb >>> 24) < 26) continue;
						depth[index] = z;
						int r = Math.min(255, Math.round(((argb >> 16) & 0xFF) * light));
						int g = Math.min(255, Math.round(((argb >> 8) & 0xFF) * light));
						int bl = Math.min(255, Math.round((argb & 0xFF) * light));
						if ((glowArgb >>> 24) > 0) {
							// Leuchtebene additiv (wie im Spiel), schwarz = kein Leuchten
							float ga = (glowArgb >>> 24) / 255f;
							r = Math.min(255, Math.round(r + ((glowArgb >> 16) & 0xFF) * ga));
							g = Math.min(255, Math.round(g + ((glowArgb >> 8) & 0xFF) * ga));
							bl = Math.min(255, Math.round(bl + (glowArgb & 0xFF) * ga));
						}
						color[index] = 0xFF000000 | r << 16 | g << 8 | bl;
					}
				}
			}
		}
		for (int y = 0; y < SIZE; y++) {
			for (int x = 0; x < SIZE; x++) image.setPixel(x, y, color[y * SIZE + x]);
		}
		return image;
	}

	/** Vorschau einer Aura: erstes Bild des Partikel-Streifens, getönt, ohne Glätten vergrößert */
	static NativeImage particles(NativeImage strip, CosmeticFormat.Particles particles) {
		NativeImage image = new NativeImage(SIZE, SIZE, true);
		int frame = strip.getHeight();
		int tint = particles.color();
		int margin = SIZE / 6;
		int inner = SIZE - 2 * margin;
		for (int y = 0; y < inner; y++) {
			for (int x = 0; x < inner; x++) {
				int argb = strip.getPixel(Math.min(frame - 1, x * frame / inner), Math.min(frame - 1, y * frame / inner));
				int r = ((argb >> 16) & 0xFF) * ((tint >> 16) & 0xFF) / 255;
				int g = ((argb >> 8) & 0xFF) * ((tint >> 8) & 0xFF) / 255;
				int b = (argb & 0xFF) * (tint & 0xFF) / 255;
				image.setPixel(margin + x, margin + y, (argb & 0xFF000000) | r << 16 | g << 8 | b);
			}
		}
		return image;
	}
}
