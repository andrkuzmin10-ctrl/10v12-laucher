package dev.tenv12.visuals;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.option.ParticlesMode;
import net.minecraft.client.util.InputUtil;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.particle.ParticleTypes;
import org.lwjgl.glfw.GLFW;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;

/** Rendering reads cached values. Inventory and equipment are NEVER scanned per frame. */
public final class VisualsClient implements ClientModInitializer {
    public static VisualConfig config;
    private static KeyBinding menu;
    private static final EquipmentSlot[] ARMOR={EquipmentSlot.HEAD,EquipmentSlot.CHEST,EquipmentSlot.LEGS,EquipmentSlot.FEET};
    private static final String[] ARMOR_NAMES={"Ш ","Н ","П ","Б "};
    private static final DateTimeFormatter TIME=DateTimeFormatter.ofPattern("HH:mm");
    private static final ParticleBudget PARTICLES=new ParticleBudget();
    private static final String[] EMPTY=new String[0];
    private static String[] lines=EMPTY;
    private static final int[] KEY_WIDTHS=new int[6];
    private static final String[] KEY_LABELS={"W","A","S","D","SPACE","SHIFT"};
    private static int healthWidth;
    private static int panelWidth=130,panelHeight=24,keyMask,ticks;
    private static String armorText="",totemText="",slotsText="",clockText="",healthText="";
    private static boolean healthWarning,dirty=true;
    private static Object lastWorld;
    public static final class Bounds {
        public int x,y,w,h;
        public boolean contains(double px,double py){return px>=x&&px<x+w&&py>=y&&py<y+h;}
    }
    private static final Bounds INFO=new Bounds(),KEYS=new Bounds();
    @Override public void onInitializeClient(){
        config=VisualConfig.load();
        menu=KeyBindingHelper.registerKeyBinding(new KeyBinding("key.tenv12_visuals.menu",InputUtil.Type.KEYSYM,GLFW.GLFW_KEY_RIGHT_SHIFT,"category.tenv12_visuals"));
        ClientTickEvents.END_CLIENT_TICK.register(client->{
            while(menu.wasPressed())if(client.world!=null&&client.currentScreen==null)client.setScreen(new VisualScreen());
            update(client);
        });
        HudRenderCallback.EVENT.register((context,counter)->{
            MinecraftClient c=MinecraftClient.getInstance();
            if(config==null||c.world==null||c.player==null||c.currentScreen!=null||c.options.hudHidden||c.getDebugHud().shouldShowDebugHud())return;
            drawHud(context,false);
        });
    }
    public static void invalidate(){dirty=true;}
    public static void prepareEditor(){
        MinecraftClient c=MinecraftClient.getInstance();if(config==null||c.world==null||c.player==null)return;
        updateInventory(c);if(config.clock)clockText="Время  "+LocalTime.now().format(TIME);
        refresh(c);dirty=true;
    }
    public static void update(MinecraftClient c){
        if(config==null)return;
        if(c.world==null||c.player==null){lastWorld=null;lines=EMPTY;keyMask=0;healthWarning=false;dirty=true;PARTICLES.reset();return;}
        if(lastWorld!=c.world){lastWorld=c.world;ticks=0;dirty=true;PARTICLES.reset();}
        if(c.currentScreen!=null){keyMask=0;return;}
        ticks++;
        if(config.keystrokes)keyMask=(c.options.forwardKey.isPressed()?1:0)|(c.options.leftKey.isPressed()?2:0)|(c.options.backKey.isPressed()?4:0)|(c.options.rightKey.isPressed()?8:0)|(c.options.jumpKey.isPressed()?16:0)|(c.options.sneakKey.isPressed()?32:0);
        else keyMask=0;
        if(dirty||ticks%10==0)updateInventory(c);
        if(config.clock&&(dirty||ticks%20==0))clockText="Время  "+LocalTime.now().format(TIME);
        if(dirty||ticks%5==0)refresh(c);
        dirty=false;
        int age=c.player.age;
        if(!config.aura&&!config.trail)return;
        boolean minimal=c.options.getParticles().getValue()==ParticlesMode.MINIMAL;
        if(config.aura&&age%(config.performance?10:4)==0&&PARTICLES.allow(age,c.getCurrentFps(),config.performance,minimal)){
            double a=age*.15;
            c.world.addParticle(ParticleTypes.END_ROD,c.player.getX()+Math.cos(a)*.8,c.player.getY()+.6,c.player.getZ()+Math.sin(a)*.8,0,.015,0);
        }
        if(config.trail&&age%(config.performance?5:3)==0&&c.player.getVelocity().horizontalLengthSquared()>.001&&PARTICLES.allow(age,c.getCurrentFps(),config.performance,minimal))
            c.world.addParticle(ParticleTypes.END_ROD,c.player.getX(),c.player.getY()+.1,c.player.getZ(),0,.004,0);
    }
    private static void updateInventory(MinecraftClient c){
        if(config.armor){
            StringBuilder s=new StringBuilder("Броня  ");
            for(int i=0;i<ARMOR.length;i++){
                ItemStack item=c.player.getEquippedStack(ARMOR[i]);int max=item.getMaxDamage();
                s.append(ARMOR_NAMES[i]);
                if(item.isEmpty())s.append("—");else if(max<=0)s.append("∞");else s.append(Math.max(0,Math.min(100,Math.round((max-item.getDamage())*100f/max)))).append('%');
                if(i<3)s.append("  ");
            }
            armorText=s.toString();
        }
        if(config.totems||config.freeSlots){
            int totems=0,free=0;var inventory=c.player.getInventory();
            for(int i=0;i<inventory.size();i++){
                ItemStack item=inventory.getStack(i);
                if(config.totems&&item.isOf(Items.TOTEM_OF_UNDYING))totems+=item.getCount();
                if(config.freeSlots&&i<36&&item.isEmpty())free++;
            }
            totemText="Тотемы  "+totems;slotsText="Свободно  "+free+" / 36 слотов";
        }
    }
    private static void refresh(MinecraftClient c){
        ArrayList<String> next=new ArrayList<>(6);
        String title=config.watermark?"10v12":"";
        if(config.fps)title+=(title.isEmpty()?"":"  |  ")+c.getCurrentFps()+" FPS";
        if(!title.isEmpty())next.add(title);
        if(config.coordinates)next.add("XYZ  "+c.player.getBlockX()+" / "+c.player.getBlockY()+" / "+c.player.getBlockZ());
        if(config.clock)next.add(clockText);
        if(config.armor)next.add(armorText);
        if(config.totems)next.add(totemText);
        if(config.freeSlots)next.add(slotsText);
        lines=next.toArray(String[]::new);panelWidth=130;
        for(String line:lines)panelWidth=Math.max(panelWidth,c.textRenderer.getWidth(line)+20);
        panelHeight=Math.max(24,lines.length*14+12);
        float effective=c.player.getHealth()+c.player.getAbsorptionAmount();
        healthWarning=config.lowHp&&effective>0&&effective<=config.hpThreshold;
        if(healthWarning){healthText="МАЛО HP  "+(int)Math.ceil(effective);healthWidth=c.textRenderer.getWidth(healthText)+24;}
        for(int i=0;i<6;i++)KEY_WIDTHS[i]=c.textRenderer.getWidth(KEY_LABELS[i]);
    }
    public static boolean customCrosshairActive(){
        MinecraftClient c=MinecraftClient.getInstance();
        return config!=null&&config.crosshair&&c.player!=null&&!c.player.isSpectator()&&c.options.getPerspective().isFirstPerson()&&!c.getDebugHud().shouldShowDebugHud();
    }
    public static Bounds bounds(int group,int width,int height){
        Bounds b=group==0?INFO:KEYS;
        b.w=group==0?Math.min(Math.max(40,width-8),panelWidth):98;b.h=group==0?Math.min(Math.max(24,height-8),panelHeight):66;
        b.x=(int)Math.round(VisualConfig.unit(group==0?config.infoX:config.keysX)*Math.max(0,width-b.w));
        b.y=(int)Math.round(VisualConfig.unit(group==0?config.infoY:config.keysY)*Math.max(0,height-b.h));return b;
    }
    public static void drawHud(DrawContext ctx,boolean editor){
        MinecraftClient c=MinecraftClient.getInstance();if(config==null)return;
        int w=ctx.getScaledWindowWidth(),h=ctx.getScaledWindowHeight(),accent=config.accent();
        if(lines.length>0||editor){
            Bounds b=bounds(0,w,h);ctx.fill(b.x,b.y,b.x+b.w,b.y+b.h,0xD014151E);ctx.fill(b.x,b.y+4,b.x+2,b.y+b.h-4,accent);
            if(lines.length==0)ctx.drawText(c.textRenderer,"Инфо HUD (выключен)",b.x+10,b.y+8,0xFFB4ADC6,false);
            else for(int i=0;i<lines.length;i++)ctx.drawText(c.textRenderer,lines[i],b.x+10,b.y+7+i*14,i==0?accent:0xFFE0DCEB,false);
        }
        if(config.keystrokes||editor){Bounds b=bounds(1,w,h);drawKey(ctx,c,b.x+26,b.y,22,20,"W",1,editor);drawKey(ctx,c,b.x,b.y+23,22,20,"A",2,editor);drawKey(ctx,c,b.x+26,b.y+23,22,20,"S",4,editor);drawKey(ctx,c,b.x+52,b.y+23,22,20,"D",8,editor);drawKey(ctx,c,b.x,b.y+46,47,20,"SPACE",16,editor);drawKey(ctx,c,b.x+51,b.y+46,47,20,"SHIFT",32,editor);}
        if(!editor&&healthWarning){int ww=healthWidth,x=(w-ww)/2,y=Math.max(4,h-82);ctx.fill(x,y,x+ww,y+23,0xE03F1D2D);ctx.drawText(c.textRenderer,healthText,x+12,y+8,0xFFFFB4BF,false);}
        if(!editor&&customCrosshairActive()){int x=w/2,y=h/2;ctx.fill(x-2,y-2,x+3,y+3,0xB3090A10);ctx.fill(x-1,y-1,x+2,y+2,accent);}
    }
    private static void drawKey(DrawContext ctx,MinecraftClient c,int x,int y,int w,int h,String label,int bit,boolean editor){
        boolean pressed=!editor&&(keyMask&bit)!=0;ctx.fill(x,y,x+w,y+h,pressed?config.accent():0xD01B1A27);
        ctx.drawText(c.textRenderer,label,x+(w-KEY_WIDTHS[Integer.numberOfTrailingZeros(bit)])/2,y+6,pressed?0xFF181125:0xFFD5CFDF,false);
    }
}
