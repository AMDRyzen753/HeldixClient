package dev.heldixclient.addons.wings.test;

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
 * Cyber-Flügel (ganz in Blockbench gebaut: tools/blockbench, bau.js + maler.js + export.js). Ab 0.14.0 nach einer
 * Bildvorlage des Besitzers aufgebaut (eigene blockige Umsetzung): Rückenkern mit Leuchtraute; je Seite ein gepanzerter,
 * dreigliedriger Arm (je Glied zwei überlappende Panzerplatten) mit runden Leuchtring-Gelenken – klein an Schulter und
 * Handstück, groß in der Mitte (Nabe tiefer als die Panzerung, um 45° gedrehter Ring, Achskappe mit Leuchtpunkt);
 * darunter zwölf Federklingen in drei Lagen, die von der Schulter (fast senkrecht) bis zur langen Spitze (in
 * Armrichtung) fächern, mit Leuchtkanten an den schrägen Spitzen. Schattierung im Maler.
 * Texturgröße 128x64 (Bilder 512x256). Die Ruhepose kommt aus Blockbench; {@link #setupAnim} setzt zuerst auf sie
 * zurück (Model.setupAnim) und addiert dann die Bewegung aus {@link Pose}, weil Minecraft 26.3 gesammelt zeichnet und
 * dabei setupAnim aufruft. In Java dazu nur die Verkleinerung ({@link #SCALE}) und die Wölbung ({@link #CAMBER}).
 */
final class WingsModel extends Model<WingsModel.Pose> {
	static final int BLADES = 12;
	/** Größe gegenüber dem Blockbench-Entwurf */
	static final float SCALE = 0.62f;
	/** Wölbung nach hinten je Holmglied (yRot, Bogenmaß) – gibt den Flügeln Tiefe */
	static final float[] CAMBER = {0.3f, 0.22f, 0.26f};
	/** Holmglied je Klinge (wie in bau.js) */
	static final int[] BLADE_ARM = {0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2};

	/** [Seite 0 = rechts (−x), 1 = links (+x)][Glied 0..2] */
	private final ModelPart[][] arms = new ModelPart[2][3];
	/** [Seite][Klinge 0..11], innen nach außen */
	private final ModelPart[][] blades = new ModelPart[2][BLADES];

	WingsModel(ModelPart root) {
		super(root, RenderTypes::entityCutout);
		ModelPart core = root.getChild("kern");
		core.setInitialPose(core.getInitialPose().withScale(SCALE));
		for (int side = 0; side < 2; side++) {
			String pre = side == 0 ? "r_" : "l_";
			ModelPart part = core.getChild(pre + "holm0");
			arms[side][0] = part;
			for (int k = 1; k < 3; k++) {
				part = part.getChild(pre + "holm" + k);
				arms[side][k] = part;
			}
			for (int i = 0; i < BLADES; i++) blades[side][i] = arms[side][BLADE_ARM[i]].getChild(pre + "klinge" + i);
		}
	}

	/** Abweichung von der Ruhepose (Bogenmaß) */
	static final class Pose {
		/** Heben des ganzen Flügels */
		float lift;
		/** Zurückschwenken */
		float sweep;
		/** Knick der äußeren Glieder (positiv = einfalten) */
		float bend;
		/** Fächer der Klingen (positiv = spreizen) */
		float fan;
		/** Servo-Ruck der Spitze (positiv = hoch) */
		float twitch;
		/** Schräglage beim Gleiten: positiv hebt den rechten und senkt den linken Flügel */
		float roll;
		/** Phase der Welle, die von innen nach außen durch die Klingen läuft */
		float ripple;
		/** Stärke der Welle */
		float rippleAmp;
		/** zusätzliches Spreizen je Klinge (Strecken: die Klingen öffnen nacheinander) */
		final float[] open = new float[BLADES];
	}

	@Override
	public void setupAnim(Pose pose) {
		super.setupAnim(pose);
		for (int side = 0; side < 2; side++) {
			// rechts (−x): positives zRot hebt den Holm und spreizt die Klingen nach außen, positives yRot schwenkt
			// die Spitze nach hinten; links gespiegelt
			float s = side == 0 ? 1f : -1f;
			for (int k = 0; k < 3; k++) arms[side][k].yRot += s * CAMBER[k];
			arms[side][0].zRot += s * pose.lift + pose.roll;
			arms[side][0].yRot += s * pose.sweep;
			arms[side][1].zRot -= s * pose.bend;
			arms[side][2].zRot -= s * (pose.bend * 0.8f - pose.twitch);
			// Nachbarn bewegen sich fast gleich (kleiner Phasenschritt), damit die Überlappung nicht aufgeht. Die Welle
			// dreht nur in der Fläche (zRot); das Kippen nach hinten ist für alle Klingen gleich, sonst liefen die beiden
			// Lagen durcheinander
			// Flattern als sin² (bis 0.14 |sin| – das knickte bei jedem Nulldurchgang wie ein Stoß)
			float flutterWave = (float) Math.sin(pose.ripple);
			float flutter = flutterWave * flutterWave * pose.rippleAmp * 1.5f;
			for (int i = 0; i < BLADES; i++) {
				float wave = (float) Math.sin(pose.ripple - i * 0.3f) * pose.rippleAmp;
				// Fächer: ein gemeinsamer Anteil dreht alle gleich, nur der Rest spreizt die Klingen gegeneinander
				blades[side][i].zRot += s * (pose.fan * (0.4f + 0.6f * (i + 1) / BLADES) + pose.open[i] + wave);
				blades[side][i].xRot += flutter;
			}
		}
	}

	/**
	 * Bewegung im mechanischen Stil.
	 * <ul>
	 *   <li>Stand: ruhiges Atmen, eine leise Welle läuft durch die Klingen, alle 4,5 Sekunden ein kurzer Servo-Ruck
	 *       der Spitze (schnell hoch, langsam zurück, ohne Nachzittern), alle 12 Sekunden ein Strecken – heben, Klingen
	 *       öffnen nacheinander von innen nach außen, wieder einfahren</li>
	 *   <li>Vorwärts laufen: im Fahrtwind gespreizt, Klingen flattern; Rennen: weiter gespreizt und nach hinten
	 *       gestreckt. Rückwärts: angelegt (seitwärts dazwischen). Ab 0.15 ohne Schrittwippen (beim Rennen 4 Stöße je
	 *       Sekunde – das sah wie Zittern aus)</li>
	 *   <li>Schleichen: eng am Rücken gefaltet</li>
	 *   <li>Springen ({@code rising} 0..1): kräftige Flügelschläge, schnell nach unten, langsamer zurück</li>
	 *   <li>Fallen und Elytra-Flug ({@code gliding} 0..1): weit ausgebreitet, gleitend mit leichter Schräglage</li>
	 * </ul>
	 * Alle Zustände kommen geglättet aus {@link WingsMotion}.
	 */
	static Pose animate(float age, WingsMotion m) {
		Pose pose = new Pose();
		float walk = m.walk, forward = m.forward, gliding = m.gliding, rising = m.rising;
		// vorwärts (forward 1) spreizen sich die Flügel im Fahrtwind, rückwärts (0) legen sie sich an
		float spread = walk * forward;
		float tuck = walk * (1f - forward);
		// Ruhebewegungen (Servo-Ruck, Strecken) nur im Stand am Boden
		float still = (1f - walk) * (1f - Math.max(gliding, rising));
		float breathe = (float) Math.sin(age * 0.06f);
		// Ab 0.14.0 steht der Arm in Ruhe steil (wie in der Vorlage); zum Spreizen senkt er sich und die äußeren
		// Glieder klappen nach außen (bend positiv), damit der Flügel waagerecht ausgebreitet ist
		pose.lift = breathe * 0.05f - 0.15f * spread - 0.35f * tuck;
		pose.sweep = 0.18f * spread + 0.5f * tuck;
		pose.bend = breathe * 0.03f + 0.25f * spread + 0.3f * tuck;
		pose.fan = breathe * 0.04f + 0.3f * spread - 0.3f * tuck;
		pose.ripple = m.ripple;
		// im Fahrtwind flattern die Klingen etwas stärker
		pose.rippleAmp = 0.025f + 0.02f * (1f - walk) + 0.03f * spread;

		// Servo-Ruck der Spitze: in 0,25 s hoch, in 0,5 s zurück, weich an beiden Enden (bis 0.14 schwang er mit
		// 5 Hz aus – das war ein Zittern)
		float t = age % 90f;
		if (t < 15f) {
			float up = 5f;
			float h = t < up ? (float) Math.sin(t / up * Math.PI * 0.5) : (float) Math.cos((t - up) / (15f - up) * Math.PI * 0.5);
			pose.twitch = h * h * 0.14f * still;
		}

		// Strecken im Stand: heben und knicken auf, die Klingen öffnen nacheinander und schließen wieder
		float c = age % 240f;
		if (c < 50f && still > 0f) {
			float p = c / 50f;
			float body = bump(p) * still;
			pose.lift -= 0.15f * body;
			pose.bend += 0.25f * body;
			for (int i = 0; i < BLADES; i++) {
				float q = (p - i * 0.025f) / 0.75f;
				pose.open[i] = q > 0f && q < 1f ? bump(q) * 0.2f * (i + 1) / BLADES * still : 0f;
			}
		}

		// Rennen: weiter gespreizt und nach hinten gestreckt; Schleichen: eng angelegt (beides weich überblendet)
		float sprint = m.sprint * spread;
		pose.lift -= 0.05f * sprint;
		pose.sweep += 0.22f * sprint;
		pose.bend += 0.1f * sprint;
		pose.fan += 0.1f * sprint;
		pose.lift -= 0.25f * m.crouch;
		pose.sweep += 0.45f * m.crouch;
		pose.bend += 0.2f * m.crouch;
		pose.fan -= 0.3f * m.crouch;

		// Springen: Flügelschläge (Abschlag in der ersten Hälfte schnell, Aufschlag langsamer); die Phase beginnt beim
		// Abheben oben (WingsMotion.stroke)
		if (rising > 0f) {
			float phase = m.stroke;
			float stroke = phase < Math.PI * 0.8 ? (float) Math.cos(phase / 0.8f) : (float) -Math.cos((phase - Math.PI * 0.8) / 1.2f);
			pose.lift += (-0.2f + 0.45f * stroke - pose.lift) * rising;
			pose.sweep += (0.05f - pose.sweep) * rising;
			pose.bend += (0.25f + 0.1f * stroke - pose.bend) * rising;
			pose.fan += (0.3f + 0.1f * stroke - pose.fan) * rising;
		}
		// Gleiten: weit ausgebreitet, langsame Schräglage, Klingen gespreizt
		if (gliding > 0f) {
			float sway = (float) Math.sin(age * 0.11f);
			pose.lift += (-0.4f + 0.04f * sway - pose.lift) * gliding;
			pose.sweep += (0.08f - pose.sweep) * gliding;
			pose.bend += (0.35f - pose.bend) * gliding;
			pose.fan += (0.4f - pose.fan) * gliding;
			pose.roll = 0.07f * sway * gliding;
		}
		return pose;
	}

	/** weicher Hügel 0..1..0 über x in 0..1 */
	private static float bump(float x) {
		float y = (float) Math.sin(x * Math.PI);
		return y * y;
	}

	/** Mesh aus Blockbench (Modded Entity, Mojang-Namen, export.js), ohne die Maßfigur; unverändert eingefügt */
	static WingsModel create() {
		MeshDefinition mesh = new MeshDefinition();
		PartDefinition root = mesh.getRoot();
		PartDefinition kern = root.addOrReplaceChild("kern", CubeListBuilder.create().texOffs(48, 40).addBox(-3.0F, -1.0F, -0.5F, 6.0F, 6.0F, 2.0F, new CubeDeformation(0.0F)), PartPose.offset(0.0F, 2.0F, 2.5F));

		PartDefinition r_holm0 = kern.addOrReplaceChild("r_holm0", CubeListBuilder.create().texOffs(76, 19).addBox(-5.1F, -2.6F, -1.8F, 3.7F, 4.2F, 4.3F, new CubeDeformation(0.0F))
		.texOffs(12, 30).addBox(-8.7F, -2.3F, -1.7F, 4.2F, 3.6F, 4.1F, new CubeDeformation(0.0F))
		.texOffs(56, 19).addBox(-1.8F, -1.8F, -3.0F, 3.6F, 3.6F, 6.0F, new CubeDeformation(0.0F))
		.texOffs(50, 30).addBox(-0.8F, -0.8F, -3.4F, 1.6F, 1.6F, 6.8F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-3.5F, 0.0F, 1.0F, 0.0F, 0.0F, 0.4363F));

		PartDefinition r_holm0_ring_r1 = r_holm0.addOrReplaceChild("r_holm0_ring_r1", CubeListBuilder.create().texOffs(32, 30).addBox(-1.5F, -1.5F, -2.8F, 3.0F, 3.0F, 5.6F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7854F));

		PartDefinition r_holm1 = r_holm0.addOrReplaceChild("r_holm1", CubeListBuilder.create().texOffs(112, 19).addBox(-4.6F, -2.6F, -1.8F, 2.2F, 4.2F, 4.3F, new CubeDeformation(0.0F))
		.texOffs(68, 30).addBox(-7.7F, -2.3F, -1.7F, 3.7F, 3.6F, 4.1F, new CubeDeformation(0.0F))
		.texOffs(74, 0).addBox(-2.8F, -2.8F, -3.2F, 5.6F, 5.6F, 6.4F, new CubeDeformation(0.0F))
		.texOffs(22, 19).addBox(-1.1F, -1.1F, -3.6F, 2.2F, 2.2F, 7.2F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-9.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.2618F));

		PartDefinition r_holm1_ring_r1 = r_holm1.addOrReplaceChild("r_holm1_ring_r1", CubeListBuilder.create().texOffs(0, 19).addBox(-2.3F, -2.3F, -3.0F, 4.6F, 4.6F, 6.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7854F));

		PartDefinition r_holm2 = r_holm1.addOrReplaceChild("r_holm2", CubeListBuilder.create().texOffs(94, 19).addBox(-4.6F, -2.6F, -1.8F, 3.5F, 4.2F, 4.3F, new CubeDeformation(0.0F))
		.texOffs(86, 30).addBox(-7.7F, -2.3F, -1.7F, 3.7F, 3.6F, 4.1F, new CubeDeformation(0.0F))
		.texOffs(104, 30).addBox(-1.5F, -1.5F, -2.9F, 3.0F, 3.0F, 5.8F, new CubeDeformation(0.0F))
		.texOffs(18, 40).addBox(-0.6F, -0.6F, -3.3F, 1.2F, 1.2F, 6.6F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-8.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.2618F));

		PartDefinition r_holm2_ring_r1 = r_holm2.addOrReplaceChild("r_holm2_ring_r1", CubeListBuilder.create().texOffs(0, 40).addBox(-1.2F, -1.2F, -2.7F, 2.4F, 2.4F, 5.4F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7854F));

		PartDefinition r_klinge7 = r_holm2.addOrReplaceChild("r_klinge7", CubeListBuilder.create().texOffs(40, 0).addBox(-2.0F, 0.0F, -0.5F, 4.0F, 15.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-1.2F, 0.5F, 0.3F, 0.1047F, 0.0F, 0.192F));

		PartDefinition r_klinge8 = r_holm2.addOrReplaceChild("r_klinge8", CubeListBuilder.create().texOffs(30, 0).addBox(-2.0F, 0.0F, -0.5F, 4.0F, 16.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-2.9F, 0.5F, 1.7F, 0.1047F, 0.0F, 0.4014F));

		PartDefinition r_klinge9 = r_holm2.addOrReplaceChild("r_klinge9", CubeListBuilder.create().texOffs(10, 0).addBox(-2.0F, 0.0F, -0.5F, 4.0F, 17.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-4.6F, 0.5F, -1.1F, 0.1047F, 0.0F, 0.6458F));

		PartDefinition r_klinge10 = r_holm2.addOrReplaceChild("r_klinge10", CubeListBuilder.create().texOffs(20, 0).addBox(-2.0F, 0.0F, -0.5F, 4.0F, 17.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-6.3F, 0.5F, 0.3F, 0.1047F, 0.0F, 0.9599F));

		PartDefinition r_klinge11 = r_holm2.addOrReplaceChild("r_klinge11", CubeListBuilder.create().texOffs(0, 0).addBox(-2.0F, 0.0F, -0.5F, 4.0F, 18.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-8.0F, 0.5F, 1.7F, 0.1047F, 0.0F, 1.4486F));

		PartDefinition r_klinge3 = r_holm1.addOrReplaceChild("r_klinge3", CubeListBuilder.create().texOffs(112, 0).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 11.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-1.5F, 0.5F, -1.1F, 0.1047F, 0.0F, -0.1396F));

		PartDefinition r_klinge4 = r_holm1.addOrReplaceChild("r_klinge4", CubeListBuilder.create().texOffs(100, 0).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 12.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-3.5F, 0.5F, 0.3F, 0.1047F, 0.0F, 0.0F));

		PartDefinition r_klinge5 = r_holm1.addOrReplaceChild("r_klinge5", CubeListBuilder.create().texOffs(62, 0).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 13.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-5.5F, 0.5F, 1.7F, 0.1047F, 0.0F, 0.1396F));

		PartDefinition r_klinge6 = r_holm1.addOrReplaceChild("r_klinge6", CubeListBuilder.create().texOffs(50, 0).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 14.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-7.5F, 0.5F, -1.1F, 0.1047F, 0.0F, 0.2793F));

		PartDefinition r_klinge0 = r_holm0.addOrReplaceChild("r_klinge0", CubeListBuilder.create().texOffs(36, 40).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 8.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-3.0F, 0.5F, -1.1F, 0.1047F, 0.0F, -0.2967F));

		PartDefinition r_klinge1 = r_holm0.addOrReplaceChild("r_klinge1", CubeListBuilder.create().texOffs(0, 30).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 9.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-5.0F, 0.5F, 0.3F, 0.1047F, 0.0F, -0.1571F));

		PartDefinition r_klinge2 = r_holm0.addOrReplaceChild("r_klinge2", CubeListBuilder.create().texOffs(44, 19).addBox(-2.3F, 0.0F, -0.5F, 4.6F, 10.0F, 1.0F, new CubeDeformation(0.0F)), PartPose.offsetAndRotation(-7.0F, 0.5F, 1.7F, 0.1047F, 0.0F, -0.0175F));

		PartDefinition l_holm0 = kern.addOrReplaceChild("l_holm0", CubeListBuilder.create().texOffs(76, 19).mirror().addBox(1.4F, -2.6F, -1.8F, 3.7F, 4.2F, 4.3F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(12, 30).mirror().addBox(4.5F, -2.3F, -1.7F, 4.2F, 3.6F, 4.1F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(56, 19).mirror().addBox(-1.8F, -1.8F, -3.0F, 3.6F, 3.6F, 6.0F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(50, 30).mirror().addBox(-0.8F, -0.8F, -3.4F, 1.6F, 1.6F, 6.8F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(3.5F, 0.0F, 1.0F, 0.0F, 0.0F, -0.4363F));

		PartDefinition l_holm0_ring_r1 = l_holm0.addOrReplaceChild("l_holm0_ring_r1", CubeListBuilder.create().texOffs(32, 30).mirror().addBox(-1.5F, -1.5F, -2.8F, 3.0F, 3.0F, 5.6F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7854F));

		PartDefinition l_holm1 = l_holm0.addOrReplaceChild("l_holm1", CubeListBuilder.create().texOffs(112, 19).mirror().addBox(2.4F, -2.6F, -1.8F, 2.2F, 4.2F, 4.3F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(68, 30).mirror().addBox(4.0F, -2.3F, -1.7F, 3.7F, 3.6F, 4.1F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(74, 0).mirror().addBox(-2.8F, -2.8F, -3.2F, 5.6F, 5.6F, 6.4F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(22, 19).mirror().addBox(-1.1F, -1.1F, -3.6F, 2.2F, 2.2F, 7.2F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(9.0F, 0.0F, 0.0F, 0.0F, 0.0F, -0.2618F));

		PartDefinition l_holm1_ring_r1 = l_holm1.addOrReplaceChild("l_holm1_ring_r1", CubeListBuilder.create().texOffs(0, 19).mirror().addBox(-2.3F, -2.3F, -3.0F, 4.6F, 4.6F, 6.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7854F));

		PartDefinition l_holm2 = l_holm1.addOrReplaceChild("l_holm2", CubeListBuilder.create().texOffs(94, 19).mirror().addBox(1.1F, -2.6F, -1.8F, 3.5F, 4.2F, 4.3F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(86, 30).mirror().addBox(4.0F, -2.3F, -1.7F, 3.7F, 3.6F, 4.1F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(104, 30).mirror().addBox(-1.5F, -1.5F, -2.9F, 3.0F, 3.0F, 5.8F, new CubeDeformation(0.0F)).mirror(false)
		.texOffs(18, 40).mirror().addBox(-0.6F, -0.6F, -3.3F, 1.2F, 1.2F, 6.6F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(8.0F, 0.0F, 0.0F, 0.0F, 0.0F, -0.2618F));

		PartDefinition l_holm2_ring_r1 = l_holm2.addOrReplaceChild("l_holm2_ring_r1", CubeListBuilder.create().texOffs(0, 40).mirror().addBox(-1.2F, -1.2F, -2.7F, 2.4F, 2.4F, 5.4F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(0.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.7854F));

		PartDefinition l_klinge7 = l_holm2.addOrReplaceChild("l_klinge7", CubeListBuilder.create().texOffs(40, 0).mirror().addBox(-2.0F, 0.0F, -0.5F, 4.0F, 15.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(1.2F, 0.5F, 0.3F, 0.1047F, 0.0F, -0.192F));

		PartDefinition l_klinge8 = l_holm2.addOrReplaceChild("l_klinge8", CubeListBuilder.create().texOffs(30, 0).mirror().addBox(-2.0F, 0.0F, -0.5F, 4.0F, 16.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(2.9F, 0.5F, 1.7F, 0.1047F, 0.0F, -0.4014F));

		PartDefinition l_klinge9 = l_holm2.addOrReplaceChild("l_klinge9", CubeListBuilder.create().texOffs(10, 0).mirror().addBox(-2.0F, 0.0F, -0.5F, 4.0F, 17.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(4.6F, 0.5F, -1.1F, 0.1047F, 0.0F, -0.6458F));

		PartDefinition l_klinge10 = l_holm2.addOrReplaceChild("l_klinge10", CubeListBuilder.create().texOffs(20, 0).mirror().addBox(-2.0F, 0.0F, -0.5F, 4.0F, 17.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(6.3F, 0.5F, 0.3F, 0.1047F, 0.0F, -0.9599F));

		PartDefinition l_klinge11 = l_holm2.addOrReplaceChild("l_klinge11", CubeListBuilder.create().texOffs(0, 0).mirror().addBox(-2.0F, 0.0F, -0.5F, 4.0F, 18.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(8.0F, 0.5F, 1.7F, 0.1047F, 0.0F, -1.4486F));

		PartDefinition l_klinge3 = l_holm1.addOrReplaceChild("l_klinge3", CubeListBuilder.create().texOffs(112, 0).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 11.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(1.5F, 0.5F, -1.1F, 0.1047F, 0.0F, 0.1396F));

		PartDefinition l_klinge4 = l_holm1.addOrReplaceChild("l_klinge4", CubeListBuilder.create().texOffs(100, 0).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 12.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(3.5F, 0.5F, 0.3F, 0.1047F, 0.0F, 0.0F));

		PartDefinition l_klinge5 = l_holm1.addOrReplaceChild("l_klinge5", CubeListBuilder.create().texOffs(62, 0).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 13.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(5.5F, 0.5F, 1.7F, 0.1047F, 0.0F, -0.1396F));

		PartDefinition l_klinge6 = l_holm1.addOrReplaceChild("l_klinge6", CubeListBuilder.create().texOffs(50, 0).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 14.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(7.5F, 0.5F, -1.1F, 0.1047F, 0.0F, -0.2793F));

		PartDefinition l_klinge0 = l_holm0.addOrReplaceChild("l_klinge0", CubeListBuilder.create().texOffs(36, 40).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 8.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(3.0F, 0.5F, -1.1F, 0.1047F, 0.0F, 0.2967F));

		PartDefinition l_klinge1 = l_holm0.addOrReplaceChild("l_klinge1", CubeListBuilder.create().texOffs(0, 30).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 9.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(5.0F, 0.5F, 0.3F, 0.1047F, 0.0F, 0.1571F));

		PartDefinition l_klinge2 = l_holm0.addOrReplaceChild("l_klinge2", CubeListBuilder.create().texOffs(44, 19).mirror().addBox(-2.3F, 0.0F, -0.5F, 4.6F, 10.0F, 1.0F, new CubeDeformation(0.0F)).mirror(false), PartPose.offsetAndRotation(7.0F, 0.5F, 1.7F, 0.1047F, 0.0F, 0.0175F));
		return new WingsModel(LayerDefinition.create(mesh, 128, 64).bakeRoot());
	}
}
