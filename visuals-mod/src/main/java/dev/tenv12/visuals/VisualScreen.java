package dev.tenv12.visuals;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.option.ParticlesMode;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;
import java.util.ArrayList;
import java.util.List;
import java.util.function.*;

/** Original client-only panel. No networking, entity scanning or gameplay automation. */
public final class VisualScreen extends Screen {
    private static final int W = 700, H = 430, FG = 0xFFF3EFFC, MUTED = 0xFFB4ADC6;
    private final VisualConfig cfg = VisualsClient.config;
    private final List<Control> controls = new ArrayList<>();
    private final long opened = System.nanoTime();
    private int tab = 0, focus = -1, dragging = -1;
    private float scale, originX, originY;
    private boolean saveFailed;
    private String[] displayValues = new String[0];
    private int refreshTicks;
    private static final String[] TABS = {"Интерфейс", "Изображение", "Инфо HUD", "Оформление"};
    private static final String[] NUMBERS = {"01","02","03","04"};
    private static final String[] TAGLINES = {"Всё нужное. Ничего лишнего.","Декор под контролем бюджета.","Полезная информация без сканирования мира.","Твой стиль. Лёгкие настройки."};
    private static final int[][] CORNERS = new int[13][];
    static { for(int r=0;r<CORNERS.length;r++){ CORNERS[r]=new int[r];for(int row=0;row<r;row++){double dy=r-row-.5;CORNERS[r][row]=(int)Math.ceil(r-Math.sqrt(r*r-dy*dy));}} }
    private void refreshValues(){displayValues=new String[controls.size()];for(int i=0;i<controls.size();i++)displayValues[i]=controls.get(i).value.get();}
    @Override public void tick(){if(++refreshTicks%4==0)refreshValues();}
    private record Control(int x, int y, int w, int h, String title, String description, int kind,
                           BooleanSupplier enabled, Supplier<String> value, IntConsumer change,
                           DoubleSupplier progress, DoubleConsumer setProgress) {}
    public VisualScreen() { super(Text.literal("10v12 Visuals")); }
    @Override protected void init() { geometry(); rebuild(); }
    private void geometry() {
        scale = Math.max(0.1f, Math.min(1.35f, Math.min((width - 20f) / W, (height - 20f) / H)));
        originX = (width - W * scale) / 2; originY = (height - H * scale) / 2;
    }
    private void toggle(int col, int row, String title, String description, BooleanSupplier get, Runnable change) {
        controls.add(new Control(180 + col * 254, 102 + row * 94, 242, 82, title, description, 0, get,
            () -> get.getAsBoolean() ? "ВКЛ" : "ВЫКЛ", ignored -> change.run(), null, null));
    }
    private void cycle(int col, int row, String title, String description, Supplier<String> value, IntConsumer change) {
        controls.add(new Control(180 + col * 254, 102 + row * 94, 242, 82, title, description, 1,
            () -> true, value, change, null, null));
    }
    private void slider(int col, int row, String title, String description, Supplier<String> value, DoubleSupplier get, DoubleConsumer set) {
        controls.add(new Control(180 + col * 254, 102 + row * 94, 242, 82, title, description, 2,
            () -> true, value, ignored -> {}, get, set));
    }
    private void rebuild() {
        controls.clear(); dragging = -1; focus = -1;
        if (tab == 0) {
            toggle(0,0,"Водяной знак","Компактный тег 10v12",() -> cfg.watermark,() -> cfg.watermark = !cfg.watermark);
            toggle(1,0,"Счётчик FPS","Текущая частота кадров",() -> cfg.fps,() -> cfg.fps = !cfg.fps);
            toggle(0,1,"Координаты","Только твоя позиция XYZ",() -> cfg.coordinates,() -> cfg.coordinates = !cfg.coordinates);
            toggle(1,1,"Точка прицела","Цветная точка вместо креста",() -> cfg.crosshair,() -> cfg.crosshair = !cfg.crosshair);
            toggle(0,2,"Часы","Локальное время компьютера",() -> cfg.clock,() -> cfg.clock = !cfg.clock);
            toggle(1,2,"Нажатые клавиши","WASD, пробел и приседание",() -> cfg.keystrokes,() -> cfg.keystrokes = !cfg.keystrokes);
        } else if (tab == 1) {
            slider(0,0,"Поле зрения","Стандартный FOV игры",() -> client.options.getFov().getValue() + "°",
                () -> (client.options.getFov().getValue()-70)/40.0,
                v -> client.options.getFov().setValue(70+(int)Math.round(v*40)));
            slider(1,0,"Яркость","Обычный диапазон Minecraft",() -> Math.round(client.options.getGamma().getValue()*100) + "%",
                () -> client.options.getGamma().getValue(), v -> client.options.getGamma().setValue(v));
            toggle(0,1,"Покачивание камеры","Движение камеры при ходьбе",() -> client.options.getBobView().getValue(),
                () -> client.options.getBobView().setValue(!client.options.getBobView().getValue()));
            cycle(1,1,"Частицы мира","Стандартная настройка игры",this::particleLabel, direction -> {
                ParticlesMode[] modes = {ParticlesMode.ALL,ParticlesMode.DECREASED,ParticlesMode.MINIMAL};
                int index = client.options.getParticles().getValue().ordinal();
                client.options.getParticles().setValue(modes[Math.floorMod(index + direction, modes.length)]);
            });
            toggle(0,2,"Светящаяся аура","Редкие искры; стоп при FPS < 45",() -> cfg.aura,() -> cfg.aura = !cfg.aura);
            toggle(1,2,"След из частиц","Общий лимит с аурой",() -> cfg.trail,() -> cfg.trail = !cfg.trail);
        } else if(tab == 2) {
            toggle(0,0,"Прочность брони","Проценты для 4 слотов",() -> cfg.armor,() -> cfg.armor=!cfg.armor);
            toggle(1,0,"Счётчик тотемов","Инвентарь и вторая рука",() -> cfg.totems,() -> cfg.totems=!cfg.totems);
            toggle(0,1,"Низкое здоровье","Спокойное предупреждение",() -> cfg.lowHp,() -> cfg.lowHp=!cfg.lowHp);
            toggle(1,1,"Свободные слоты","Основной инвентарь: 36 слотов",() -> cfg.freeSlots,() -> cfg.freeSlots=!cfg.freeSlots);
            cycle(0,2,"Редактор HUD","Перетаскивай блоки мышью",() -> "ОТКРЫТЬ",d -> client.setScreen(new HudEditorScreen()));
            cycle(1,2,"Порог здоровья","В очках HP: 2 HP = 1 сердце",() -> cfg.hpThreshold+" HP",d -> cfg.hpThreshold=2+Math.floorMod(cfg.hpThreshold-2+d*2,10));
        } else {
            cycle(0,0,"Акцент интерфейса","Шесть спокойных палитр",cfg::paletteName,d -> cfg.palette=Math.floorMod(cfg.palette+d,VisualConfig.COLORS.length));
            toggle(1,0,"Плавные анимации","Без анимаций в лёгком режиме",() -> cfg.animations,() -> cfg.animations=!cfg.animations);
            toggle(0,1,"Искры меню","Без декора в лёгком режиме",() -> cfg.sparkles,() -> cfg.sparkles=!cfg.sparkles);
            toggle(1,1,"Лёгкий режим","Не более 4 частиц в секунду",() -> cfg.performance,() -> cfg.performance=!cfg.performance);
            cycle(0,2,"Лёгкий пресет","Отключить декоративные эффекты",() -> "ПРИМЕНИТЬ",d -> cfg.lightPreset());
            cycle(1,2,"Позиции HUD","Вернуть блоки на место",() -> "СБРОСИТЬ",d -> cfg.resetPositions());
        }
        refreshValues();
    }
    private String particleLabel() {
        return switch (client.options.getParticles().getValue()) {
            case ALL -> "Все"; case DECREASED -> "Уменьшено"; case MINIMAL -> "Минимум";
        };
    }
    private void text(DrawContext c, String value, int x, int y, int color) { c.drawText(textRenderer,value,x,y,color,false); }
    private void heading(DrawContext c, String value, int x, int y, float fontScale, int color) {
        c.getMatrices().push(); c.getMatrices().translate(x,y,0); c.getMatrices().scale(fontScale,fontScale,1);
        c.drawText(textRenderer,value,0,0,color,false); c.getMatrices().pop();
    }
    public static void rounded(DrawContext c, int x, int y, int w, int h, int r, int color) {
        r = Math.max(0,Math.min(12,Math.min(r, Math.min(w,h)/2)));
        c.fill(x,y+r,x+w,y+h-r,color);
        for(int row=0;row<r;){int end=row+1,inset=CORNERS[r][row];while(end<r&&CORNERS[r][end]==inset)end++;
            c.fill(x+inset,y+row,x+w-inset,y+end,color);
            c.fill(x+inset,y+h-end,x+w-inset,y+h-row,color);row=end;
        }
    }
    private boolean inside(double x,double y,int rx,int ry,int w,int h) { return x>=rx&&x<rx+w&&y>=ry&&y<ry+h; }
    private double mx(double value) { return (value-originX)/scale; }
    private double my(double value) { return (value-originY)/scale; }
    @Override public void render(DrawContext c,int mouseX,int mouseY,float delta) {
        double x=mx(mouseX), y=my(mouseY); int accent=cfg.accent();
        c.fill(0,0,width,height,0x9B070912);
        c.getMatrices().push(); c.getMatrices().translate(originX,originY,0); c.getMatrices().scale(scale,scale,1);
        rounded(c,0,0,W,H,12,0xFF454052); rounded(c,1,1,W-2,H-2,11,0xF414151F);
        rounded(c,1,1,151,H-2,11,0xFF11121C); c.fill(141,1,152,H-1,0xFF11121C); c.fill(152,18,153,H-18,0xFF343040);
        rounded(c,20,25,28,28,7,accent); text(c,"V",31,35,0xFF191326); heading(c,"10v12",58,28,1.65f,FG); text(c,"VISUAL STUDIO",21,65,MUTED);
        text(c,"ТВОЙ ИНТЕРФЕЙС",20,100,0xFF958CA8);
        for(int i=0;i<TABS.length;i++) {
            int ry=126+i*44; boolean hover=inside(x,y,14,ry,124,34);
            if(tab==i||hover) rounded(c,14,ry,124,34,7,tab==i?0xFF29233D:0xFF1C1B29);
            text(c,NUMBERS[i],24,ry+12,tab==i?accent:MUTED);text(c,TABS[i],46,ry+12,tab==i?accent:0xFFD1CADA);
        }
        text(c,"ЧИСТО ВИЗУАЛЬНО",20,307,accent);text(c,"Твой стиль.",20,329,FG);text(c,"Твоё пространство.",20,344,FG);
        c.fill(20,376,132,377,0xFF343040);text(c,"Fabric 1.21.1",20,389,MUTED);text(c,"v1.1",107,389,MUTED);
        heading(c,TABS[tab],180,26,1.8f,FG);text(c,TAGLINES[tab],180,53,MUTED);
        rounded(c,617,22,60,23,6,0xFF242032);text(c,"RSHIFT",630,30,accent);text(c,"НАСТРОЙ ПОД СЕБЯ",180,82,0xFFA79ABF);
        double elapsed=(System.nanoTime()-opened)/1e9;
        for(int i=0;i<controls.size();i++) {
            Control a=controls.get(i); boolean hover=inside(x,y,a.x,a.y,a.w,a.h);
            int border=(i==focus)?accent:hover?0xFF756889:0xFF3C364A;
            rounded(c,a.x,a.y,a.w,a.h,8,border); rounded(c,a.x+1,a.y+1,a.w-2,a.h-2,7,hover?0xFF232130:0xFF1B1B29);
            text(c,a.title,a.x+14,a.y+14,FG);text(c,a.description,a.x+14,a.y+33,MUTED);
            if(a.kind==0) {
                boolean on=a.enabled.getAsBoolean(); rounded(c,a.x+a.w-47,a.y+12,33,16,8,on?0xFF574576:0xFF484152);
                rounded(c,a.x+a.w-44+(on?16:0),a.y+15,10,10,5,on?accent:0xFFC4BDCF);
                text(c,displayValues[i],a.x+14,a.y+59,on?accent:0xFFAAA1BA);
            } else if(a.kind==1) {
                text(c,displayValues[i],a.x+14,a.y+59,accent);text(c,"<   >",a.x+a.w-46,a.y+59,MUTED);
            } else {
                double p=Math.max(0,Math.min(1,a.progress.getAsDouble()));
                text(c,displayValues[i],a.x+a.w-52,a.y+14,accent);
                int track=a.w-28; c.fill(a.x+14,a.y+62,a.x+14+track,a.y+65,0xFF494051);
                c.fill(a.x+14,a.y+62,a.x+14+(int)(track*p),a.y+65,accent);
                rounded(c,a.x+11+(int)(track*p),a.y+59,7,9,3,accent);
            }
        }
        if(tab==3 && cfg.sparkles && !cfg.performance) for(int i=0;i<9;i++){
            int sx=430+(i*23)%220,sy=79+(int)((i*17+(cfg.animations?elapsed*5:0))%12);
            c.fill(sx,sy,sx+1,sy+1,0x887E6CA8);
        }
        c.fill(180,391,676,392,0xFF35303F);
        String help=saveFailed?"Не удалось сохранить. ESC ещё раз — выйти без сохранения.":"RSHIFT / ESC — закрыть   TAB — выбор   ENTER — изменить";
        text(c,help,180,406,saveFailed?0xFFFFB2B2:MUTED);
        // A restrained opening accent animation; no flicker or camera effects.
        int lineWidth=cfg.animations&&!cfg.performance?(int)(496*Math.min(1,elapsed/0.24)):496;c.fill(180,72,180+lineWidth,73,accent);
        c.getMatrices().pop();
    }
    private void activate(int index,int direction) {
        if(index<0||index>=controls.size())return; Control a=controls.get(index);
        if(a.kind==2) a.setProgress.accept(Math.max(0,Math.min(1,a.progress.getAsDouble()+direction*0.025)));
        else a.change.accept(direction);
        refreshValues();VisualsClient.invalidate();
    }
    private void slide(int index,double x) { Control a=controls.get(index);a.setProgress.accept(Math.max(0,Math.min(1,(x-a.x-14)/(a.w-28.0)))); refreshValues(); }
    @Override public boolean mouseClicked(double mouseX,double mouseY,int button) {
        double x=mx(mouseX),y=my(mouseY);if(button!=0&&button!=1)return false;
        for(int i=0;i<TABS.length;i++)if(inside(x,y,14,126+i*44,124,34)){tab=i;rebuild();return true;}
        for(int i=0;i<controls.size();i++){Control a=controls.get(i);if(inside(x,y,a.x,a.y,a.w,a.h)){focus=i;if(a.kind==2){dragging=i;slide(i,x);}else activate(i,button==1?-1:1);return true;}}
        return super.mouseClicked(mouseX,mouseY,button);
    }
    @Override public boolean mouseDragged(double mouseX,double mouseY,int button,double deltaX,double deltaY) {
        if(dragging>=0){slide(dragging,mx(mouseX));return true;}return super.mouseDragged(mouseX,mouseY,button,deltaX,deltaY);
    }
    @Override public boolean mouseReleased(double mouseX,double mouseY,int button) { dragging=-1;return super.mouseReleased(mouseX,mouseY,button); }
    @Override public boolean keyPressed(int key,int scanCode,int modifiers) {
        if(key==GLFW.GLFW_KEY_RIGHT_SHIFT||key==GLFW.GLFW_KEY_ESCAPE){close();return true;}
        if(key==GLFW.GLFW_KEY_TAB){int d=(modifiers&GLFW.GLFW_MOD_SHIFT)!=0?-1:1;focus=focus<0?(d>0?0:controls.size()-1):Math.floorMod(focus+d,controls.size());return true;}
        if(key>=GLFW.GLFW_KEY_1&&key<=GLFW.GLFW_KEY_4){tab=key-GLFW.GLFW_KEY_1;rebuild();return true;}
        if(key==GLFW.GLFW_KEY_ENTER||key==GLFW.GLFW_KEY_SPACE||key==GLFW.GLFW_KEY_RIGHT){activate(focus,1);return true;}
        if(key==GLFW.GLFW_KEY_LEFT){activate(focus,-1);return true;}
        return super.keyPressed(key,scanCode,modifiers);
    }
    @Override public boolean shouldPause() { return true; }
    @Override public void close() {
        if(!cfg.save()&&!saveFailed){saveFailed=true;return;}VisualsClient.invalidate();client.options.write();client.setScreen(null);
    }
    @Override public void removed() { cfg.save(); if(client!=null)client.options.write(); }
}
