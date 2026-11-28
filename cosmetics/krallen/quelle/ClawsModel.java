package dev.heldixclient.addons.claws.test;

import net.minecraft.client.model.Model;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.client.renderer.rendertype.RenderTypes;

/**
 * Vier Tentakel-Krallen aus dem unteren Rücken (eigener Entwurf, frei nach Rinkaku-Kagune; in Blockbench gebaut:
 * tools/blockbench/krallen.bbmodel). Je Kralle neun sich verjüngende Glieder aus Fleisch mit Leuchtadern, darauf
 * überlappende Knochenschuppen, Dornen an jedem zweiten Glied und eine Hakenklinge. Die oberen steigen hinter dem Kopf
 * auf und krümmen sich nach vorn, die unteren schwingen nach hinten aus. Texturgröße 128x64 (Bilder 512x256).
 * Die Ruhepose kommt aus Blockbench; {@link #setupAnim} setzt zuerst auf sie zurück (Model.setupAnim) und addiert die
 * Bewegung aus {@link Pose}.
 */
final class ClawsModel extends Model<ClawsModel.Pose> {
	static final int CLAWS = 4, SEGS = 9;
	/** Richtung „nach außen“ für zRot: Kralle 0/2 rechts (−x), 1/3 links (+x) */
	static final float[] OUT = {-1f, 1f, -1f, 1f};

	/** Glieder je Kralle: [Kralle][Glied 0..8] */
	private final ModelPart[][] segs = new ModelPart[CLAWS][SEGS];
	private final ModelPart[] tips = new ModelPart[CLAWS];

	ClawsModel(ModelPart root) {
		super(root, RenderTypes::entityCutout);
		for (int i = 0; i < CLAWS; i++) {
			ModelPart part = root.getChild("kralle" + i + "_g0");
			segs[i][0] = part;
			for (int k = 1; k < SEGS; k++) {
				part = part.getChild("kralle" + i + "_g" + k);
				segs[i][k] = part;
			}
			tips[i] = part.getChild("kralle" + i + "_spitze");
		}
	}

	/** Abweichung von der Ruhepose (Bogenmaß): Wurzel (x = aufrichten, z), Krümmung und Seitenschwung je Glied, Spitze */
	static final class Pose {
		final float[] rootX = new float[CLAWS];
		final float[] rootZ = new float[CLAWS];
		final float[][] curl = new float[CLAWS][SEGS];
		final float[][] sway = new float[CLAWS][SEGS];
		final float[] tip = new float[CLAWS];
	}

	@Override
	public void setupAnim(Pose pose) {
		super.setupAnim(pose);   // zurück auf die Ruhepose
		for (int i = 0; i < CLAWS; i++) {
			segs[i][0].xRot += pose.rootX[i];
			segs[i][0].zRot += pose.rootZ[i];
			for (int k = 1; k < SEGS; k++) {
				segs[i][k].xRot += pose.curl[i][k];
				segs[i][k].zRot += pose.sway[i][k];
			}
			tips[i].xRot += pose.tip[i];
		}
	}

	/**
	 * Bewegung. Im Stand die bestätigte ruhige Welle; beim Laufen seitliches Mitschwingen (links/rechts gegenläufig),
	 * Wippen im Schritt und beim Rennen leichtes Vorneigen; beim Schleichen enger; Sitzen ({@code sit}) entspannt nach
	 * hinten; „Krallen zeigen“ ({@code flare}) aufgerichtet, weit gespreizt, zitternd. Steht der Spieler AFK
	 * ({@code afk} 0..1), hat jede Kralle ihr eigenes Verhalten: 0 späht wie ein Schlangenkopf umher, 1 rollt sich
	 * immer wieder ein und aus, 2 sinkt ab und klopft ungeduldig mit der Spitze, 3 streckt sich und zuckt ab und zu.
	 */
	static Pose animate(float age, float walkSpeed, float walkPos, boolean crouching, float sit, float flare, float afk) {
		Pose pose = new Pose();
		float walk = Math.min(1f, walkSpeed * 1.6f);
		float s = smooth(sit);
		float f = smooth(flare);
		float a = smooth(afk);
		for (int i = 0; i < CLAWS; i++) {
			float o = OUT[i];
			float rx = (float) Math.sin(age * 0.05f + i * 1.7f) * 0.05f;
			float rz = 0f;
			if (crouching) {
				rx -= 0.15f;
				rz -= o * 0.06f;
			}
			if (walk > 0f) {
				float side = (i % 2 == 0) ? 0f : (float) Math.PI;
				rz += (float) Math.sin(walkPos * 0.6662f + side) * 0.10f * walk;
				rx += (float) Math.cos(walkPos * 1.3324f + i * 0.5f) * 0.05f * walk + 0.10f * walk * walk;
			}
			rx -= 0.3f * s;
			rz += o * 0.08f * s;
			float tremble = (float) Math.sin(age * 2.3f + i * 1.3f) * 0.03f;
			rx += (0.45f + tremble) * f;
			rz += o * 0.35f * f;
			float[] curl = pose.curl[i];
			float[] sway = pose.sway[i];
			// Glied-Wackeln wie die gelobte Fassung (dort 5 Gelenke mit 0,03/0,06), auf 8 Gelenke umgerechnet: gleich weiter Ausschlag
			for (int k = 1; k < SEGS; k++) {
				int part = k <= 3 ? 0 : k <= 6 ? 1 : 2;
				curl[k] = (float) Math.sin(age * 0.07f - part * 0.7f + i) * 0.019f
						+ (float) Math.sin(walkPos * 0.6662f - part * 0.7f + i) * 0.0375f * walk
						+ 0.04f * s - 0.05f * f;
			}
			if (a > 0f) {
				switch (i) {
					case 0 -> {   // Späher: aufgerichtet, der Kopf pendelt suchend hin und her
						rx += 0.12f * a;
						for (int k = 3; k < SEGS; k++) {
							sway[k] += ((float) Math.sin(age * 0.031f + k * 0.4f) * 0.6f
									+ (float) Math.sin(age * 0.083f + k * 0.3f) * 0.3f) * 0.12f * a;
							if (k >= 6) curl[k] += 0.08f * a;
						}
						pose.tip[i] += 0.2f * a;
					}
					case 1 -> {   // Einrollen: rollt sich langsam nach hinten zur Spirale, hält, rollt sich wieder aus
						float cyc = ((age + 37f) % 240f) / 240f;
						float coil = cyc < 0.25f ? smooth(cyc / 0.25f) : cyc < 0.5f ? 1f : cyc < 0.75f ? 1f - smooth((cyc - 0.5f) / 0.25f) : 0f;
						rx += 0.1f * a;
						for (int k = 1; k < SEGS; k++) {
							curl[k] -= (coil * 0.34f + (float) Math.sin(age * 1.7f + k) * 0.015f * coil) * a;
						}
						pose.tip[i] -= 0.4f * coil * a;
					}
					case 2 -> {   // Klopfen: sinkt Richtung Boden, die Spitze klopft dreimal, dann Pause
						rx -= 1.1f * a;
						for (int k = 1; k < SEGS; k++) curl[k] -= 0.07f * a;
						int beat = (int) Math.floor(age / 8f) % 5;
						float ph = (age % 8f) / 8f;
						float tap = beat < 3 ? (float) Math.pow(Math.max(0.0, Math.sin(ph * Math.PI)), 2) : 0f;
						curl[SEGS - 1] += 0.5f * tap * a;
						curl[SEGS - 2] += 0.25f * tap * a;
						pose.tip[i] += (0.2f + 0.6f * tap) * a;
					}
					default -> {   // Strecken und Zucken: streckt sich langsam aus, zuckt ab und zu kurz zur Seite
						float st = 0.5f - 0.5f * (float) Math.cos(age * (2f * Math.PI / 300f));
						rx += 0.25f * st * a;
						rz += o * 0.3f * st * a;
						for (int k = 1; k < SEGS; k++) curl[k] -= 0.08f * st * a;
						int slot = (int) Math.floor(age / 23f);
						float local = age - slot * 23f;
						if (hash(slot) < 0.4f && local < 6f) {
							float amp = (1f - local / 6f) * 0.35f * (hash(slot + 7) > 0.5f ? 1f : -1f);
							for (int k = 4; k < SEGS; k++) sway[k] += amp * (float) Math.sin(local * 2.5f) * a;
						}
					}
				}
			}
			pose.rootX[i] = rx;
			pose.rootZ[i] = rz;
		}
		return pose;
	}

	private static float smooth(float t) {
		t = Math.clamp(t, 0f, 1f);
		return t * t * (3f - 2f * t);
	}

	/** gleichmäßig verteilte Zufallszahl 0..1 aus einer ganzen Zahl (fest, damit alle Bilder gleich zucken) */
	static float hash(int n) {
		int h = n * 374761393 + 668265263;
		h = (h ^ (h >>> 13)) * 1274126177;
		return ((h ^ (h >>> 16)) >>> 8) / (float) (1 << 24);
	}

	/** Mesh aus Blockbench (Modded Entity, Mojang-Namen), ohne die Maßfigur */
	static ClawsModel create() {
		MeshDefinition mesh = new MeshDefinition();
		PartDefinition root = mesh.getRoot();
		PartDefinition kralle0_g0 = root.addOrReplaceChild("kralle0_g0", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, CubeDeformation.NONE)
			.texOffs(56, 0).addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(-1.5F, 8.0F, 2.6F, -0.6632F, 0.0F, -0.384F));
		PartDefinition kralle0_g1 = kralle0_g0.addOrReplaceChild("kralle0_g1", CubeListBuilder.create().texOffs(12, 0).addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, new CubeDeformation(0.04F))
			.texOffs(64, 0).addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1047F, 0.0F, 0.0F));
		kralle0_g1.addOrReplaceChild("kralle0_dorn1", CubeListBuilder.create().texOffs(106, 0).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -2.4F, 1.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle0_g2 = kralle0_g1.addOrReplaceChild("kralle0_g2", CubeListBuilder.create().texOffs(24, 0).addBox(-1.0F, -4.5F, -1.0F, 2.0F, 5.0F, 2.0F, CubeDeformation.NONE)
			.texOffs(72, 0).addBox(-1.0F, -4.5F, 0.5F, 2.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1396F, 0.0F, 0.0F));
		PartDefinition kralle0_g3 = kralle0_g2.addOrReplaceChild("kralle0_g3", CubeListBuilder.create().texOffs(32, 0).addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F))
			.texOffs(88, 0).addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1745F, 0.0F, 0.0F));
		kralle0_g3.addOrReplaceChild("kralle0_dorn3", CubeListBuilder.create().texOffs(110, 0).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle0_g4 = kralle0_g3.addOrReplaceChild("kralle0_g4", CubeListBuilder.create().texOffs(40, 0).addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, CubeDeformation.NONE)
			.texOffs(94, 0).addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		PartDefinition kralle0_g5 = kralle0_g4.addOrReplaceChild("kralle0_g5", CubeListBuilder.create().texOffs(48, 0).addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F))
			.texOffs(100, 0).addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		kralle0_g5.addOrReplaceChild("kralle0_dorn5", CubeListBuilder.create().texOffs(114, 0).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle0_g6 = kralle0_g5.addOrReplaceChild("kralle0_g6", CubeListBuilder.create().texOffs(84, 0).addBox(-0.5F, -3.5F, -0.5F, 1.0F, 4.0F, 1.0F, CubeDeformation.NONE)
			.texOffs(118, 0).addBox(-0.5F, -3.5F, 0.0F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2443F, 0.0F, 0.0F));
		PartDefinition kralle0_g7 = kralle0_g6.addOrReplaceChild("kralle0_g7", CubeListBuilder.create().texOffs(122, 0).addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.04F))
			.texOffs(8, 8).addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2443F, 0.0F, 0.0F));
		kralle0_g7.addOrReplaceChild("kralle0_dorn7", CubeListBuilder.create().texOffs(0, 8).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -1.2F, 0.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle0_g8 = kralle0_g7.addOrReplaceChild("kralle0_g8", CubeListBuilder.create().texOffs(4, 8).addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, CubeDeformation.NONE)
			.texOffs(12, 8).addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.2793F, 0.0F, 0.0F));
		PartDefinition kralle0_spitze = kralle0_g8.addOrReplaceChild("kralle0_spitze", CubeListBuilder.create().texOffs(78, 0).addBox(-0.5F, -3.0F, -1.0F, 1.0F, 3.0F, 2.0F, new CubeDeformation(0.09F)), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.3491F, 0.0F, 0.0F));
		kralle0_spitze.addOrReplaceChild("kralle0_haken", CubeListBuilder.create().texOffs(16, 8).addBox(-0.5F, -2.0F, -0.5F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.7854F, 0.0F, 0.0F));
		PartDefinition kralle1_g0 = root.addOrReplaceChild("kralle1_g0", CubeListBuilder.create().texOffs(0, 0).mirror().addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(56, 0).mirror().addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(1.5F, 8.0F, 2.6F, -0.6632F, 0.0F, 0.384F));
		PartDefinition kralle1_g1 = kralle1_g0.addOrReplaceChild("kralle1_g1", CubeListBuilder.create().texOffs(12, 0).mirror().addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(64, 0).mirror().addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1047F, 0.0F, 0.0F));
		kralle1_g1.addOrReplaceChild("kralle1_dorn1", CubeListBuilder.create().texOffs(106, 0).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -2.4F, 1.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle1_g2 = kralle1_g1.addOrReplaceChild("kralle1_g2", CubeListBuilder.create().texOffs(24, 0).mirror().addBox(-1.0F, -4.5F, -1.0F, 2.0F, 5.0F, 2.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(72, 0).mirror().addBox(-1.0F, -4.5F, 0.5F, 2.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1396F, 0.0F, 0.0F));
		PartDefinition kralle1_g3 = kralle1_g2.addOrReplaceChild("kralle1_g3", CubeListBuilder.create().texOffs(32, 0).mirror().addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(88, 0).mirror().addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1745F, 0.0F, 0.0F));
		kralle1_g3.addOrReplaceChild("kralle1_dorn3", CubeListBuilder.create().texOffs(110, 0).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle1_g4 = kralle1_g3.addOrReplaceChild("kralle1_g4", CubeListBuilder.create().texOffs(40, 0).mirror().addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(94, 0).mirror().addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		PartDefinition kralle1_g5 = kralle1_g4.addOrReplaceChild("kralle1_g5", CubeListBuilder.create().texOffs(48, 0).mirror().addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(100, 0).mirror().addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		kralle1_g5.addOrReplaceChild("kralle1_dorn5", CubeListBuilder.create().texOffs(114, 0).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle1_g6 = kralle1_g5.addOrReplaceChild("kralle1_g6", CubeListBuilder.create().texOffs(84, 0).mirror().addBox(-0.5F, -3.5F, -0.5F, 1.0F, 4.0F, 1.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(118, 0).mirror().addBox(-0.5F, -3.5F, 0.0F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2443F, 0.0F, 0.0F));
		PartDefinition kralle1_g7 = kralle1_g6.addOrReplaceChild("kralle1_g7", CubeListBuilder.create().texOffs(122, 0).mirror().addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(8, 8).mirror().addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2443F, 0.0F, 0.0F));
		kralle1_g7.addOrReplaceChild("kralle1_dorn7", CubeListBuilder.create().texOffs(0, 8).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -1.2F, 0.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle1_g8 = kralle1_g7.addOrReplaceChild("kralle1_g8", CubeListBuilder.create().texOffs(4, 8).mirror().addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(12, 8).mirror().addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.2793F, 0.0F, 0.0F));
		PartDefinition kralle1_spitze = kralle1_g8.addOrReplaceChild("kralle1_spitze", CubeListBuilder.create().texOffs(78, 0).mirror().addBox(-0.5F, -3.0F, -1.0F, 1.0F, 3.0F, 2.0F, new CubeDeformation(0.09F)).mirror(false), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.3491F, 0.0F, 0.0F));
		kralle1_spitze.addOrReplaceChild("kralle1_haken", CubeListBuilder.create().texOffs(16, 8).mirror().addBox(-0.5F, -2.0F, -0.5F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.7854F, 0.0F, 0.0F));
		PartDefinition kralle2_g0 = root.addOrReplaceChild("kralle2_g0", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, CubeDeformation.NONE)
			.texOffs(56, 0).addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(-2.5F, 10.5F, 2.6F, -1.0821F, 0.0F, -0.8378F));
		PartDefinition kralle2_g1 = kralle2_g0.addOrReplaceChild("kralle2_g1", CubeListBuilder.create().texOffs(12, 0).addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, new CubeDeformation(0.04F))
			.texOffs(64, 0).addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.0698F, 0.0F, 0.0F));
		kralle2_g1.addOrReplaceChild("kralle2_dorn1", CubeListBuilder.create().texOffs(106, 0).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -2.4F, 1.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle2_g2 = kralle2_g1.addOrReplaceChild("kralle2_g2", CubeListBuilder.create().texOffs(24, 0).addBox(-1.0F, -4.5F, -1.0F, 2.0F, 5.0F, 2.0F, CubeDeformation.NONE)
			.texOffs(72, 0).addBox(-1.0F, -4.5F, 0.5F, 2.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1047F, 0.0F, 0.0F));
		PartDefinition kralle2_g3 = kralle2_g2.addOrReplaceChild("kralle2_g3", CubeListBuilder.create().texOffs(32, 0).addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F))
			.texOffs(88, 0).addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1396F, 0.0F, 0.0F));
		kralle2_g3.addOrReplaceChild("kralle2_dorn3", CubeListBuilder.create().texOffs(110, 0).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle2_g4 = kralle2_g3.addOrReplaceChild("kralle2_g4", CubeListBuilder.create().texOffs(40, 0).addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, CubeDeformation.NONE)
			.texOffs(94, 0).addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.1745F, 0.0F, 0.0F));
		PartDefinition kralle2_g5 = kralle2_g4.addOrReplaceChild("kralle2_g5", CubeListBuilder.create().texOffs(48, 0).addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F))
			.texOffs(100, 0).addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.1745F, 0.0F, 0.0F));
		kralle2_g5.addOrReplaceChild("kralle2_dorn5", CubeListBuilder.create().texOffs(114, 0).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle2_g6 = kralle2_g5.addOrReplaceChild("kralle2_g6", CubeListBuilder.create().texOffs(84, 0).addBox(-0.5F, -3.5F, -0.5F, 1.0F, 4.0F, 1.0F, CubeDeformation.NONE)
			.texOffs(118, 0).addBox(-0.5F, -3.5F, 0.0F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		PartDefinition kralle2_g7 = kralle2_g6.addOrReplaceChild("kralle2_g7", CubeListBuilder.create().texOffs(122, 0).addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.04F))
			.texOffs(8, 8).addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.15F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		kralle2_g7.addOrReplaceChild("kralle2_dorn7", CubeListBuilder.create().texOffs(0, 8).addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)), PartPose.offsetAndRotation(0.0F, -1.2F, 0.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle2_g8 = kralle2_g7.addOrReplaceChild("kralle2_g8", CubeListBuilder.create().texOffs(4, 8).addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, CubeDeformation.NONE)
			.texOffs(12, 8).addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.2443F, 0.0F, 0.0F));
		PartDefinition kralle2_spitze = kralle2_g8.addOrReplaceChild("kralle2_spitze", CubeListBuilder.create().texOffs(78, 0).addBox(-0.5F, -3.0F, -1.0F, 1.0F, 3.0F, 2.0F, new CubeDeformation(0.09F)), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.3491F, 0.0F, 0.0F));
		kralle2_spitze.addOrReplaceChild("kralle2_haken", CubeListBuilder.create().texOffs(16, 8).addBox(-0.5F, -2.0F, -0.5F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.7854F, 0.0F, 0.0F));
		PartDefinition kralle3_g0 = root.addOrReplaceChild("kralle3_g0", CubeListBuilder.create().texOffs(0, 0).mirror().addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(56, 0).mirror().addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(2.5F, 10.5F, 2.6F, -1.0821F, 0.0F, 0.8378F));
		PartDefinition kralle3_g1 = kralle3_g0.addOrReplaceChild("kralle3_g1", CubeListBuilder.create().texOffs(12, 0).mirror().addBox(-1.5F, -4.5F, -1.5F, 3.0F, 5.0F, 3.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(64, 0).mirror().addBox(-1.5F, -4.5F, 1.0F, 3.0F, 4.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.0698F, 0.0F, 0.0F));
		kralle3_g1.addOrReplaceChild("kralle3_dorn1", CubeListBuilder.create().texOffs(106, 0).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -2.4F, 1.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle3_g2 = kralle3_g1.addOrReplaceChild("kralle3_g2", CubeListBuilder.create().texOffs(24, 0).mirror().addBox(-1.0F, -4.5F, -1.0F, 2.0F, 5.0F, 2.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(72, 0).mirror().addBox(-1.0F, -4.5F, 0.5F, 2.0F, 4.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1047F, 0.0F, 0.0F));
		PartDefinition kralle3_g3 = kralle3_g2.addOrReplaceChild("kralle3_g3", CubeListBuilder.create().texOffs(32, 0).mirror().addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(88, 0).mirror().addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -4.0F, 0.0F, 0.1396F, 0.0F, 0.0F));
		kralle3_g3.addOrReplaceChild("kralle3_dorn3", CubeListBuilder.create().texOffs(110, 0).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle3_g4 = kralle3_g3.addOrReplaceChild("kralle3_g4", CubeListBuilder.create().texOffs(40, 0).mirror().addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(94, 0).mirror().addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.1745F, 0.0F, 0.0F));
		PartDefinition kralle3_g5 = kralle3_g4.addOrReplaceChild("kralle3_g5", CubeListBuilder.create().texOffs(48, 0).mirror().addBox(-1.0F, -3.5F, -1.0F, 2.0F, 4.0F, 2.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(100, 0).mirror().addBox(-1.0F, -3.5F, 0.5F, 2.0F, 3.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.1745F, 0.0F, 0.0F));
		kralle3_g5.addOrReplaceChild("kralle3_dorn5", CubeListBuilder.create().texOffs(114, 0).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -1.8F, 1.4F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle3_g6 = kralle3_g5.addOrReplaceChild("kralle3_g6", CubeListBuilder.create().texOffs(84, 0).mirror().addBox(-0.5F, -3.5F, -0.5F, 1.0F, 4.0F, 1.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(118, 0).mirror().addBox(-0.5F, -3.5F, 0.0F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		PartDefinition kralle3_g7 = kralle3_g6.addOrReplaceChild("kralle3_g7", CubeListBuilder.create().texOffs(122, 0).mirror().addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.04F)).mirror(false)
			.texOffs(8, 8).mirror().addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.15F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.2094F, 0.0F, 0.0F));
		kralle3_g7.addOrReplaceChild("kralle3_dorn7", CubeListBuilder.create().texOffs(0, 8).mirror().addBox(-0.5F, -3.0F, -0.4F, 1.0F, 3.0F, 1.0F, new CubeDeformation(0.07F)).mirror(false), PartPose.offsetAndRotation(0.0F, -1.2F, 0.9F, 0.8727F, 0.0F, 0.0F));
		PartDefinition kralle3_g8 = kralle3_g7.addOrReplaceChild("kralle3_g8", CubeListBuilder.create().texOffs(4, 8).mirror().addBox(-0.5F, -2.5F, -0.5F, 1.0F, 3.0F, 1.0F, CubeDeformation.NONE).mirror(false)
			.texOffs(12, 8).mirror().addBox(-0.5F, -2.5F, 0.0F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.2443F, 0.0F, 0.0F));
		PartDefinition kralle3_spitze = kralle3_g8.addOrReplaceChild("kralle3_spitze", CubeListBuilder.create().texOffs(78, 0).mirror().addBox(-0.5F, -3.0F, -1.0F, 1.0F, 3.0F, 2.0F, new CubeDeformation(0.09F)).mirror(false), PartPose.offsetAndRotation(0.0F, -2.0F, 0.0F, 0.3491F, 0.0F, 0.0F));
		kralle3_spitze.addOrReplaceChild("kralle3_haken", CubeListBuilder.create().texOffs(16, 8).mirror().addBox(-0.5F, -2.0F, -0.5F, 1.0F, 2.0F, 1.0F, new CubeDeformation(0.12F)).mirror(false), PartPose.offsetAndRotation(0.0F, -3.0F, 0.0F, 0.7854F, 0.0F, 0.0F));
		return new ClawsModel(LayerDefinition.create(mesh, 128, 64).bakeRoot());
	}
}
