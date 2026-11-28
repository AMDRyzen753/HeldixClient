package dev.heldixclient.addons.emoterad.test;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.heldixclient.api.HeldixLogger;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.state.level.CameraRenderState;

/**
 * Spieler-Renderer mit Emotes (Test, Minecraft 26.3). Für alle anderen Spieler und ohne laufendes Emote zeichnet er
 * genau wie Minecraft. Sitzen: Körper sinkt weich zu Boden, ganz gesessen gilt Minecrafts eigene Sitzpose
 * ({@code isPassenger}), damit Rüstung und Kleidung genau mitgehen. Verbeugen nutzt Minecrafts Schleich-Haltung für den
 * Oberkörper. Winken und Krallen zeigen bewegen nur Arme und Kopf. Geht etwas schief, schalten sich die Emotes ab.
 */
final class EmoteAvatarRenderer extends AvatarRenderer<AbstractClientPlayer> {
	/** so weit sinkt der Körper beim Sitzen (Hüfte auf Bodenhöhe, Beine liegen waagerecht) */
	static final float LOWER = 0.6f;

	private final Emotes emotes;
	private final HeldixLogger log;
	private boolean broken;

	EmoteAvatarRenderer(EntityRendererProvider.Context context, boolean slim, Emotes emotes, HeldixLogger log) {
		super(context, slim);
		this.emotes = emotes;
		this.log = log;
		this.model = new EmotePlayerModel(context.bakeLayer(slim ? ModelLayers.PLAYER_SLIM : ModelLayers.PLAYER), slim);
	}

	/** Renderzustand mit laufendem Emote (null = keins), Stärke 0..1 und Sekunden seit dem Start */
	static final class EmoteState extends AvatarRenderState {
		Emotes.Emote emote;
		float blend;
		float seconds;
	}

	@Override
	public AvatarRenderState createRenderState() {
		return new EmoteState();
	}

	@Override
	public void extractRenderState(AbstractClientPlayer player, AvatarRenderState state, float partialTick) {
		super.extractRenderState(player, state, partialTick);
		if (!(state instanceof EmoteState s)) return;
		s.emote = null;
		s.blend = 0f;
		if (broken) return;
		try {
			if (!emotes.isLocal(player)) return;
			// anderen Addons (z. B. Krallen) das laufende Emote melden; ohne Emote leer
			EmoteChannel.publish(emotes.current(), emotes.blend());
			if (emotes.current() == null) return;
			s.emote = emotes.current();
			s.blend = emotes.blend();
			s.seconds = emotes.seconds();
			if (s.emote == Emotes.Emote.SIT && s.blend >= 0.999f) state.isPassenger = true;   // Minecrafts Sitzpose
			if (s.emote == Emotes.Emote.BOW && s.blend >= 0.5f) state.isCrouching = true;      // Oberkörper geneigt
		} catch (Throwable t) {
			fail(t);
		}
	}

	@Override
	public void submit(AvatarRenderState state, PoseStack pose, SubmitNodeCollector collector, CameraRenderState camera) {
		if (broken || !(state instanceof EmoteState s) || s.emote != Emotes.Emote.SIT || s.blend <= 0f) {
			super.submit(state, pose, collector, camera);
			return;
		}
		pose.pushPose();
		try {
			float p = smooth(s.blend);
			float breathe = s.blend >= 0.999f ? (float) Math.sin(state.ageInTicks * 0.09f) * 0.008f : 0f;   // leichtes Atmen
			pose.translate(0f, -LOWER * p + breathe, 0f);
			super.submit(state, pose, collector, camera);
		} finally {
			pose.popPose();
		}
	}

	private void fail(Throwable t) {
		if (broken) return;
		broken = true;
		EmoteChannel.clear();
		log.error("Emote-Rad: Emotes abgeschaltet nach einem Fehler", t);
	}

	static float smooth(float t) {
		return t * t * (3f - 2f * t);
	}

	/** Arme, Beine und Kopf je Emote, weich über die Stärke eingeblendet. */
	static final class EmotePlayerModel extends PlayerModel {
		EmotePlayerModel(ModelPart root, boolean slim) {
			super(root, slim);
		}

		@Override
		public void setupAnim(AvatarRenderState state) {
			super.setupAnim(state);
			if (!(state instanceof EmoteState s) || s.emote == null || s.blend <= 0f) return;
			float p = smooth(s.blend);
			switch (s.emote) {
				case SIT -> {
					if (state.isPassenger) return;   // ganz gesessen: Minecrafts Sitzpose gilt schon
					rightLeg.xRot += (-1.4137167f - rightLeg.xRot) * p;
					rightLeg.yRot += (0.31415927f - rightLeg.yRot) * p;
					rightLeg.zRot += (0.07853982f - rightLeg.zRot) * p;
					leftLeg.xRot += (-1.4137167f - leftLeg.xRot) * p;
					leftLeg.yRot += (-0.31415927f - leftLeg.yRot) * p;
					leftLeg.zRot += (-0.07853982f - leftLeg.zRot) * p;
					rightArm.xRot += -0.62831855f * p;
					leftArm.xRot += -0.62831855f * p;
				}
				case WAVE -> {
					// rechter Arm schräg nach außen oben, Hand schwingt seitlich hin und her. Minecraft dreht erst um X,
					// dann um Z: beim erhobenen Arm zeigt negatives zRot nach außen (positives über den Kopf)
					float swing = -0.5f + (float) Math.sin(s.seconds * 9f) * 0.3f;
					rightArm.xRot += (-2.75f - rightArm.xRot) * p;
					rightArm.yRot += (0f - rightArm.yRot) * p;
					rightArm.zRot += (swing - rightArm.zRot) * p;
					head.zRot += 0.08f * p;   // Kopf leicht zur Seite geneigt
				}
				case BOW -> {
					// Oberkörper über die Schleich-Haltung; dazu Kopf tief, Arme locker nach hinten
					head.xRot += (0.75f - head.xRot) * p;
					rightArm.xRot += (0.25f - rightArm.xRot) * p;
					leftArm.xRot += (0.25f - leftArm.xRot) * p;
				}
				case FLARE -> {
					// Arme leicht auseinander und zurück, Blick nach oben – läuft das Krallen-Addon, spreizen sich die
					// Krallen (es liest das Emote über EmoteChannel)
					float tremble = (float) Math.sin(s.seconds * 31f) * 0.02f;
					rightArm.zRot += (0.85f + tremble - rightArm.zRot) * p;
					leftArm.zRot += (-0.85f - tremble - leftArm.zRot) * p;
					rightArm.xRot += (0.25f - rightArm.xRot) * p;
					leftArm.xRot += (0.25f - leftArm.xRot) * p;
					head.xRot += (-0.3f - head.xRot) * p;
				}
				default -> {
				}
			}
		}
	}
}
