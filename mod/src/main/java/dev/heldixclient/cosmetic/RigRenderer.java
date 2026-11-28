package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ParticleStatus;
import net.minecraft.util.LightCoordsUtil;
import net.minecraft.world.item.Items;
import org.joml.Matrix3f;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * Zeichnet Cosmetics im Format 2 (Meshes mit Knochen, {@link CosmeticRig}) an Spielern und Menüfiguren und erzeugt ihre
 * Minecraft-Partikel. Wird von {@link CosmeticRenderer} an denselben Stellen aufgerufen wie Format 1:
 * <ul>
 *   <li><b>head</b>, <b>back</b>, <b>companion</b> in {@code CapeLayer.submit} am posierten Spielermodell: Kopf bzw. Rumpf
 *       ({@code translateAndRotate}), dann 1/16 – das ist genau der Body-Modellraum der Vorlage (+X links, +Y unten,
 *       +Z hinten). Der Begleiter sitzt zusätzlich bei {@code attach.origin} und wird für die rechte Seite an x
 *       gespiegelt. Er folgt so dem Rumpf (auch beim Schleichen).</li>
 *   <li><b>aura</b> in {@code EntityRenderer.submit}: an der Position des Spielers, nur mit dem Body-Yaw gedreht (kippt
 *       nicht beim Schleichen, Schwimmen oder Elytra-Flug), gleiche Pixel-Koordinaten (Füße bei y = 24).</li>
 * </ul>
 *
 * <p>Je Bild zwei Durchgänge über {@code submitCustomGeometry}: Albedo mit {@code entityCutout} (ohne Rückseiten-Culling)
 * und Licht, danach nur die Vierecke mit leuchtenden Pixeln mit {@code eyes} (additiv, volle Helligkeit), Bild im
 * Streifen und Puls über die Vertexfarbe. Die Knochen-Matrizen entstehen beim Einreichen; die Vertices erst beim
 * Zeichnen, jeder Vertex einmal je Durchgang (gemeinsame Ecken der Vierecke werden wiederverwendet), in festen Feldern.
 *
 * <p>Partikel: an pivot bzw. tail eines Knochens mit der Knochen-Matrix des Bildes in Weltkoordinaten, als
 * Poisson-Prozess mit {@code perSecond}, nur in den Animationen aus {@code states}, über {@code level.addParticle} (damit
 * gilt die Partikel-Einstellung von Minecraft; bei „Minimal“ gar keine). Nicht in Menüs, nicht weiter als 48 Blöcke,
 * bei anderen Spielern nur mit „Auren anderer zeigen“.
 */
final class RigRenderer {
	static final int HEAD = 0;
	static final int BACK = 1;
	static final int AURA = 2;
	static final int COMPANION = 3;
	static final String[] SLOTS = {"head", "back", "aura", "companion"};
	/** Slots im Body-Raum (CapeLayer.submit) */
	private static final int[] BODY_SLOTS = {HEAD, BACK, COMPANION};
	/** Partikel und volle Bildrate der Pose nur bis zu dieser Entfernung (Blöcke) */
	static final double NEAR = 48;
	private static final float PX = 1f / 16f;
	private static final long EPOCH = System.nanoTime();

	private RigRenderer() {
	}

	// ======================================================================================
	// Träger: Animatoren je Slot
	// ======================================================================================

	/**
	 * Animatoren eines Trägers an seine Cosmetics anpassen und weiterstellen (einmal je Bild). Wechselt ein Slot, spielt
	 * das alte Cosmetic seine Animation zum Ablegen zu Ende, das neue seine zum Anlegen – nur in der Welt (nicht in Menüs),
	 * nicht beim ersten Sehen eines Spielers und nicht, wenn nur eine neue Version desselben Cosmetics kommt.
	 */
	static void sync(CosmeticRenderer.Wearer w, long now, double distanceSq) {
		if (now - w.rigSync < 2_000_000L && w.rigSync != 0) return;
		w.rigSync = now;
		if (w.player != null) {
			if (w.motion == null) w.motion = RigMotion.create();
			w.motion.update(w.player, w.own);
		}
		HeldixConfig.Data config = HeldixConfig.get();
		boolean transitions = w.dress == null && !w.fresh && (w.own || config.cosmeticsOthers);
		boolean far = w.dress == null && !w.own && distanceSq > NEAR * NEAR;
		for (int i = 0; i < 4; i++) {
			CosmeticCatalog.Item worn = i == HEAD ? w.head : i == BACK ? w.back : i == AURA ? w.aura : w.companion;
			CosmeticCatalog.Item target = worn != null && worn.rig() != null ? worn : null;
			RigAnimator a = w.rigs[i];
			CosmeticCatalog.Item current = a == null ? null : a.item;
			if (target != current) {
				boolean sameId = current != null && target != null && current.id().equals(target.id());
				boolean animate = transitions && !sameId;
				if (a != null && animate) {
					a.leave();
					if (!a.done) w.leaving[i] = a;
				}
				if (target != null) {
					a = new RigAnimator(target);
					if (animate) a.intro();
				} else a = null;
				w.rigs[i] = a;
			}
			if (a != null) {
				int forced = -1;
				if (w.dress != null) {
					// Menü: beim Darüberfahren (Vorschau eines anderen Cosmetics als des getragenen) die Show-Animation
					if (!a.item.id().equals(Cosmetics.own(SLOTS[i]))) forced = RigMotion.EMOTE;
				} else if (w.own && RigMotion.ownEmote()) forced = RigMotion.EMOTE;
				if (forced >= 0 && !a.has(forced)) forced = -1;
				if (w.own) {
					// Effekte der Addon-API: flap und burst jubeln, spin und bounce bewegen das ganze Cosmetic
					Cosmetics.Effect effect = Cosmetics.effect(SLOTS[i]);
					if (effect != null && effect.start() != a.seenEffect && (effect.kind().equals("flap") || effect.kind().equals("burst"))) {
						a.seenEffect = effect.start();
						a.trigger(RigMotion.CELEBRATE);
					}
				}
				a.update(now, w.motion, forced, far);
				if (w.dress != null) {
					// Messwerte der Menüfigur (für Tests)
					MENU_ID[i] = a.item.id();
					MENU_CLIP[i] = a.clipName();
					MENU_NANOS[i] = now;
				}
			}
			RigAnimator leaving = w.leaving[i];
			if (leaving != null) {
				leaving.update(now, null, -1, far);
				if (leaving.done) w.leaving[i] = null;
			}
		}
		w.fresh = false;
	}

	/** Etwas im Format 2 an diesem Träger zu zeichnen? */
	static boolean any(CosmeticRenderer.Wearer w) {
		for (int i = 0; i < 4; i++) if (w.rigs[i] != null || w.leaving[i] != null) return true;
		return false;
	}

	// ======================================================================================
	// Kopf, Rücken, Begleiter (CapeLayer.submit)
	// ======================================================================================

	static void layer(PlayerModel model, PoseStack pose, SubmitNodeCollector collector, int light, AvatarRenderState state, CosmeticRenderer.Wearer w) {
		HeldixConfig.Data config = HeldixConfig.get();
		boolean helmet = !state.headEquipment.isEmpty();
		for (int slot : BODY_SLOTS) {
			if (slot == HEAD && helmet && !config.cosmeticHatOverHelmet) continue;
			for (int k = 0; k < 2; k++) {
				RigAnimator a = k == 0 ? w.rigs[slot] : w.leaving[slot];
				if (a == null || a.done) continue;
				pose.pushPose();
				model.root().translateAndRotate(pose);
				if (slot == HEAD) {
					// am Kopf (folgt dem Blick); Ursprung wie beim Rumpf am Hals, über einem Helm einen Pixel höher
					model.head.translateAndRotate(pose);
					if (helmet) pose.translate(0f, -PX, 0f);
				} else {
					model.body.translateAndRotate(pose);
					// mit Brustpanzer einen Pixel weiter nach hinten (wie das Cape)
					if (slot == BACK && !state.chestEquipment.isEmpty() && !state.chestEquipment.is(Items.ELYTRA)) pose.translate(0f, 0f, PX);
				}
				pose.scale(PX, PX, PX);
				if (a.rig.mirrored) pose.scale(-1f, 1f, 1f);
				if (a.rig.origin != null) pose.translate(a.rig.origin[0], a.rig.origin[1], a.rig.origin[2]);
				applyEffect(pose, w, slot);
				submit(collector, pose, a, light);
				a.pendingPose.set(pose.last().pose());
				a.pending = true;
				pose.popPose();
			}
		}
	}

	/** Effekte der Addon-API am eigenen Cosmetic: spin dreht einmal um die Hochachse, bounce hüpft (Modellraum: +Y unten) */
	private static void applyEffect(PoseStack pose, CosmeticRenderer.Wearer w, int slot) {
		if (!w.own) return;
		Cosmetics.Effect effect = Cosmetics.effect(SLOTS[slot]);
		if (effect == null) return;
		double p = Math.clamp(effect.progress(System.nanoTime()), 0, 1);
		switch (effect.kind()) {
			case "spin" -> pose.rotateDegrees(Axis.YP, (float) (360 * (p * p * (3 - 2 * p))));
			case "bounce" -> pose.translate(0f, (float) (-Math.abs(Math.sin(p * Math.PI * 2)) * 4 * (1 - p)), 0f);
			default -> {
			}
		}
	}

	// ======================================================================================
	// Aura und Bestätigung (EntityRenderer.submit)
	// ======================================================================================

	/**
	 * Anfang von EntityRenderer.submit: Aura zeichnen; in der Welt die Partikel und Messwerte der Cosmetics aus
	 * {@link #layer} bestätigen (erst hier ist bekannt, ob es die Welt oder ein Menü ist).
	 */
	static void entity(PoseStack pose, SubmitNodeCollector collector, AvatarRenderState state, CosmeticRenderer.Wearer w, boolean gui, CameraRenderState camera,
			long now) {
		boolean particles = !gui && (w.own || HeldixConfig.get().cosmeticParticlesOthers) && state.distanceToCameraSq <= NEAR * NEAR;
		for (int slot : BODY_SLOTS) {
			for (int k = 0; k < 2; k++) {
				RigAnimator a = k == 0 ? w.rigs[slot] : w.leaving[slot];
				if (a == null || !a.pending) continue;
				a.pending = false;
				if (!gui) commit(a, camera, particles, now, slot);
			}
		}
		for (int k = 0; k < 2; k++) {
			RigAnimator a = k == 0 ? w.rigs[AURA] : w.leaving[AURA];
			if (a == null || a.done) continue;
			pose.pushPose();
			float scale = state.scale > 0 ? state.scale : 1f;
			// AvatarRenderer senkt schleichende Spieler um 2 Pixel ab – die Aura bleibt am Boden
			if (state.isCrouching) pose.translate(0f, 2f / 16f * scale, 0f);
			// wie das Spielermodell (LivingEntityRenderer), aber nur mit dem Body-Yaw: kein Kippen
			pose.rotate(Axis.YP, (float) Math.toRadians(180f - state.bodyRot));
			float s = scale * 0.9375f;
			pose.scale(-s, -s, s);
			pose.translate(0f, -1.501f, 0f);
			pose.scale(PX, PX, PX);
			applyEffect(pose, w, AURA);
			submit(collector, pose, a, state.lightCoords);
			if (!gui) {
				a.pendingPose.set(pose.last().pose());
				commit(a, camera, particles, now, AURA);
			}
			pose.popPose();
		}
	}

	private static final Vector3f POINT = new Vector3f();

	/** In der Welt: Messwerte (Anker, Wurzel-Knochen) und Partikel aus der gemerkten Lage */
	private static void commit(RigAnimator a, CameraRenderState camera, boolean particles, long now, int slot) {
		Matrix4f m = a.pendingPose;
		double cx = camera.pos.x;
		double cy = camera.pos.y;
		double cz = camera.pos.z;
		m.transformPosition(0f, slot == AURA ? 24f : 0f, 0f, POINT);
		a.anchor[0] = cx + POINT.x;
		a.anchor[1] = cy + POINT.y;
		a.anchor[2] = cz + POINT.z;
		CosmeticRig rig = a.rig;
		a.world[0].transformPosition(rig.pivot[0], rig.pivot[1], rig.pivot[2], POINT);
		m.transformPosition(POINT);
		a.rootPivot[0] = cx + POINT.x;
		a.rootPivot[1] = cy + POINT.y;
		a.rootPivot[2] = cz + POINT.z;
		a.frame = now;
		double elapsed = a.clock - a.particleClock;
		a.particleClock = a.clock;
		if (!particles || rig.particles.length == 0 || elapsed <= 0) return;
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null) return;
		boolean minimal = mc.options.particles().get() == ParticleStatus.MINIMAL;
		for (int i = 0; i < rig.particles.length; i++) {
			CosmeticRig.Particle p = rig.particles[i];
			if (!a.active(p)) continue;
			a.nextParticle[i] -= elapsed;
			int guard = 0;
			while (a.nextParticle[i] <= 0 && guard++ < 8) {
				a.nextParticle[i] += a.interval(p.perSecond);
				if (minimal) continue;
				spawn(mc, a, p, p.bone, m, cx, cy, cz);
			}
			// nach einer langen Pause nicht alles nachholen
			if (a.nextParticle[i] <= 0) a.nextParticle[i] = a.interval(p.perSecond);
		}
	}

	private static void spawn(Minecraft mc, RigAnimator a, CosmeticRig.Particle p, int bone, Matrix4f pose, double cx, double cy, double cz) {
		float[] point = p.tail ? a.rig.tail : a.rig.pivot;
		a.world[bone].transformPosition(point[bone * 3], point[bone * 3 + 1], point[bone * 3 + 2], POINT);
		pose.transformPosition(POINT);
		double vx = (a.random.nextDouble() - 0.5) * 0.02;
		double vy = a.random.nextDouble() * 0.02;
		double vz = (a.random.nextDouble() - 0.5) * 0.02;
		mc.level.addParticle(options(p), cx + POINT.x, cy + POINT.y, cz + POINT.z, vx, vy, vz);
		a.particlesSpawned++;
	}

	/** Minecraft-Partikel zum Namen (einmal je Eintrag aufgelöst) */
	static ParticleOptions options(CosmeticRig.Particle p) {
		if (p.options instanceof ParticleOptions o) return o;
		ParticleOptions o = switch (p.particle) {
			case "flame" -> ParticleTypes.FLAME;
			case "small_flame" -> ParticleTypes.SMALL_FLAME;
			case "soul_fire_flame" -> ParticleTypes.SOUL_FIRE_FLAME;
			case "smoke" -> ParticleTypes.SMOKE;
			case "electric_spark" -> ParticleTypes.ELECTRIC_SPARK;
			case "dust" -> new DustParticleOptions(p.color >= 0 ? p.color : 0xFFFFFF, 1.0f);
			case "heart" -> ParticleTypes.HEART;
			case "note" -> ParticleTypes.NOTE;
			case "happy_villager" -> ParticleTypes.HAPPY_VILLAGER;
			case "cloud" -> ParticleTypes.CLOUD;
			case "poof" -> ParticleTypes.POOF;
			case "snowflake" -> ParticleTypes.SNOWFLAKE;
			case "spore_blossom_air" -> ParticleTypes.SPORE_BLOSSOM_AIR;
			case "crit" -> ParticleTypes.CRIT;
			case "enchant" -> ParticleTypes.ENCHANT;
			case "portal" -> ParticleTypes.PORTAL;
			case "witch" -> ParticleTypes.WITCH;
			case "glow" -> ParticleTypes.GLOW;
			case "falling_water" -> ParticleTypes.FALLING_WATER;
			case "dripping_water" -> ParticleTypes.DRIPPING_WATER;
			case "firework" -> ParticleTypes.FIREWORK;
			case "cherry_leaves" -> ParticleTypes.CHERRY_LEAVES;
			case "ash" -> ParticleTypes.ASH;
			case "white_ash" -> ParticleTypes.WHITE_ASH;
			case "soul" -> ParticleTypes.SOUL;
			case "sculk_soul" -> ParticleTypes.SCULK_SOUL;
			case "lava" -> ParticleTypes.LAVA;
			case "falling_spore_blossom" -> ParticleTypes.FALLING_SPORE_BLOSSOM;
			case "wax_on" -> ParticleTypes.WAX_ON;
			case "wax_off" -> ParticleTypes.WAX_OFF;
			case "bubble_pop" -> ParticleTypes.BUBBLE_POP;
			case "composter" -> ParticleTypes.COMPOSTER;
			case "totem_of_undying" -> ParticleTypes.TOTEM_OF_UNDYING;
			case "reverse_portal" -> ParticleTypes.REVERSE_PORTAL;
			default -> ParticleTypes.END_ROD;
		};
		p.options = o;
		return o;
	}

	// ======================================================================================
	// Einreichen und Zeichnen
	// ======================================================================================

	private static void submit(SubmitNodeCollector collector, PoseStack pose, RigAnimator a, int light) {
		CosmeticCatalog.Item item = a.item;
		Identifier texture = item.texture();
		if (texture == null) return;
		RigDraw draw = next();
		draw.prepare(a.rig, a.world, light, false, 0f, 1f, -1);
		collector.submitCustomGeometry(pose, RenderTypes.entityCutout(texture), draw);
		Identifier glow = item.glow();
		CosmeticRig rig = a.rig;
		if (glow != null && rig.glowCount > 0) {
			double seconds = (System.nanoTime() - EPOCH) / 1e9;
			long ticks = (long) (seconds * 20);
			int frame = (int) ((ticks / rig.frametimeTicks) % rig.glowFrames);
			double pulse = rig.pulseMin + (rig.pulseMax - rig.pulseMin) * (0.5 + 0.5 * Math.sin(2 * Math.PI * seconds / rig.pulsePeriod));
			int c = Math.clamp((int) Math.round(pulse * 255), 0, 255);
			RigDraw glowDraw = next();
			// dieselbe Pose wie der Albedo-Durchgang
			glowDraw.prepare(rig, a.world, LightCoordsUtil.FULL_BRIGHT, true, frame, 1f / rig.glowFrames, 0xFF000000 | c << 16 | c << 8 | c);
			collector.submitCustomGeometry(pose, RenderTypes.eyes(glow), glowDraw);
		}
	}

	/**
	 * Wiederverwendete Einreichungen: Ein Eintrag wird erst wieder vergeben, wenn er gezeichnet wurde (oder seit einer
	 * Sekunde wartet, etwa weil Minecraft ihn verworfen hat). Sonst wächst der Vorrat – so überschreibt auch eine Menge
	 * Spieler keine Einreichung, bevor sie gezeichnet ist.
	 */
	private static final java.util.ArrayList<RigDraw> POOL = new java.util.ArrayList<>();
	private static final int POOL_MAX = 8192;
	private static int cursor;

	private static RigDraw next() {
		long now = System.nanoTime();
		if (!POOL.isEmpty()) {
			cursor %= POOL.size();
			RigDraw draw = POOL.get(cursor);
			if (draw.drawn || now - draw.prepared > 1_000_000_000L || POOL.size() >= POOL_MAX) {
				cursor++;
				draw.drawn = false;
				draw.prepared = now;
				return draw;
			}
		}
		RigDraw draw = new RigDraw();
		draw.prepared = now;
		POOL.add(Math.min(cursor, POOL.size()), draw);
		cursor++;
		return draw;
	}

	/** Eine Einreichung: Knochen-Matrizen (beim Einreichen kopiert), Licht, Durchgang; zeichnet beim Ausführen */
	private static final class RigDraw implements SubmitNodeCollector.CustomGeometryRenderer {
		CosmeticRig rig;
		Matrix4f[] own = new Matrix4f[0];
		Matrix4f[] bones;
		int light;
		boolean glow;
		float frame;
		float frameScale;
		int color;
		/** schon gezeichnet (darf wieder vergeben werden) und wann zuletzt vergeben */
		boolean drawn = true;
		long prepared;

		void prepare(CosmeticRig rig, Matrix4f[] source, int light, boolean glow, float frame, float frameScale, int color) {
			this.rig = rig;
			this.light = light;
			this.glow = glow;
			this.frame = frame;
			this.frameScale = frameScale;
			this.color = color;
			// eigene Kopie der Matrizen (auch im Glow-Pass): unabhängig davon, wann Minecraft welchen Durchgang zeichnet
			int n = rig.boneCount;
			if (own.length < n) {
				Matrix4f[] grown = java.util.Arrays.copyOf(own, n);
				for (int i = own.length; i < n; i++) grown[i] = new Matrix4f();
				own = grown;
			}
			for (int b = 0; b < n; b++) own[b].set(source[b]);
			bones = own;
		}

		@Override
		public void render(PoseStack.Pose pose, VertexConsumer consumer) {
			if (rig == null || bones == null) return;
			long start = System.nanoTime();
			int quads = glow ? rig.glowCount : rig.quadCount;
			CosmeticRenderer.emittedVertices += quads * 4L;
			emit(pose, consumer, this);
			drawn = true;
			CosmeticRenderer.emitNanos += System.nanoTime() - start;
		}
	}

	// feste Felder für das Zeichnen (nur Render-Thread): Matrizen je Knochen und umgerechnete Vertices
	private static float[] boneM = new float[96 * 12];
	private static float[] boneN = new float[96 * 9];
	private static int[] stamp = new int[0];
	private static float[] out = new float[0];
	private static int stampValue;
	private static final float[] BLEND_M = new float[12];
	private static final float[] BLEND_N = new float[9];
	private static final Matrix4f FULL = new Matrix4f();
	private static final Matrix3f NORMAL = new Matrix3f();
	private static final Matrix3f BONE_NORMAL = new Matrix3f();

	private static void emit(PoseStack.Pose pose, VertexConsumer consumer, RigDraw draw) {
		CosmeticRig rig = draw.rig;
		Matrix4f[] bones = draw.bones;
		int n = rig.boneCount;
		if (boneM.length < n * 12) {
			boneM = new float[n * 12];
			boneN = new float[n * 9];
		}
		Matrix4f p = pose.pose();
		Matrix3f np = pose.normal();
		for (int b = 0; b < n; b++) {
			Matrix4f m = FULL.set(p).mul(bones[b]);
			int o = b * 12;
			boneM[o] = m.m00();
			boneM[o + 1] = m.m01();
			boneM[o + 2] = m.m02();
			boneM[o + 3] = m.m10();
			boneM[o + 4] = m.m11();
			boneM[o + 5] = m.m12();
			boneM[o + 6] = m.m20();
			boneM[o + 7] = m.m21();
			boneM[o + 8] = m.m22();
			boneM[o + 9] = m.m30();
			boneM[o + 10] = m.m31();
			boneM[o + 11] = m.m32();
			Matrix3f nm = NORMAL.set(np).mul(bones[b].get3x3(BONE_NORMAL));
			o = b * 9;
			boneN[o] = nm.m00();
			boneN[o + 1] = nm.m01();
			boneN[o + 2] = nm.m02();
			boneN[o + 3] = nm.m10();
			boneN[o + 4] = nm.m11();
			boneN[o + 5] = nm.m12();
			boneN[o + 6] = nm.m20();
			boneN[o + 7] = nm.m21();
			boneN[o + 8] = nm.m22();
		}
		int vertices = rig.vertexCount;
		if (stamp.length < vertices) {
			stamp = new int[vertices];
			out = new float[vertices * 6];
			stampValue = 0;
		}
		if (++stampValue == Integer.MAX_VALUE) {
			java.util.Arrays.fill(stamp, 0);
			stampValue = 1;
		}
		int current = stampValue;
		float[] pos = rig.pos;
		float[] nrm = rig.nrm;
		float[] uv = rig.uv;
		int[] vertexBone = rig.vertexBone;
		int[] soft = rig.softIndex;
		int[] quads = rig.quads;
		int[] list = rig.glowQuads;
		boolean glow = draw.glow;
		int count = glow ? rig.glowCount : rig.quadCount;
		int color = draw.color;
		int light = draw.light;
		int overlay = OverlayTexture.NO_OVERLAY;
		float frame = draw.frame;
		float frameScale = draw.frameScale;
		for (int k = 0; k < count; k++) {
			int q = (glow ? list[k] : k) * 4;
			for (int j = 0; j < 4; j++) {
				int v = quads[q + j];
				int o = v * 6;
				if (stamp[v] != current) {
					stamp[v] = current;
					float[] mm = boneM;
					float[] nn = boneN;
					int mo;
					int no;
					int s = soft == null ? -1 : soft[v];
					if (s < 0) {
						mo = vertexBone[v] * 12;
						no = vertexBone[v] * 9;
					} else {
						// weiche Haut: Matrizen der (bis zu vier) Knochen nach Gewicht mischen
						java.util.Arrays.fill(BLEND_M, 0f);
						java.util.Arrays.fill(BLEND_N, 0f);
						for (int i = 0; i < 4; i++) {
							float w = rig.softWeight[s * 4 + i];
							if (w <= 0) continue;
							int jm = rig.softJoint[s * 4 + i] * 12;
							int jn = rig.softJoint[s * 4 + i] * 9;
							for (int c = 0; c < 12; c++) BLEND_M[c] += boneM[jm + c] * w;
							for (int c = 0; c < 9; c++) BLEND_N[c] += boneN[jn + c] * w;
						}
						mm = BLEND_M;
						nn = BLEND_N;
						mo = 0;
						no = 0;
					}
					float x = pos[v * 3];
					float y = pos[v * 3 + 1];
					float z = pos[v * 3 + 2];
					out[o] = mm[mo] * x + mm[mo + 3] * y + mm[mo + 6] * z + mm[mo + 9];
					out[o + 1] = mm[mo + 1] * x + mm[mo + 4] * y + mm[mo + 7] * z + mm[mo + 10];
					out[o + 2] = mm[mo + 2] * x + mm[mo + 5] * y + mm[mo + 8] * z + mm[mo + 11];
					float nx = nrm[v * 3];
					float ny = nrm[v * 3 + 1];
					float nz = nrm[v * 3 + 2];
					float tx = nn[no] * nx + nn[no + 3] * ny + nn[no + 6] * nz;
					float ty = nn[no + 1] * nx + nn[no + 4] * ny + nn[no + 7] * nz;
					float tz = nn[no + 2] * nx + nn[no + 5] * ny + nn[no + 8] * nz;
					float length = (float) Math.sqrt(tx * tx + ty * ty + tz * tz);
					if (length > 1e-6f) {
						tx /= length;
						ty /= length;
						tz /= length;
					}
					out[o + 3] = tx;
					out[o + 4] = ty;
					out[o + 5] = tz;
				}
				float u = uv[v * 2];
				float tv = uv[v * 2 + 1];
				if (glow) tv = (tv + frame) * frameScale;
				consumer.addVertex(out[o], out[o + 1], out[o + 2], color, u, tv, overlay, light, out[o + 3], out[o + 4], out[o + 5]);
			}
		}
	}

	// ======================================================================================
	// Für Tests
	// ======================================================================================

	/**
	 * Messwerte eines Cosmetics im Format 2 (nur Welt): Zustand und Animation, Überblenden, Anker (Rücken/Kopf: Hals-Pivot,
	 * Begleiter: attach.origin, Aura: Füße) und Pivot des ersten Knochens in Weltkoordinaten, Fingerabdruck der Pose,
	 * Zeitpunkt des letzten Bildes in der Welt, erzeugte Partikel; leaving = spielt gerade die Animation zum Ablegen.
	 */
	public record Probe(String id, String state, String clip, boolean blending, boolean oneShot, double[] anchor, double[] rootPivot, float pose, long frame,
			long particles, boolean leaving) {
	}

	static Probe probe(CosmeticRenderer.Wearer w, int slot) {
		RigAnimator a = w.rigs[slot] != null ? w.rigs[slot] : w.leaving[slot];
		if (a == null) return null;
		return new Probe(a.item.id(), CosmeticFormat.STATE_KEYS.get(a.state), a.clipName(), a.blending, a.oneShot, a.anchor.clone(), a.rootPivot.clone(),
				a.fingerprint(), a.frame, a.particlesSpawned, a.leaving);
	}

	private static final String[] MENU_ID = new String[4];
	private static final String[] MENU_CLIP = new String[4];
	private static final long[] MENU_NANOS = new long[4];

	/** Cosmetic und Animation der zuletzt gezeichneten Menüfigur im Slot ({id, Animation}), null = seit 1 s keine */
	static String[] menu(String slot) {
		int i = slotIndex(slot);
		if (MENU_ID[i] == null || System.nanoTime() - MENU_NANOS[i] > 1_000_000_000L) return null;
		return new String[] {MENU_ID[i], MENU_CLIP[i]};
	}

	static int slotIndex(String slot) {
		for (int i = 0; i < SLOTS.length; i++) if (SLOTS[i].equals(slot)) return i;
		throw new IllegalArgumentException("Unbekannter Slot „" + slot + "“");
	}
}
