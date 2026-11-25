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

/**
 * Cape als wehender Stoff statt als starre Platte: Das Cape besteht aus vielen waagrechten Streifen, die sich nach
 * unten hin immer stärker nach hinten biegen. Darüber läuft eine Welle von oben nach unten – beim Laufen kräftiger,
 * im Stehen ganz leicht. Die Grundneigung kommt wie bei Minecraft aus der Bewegung des Spielers (capeLean, capeFlap).
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

	private CapeCloth() {
	}

	/** Kann dieses Modell als Stoff gezeichnet werden? (Cape-Teil am Körper vorhanden) */
	public static boolean supports(Model<?> model) {
		return model instanceof HumanoidModel<?> humanoid && humanoid.body.hasChild("cape");
	}

	/**
	 * Zeichnet das Cape. pose ist die Lage, die Minecraft dem Cape-Modell mitgeben würde (Spieler, ggf. Rüstung).
	 *
	 * @param glow Leuchtbild (null = keins); wird voll hell und additiv über die Außenseite gelegt
	 */
	@SuppressWarnings({"unchecked", "rawtypes"})
	public static void submit(SubmitNodeCollector collector, Model model, AvatarRenderState state, PoseStack pose, Identifier texture,
			Identifier glow, int light, int overlay) {
		HumanoidModel<?> humanoid = (HumanoidModel<?>) model;
		// Körperhaltung (z. B. Schleichen) wie beim normalen Modell
		model.setupAnim(state);
		ModelPart cape = humanoid.body.getChild("cape");
		pose.pushPose();
		model.root().translateAndRotate(pose);
		humanoid.body.translateAndRotate(pose);
		pose.translate(cape.x / 16f, cape.y / 16f, cape.z / 16f);
		float sideways = state.capeLean2 / 2f;
		pose.rotateDegrees(Axis.ZP, sideways);
		pose.rotateDegrees(Axis.YP, -sideways);
		pose.scale(1 / 16f, 1 / 16f, 1 / 16f);

		Shape shape = shape(state);
		collector.submitCustomGeometry(pose, RenderTypes.entityCutout(texture), (p, consumer) -> emit(p, consumer, shape, light, overlay));
		if (glow != null) {
			collector.submitCustomGeometry(pose, RenderTypes.eyes(glow), (p, consumer) -> emitGlow(p, consumer, shape, overlay));
		}
		pose.popPose();
	}

	/** Form des Stoffs: Punkte der Innenseite und Richtung nach außen je Gitterpunkt */
	private record Shape(float[][] y, float[][] z, float[][] ny, float[][] nz) {
	}

	private static Shape shape(AvatarRenderState state) {
		float base = 6f + state.capeLean / 2f + state.capeFlap;
		float motion = Math.clamp(state.capeLean / 70f, 0f, 1f);
		float time = state.ageInTicks / 20f;
		float amplitude = 2.2f + motion * 8f;
		float speed = 2.6f + motion * 5.5f;

		// Winkel der Streifen: oben nah am Körper, unten weiter nach hinten, mit wandernder Welle
		float[] angle = new float[ROWS];
		for (int i = 0; i < ROWS; i++) {
			float s = (i + 0.5f) / ROWS;
			float bend = base * (0.45f + 1.1f * s);
			float wave = amplitude * s * (float) Math.sin(time * speed - s * 6.5f)
					+ amplitude * 0.35f * s * (float) Math.sin(time * speed * 1.7f - s * 11f + 1.3f);
			angle[i] = Math.clamp(bend + wave, -12f, 115f);
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
		for (int j = 0; j <= ROWS; j++) {
			float s = (float) j / ROWS;
			float nY = -(float) Math.sin(na[j]);
			float nZ = (float) Math.cos(na[j]);
			for (int c = 0; c <= COLS; c++) {
				float u = (float) c / COLS * 2f - 1f;
				float bulge = (0.25f + motion * 0.6f) * s * (1f - u * u);
				float flutter = (0.12f + motion * 0.35f) * s * (float) Math.sin(time * speed * 1.3f + u * 2.4f - s * 4f);
				float offset = bulge + flutter;
				y[j][c] = cy[j] + nY * offset;
				z[j][c] = cz[j] + nZ * offset;
				ny[j][c] = nY;
				nz[j][c] = nZ;
			}
		}
		return new Shape(y, z, ny, nz);
	}

	private static float x(int c) {
		return WIDTH / 2f - (float) c / COLS * WIDTH;
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
				float xa = x(c);
				float xb = x(c + 1);
				// Außenseite (1,1)–(11,17): x = +5 links im Bild
				float ua = (1f + WIDTH * c / COLS) / 64f;
				float ub = (1f + WIDTH * (c + 1) / COLS) / 64f;
				quad(pose, consumer, light, overlay,
						xa, outerY(shape, j, c, t), outerZ(shape, j, c, t), ua, v0, 0, shape.ny[j][c], shape.nz[j][c],
						xb, outerY(shape, j, c + 1, t), outerZ(shape, j, c + 1, t), ub, v0, 0, shape.ny[j][c + 1], shape.nz[j][c + 1],
						xb, outerY(shape, j + 1, c + 1, t), outerZ(shape, j + 1, c + 1, t), ub, v1, 0, shape.ny[j + 1][c + 1], shape.nz[j + 1][c + 1],
						xa, outerY(shape, j + 1, c, t), outerZ(shape, j + 1, c, t), ua, v1, 0, shape.ny[j + 1][c], shape.nz[j + 1][c]);
				// Innenseite (12,1)–(22,17): gespiegelt, x = +5 rechts im Bild
				float ia = (22f - WIDTH * c / COLS) / 64f;
				float ib = (22f - WIDTH * (c + 1) / COLS) / 64f;
				quad(pose, consumer, light, overlay,
						xa, shape.y[j][c], shape.z[j][c], ia, v0, 0, -shape.ny[j][c], -shape.nz[j][c],
						xa, shape.y[j + 1][c], shape.z[j + 1][c], ia, v1, 0, -shape.ny[j + 1][c], -shape.nz[j + 1][c],
						xb, shape.y[j + 1][c + 1], shape.z[j + 1][c + 1], ib, v1, 0, -shape.ny[j + 1][c + 1], -shape.nz[j + 1][c + 1],
						xb, shape.y[j][c + 1], shape.z[j][c + 1], ib, v0, 0, -shape.ny[j][c + 1], -shape.nz[j][c + 1]);
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
				float xa = x(c);
				float xb = x(c + 1);
				float ua = (1f + WIDTH * c / COLS) / 64f;
				float ub = (1f + WIDTH * (c + 1) / COLS) / 64f;
				float[][] p = {
						{xa, outerY(shape, j, c, t), outerZ(shape, j, c, t), ua, v0},
						{xb, outerY(shape, j, c + 1, t), outerZ(shape, j, c + 1, t), ub, v0},
						{xb, outerY(shape, j + 1, c + 1, t), outerZ(shape, j + 1, c + 1, t), ub, v1},
						{xa, outerY(shape, j + 1, c, t), outerZ(shape, j + 1, c, t), ua, v1}};
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
		float x = x(c);
		quad(pose, consumer, light, overlay,
				x, shape.y[j][c], shape.z[j][c], u0, v0, side, 0, 0,
				x, outerY(shape, j, c, t), outerZ(shape, j, c, t), u1, v0, side, 0, 0,
				x, outerY(shape, j + 1, c, t), outerZ(shape, j + 1, c, t), u1, v1, side, 0, 0,
				x, shape.y[j + 1][c], shape.z[j + 1][c], u0, v1, side, 0, 0);
	}

	private static void cap(PoseStack.Pose pose, VertexConsumer consumer, Shape shape, int j, int c, float ua, float ub, float v0, float v1,
			int light, int overlay, float t, float up) {
		float xa = x(c);
		float xb = x(c + 1);
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
