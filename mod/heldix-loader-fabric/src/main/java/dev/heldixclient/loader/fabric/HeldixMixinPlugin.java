package dev.heldixclient.loader.fabric;

import dev.heldixclient.loader.impl.LoaderCore;
import org.objectweb.asm.tree.ClassNode;
import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;

import java.util.List;
import java.util.Set;

/**
 * Brücke zwischen Mixin und den Heldix-Transformern: Nachdem Mixin eine Klasse fertig bearbeitet hat
 * (alle Mods, höchste Priorität für {@code TransformTargets}), laufen hier dieselben ASM-Eingriffe
 * wie beim eigenständigen Heldix Loader. Mixin schreibt die Klasse danach und berechnet die Frames.
 */
public final class HeldixMixinPlugin implements IMixinConfigPlugin {
	@Override
	public void onLoad(String mixinPackage) {
	}

	@Override
	public String getRefMapperConfig() {
		return null;
	}

	@Override
	public boolean shouldApplyMixin(String targetClassName, String mixinClassName) {
		return true;
	}

	@Override
	public void acceptTargets(Set<String> myTargets, Set<String> otherTargets) {
	}

	@Override
	public List<String> getMixins() {
		return null;
	}

	@Override
	public void preApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {
	}

	@Override
	public void postApply(String targetClassName, ClassNode targetClass, String mixinClassName, IMixinInfo mixinInfo) {
		if (!FabricBoot.isBooted()) {
			LoaderCore.LOG.warn("Heldix Loader: {} wurde vor dem Start des Loaders geladen und bleibt unverändert", targetClassName);
			return;
		}
		LoaderCore.transformEmbedded(targetClassName.replace('.', '/'), targetClass);
	}
}
