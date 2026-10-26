package dev.tenv12.visuals;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

public final class HudEditorScreen extends Screen {
    private int dragging=-1;private double dx,dy;private boolean saveFailed;
    public HudEditorScreen(){super(Text.literal("10v12 HUD editor"));}
    @Override protected void init(){VisualsClient.prepareEditor();}
    @Override public void render(DrawContext c,int mouseX,int mouseY,float delta){
        c.fill(0,0,width,height,0x900A0B13);VisualsClient.drawHud(c,true);
        for(int group=0;group<2;group++){
            VisualsClient.Bounds b=VisualsClient.bounds(group,width,height);int color=group==dragging?VisualsClient.config.accent():0xFF8B7DA2;
            c.fill(b.x-1,b.y-1,b.x+b.w+1,b.y,color);c.fill(b.x-1,b.y+b.h,b.x+b.w+1,b.y+b.h+1,color);
            c.fill(b.x-1,b.y,b.x,b.y+b.h,color);c.fill(b.x+b.w,b.y,b.x+b.w+1,b.y+b.h,color);
        }
        String hint=saveFailed?"Ошибка сохранения. ESC ещё раз — выйти.":"Тяни блоки мышью · R — сброс · ESC — сохранить";
        c.drawText(textRenderer,hint,Math.max(4,(width-textRenderer.getWidth(hint))/2),height-12,0xFFE1D7F4,false);
    }
    @Override public boolean mouseClicked(double x,double y,int button){
        if(button!=0)return false;
        for(int i=1;i>=0;i--){var b=VisualsClient.bounds(i,width,height);if(b.contains(x,y)){dragging=i;dx=x-b.x;dy=y-b.y;return true;}}
        return false;
    }
    @Override public boolean mouseDragged(double x,double y,int button,double deltaX,double deltaY){
        if(dragging<0)return false;var b=VisualsClient.bounds(dragging,width,height);
        double nx=VisualConfig.unit((x-dx)/Math.max(1,width-b.w)),ny=VisualConfig.unit((y-dy)/Math.max(1,height-b.h));
        if(dragging==0){VisualsClient.config.infoX=nx;VisualsClient.config.infoY=ny;}else{VisualsClient.config.keysX=nx;VisualsClient.config.keysY=ny;}return true;
    }
    @Override public boolean mouseReleased(double x,double y,int button){dragging=-1;return true;}
    @Override public boolean keyPressed(int key,int scan,int modifiers){
        if(key==GLFW.GLFW_KEY_ESCAPE||key==GLFW.GLFW_KEY_RIGHT_SHIFT){close();return true;}
        if(key==GLFW.GLFW_KEY_R){VisualsClient.config.resetPositions();return true;}return super.keyPressed(key,scan,modifiers);
    }
    @Override public boolean shouldPause(){return true;}
    @Override public void close(){if(!VisualsClient.config.save()&&!saveFailed){saveFailed=true;return;}VisualsClient.invalidate();client.setScreen(null);}
    @Override public void removed(){VisualsClient.config.save();VisualsClient.invalidate();}
}
