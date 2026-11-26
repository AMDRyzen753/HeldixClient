package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.util.LightCoordsUtil;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.Items;
import org.joml.Matrix3f;
import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.WeakHashMap;

/**
 * Zeichnet die Cosmetics an Spielern (eigener Spieler in der Third-Person-Ansicht und im Inventar, andere
 * HeldixClient-Spieler laut Nachschlagen beim Heldix-Dienst, Figuren in den Menüs).
 *
 * <ul>
 *   <li><b>head</b> und <b>back</b> über {@link #layer}: Anfang von {@code CapeLayer.submit}. Dort ist das Spielermodell
 *       schon für diesen Spieler ausgerichtet (Kopf folgt dem Blick, Rumpf dem Schleichen); das Cosmetic hängt an
 *       Kopf-Oberseite bzw. Rumpfmitte auf Schulterhöhe.</li>
 *   <li><b>companion</b> und <b>aura</b> über {@link #entity}: Anfang von {@code EntityRenderer.submit} (nach dem
 *       Spielermodell, in Weltlage am Spieler). Der Begleiter folgt weich, die Partikel bleiben in der Welt stehen.</li>
 * </ul>
 *
 * <p>Beide Stellen sind schon Ziele der Fabric-Brücke (Cape-Glanz, Namensschilder), es braucht also keine neuen.
 * Gezeichnet wird über {@code submitCustomGeometry}: Die Bone-Matrizen werden beim Einreichen in wiederverwendete
 * Objekte geschrieben, die Vertices erst beim Zeichnen erzeugt – ohne neue Objekte pro Bild (abgesehen von dem, was
 * Minecraft selbst je Einreichung anlegt). Alles im Render-Thread.
 */
public final class CosmeticRenderer {
	/** Partikel anderer Spieler nur bis zu dieser Entfernung (Blöcke) */
	private static final double AURA_DISTANCE = 48;
	/** höchstens so viele lebende Aura-Partikel je Spieler */
	public static final int MAX_PARTICLES = 64;
	private static final long EPOCH = System.nanoTime();
	private static final float PX = 1f / 16f;

	/** Messung (Render-Thread): Zeit in den Hooks beim Einreichen und beim Erzeugen der Vertices, in Nanosekunden */
	public static long submitNanos;
	public static long emitNanos;
	public static long emittedVertices;

	/** Figuren in Menüs: was sie tragen (Renderzustand → Kleidung) */
	private static final Map<AvatarRenderState, Cosmetics.Dress> DRESSES = new WeakHashMap<>();
	/** Laufzeitdaten je Träger (UUID oder Kleidung einer Menüfigur) */
	private static final Map<Object, Wearer> WEARERS = new HashMap<>();
	private static long lastCleanup = System.nanoTime();

	private CosmeticRenderer() {
	}

	// ======================================================================================
	// Träger
	// ======================================================================================

	/** Laufzeitdaten eines Trägers: Zeit der Flügel, Begleiter, Partikel, Messwerte für Tests */
	static final class Wearer {
		final Object key;
		boolean own;
		UUID uuid;
		Cosmetics.Dress dress;
		AbstractClientPlayer player;
		CosmeticCatalog.Item head;
		CosmeticCatalog.Item back;
		CosmeticCatalog.Item aura;
		CosmeticCatalog.Item companion;
		long seen;
		long lastNanos;
		double flapTime;
		float flapFactor = 1f;
		// Begleiter (Weltlage)
		long lastCompanion;
		boolean placed;
		double cx;
		double cy;
		double cz;
		float cyaw;
		final Emitter world = new Emitter();
		final Emitter gui = new Emitter();
		// Messwerte (nur Welt): Lage des Ankers relativ zur Kamera bzw. in der Welt, Fingerabdruck der Pose
		final float[] pendingHead = new float[4];
		final float[] pendingBack = new float[4];
		final double[] headAnchor = new double[3];
		final double[] backAnchor = new double[3];
		final double[] companionAnchor = new double[3];
		float headPose;
		float backPose;
		float companionPose;
		long headFrame;
		long backFrame;
		long companionFrame;
		long auraFrame;

		Wearer(Object key) {
			this.key = key;
		}
	}

	/** Für Menüfiguren: was die Figur mit diesem Renderzustand trägt (gilt, solange der Zustand lebt) */
	public static void dress(AvatarRenderState state, Cosmetics.Dress dress) {
		if (state != null && dress != null) DRESSES.put(state, dress);
	}

	private static Wearer wearer(AvatarRenderState state, long now) {
		Cosmetics.Dress dress = DRESSES.isEmpty() ? null : DRESSES.get(state);
		Minecraft mc = Minecraft.getInstance();
		HeldixConfig.Data config = HeldixConfig.get();
		Wearer wearer;
		if (dress != null) {
			wearer = WEARERS.computeIfAbsent(dress, Wearer::new);
			wearer.dress = dress;
			wearer.own = false;
			wearer.player = null;
			wearer.head = CosmeticCatalog.item(dress.head, "head");
			wearer.back = CosmeticCatalog.item(dress.back, "back");
			wearer.aura = CosmeticCatalog.item(dress.aura, "aura");
			wearer.companion = CosmeticCatalog.item(dress.companion, "companion");
		} else {
			if (mc.level == null) return null;
			Entity entity = mc.level.getEntity(state.id);
			if (!(entity instanceof AbstractClientPlayer player)) return null;
			UUID uuid = player.getUUID();
			wearer = WEARERS.get(uuid);
			if (wearer == null) {
				wearer = new Wearer(uuid);
				WEARERS.put(uuid, wearer);
			}
			wearer.uuid = uuid;
			wearer.player = player;
			wearer.own = uuid.equals(mc.getGameProfile().id());
			if (wearer.own) {
				wearer.head = CosmeticCatalog.item(Cosmetics.own("head"), "head");
				wearer.back = CosmeticCatalog.item(Cosmetics.own("back"), "back");
				wearer.aura = CosmeticCatalog.item(Cosmetics.own("aura"), "aura");
				wearer.companion = CosmeticCatalog.item(Cosmetics.own("companion"), "companion");
			} else if (!config.cosmeticsOthers) {
				wearer.head = wearer.back = wearer.aura = wearer.companion = null;
			} else {
				wearer.head = CosmeticCatalog.item(Social.cosmeticOf(uuid, "head"), "head");
				wearer.back = CosmeticCatalog.item(Social.cosmeticOf(uuid, "back"), "back");
				wearer.aura = config.cosmeticParticlesOthers ? CosmeticCatalog.item(Social.cosmeticOf(uuid, "aura"), "aura") : null;
				wearer.companion = CosmeticCatalog.item(Social.cosmeticOf(uuid, "companion"), "companion");
			}
		}
		wearer.seen = now;
		advance(wearer, now);
		cleanup(now);
		return wearer;
	}

	/** Zeit weiterlaufen lassen: Flügel schneller beim Fliegen und Fallen (Faktor bis 2, weich) */
	private static void advance(Wearer wearer, long now) {
		if (wearer.lastNanos == 0) wearer.lastNanos = now;
		double dt = Math.min(0.25, (now - wearer.lastNanos) / 1e9);
		if (dt <= 0) return;
		wearer.lastNanos = now;
		float target = 1f;
		AbstractClientPlayer player = wearer.player;
		if (player != null) {
			if (player.isFallFlying()) target = 2f;
			else if (player.getAbilities().flying) target = 1.5f;
			else if (!player.onGround()) {
				double vy = player.getDeltaMovement().y;
				if (vy < -0.3) target = (float) Math.min(2.0, 1.0 + (-vy - 0.3) / 0.6);
			}
		}
		if (wearer.own) {
			Cosmetics.Effect effect = Cosmetics.effect("back");
			if (effect != null && effect.kind().equals("flap")) target = 2f;
		}
		wearer.flapFactor += (float) ((target - wearer.flapFactor) * (1 - Math.exp(-dt * 5)));
		wearer.flapTime += dt * wearer.flapFactor;
	}

	private static void cleanup(long now) {
		if (now - lastCleanup < 5_000_000_000L) return;
		lastCleanup = now;
		Iterator<Wearer> it = WEARERS.values().iterator();
		while (it.hasNext()) {
			if (now - it.next().seen > 10_000_000_000L) it.remove();
		}
	}

	/** Katalog neu geladen: Begleiter neu platzieren, Partikel leeren (andere Texturen) */
	static void catalogChanged() {
		for (Wearer wearer : WEARERS.values()) {
			wearer.world.clear();
			wearer.gui.clear();
		}
	}

	private static double time(long now) {
		return (now - EPOCH) / 1e9;
	}

	/** F1: Cosmetics in der Welt ausblenden (nicht in Menüs) */
	private static boolean hiddenByF1(Minecraft mc) {
		return mc.gui.screen() == null && mc.gui.hud.isHidden();
	}

	// ======================================================================================
	// Kopf und Rücken (CapeLayer.submit)
	// ======================================================================================

	/** Anfang von CapeLayer.submit: Kopf- und Rücken-Cosmetics am posierten Spielermodell */
	public static void layer(RenderLayer<AvatarRenderState, PlayerModel> layer, PoseStack pose, SubmitNodeCollector collector, int light,
			AvatarRenderState state) {
		if (state.isInvisible || state.isSpectator) return;
		Minecraft mc = Minecraft.getInstance();
		long now = System.nanoTime();
		Wearer wearer = wearer(state, now);
		if (wearer == null || (wearer.head == null && wearer.back == null)) return;
		if (wearer.dress == null && hiddenByF1(mc)) return;
		PlayerModel model = layer.getParentModel();
		double t = time(now);
		HeldixConfig.Data config = HeldixConfig.get();

		CosmeticCatalog.Item head = wearer.head;
		boolean helmet = !state.headEquipment.isEmpty();
		if (head != null && head.mesh() != null && (!helmet || config.cosmeticHatOverHelmet)) {
			pose.pushPose();
			model.root().translateAndRotate(pose);
			model.head.translateAndRotate(pose);
			// Mitte der Kopf-Oberseite (Java-Modellraum: y nach unten); über einem Helm einen Pixel höher
			pose.translate(0f, (-8f - (helmet ? 1f : 0f)) * PX, 0f);
			toModelSpace(pose);
			applyEffect(pose, wearer, "head", t);
			ModelDraw draw = submitModel(collector, pose, head, wearer, t, light);
			probe(pose, wearer.pendingHead, draw);
			wearer.headFrame = -1; // erst in entity() bestätigt (dort ist bekannt, ob es die Welt oder ein Menü ist)
			pose.popPose();
		}

		CosmeticCatalog.Item back = wearer.back;
		if (back != null && back.mesh() != null) {
			pose.pushPose();
			model.root().translateAndRotate(pose);
			model.body.translateAndRotate(pose);
			// Rumpfmitte auf Schulterhöhe; mit Brustpanzer einen Pixel weiter nach hinten (wie das Cape)
			if (!state.chestEquipment.isEmpty() && !state.chestEquipment.is(Items.ELYTRA)) pose.translate(0f, 0f, PX);
			toModelSpace(pose);
			applyEffect(pose, wearer, "back", t);
			ModelDraw draw = submitModel(collector, pose, back, wearer, t, light);
			probe(pose, wearer.pendingBack, draw);
			wearer.backFrame = -1;
			pose.popPose();
		}
	}

	/** Java-Modellraum (Blöcke, y nach unten, vorn = −z) → Cosmetic-Modellraum (Pixel, +y oben, +z vorn) */
	private static void toModelSpace(PoseStack pose) {
		pose.rotateDegrees(Axis.XP, 180f);
		pose.scale(PX, PX, PX);
	}

	/** Effekt der Addon-API am eigenen Cosmetic: spin dreht einmal um die Hochachse, bounce hüpft */
	private static void applyEffect(PoseStack pose, Wearer wearer, String slot, double t) {
		if (!wearer.own) return;
		Cosmetics.Effect effect = Cosmetics.effect(slot);
		if (effect == null) return;
		double p = Math.clamp(effect.progress(System.nanoTime()), 0, 1);
		switch (effect.kind()) {
			case "spin" -> pose.rotateDegrees(Axis.YP, (float) (360 * (p * p * (3 - 2 * p))));
			case "bounce" -> pose.translate(0f, (float) (Math.abs(Math.sin(p * Math.PI * 2)) * 4 * (1 - p)), 0f);
			default -> {
			}
		}
	}

	/** Lage des Ankers (Ursprung) relativ zur Kamera und Fingerabdruck der Pose merken */
	private static void probe(PoseStack pose, float[] out, ModelDraw draw) {
		Matrix4f m = pose.last().pose();
		out[0] = m.m30();
		out[1] = m.m31();
		out[2] = m.m32();
		out[3] = draw == null ? 0f : draw.fingerprint();
	}

	// ======================================================================================
	// Begleiter und Aura (EntityRenderer.submit)
	// ======================================================================================

	private static final Vector3f AXIS_A = new Vector3f();
	private static final Vector3f AXIS_B = new Vector3f();

	/** Anfang von EntityRenderer.submit (für Spieler nach dem Modell): Begleiter und Aura in Weltlage */
	public static void entity(EntityRenderState entityState, PoseStack pose, SubmitNodeCollector collector, CameraRenderState camera) {
		if (!(entityState instanceof AvatarRenderState state)) return;
		if (state.isInvisible || state.isSpectator) return;
		Minecraft mc = Minecraft.getInstance();
		long now = System.nanoTime();
		Wearer wearer = wearer(state, now);
		if (wearer == null) return;
		boolean gui = camera == null || !camera.initialized || camera.pos == null;
		if (!gui) {
			// Messwerte aus layer() bestätigen: das war die Welt
			long frame = now;
			if (wearer.headFrame == -1) {
				toWorld(wearer.pendingHead, camera, wearer.headAnchor);
				wearer.headPose = wearer.pendingHead[3];
				wearer.headFrame = frame;
			}
			if (wearer.backFrame == -1) {
				toWorld(wearer.pendingBack, camera, wearer.backAnchor);
				wearer.backPose = wearer.pendingBack[3];
				wearer.backFrame = frame;
			}
		} else {
			if (wearer.headFrame == -1) wearer.headFrame = 0;
			if (wearer.backFrame == -1) wearer.backFrame = 0;
		}
		if (!gui && hiddenByF1(mc)) return;
		double t = time(now);

		CosmeticCatalog.Item companion = wearer.companion;
		if (companion != null && companion.mesh() != null && companion.manifest().companion() != null) {
			submitCompanion(pose, collector, state, wearer, companion, gui, t, now);
		}
		CosmeticCatalog.Item aura = wearer.aura;
		if (aura != null && aura.manifest().particles() != null) {
			boolean near = gui || wearer.own || state.distanceToCameraSq <= AURA_DISTANCE * AURA_DISTANCE;
			if (near) submitAura(pose, collector, state, wearer, aura, gui, camera, now);
		}
	}

	private static void toWorld(float[] relative, CameraRenderState camera, double[] out) {
		out[0] = camera.pos.x + relative[0];
		out[1] = camera.pos.y + relative[1];
		out[2] = camera.pos.z + relative[2];
	}

	private static void submitCompanion(PoseStack pose, SubmitNodeCollector collector, AvatarRenderState state, Wearer wearer,
			CosmeticCatalog.Item item, boolean gui, double t, long now) {
		CosmeticFormat.Companion info = item.manifest().companion();
		// Platz neben dem Spieler: x zeigt zur rechten Seite (Modell −x), mit dem Rumpf gedreht (Welt = Ry(−bodyRot) · Modell)
		double yaw = Math.toRadians(state.bodyRot);
		double mx = -info.offset()[0];
		double my = info.offset()[1];
		double mz = info.offset()[2];
		double cos = Math.cos(-yaw);
		double sin = Math.sin(-yaw);
		double ox = mx * cos + mz * sin;
		double oz = -mx * sin + mz * cos;
		double rx;
		double ry;
		double rz;
		float renderYaw;
		if (gui) {
			rx = ox;
			ry = my;
			rz = oz;
			renderYaw = state.bodyRot;
		} else {
			double tx = state.x + ox;
			double ty = state.y + my;
			double tz = state.z + oz;
			double dt = Math.min(0.25, Math.max(0, (now - wearer.lastCompanion) / 1e9));
			wearer.lastCompanion = now;
			double distance = Math.abs(wearer.cx - tx) + Math.abs(wearer.cy - ty) + Math.abs(wearer.cz - tz);
			if (!wearer.placed || distance > 12) {
				wearer.cx = tx;
				wearer.cy = ty;
				wearer.cz = tz;
				wearer.cyaw = state.bodyRot;
				wearer.placed = true;
			} else {
				double k = 1 - Math.exp(-dt * 4.5);
				wearer.cx += (tx - wearer.cx) * k;
				wearer.cy += (ty - wearer.cy) * k;
				wearer.cz += (tz - wearer.cz) * k;
				float delta = net.minecraft.util.Mth.wrapDegrees(state.bodyRot - wearer.cyaw);
				wearer.cyaw += (float) (delta * (1 - Math.exp(-dt * 3)));
			}
			rx = wearer.cx - state.x;
			ry = wearer.cy - state.y;
			rz = wearer.cz - state.z;
			renderYaw = wearer.cyaw;
		}
		pose.pushPose();
		pose.translate((float) rx, (float) ry, (float) rz);
		pose.rotate(Axis.YP, (float) Math.toRadians(-renderYaw));
		float scale = (float) info.scale() * PX;
		pose.scale(scale, scale, scale);
		applyEffect(pose, wearer, "companion", t);
		int light = state.lightCoords;
		ModelDraw draw = submitModel(collector, pose, item, wearer, t, light);
		if (!gui) {
			wearer.companionAnchor[0] = wearer.cx;
			wearer.companionAnchor[1] = wearer.cy;
			wearer.companionAnchor[2] = wearer.cz;
			wearer.companionPose = draw == null ? 0 : draw.fingerprint();
			wearer.companionFrame = now;
		}
		pose.popPose();
	}

	// ======================================================================================
	// Modelle
	// ======================================================================================

	private static ModelDraw submitModel(SubmitNodeCollector collector, PoseStack pose, CosmeticCatalog.Item item, Wearer wearer, double t, int light) {
		CosmeticMesh mesh = item.mesh();
		Identifier texture = item.texture();
		if (texture == null) return null;
		ModelDraw draw = nextModel();
		draw.prepare(mesh, light, OverlayTexture.NO_OVERLAY);
		mesh.pose(t, wearer.flapTime, draw.scratch, draw.own);
		draw.bones = draw.own;
		collector.submitCustomGeometry(pose, RenderTypes.entityCutoutCull(texture), draw);
		Identifier glow = item.glow();
		if (glow != null) {
			ModelDraw glowDraw = nextModel();
			glowDraw.prepare(mesh, LightCoordsUtil.FULL_BRIGHT, OverlayTexture.NO_OVERLAY);
			glowDraw.bones = draw.own;
			collector.submitCustomGeometry(pose, RenderTypes.eyes(glow), glowDraw);
		}
		return draw;
	}

	private static final ModelDraw[] MODEL_RING = new ModelDraw[512];
	private static int modelIndex;

	private static ModelDraw nextModel() {
		int index = modelIndex = (modelIndex + 1) % MODEL_RING.length;
		ModelDraw draw = MODEL_RING[index];
		if (draw == null) MODEL_RING[index] = draw = new ModelDraw();
		return draw;
	}

	/** Eine Einreichung eines Modells: Bone-Matrizen (beim Einreichen gerechnet) und Licht; zeichnet beim Ausführen */
	private static final class ModelDraw implements SubmitNodeCollector.CustomGeometryRenderer {
		private static final Matrix4f FULL = new Matrix4f();
		private static final Matrix3f NORMAL = new Matrix3f();
		private static final Matrix3f BONE_NORMAL = new Matrix3f();

		CosmeticMesh mesh;
		Matrix4f[] own = new Matrix4f[0];
		Matrix4f[] bones;
		float[] scratch = new float[0];
		int light;
		int overlay;

		void prepare(CosmeticMesh mesh, int light, int overlay) {
			this.mesh = mesh;
			this.light = light;
			this.overlay = overlay;
			int n = mesh.boneCount();
			if (own.length < n) {
				Matrix4f[] grown = java.util.Arrays.copyOf(own, n);
				for (int i = own.length; i < n; i++) grown[i] = new Matrix4f();
				own = grown;
			}
			if (scratch.length < n * 6) scratch = new float[n * 6];
		}

		/** Summe einiger Matrixwerte: ändert sich, wenn sich das Modell bewegt (für Tests) */
		float fingerprint() {
			float sum = 0;
			for (int b = 0; b < mesh.boneCount(); b++) {
				Matrix4f m = own[b];
				sum += m.m00() * 1.3f + m.m01() * 2.1f + m.m02() * 0.7f + m.m10() * 1.9f + m.m12() * 0.3f + m.m30() * 0.11f + m.m31() * 0.13f + m.m32() * 0.17f;
			}
			return sum;
		}

		@Override
		public void render(PoseStack.Pose pose, VertexConsumer consumer) {
			CosmeticMesh mesh = this.mesh;
			Matrix4f[] bones = this.bones;
			if (mesh == null || bones == null) return;
			long start = System.nanoTime();
			emittedVertices += mesh.vertexCount;
			emit(pose, consumer, mesh, bones);
			emitNanos += System.nanoTime() - start;
		}

		private void emit(PoseStack.Pose pose, VertexConsumer consumer, CosmeticMesh mesh, Matrix4f[] bones) {
			Matrix3f normal = pose.normal();
			for (int b = 0; b < mesh.boneCount; b++) {
				float[] v = mesh.vertices[b];
				if (v.length == 0) continue;
				Matrix4f m = FULL.set(pose.pose()).mul(bones[b]);
				Matrix3f n = bones[b].get3x3(BONE_NORMAL);
				n = NORMAL.set(normal).mul(n);
				float m00 = m.m00(), m01 = m.m01(), m02 = m.m02();
				float m10 = m.m10(), m11 = m.m11(), m12 = m.m12();
				float m20 = m.m20(), m21 = m.m21(), m22 = m.m22();
				float m30 = m.m30(), m31 = m.m31(), m32 = m.m32();
				float n00 = n.m00(), n01 = n.m01(), n02 = n.m02();
				float n10 = n.m10(), n11 = n.m11(), n12 = n.m12();
				float n20 = n.m20(), n21 = n.m21(), n22 = n.m22();
				for (int i = 0; i < v.length; i += CosmeticMesh.STRIDE) {
					float x = v[i];
					float y = v[i + 1];
					float z = v[i + 2];
					float nx = v[i + 5];
					float ny = v[i + 6];
					float nz = v[i + 7];
					float tx = n00 * nx + n10 * ny + n20 * nz;
					float ty = n01 * nx + n11 * ny + n21 * nz;
					float tz = n02 * nx + n12 * ny + n22 * nz;
					float length = (float) Math.sqrt(tx * tx + ty * ty + tz * tz);
					if (length > 0) {
						tx /= length;
						ty /= length;
						tz /= length;
					}
					consumer.addVertex(m00 * x + m10 * y + m20 * z + m30, m01 * x + m11 * y + m21 * z + m31, m02 * x + m12 * y + m22 * z + m32,
							-1, v[i + 3], v[i + 4], overlay, light, tx, ty, tz);
				}
			}
		}
	}

	// ======================================================================================
	// Aura (Partikel)
	// ======================================================================================

	/** Partikel eines Trägers: feste Felder für höchstens 64, ohne neue Objekte */
	static final class Emitter {
		final float[] age = new float[MAX_PARTICLES];
		final float[] life = new float[MAX_PARTICLES];
		final float[] angle = new float[MAX_PARTICLES];
		final float[] dist = new float[MAX_PARTICLES];
		final float[] height = new float[MAX_PARTICLES];
		final float[] seed = new float[MAX_PARTICLES];
		final double[] ax = new double[MAX_PARTICLES];
		final double[] ay = new double[MAX_PARTICLES];
		final double[] az = new double[MAX_PARTICLES];
		int count;
		double due;
		long last;
		CosmeticCatalog.Item item;
		long burstHandled;
		int random = (int) (System.nanoTime() & 0x7FFFFFFF) | 1;

		void clear() {
			count = 0;
			due = 0;
			item = null;
		}

		float random() {
			random = (int) ((random * 16807L) % 2147483647L);
			return random / 2147483647f;
		}

		/** Zeit weiterlaufen lassen, neue Partikel am Anker (Welt) bzw. an der Figur (Menü) */
		void update(CosmeticCatalog.Item item, double anchorX, double anchorY, double anchorZ, long now, boolean prewarm) {
			CosmeticFormat.Particles p = item.manifest().particles();
			if (this.item != item) {
				clear();
				this.item = item;
				last = now;
				if (prewarm) {
					// gleich voll: eine Lebensdauer im Voraus laufen lassen (wie im Launcher)
					for (float s = 0; s < p.lifetime() / 20f; s += 0.05f) step(p, 0.05f, anchorX, anchorY, anchorZ);
				}
			}
			double dt = Math.min(0.25, (now - last) / 1e9);
			last = now;
			if (dt > 0) step(p, (float) dt, anchorX, anchorY, anchorZ);
		}

		void step(CosmeticFormat.Particles p, float dt, double anchorX, double anchorY, double anchorZ) {
			for (int i = count - 1; i >= 0; i--) {
				age[i] += dt;
				if (age[i] >= life[i]) remove(i);
				else if (p.motion().equals("orbit")) {
					ax[i] = anchorX;
					ay[i] = anchorY;
					az[i] = anchorZ;
				}
			}
			due += dt * p.rate();
			while (due >= 1) {
				due -= 1;
				if (count < MAX_PARTICLES) spawn(p, anchorX, anchorY, anchorZ);
			}
		}

		void spawn(CosmeticFormat.Particles p, double anchorX, double anchorY, double anchorZ) {
			int i = count++;
			float r = (float) p.radius() * 16f;
			age[i] = 0;
			life[i] = Math.max(0.25f, p.lifetime() / 20f) * (0.8f + 0.4f * random());
			angle[i] = random() * (float) (Math.PI * 2);
			dist[i] = r * (0.55f + 0.45f * random());
			height[i] = switch (p.motion()) {
				case "fall" -> 30 + random() * 8;
				case "rise" -> 1 + random() * 8;
				default -> 3 + random() * 28;
			};
			seed[i] = random() * 100;
			ax[i] = anchorX;
			ay[i] = anchorY;
			az[i] = anchorZ;
		}

		private void remove(int i) {
			int last = --count;
			age[i] = age[last];
			life[i] = life[last];
			angle[i] = angle[last];
			dist[i] = dist[last];
			height[i] = height[last];
			seed[i] = seed[last];
			ax[i] = ax[last];
			ay[i] = ay[last];
			az[i] = az[last];
		}
	}

	private static void submitAura(PoseStack pose, SubmitNodeCollector collector, AvatarRenderState state, Wearer wearer, CosmeticCatalog.Item item,
			boolean gui, CameraRenderState camera, long now) {
		Identifier texture = item.texture();
		if (texture == null) return;
		CosmeticFormat.Particles p = item.manifest().particles();
		Emitter emitter = gui ? wearer.gui : wearer.world;
		double baseX = gui ? 0 : state.x;
		double baseY = gui ? 0 : state.y;
		double baseZ = gui ? 0 : state.z;
		emitter.update(item, baseX, baseY, baseZ, now, gui);
		if (wearer.own) {
			Cosmetics.Effect effect = Cosmetics.effect("aura");
			if (effect != null && effect.kind().equals("burst") && emitter.burstHandled != effect.start()) {
				emitter.burstHandled = effect.start();
				for (int i = 0; i < 16 && emitter.count < MAX_PARTICLES; i++) emitter.spawn(p, baseX, baseY, baseZ);
			}
		}
		if (!gui) wearer.auraFrame = now;
		if (emitter.count == 0) return;

		// Achsen der Partikel (zur Kamera gedreht) im Raum der Pose
		Matrix4f m = pose.last().pose();
		if (gui) {
			// Menü: Bildschirm-Achsen zurück in den Raum der Figur; „oben“ zeigt nach oben an der Figur
			AXIS_A.set(m.m00(), m.m10(), m.m20()).normalize();
			AXIS_B.set(m.m01(), m.m11(), m.m21()).normalize();
			if (AXIS_B.y < 0) {
				AXIS_A.negate();
				AXIS_B.negate();
			}
		} else {
			Quaternionf q = camera.orientation;
			AXIS_A.set(1, 0, 0).rotate(q);
			AXIS_B.set(0, 1, 0).rotate(q);
		}
		ParticleDraw draw = nextParticles();
		float half = (float) p.size() / 2f;
		int frames = p.frames();
		int n = 0;
		for (int i = 0; i < emitter.count; i++) {
			float k = emitter.age[i] / emitter.life[i];
			float angle = emitter.angle[i];
			float dist = emitter.dist[i];
			float y = emitter.height[i];
			float age = emitter.age[i];
			float s = emitter.seed[i];
			switch (p.motion()) {
				case "rise" -> y += k * 28;
				case "fall" -> {
					y -= k * 30;
					angle += (float) Math.sin(s + age * 2.4) * 0.18f;
				}
				case "orbit" -> {
					angle += age * 1.8f;
					y += (float) Math.sin(s + age * 1.5) * 1.5f;
				}
				case "spark" -> dist += k * 4;
				default -> {
					y += (float) Math.sin(s + age * 1.3) * 2.5f;
					angle += age * 0.25f;
				}
			}
			int o = n * ParticleDraw.STRIDE;
			draw.data[o] = (float) (emitter.ax[i] - baseX) + (float) Math.cos(angle) * dist * PX;
			draw.data[o + 1] = (float) (emitter.ay[i] - baseY) + y * PX;
			draw.data[o + 2] = (float) (emitter.az[i] - baseZ) + (float) Math.sin(angle) * dist * PX;
			int frame = Math.min(frames - 1, (int) (k * frames));
			draw.data[o + 3] = (float) frame / frames;
			draw.data[o + 4] = (float) (frame + 1) / frames;
			// die letzten 15 % ausblenden
			draw.data[o + 5] = k > 0.85f ? Math.max(0f, (1f - k) / 0.15f) : 1f;
			n++;
		}
		draw.count = n;
		draw.half = half;
		draw.ax = AXIS_A.x;
		draw.ay = AXIS_A.y;
		draw.az = AXIS_A.z;
		draw.bx = AXIS_B.x;
		draw.by = AXIS_B.y;
		draw.bz = AXIS_B.z;
		draw.color = p.color();
		draw.light = p.fullbright() ? LightCoordsUtil.FULL_BRIGHT : state.lightCoords;
		collector.submitCustomGeometry(pose, RenderTypes.entityTranslucent(texture), draw);
	}

	private static final ParticleDraw[] PARTICLE_RING = new ParticleDraw[256];
	private static int particleIndex;

	private static ParticleDraw nextParticles() {
		int index = particleIndex = (particleIndex + 1) % PARTICLE_RING.length;
		ParticleDraw draw = PARTICLE_RING[index];
		if (draw == null) PARTICLE_RING[index] = draw = new ParticleDraw();
		return draw;
	}

	/** Partikel eines Trägers in einem Bild: Lage, Bild im Streifen, Deckkraft */
	private static final class ParticleDraw implements SubmitNodeCollector.CustomGeometryRenderer {
		static final int STRIDE = 6;
		final float[] data = new float[MAX_PARTICLES * STRIDE];
		int count;
		float half;
		float ax;
		float ay;
		float az;
		float bx;
		float by;
		float bz;
		int color;
		int light;

		@Override
		public void render(PoseStack.Pose pose, VertexConsumer consumer) {
			long start = System.nanoTime();
			emittedVertices += count * 4L;
			emitParticles(pose, consumer);
			emitNanos += System.nanoTime() - start;
		}

		private void emitParticles(PoseStack.Pose pose, VertexConsumer consumer) {
			Matrix4f m = pose.pose();
			Matrix3f nm = pose.normal();
			// Normale nach oben: Partikel werden gleichmäßig hell
			float nx = nm.m10();
			float ny = nm.m11();
			float nz = nm.m12();
			float length = (float) Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (length > 0) {
				nx /= length;
				ny /= length;
				nz /= length;
			}
			float rx = ax * half;
			float ry = ay * half;
			float rz = az * half;
			float ux = bx * half;
			float uy = by * half;
			float uz = bz * half;
			for (int i = 0; i < count; i++) {
				int o = i * STRIDE;
				float cx = data[o];
				float cy = data[o + 1];
				float cz = data[o + 2];
				float u0 = data[o + 3];
				float u1 = data[o + 4];
				int alpha = Math.round(Math.clamp(data[o + 5], 0f, 1f) * 255f);
				int argb = alpha << 24 | (color & 0xFFFFFF);
				vertex(consumer, m, cx - rx - ux, cy - ry - uy, cz - rz - uz, argb, u0, 1f, nx, ny, nz);
				vertex(consumer, m, cx + rx - ux, cy + ry - uy, cz + rz - uz, argb, u1, 1f, nx, ny, nz);
				vertex(consumer, m, cx + rx + ux, cy + ry + uy, cz + rz + uz, argb, u1, 0f, nx, ny, nz);
				vertex(consumer, m, cx - rx + ux, cy - ry + uy, cz - rz + uz, argb, u0, 0f, nx, ny, nz);
			}
		}

		private void vertex(VertexConsumer consumer, Matrix4f m, float x, float y, float z, int argb, float u, float v, float nx, float ny, float nz) {
			consumer.addVertex(m.m00() * x + m.m10() * y + m.m20() * z + m.m30(), m.m01() * x + m.m11() * y + m.m21() * z + m.m31(),
					m.m02() * x + m.m12() * y + m.m22() * z + m.m32(), argb, u, v, OverlayTexture.NO_OVERLAY, light, nx, ny, nz);
		}
	}

	// ======================================================================================
	// Für Tests
	// ======================================================================================

	/** Messwerte eines Trägers (nur Welt): Anker in Weltkoordinaten, Fingerabdruck der Pose, lebende Partikel */
	public record Probe(double[] head, float headPose, long headFrame, double[] back, float backPose, long backFrame, double[] companion,
			float companionPose, long companionFrame, int particles, long auraFrame, double flapFactor) {
	}

	/** Messwerte zum Spieler mit dieser UUID (null = noch nie gezeichnet) */
	public static Probe probe(UUID uuid) {
		Wearer w = WEARERS.get(uuid);
		if (w == null) return null;
		return new Probe(w.headAnchor.clone(), w.headPose, w.headFrame, w.backAnchor.clone(), w.backPose, w.backFrame, w.companionAnchor.clone(),
				w.companionPose, w.companionFrame, w.world.count, w.auraFrame, w.flapFactor);
	}

	/** lebende Partikel der Menüfigur bzw. des Inventars (für Tests) */
	public static int guiParticles(Object key) {
		Wearer w = WEARERS.get(key);
		return w == null ? -1 : w.gui.count;
	}
}
