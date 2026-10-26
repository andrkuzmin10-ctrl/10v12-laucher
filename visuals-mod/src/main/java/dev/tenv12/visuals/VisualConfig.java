package dev.tenv12.visuals;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

public final class VisualConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("10v12-visuals.json");
    public static final int[] COLORS = {0xFFB4A0FF,0xFF91DFBE,0xFF95C7FF,0xFFFFABD1,0xFFFFCE88,0xFFE0E0EA};
    private static final String[] NAMES = {"Лавандовый","Мятный","Небесный","Розовый","Янтарный","Монохром"};
    public int schema = 0;
    public boolean watermark=true, fps=true, coordinates=false, crosshair=false;
    public boolean clock=false, keystrokes=false, armor=false, totems=false, lowHp=false, freeSlots=false;
    public boolean aura=false, trail=false, animations=false, sparkles=false, performance=true;
    public int palette=0, hpThreshold=6;
    public double infoX=0.015, infoY=0.025, keysX=0.015, keysY=0.85;
    public int accent() { return COLORS[Math.floorMod(palette,COLORS.length)]; }
    public String paletteName() { return NAMES[Math.floorMod(palette,NAMES.length)]; }
    public void lightPreset() { performance=true; aura=false; trail=false; animations=false; sparkles=false; }
    public void resetPositions() { infoX=.015;infoY=.025;keysX=.015;keysY=.85; }
    public void sanitize() {
        palette=Math.floorMod(palette,COLORS.length);hpThreshold=Math.max(2,Math.min(10,hpThreshold));
        infoX=unit(infoX);infoY=unit(infoY);keysX=unit(keysX);keysY=unit(keysY);
        if(schema<2){lightPreset();schema=2;}
    }
    public static double unit(double n) { return Double.isFinite(n)?Math.max(0,Math.min(1,n)):0; }
    public static VisualConfig load() {
        try {
            if(Files.isRegularFile(FILE)){
                VisualConfig c=GSON.fromJson(Files.readString(FILE,StandardCharsets.UTF_8),VisualConfig.class);
                if(c!=null){c.sanitize();return c;}
            }
        }catch(Exception e){LoggerFactory.getLogger("10v12-visuals").warn("Could not read visual settings; using defaults.",e);}
        VisualConfig c=new VisualConfig();c.schema=2;return c;
    }
    public boolean save() {
        try {
            schema=2;Files.createDirectories(FILE.getParent());Path temp=FILE.resolveSibling(FILE.getFileName()+".tmp");
            Files.writeString(temp,GSON.toJson(this),StandardCharsets.UTF_8);
            try{Files.move(temp,FILE,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
            catch(AtomicMoveNotSupportedException e){Files.move(temp,FILE,StandardCopyOption.REPLACE_EXISTING);}
            return true;
        }catch(IOException e){LoggerFactory.getLogger("10v12-visuals").warn("Could not save visual settings.",e);return false;}
    }
}
