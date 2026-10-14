import {foodAvailability} from './food';
import {collectionUpdateInput,foodDetailsInput,foodPortions,foodRevision,postInput,textField} from './community-validation';
type Row=Record<string,any>;
export function demoFoodPost(data:Row,id:string,now=Date.now()):Row {
  const checked=postInput({...data,type:'food'},now);
  return {...checked,id,demo:true,own:true,status:'approved',createdAt:new Date(now).toISOString(),expiresAt:new Date(checked.expiresAt).toISOString(),startsAt:null,revision:0,availabilityUpdatedAt:new Date(now).toISOString(),closedAt:null,closureReason:null,freshStillCount:0,freshGoneCount:0,...(data.image?{image:data.image}:{})};
}
/** Owner edits use the same version/expiry rules as the server, without network requests. */
export function updateDemoFood(state:Row,body:Row,now=Date.now()):Row {
  const post=(state.posts||[]).find((row:Row)=>row.id===body.targetId&&row.type==='food');
  if(!post||!post.own)throw new Error('This is not one of your demo food alerts.');
  const available=foodAvailability(post,now);
  if(body.action!=='close-post'&&(!available.available||foodRevision(body.revision)!==Number(post.revision||0)))throw new Error('This pickup has ended or changed. Reopen the alert before updating it.');
  const update:Row={revision:Number(post.revision||0)+1,availabilityUpdatedAt:new Date(now).toISOString(),freshStillCount:0,freshGoneCount:0,lastAvailabilityFeedbackAt:null};
  function close(reason:string){update.closedAt=new Date(now).toISOString();update.closureReason=reason;update.expiresAt=new Date(Math.min(Date.parse(post.expiresAt),now)).toISOString();if(reason==='collected')update.portionsRemaining=0}
  if(body.action==='close-post'){
    const reason=body.reason||'ended';if(!['collected','ended','withdrawn'].includes(reason))throw new Error('Choose why collection is ending.');if(available.state==='closed')return state;close(reason);
  }else if(body.action==='food-availability'){
    update.portionsRemaining=foodPortions(body.portionsRemaining,true);if(update.portionsRemaining===0)close('collected');
  }else if(body.action==='update-post'){
    const value=collectionUpdateInput(body);update.collectionInstructions=textField(value.instructions,'Collection instructions',5,500);update.portionsRemaining=value.portions;update.foodDetails=foodDetailsInput(body.foodDetails??post.foodDetails);if(value.portions===0)close('collected');
  }else throw new Error('Unknown food action.');
  const feedback={...state.foodFeedback};delete feedback[post.id];
  return {...state,foodFeedback:feedback,posts:state.posts.map((row:Row)=>row.id===post.id?{...row,...update}:row)};
}
export function demoFoodFeedback(state:Row,post:Row,kind:string,now=Date.now()):Row {
  if(post.own)throw new Error('Use your pickup controls to update availability.');
  if(!foodAvailability(post,now).available)throw new Error('This food is no longer available.');
  if(!['still','gone'].includes(kind))throw new Error('Choose an availability update.');
  return {...state,votes:{...state.votes,[post.id]:kind},foodFeedback:{...state.foodFeedback,[post.id]:{kind,at:now}}};
}
export function withDemoFoodFeedback(post:Row,feedback:Row|undefined,now=Date.now()):Row {
  const fresh=feedback&&typeof feedback.at==='number'&&Number.isFinite(feedback.at)&&feedback.at<=now&&feedback.at>now-30*60000&&feedback.at>=Date.parse(post.availabilityUpdatedAt||post.createdAt||'1970-01-01');
  return {...post,freshStillCount:fresh&&feedback.kind==='still'?1:0,freshGoneCount:fresh&&feedback.kind==='gone'?1:0,lastAvailabilityFeedbackAt:fresh?new Date(feedback.at).toISOString():null};
}
