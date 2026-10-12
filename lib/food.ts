/** Information declared by the sharer, never a food-safety certification. */
export const FOOD_ALLERGENS = [
  {id:'celery',label:'Celery'}, {id:'cereals-gluten',label:'Cereals containing gluten'},
  {id:'crustaceans',label:'Crustaceans'}, {id:'eggs',label:'Eggs'}, {id:'fish',label:'Fish'},
  {id:'lupin',label:'Lupin'}, {id:'milk',label:'Milk'}, {id:'molluscs',label:'Molluscs'},
  {id:'mustard',label:'Mustard'}, {id:'peanuts',label:'Peanuts'}, {id:'sesame',label:'Sesame'},
  {id:'soybeans',label:'Soybeans'}, {id:'sulphites',label:'Sulphur dioxide / sulphites'},
  {id:'tree-nuts',label:'Tree nuts'},
] as const;
export type FoodAllergen = typeof FOOD_ALLERGENS[number]['id'];
export const FOOD_DIETARY = ['vegetarian','vegan','halal','gluten-free','dairy-free'] as const;
export type FoodDetails = {allergenStatus:'unknown'|'provided';allergens:FoodAllergen[];ingredients:string;handling:string;sourceLabel:string;pickupAccess:'ucl'|'public'|'ask';bringContainer:boolean};
export const emptyFoodDetails = ():FoodDetails => ({allergenStatus:'unknown',allergens:[],ingredients:'',handling:'',sourceLabel:'',pickupAccess:'ask',bringContainer:false});
/** Safe display/persistence decoder for older or untrusted records. Server writes validate separately. */
export function readFoodDetails(input:unknown):FoodDetails {
  const row=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const text=(key:string,max:number)=>typeof row[key]==='string'?(row[key] as string).trim().slice(0,max):'';
  const known=new Set<string>(FOOD_ALLERGENS.map(item=>item.id));
  const allergens=Array.isArray(row.allergens)?[...new Set(row.allergens.filter((value):value is FoodAllergen=>typeof value==='string'&&known.has(value)))]:[];
  const ingredients=text('ingredients',500),provided=row.allergenStatus==='provided'&&(allergens.length>0||ingredients.length>0);
  return {allergenStatus:provided?'provided':'unknown',allergens:provided?allergens:[],ingredients,handling:text('handling',300),sourceLabel:text('sourceLabel',100),pickupAccess:row.pickupAccess==='ucl'||row.pickupAccess==='public'?row.pickupAccess:'ask',bringContainer:row.bringContainer===true};
}
type Row=Record<string,any>;
export function foodAvailability(post:Row,now=Date.now()) {
  const end=Date.parse(post.expiresAt),start=post.startsAt?Date.parse(post.startsAt):0;
  const remainingMs=Number.isFinite(end)?Math.max(0,end-now):0;
  const closed=!!post.closedAt||!!post.closureReason||post.portionsRemaining===0||post.status==='gone';
  const state=closed?'closed':!remainingMs?'expired':post.status&&post.status!=='approved'&&post.status!=='gone'?post.status==='pending'?'pending':'unavailable':start>now?'upcoming':'available';
  const seconds=Math.floor(remainingMs/1000);
  const countdown=seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  const label=state==='pending'?'Awaiting moderation':state==='unavailable'?'Unavailable':state==='upcoming'?'Not available yet':state==='expired'?'Collection ended':state==='closed'?(post.closureReason==='collected'||post.portionsRemaining===0?'All collected':post.closureReason==='withdrawn'?'Withdrawn':post.closureReason==='community-gone'?'Reported gone':'Collection ended'):`${countdown} left`;
  return {state,label,countdown,remainingMs,available:state==='available',endingSoon:state==='available'&&remainingMs<=10*60000};
}
export function foodQuantity(post:Row):string {
  return typeof post.portionsRemaining==='number'&&Number.isInteger(post.portionsRemaining)&&post.portionsRemaining>=0?`About ${post.portionsRemaining} portion${post.portionsRemaining===1?'':'s'}`:'Quantity not specified';
}
export function foodUpdatedLabel(post:Row,now=Date.now()):string {
  const time=Date.parse(post.availabilityUpdatedAt||post.createdAt||'');
  if(!Number.isFinite(time))return 'Availability not recently confirmed';
  const minutes=Math.max(0,Math.floor((now-time)/60000));
  return minutes<1?'Sharer updated just now':`Sharer updated ${minutes} min ago`;
}
export function foodMatches(post:Row,filters:{query?:string;dietary?:string;maxDistance?:number;distance?:(post:Row)=>number;endingSoon?:boolean},now=Date.now()):boolean {
  const availability=foodAvailability(post,now);if(!availability.available)return false;
  const info=readFoodDetails(post.foodDetails);
  const words=(filters.query||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text=[post.title,post.description,post.location,info.sourceLabel].join(' ').toLowerCase();
  if(words.some(word=>!text.includes(word)))return false;
  const dietary=Array.isArray(post.dietary)?post.dietary:[];
  if(filters.dietary&&filters.dietary!=='all'&&!dietary.some((tag:unknown)=>typeof tag==='string'&&tag.toLowerCase()===filters.dietary))return false;
  if(filters.maxDistance){const distance=filters.distance?.(post);if(typeof distance!=='number'||!Number.isFinite(distance)||distance<0||distance>filters.maxDistance)return false}
  return !filters.endingSoon||availability.endingSoon;
}
