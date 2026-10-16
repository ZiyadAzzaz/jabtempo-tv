export type AudioDriverProps={bpm:90|110|130;run:number;rate:number;active:boolean;paused:boolean;volume:number;onTick:(positionMs:number,receiptMs:number,latencyMs?:number)=>void;onError:(message:string)=>void};
export type AudioDriverHandle={cue:(kind:'perfect'|'good'|'guard'|'miss'|'combo')=>void};
