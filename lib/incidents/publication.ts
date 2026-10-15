type Row=Record<string,unknown>;
const iso=(value:unknown)=>new Date(Number(value)).toISOString();
/** Public shape of an incident row. Owner identity never leaves the server. */
export function publicIncident(row:Row,own=false):Row {
  const photo=row.photo_key?`/api/community/photo?key=${encodeURIComponent(String(row.photo_key))}`:null;
  return {
    id:row.id,type:'incident',category:row.category,severity:row.severity,title:row.title,description:row.description,location:row.location,
    lat:row.lat,lng:row.lng,photoKey:row.photo_key||null,photoUrl:photo,image:photo||undefined,
    status:row.status,createdAt:iso(row.created_at),expiresAt:iso(row.expires_at),
    resolvedAt:row.resolved_at==null?null:iso(row.resolved_at),resolution:row.resolution||null,
    confirmCount:Number(row.confirm_count||0),clearCount:Number(row.clear_count||0),
    revision:Number(row.moderation_revision||0),own,
    ...(own&&row.moderation_reason?{moderationReason:row.moderation_reason}:{}),
  };
}
