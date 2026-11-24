package dev.heldixclient.autotest;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.api.event.HudEvents;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.render.Performance;
import dev.heldixclient.render.ShaderPreset;
import dev.heldixclient.render.Shaders;
import net.minecraft.client.InactivityFpsLimit;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.world.level.levelgen.Heightmap;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * FPS-Messung im echten Spiel ({@code -Dheldix.benchmark=true}): immer dieselbe Welt (fester Seed),
 * dieselbe Stelle und Kamerafahrt, ohne FPS-Grenze und VSync. Ergebnis im Log als
 * {@code HELDIX-BENCHMARK: backend=… avg=… low1=…}, damit man Vulkan und OpenGL vergleichen kann.
 *
 * <p>Optionen: {@code -Dheldix.benchmark.seconds=20}, {@code -Dheldix.benchmark.shader=kino},
 * {@code -Dheldix.benchmark.boost=true} (FPS-Boost während der Messung).
 */
final class Benchmark {
	private static final List<Long> FRAMES = new ArrayList<>();
	private static volatile boolean measuring;
	private static long lastFrame;

	private Benchmark() {
	}

	static void install() {
		HudEvents.RENDER.register((graphics, delta) -> {
			if (!measuring) return;
			long now = System.nanoTime();
			if (lastFrame != 0) {
				synchronized (FRAMES) {
					FRAMES.add(now - lastFrame);
				}
			}
			lastFrame = now;
		});
	}

	static void run(TestContext t) {
		int seconds = Integer.getInteger("heldix.benchmark.seconds", 20);
		ShaderPreset shader = ShaderPreset.byKey(System.getProperty("heldix.benchmark.shader", "aus"));
		boolean boost = Boolean.getBoolean("heldix.benchmark.boost");

		t.waitFor("Hauptmenü nach dem Laden", mc -> mc.gui.screen() instanceof TitleScreen && mc.gui.overlay() == null, 300);
		t.waitTicks(20);
		t.run(mc -> {
			mc.options.renderDistance().set(12);
			mc.options.framerateLimit().set(260);
			mc.options.enableVsync().set(false);
			mc.options.inactivityFpsLimit().set(InactivityFpsLimit.MINIMIZED);
			HeldixConfig.get().backgroundFps = false; // Fenster ist beim Test oft nicht im Vordergrund
			Shaders.select(shader);
			if (Performance.boostEnabled() != boost) Performance.setBoost(boost);
		});

		t.run(mc -> CreateWorldScreen.openFresh(mc, () -> mc.gui.setScreen(new TitleScreen())));
		t.waitForScreen(CreateWorldScreen.class, 60);
		t.waitTicks(5);
		t.run(mc -> {
			WorldCreationUiState state = ((CreateWorldScreen) mc.gui.screen()).getUiState();
			state.setName("Heldix Benchmark");
			state.setSeed("heldix-benchmark");
			state.setGameMode(WorldCreationUiState.SelectedGameMode.CREATIVE);
		});
		t.waitTicks(2);
		t.clickTranslatable("selectWorld.create");
		t.waitFor("Welt geladen", mc -> mc.level != null && mc.player != null && mc.gui.screen() == null, 240);

		// feste Stelle hoch über dem Gelände, Blick schräg nach unten
		t.serverCommand("gamemode spectator @a");
		t.serverCommand("time set 6000");
		t.serverCommand("weather clear");
		t.waitTicks(20);
		t.serverCommand("tp @a 0 200 0 0 25");
		t.waitSoft(mc -> mc.level.hasChunk(0, 0), 30);
		t.waitTicks(20);
		// 40 Blöcke über dem Gelände, damit die Kamera frei steht und viel Landschaft sieht
		int surface = t.compute(mc -> mc.level.getHeight(Heightmap.Types.WORLD_SURFACE, 0, 0));
		int cameraY = surface + 40;
		t.log("Gelände bei 0/0: Höhe " + surface + ", Kamera auf " + cameraY);
		t.serverCommand("tp @a 0 " + cameraY + " 0 0 25");
		t.waitTicks(40);
		if (!t.waitSoft(mc -> mc.levelRenderer.hasRenderedAllSections(), 90)) t.log("Nicht alle Chunks fertig, messe trotzdem");
		t.waitTicks(100);

		String backend = t.compute(mc -> DebugOverlay.backend());
		String resolution = t.compute(mc -> mc.getWindow().getWidth() + "x" + mc.getWindow().getHeight());
		synchronized (FRAMES) {
			FRAMES.clear();
		}
		lastFrame = 0;
		measuring = true;
		long start = System.nanoTime();
		int ticks = seconds * 20;
		for (int i = 0; i < ticks; i++) {
			// langsame Drehung: eine volle Runde während der Messung
			float yaw = 360f * i / ticks;
			t.run(mc -> {
				mc.player.setYRot(yaw);
				mc.player.setXRot(25f);
			});
			t.waitTicks(1);
		}
		measuring = false;
		double elapsed = (System.nanoTime() - start) / 1e9;

		List<Long> frames;
		synchronized (FRAMES) {
			frames = new ArrayList<>(FRAMES);
		}
		if (frames.size() < 10) throw new IllegalStateException("Zu wenige Bilder gemessen (" + frames.size() + ")");
		double totalMs = frames.stream().mapToLong(Long::longValue).sum() / 1e6;
		double avgFps = frames.size() / (totalMs / 1000);
		List<Long> slowest = frames.stream().sorted((a, b) -> Long.compare(b, a)).limit(Math.max(1, frames.size() / 100)).toList();
		double low1 = 1000 / (slowest.stream().mapToLong(Long::longValue).average().orElse(1) / 1e6);
		t.screenshot("heldix-benchmark-" + backend.toLowerCase(Locale.ROOT));
		t.log(String.format(Locale.ROOT, "HELDIX-BENCHMARK: backend=%s avg=%.1f low1=%.1f frames=%d seconds=%.1f resolution=%s shader=%s boost=%s",
				backend, avgFps, low1, frames.size(), elapsed, resolution, shader.key(), boost));
		t.check("Benchmark hat gemessen", avgFps > 0);
	}
}
