/** Native players can briefly report zero when another sound starts. Only a
 * confirmed end-of-file wrap advances by the entire track duration. */
export class AudioPositionTracker {
  private rawMs=0;
  private elapsedMs=0;
  private offsetMs=0;
  private rollbackMs: number|undefined;
  private durationMs=0;
  setDuration(durationMs:number){if(!Number.isFinite(durationMs)||durationMs<=0)throw new RangeError('Invalid audio duration');this.durationMs=durationMs;}
  update(rawMs:number){
    if(!Number.isFinite(rawMs)||rawMs<0)throw new RangeError('Invalid audio position');
    if(rawMs<this.rawMs-100){
      if(this.rollbackMs!==undefined&&rawMs>=this.rollbackMs+20&&rawMs<this.rawMs-100){
        const completedLoop=this.durationMs>0&&this.rawMs>=this.durationMs-2000&&this.rollbackMs<=2000;
        this.offsetMs=completedLoop?this.offsetMs+this.durationMs:this.elapsedMs-rawMs;
        this.rawMs=rawMs;this.rollbackMs=undefined;
        this.elapsedMs=Math.max(this.elapsedMs,this.offsetMs+rawMs);
      }else if(this.rollbackMs===undefined||rawMs<this.rollbackMs-100)this.rollbackMs=rawMs;
      return this.elapsedMs;
    }
    this.rollbackMs=undefined;
    this.rawMs=Math.max(this.rawMs,rawMs);
    this.elapsedMs=Math.max(this.elapsedMs,this.offsetMs+rawMs);
    return this.elapsedMs;
  }
}
