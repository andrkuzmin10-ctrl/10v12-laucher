package dev.tenv12.visuals.mixin;
import dev.tenv12.visuals.VisualsClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.render.RenderTickCounter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(InGameHud.class)
public abstract class CrosshairMixin {
    @Inject(method = "renderCrosshair", at = @At("HEAD"), cancellable = true)
    private void tenv12$replaceCrosshair(DrawContext context, RenderTickCounter counter, CallbackInfo ci) {
        if (VisualsClient.customCrosshairActive()) ci.cancel();
    }
}
