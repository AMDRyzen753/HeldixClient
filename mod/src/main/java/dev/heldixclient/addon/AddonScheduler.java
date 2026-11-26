package dev.heldixclient.addon;

import dev.heldixclient.api.Registration;
import dev.heldixclient.api.Scheduler;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Scheduler eines Addons (API 3): Aufgaben im Haupt-Thread nach Ticks und eine kleine Thread-Gruppe für den
 * Hintergrund. Schaltet sich ab, sobald das Addon abgeschaltet wird oder das Spiel endet.
 */
final class AddonScheduler implements Scheduler {
	private static final int THREADS = 2;
	private static final int QUEUE = 64;

	private final LoadedAddon addon;
	/** neu geplante Aufgaben (aus jedem Thread), werden im nächsten Tick übernommen */
	private final Queue<Timed> incoming = new ConcurrentLinkedQueue<>();
	/** nur im Haupt-Thread */
	private final List<Timed> timed = new ArrayList<>();
	private final AtomicInteger threadNumber = new AtomicInteger();
	private ThreadPoolExecutor pool;
	private volatile boolean shutdown;
	private long tick;

	AddonScheduler(LoadedAddon addon) {
		this.addon = addon;
	}

	/** Aufgabe, die nach Ticks im Haupt-Thread läuft (einmal oder wiederholt) */
	private final class Timed implements Registration {
		final Runnable task;
		final int delay;
		final int period;
		long due = -1;
		volatile boolean cancelled;
		volatile boolean done;

		Timed(Runnable task, int delay, int period) {
			this.task = task;
			this.delay = delay;
			this.period = period;
		}

		@Override
		public void cancel() {
			cancelled = true;
		}

		@Override
		public boolean isActive() {
			return !cancelled && !done && !shutdown;
		}
	}

	/** Aufgabe im Hintergrund bzw. einmalig „so bald wie möglich“ im Haupt-Thread */
	private final class Once implements Registration {
		final Runnable task;
		volatile Future<?> future;
		volatile boolean cancelled;
		volatile boolean done;

		Once(Runnable task) {
			this.task = task;
		}

		@Override
		public void cancel() {
			cancelled = true;
			Future<?> running = future;
			if (running != null) running.cancel(true);
		}

		@Override
		public boolean isActive() {
			return !cancelled && !done && !shutdown;
		}
	}

	/** Für Aufrufe nach dem Abschalten: tut nichts */
	static final Registration INACTIVE = new Registration() {
		@Override
		public void cancel() {
		}

		@Override
		public boolean isActive() {
			return false;
		}
	};

	@Override
	public Registration runLater(int ticks, Runnable task) {
		return schedule(Math.max(0, ticks), 0, task);
	}

	@Override
	public Registration runRepeating(int delayTicks, int periodTicks, Runnable task) {
		return schedule(Math.max(0, delayTicks), Math.max(1, periodTicks), task);
	}

	private Registration schedule(int delay, int period, Runnable task) {
		Objects.requireNonNull(task, "task");
		if (shutdown) return INACTIVE;
		Timed timed = new Timed(task, delay, period);
		incoming.add(timed);
		return timed;
	}

	@Override
	public Registration runAsync(Runnable task) {
		Objects.requireNonNull(task, "task");
		if (shutdown) return INACTIVE;
		Once once = new Once(task);
		try {
			once.future = pool().submit(() -> {
				try {
					if (once.cancelled || shutdown || !addon.isActive()) return;
					once.task.run();
				} catch (Throwable t) {
					// abgebrochene Aufgaben (interrupt) sind kein Fehler des Addons
					if (!once.cancelled && !shutdown) onMainThread(() -> AddonManager.reportError(addon, "Hintergrund-Aufgabe", t));
				} finally {
					once.done = true;
				}
			});
		} catch (RejectedExecutionException e) {
			if (shutdown) return INACTIVE;
			throw new IllegalStateException("Zu viele Hintergrund-Aufgaben (höchstens " + QUEUE + " warten)", e);
		}
		return once;
	}

	@Override
	public Registration runOnMainThread(Runnable task) {
		Objects.requireNonNull(task, "task");
		if (shutdown) return INACTIVE;
		Once once = new Once(task);
		onMainThread(() -> {
			try {
				if (once.cancelled || shutdown || !addon.isActive()) return;
				once.task.run();
			} catch (Throwable t) {
				AddonManager.reportError(addon, "runOnMainThread", t);
			} finally {
				once.done = true;
			}
		});
		return once;
	}

	@Override
	public boolean isMainThread() {
		Minecraft minecraft = Minecraft.getInstance();
		return minecraft != null ? minecraft.isSameThread() : "Render thread".equals(Thread.currentThread().getName());
	}

	/** Im Haupt-Thread ausführen (vor dem Start von Minecraft: beim nächsten Tick) */
	private void onMainThread(Runnable runnable) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft != null) minecraft.execute(runnable);
		else incoming.add(new Timed(runnable, 0, 0));
	}

	private synchronized ThreadPoolExecutor pool() {
		if (pool == null) {
			String name = "Heldix-Addon-" + addon.name().replaceAll("[^A-Za-z0-9_-]", "") + "-";
			pool = new ThreadPoolExecutor(THREADS, THREADS, 30, TimeUnit.SECONDS, new LinkedBlockingQueue<>(QUEUE), runnable -> {
				Thread thread = new Thread(runnable, name + threadNumber.incrementAndGet());
				thread.setDaemon(true);
				if (addon.classLoader != null) thread.setContextClassLoader(addon.classLoader);
				return thread;
			});
			pool.allowCoreThreadTimeOut(true);
		}
		return pool;
	}

	/** Jeden Client-Tick im Haupt-Thread: fällige Aufgaben ausführen */
	void tick() {
		tick++;
		for (Timed next; (next = incoming.poll()) != null; ) {
			next.due = tick + next.delay;
			timed.add(next);
		}
		if (timed.isEmpty()) return;
		for (Timed task : List.copyOf(timed)) {
			if (task.cancelled || shutdown) {
				timed.remove(task);
				continue;
			}
			if (task.due > tick) continue;
			if (!addon.isActive()) return;
			try {
				task.task.run();
			} catch (Throwable t) {
				AddonManager.reportError(addon, task.period > 0 ? "runRepeating" : "runLater", t);
			}
			if (task.period > 0 && !task.cancelled) {
				task.due = tick + task.period;
			} else {
				task.done = true;
				timed.remove(task);
			}
		}
	}

	/** Alles abbrechen (Addon abgeschaltet oder Spielende); laufende Hintergrund-Aufgaben werden unterbrochen */
	synchronized void shutdown() {
		if (shutdown) return;
		shutdown = true;
		incoming.clear();
		timed.clear();
		if (pool != null) pool.shutdownNow();
	}

	/** Anzahl geplanter Aufgaben im Haupt-Thread (für den Autotest) */
	int pending() {
		return timed.size() + incoming.size();
	}
}
