package dev.tenv12.visuals;

/** Pure tick-based global limiter for particles created by THIS mod only. */
public final class ParticleBudget {
    private int window=Integer.MIN_VALUE, lastTick=Integer.MIN_VALUE, used;
    public void reset(){window=Integer.MIN_VALUE;lastTick=Integer.MIN_VALUE;used=0;}
    public boolean allow(int tick,int fps,boolean lite,boolean minimal){
        if(minimal||fps<45)return false;
        int bucket=Math.floorDiv(tick,20),limit=lite?4:10,gap=lite?5:2;
        if(bucket!=window){window=bucket;used=0;}
        if(lastTick!=Integer.MIN_VALUE&&tick>=lastTick&&tick-lastTick<gap)return false;
        if(used>=limit)return false;
        lastTick=tick;used++;return true;
    }
}
