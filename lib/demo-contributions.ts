type Row = Record<string, any>;
/** Private sandbox changes only. The caller supplies local contributions, never seed rows. */
export function updateDemoContribution(state: Row, action: Row, now = Date.now()): Row {
  const tables: Record<string, string> = { review: 'reviews', post: 'posts', thread: 'threads', reply: 'replies' };
  const table = action.action === 'delete-own' ? tables[action.kind] : 'posts';
  if (!table || !['delete-own', 'close-post', 'update-post'].includes(action.action)) throw new Error('Choose a contribution to update.');
  const row = (state[table] || []).find((item: Row) => item.id === action.targetId);
  if (!row) throw new Error('This is not one of your demo contributions.');
  if (action.action === 'delete-own') {
    const removed = new Set([row.id, ...(table === 'threads' ? (state.replies || []).filter((reply: Row) => reply.threadId === row.id).map((reply: Row) => reply.id) : [])]);
    return { ...state, [table]: state[table].filter((item: Row) => !removed.has(item.id)),
      ...(table === 'threads' ? { replies: (state.replies || []).filter((reply: Row) => !removed.has(reply.id)) } : {}),
      votes: Object.fromEntries(Object.entries(state.votes || {}).filter(([id]) => !removed.has(id))),
      reports: (state.reports || []).filter((report: Row) => !removed.has(report.targetId)),
    };
  }
  if (action.action === 'close-post') return { ...state, posts: state.posts.map((item: Row) => item.id === row.id ? { ...item, expiresAt: new Date(Math.min(Date.parse(item.expiresAt), now)).toISOString() } : item) };
  if (Date.parse(row.expiresAt) <= now) throw new Error('This alert has expired. Create a new alert for a new offer.');
  const instructions = String(action.collectionInstructions || '').trim();
  const portions = action.portionsRemaining == null || action.portionsRemaining === '' ? null : Number(action.portionsRemaining);
  if (instructions.length > 500 || portions !== null && (!Number.isInteger(portions) || portions < 0 || portions > 10000)) throw new Error('Use up to 500 characters and a whole-number quantity between 0 and 10,000.');
  if (row.type !== 'food' && portions !== null) throw new Error('Portion counts apply to food alerts.');
  return { ...state, posts: state.posts.map((item: Row) => item.id === row.id ? { ...item, collectionInstructions: instructions, portionsRemaining: portions, ...(portions === 0 ? { expiresAt: new Date(now).toISOString() } : {}) } : item) };
}
