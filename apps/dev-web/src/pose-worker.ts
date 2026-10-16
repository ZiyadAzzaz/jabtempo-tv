import {FilesetResolver,PoseLandmarker} from '@mediapipe/tasks-vision';
let pose:PoseLandmarker|undefined;
let mainTimeOrigin=0;
let initializing=false;
let lastTimestamp=-Infinity;
globalThis.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      if(initializing||pose)throw new Error('Pose worker is already initialized.');
      initializing=true;
      mainTimeOrigin=data.mainTimeOrigin??performance.timeOrigin;
      const files=await FilesetResolver.forVisionTasks('/assets/vision-wasm');
      pose=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/assets/models/pose_landmarker_full.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});
      postMessage({type:'ready'});
    }else if(data.type==='frame'){
      try{if(!pose)throw new Error('Pose worker is not ready.');if(!Number.isFinite(data.t)||data.t<=lastTimestamp)throw new Error('Frame timestamps must increase.');lastTimestamp=data.t;const begin=performance.now();const result=pose.detectForVideo(data.bitmap,data.t);const end=performance.now();postMessage({type:'pose',t:data.t,landmarks:result.landmarks[0]??[],inferenceMs:end-begin,inferenceEnd:performance.timeOrigin+end-mainTimeOrigin});}finally{data.bitmap?.close();}
    }
  }catch(error){postMessage({type:'error',message:error instanceof Error?error.message:'Pose failed'});}
};
