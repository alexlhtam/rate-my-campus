'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Flag, GraduationCap, LoaderCircle, MessageCircle, Plus, Sparkles, Star, ThumbsDown, ThumbsUp } from 'lucide-react';
import { criteriaFor, criterionLabels, mergeRows, reviewYear } from '@/lib/community-view';

type Row = Record<string, any>;
type Props = { place: Row; demo: boolean; tab: string; reviews: Row[]; threads: Row[]; replies: Row[]; summary: Row; votes: Record<string, string>; ai: boolean; refreshKey?: unknown; onReview: () => void; onThread: () => void; onReport: (id: string) => void; onAction: (action: string, data: Row) => Promise<unknown>; onNotice: (message: string) => void };

export default function PlaceCommunity({ place, demo, tab, reviews, threads, replies, summary, votes, ai, refreshKey, onReview, onThread, onReport, onAction, onNotice }: Props) {
  const [loaded, setLoaded] = useState<Row[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [year, setYear] = useState('all'), [order, setOrder] = useState('recent'), [textSummary, setTextSummary] = useState(''), [summarizing, setSummarizing] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const source = useRef({ placeId: place.id, demo, tab, refreshKey });
  useEffect(() => { setLoaded([]); setOffset(0); setTotal(0); setActive(null); setTextSummary(''); setYear('all'); }, [place.id, demo, tab]);
  useEffect(() => {
    if (demo) return;
    const changed = source.current.placeId !== place.id || source.current.demo !== demo || source.current.tab !== tab || source.current.refreshKey !== refreshKey;
    source.current = { placeId: place.id, demo, tab, refreshKey };
    // A changed dataset invalidates offsets: merging just the last page would
    // retain removed/hidden earlier rows and omit newly published first rows.
    if (changed) { setLoaded([]); setTotal(0); setTextSummary(''); if (offset !== 0) { setOffset(0); return; } }
    let cancelled = false; setLoading(true); setError('');
    const params = new URLSearchParams({ placeId: place.id, kind: tab === 'reviews' ? 'reviews' : 'threads', offset: String(offset) });
    fetch(`/api/community/place?${params}`).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load this page.'); return body; }).then(body => {
      if (!cancelled) { setLoaded(previous => offset ? mergeRows(previous, body.rows || []) : body.rows || []); setTotal(Number(body.total || 0)); }
    }).catch(failure => { if (!cancelled) setError(failure.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [place.id, demo, tab, offset, refreshKey, retry]);
  const placeReviews = demo ? reviews.filter(row => row.placeId === place.id) : mergeRows(reviews.filter(row => row.placeId === place.id && row.own), tab === 'reviews' ? loaded : []);
  const years = [...new Set(placeReviews.map(reviewYear).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const shown = placeReviews.filter(row => year === 'all' || String(reviewYear(row)) === year).sort((a, b) => order === 'helpful' ? Number(b.helpful || 0) - Number(a.helpful || 0) : Number(reviewYear(b) || 0) - Number(reviewYear(a) || 0) || Date.parse(b.createdAt || '1970-01-01') - Date.parse(a.createdAt || '1970-01-01'));
  const placeThreads = demo ? threads.filter(row => row.placeId === place.id) : tab !== 'reviews' ? loaded : [];
  const more = !demo && loaded.length < total;
  return <>
    {tab === 'reviews' ? <>
      <div className="criteria-grid">{criteriaFor(place.category).map(key => { const value = Number(summary.criteria?.[key] || 0); return <div key={key}><span>{criterionLabels[key]}</span><div className="criterion-bar"><i style={{ width: `${value / 5 * 100}%` }} /></div><b>{value ? value.toFixed(1) : '—'}</b></div>; })}</div>
      <div className="summary-card"><Sparkles size={18} /><div><b>Students say</b><p>{textSummary || (summary.count ? 'A summary of the published reviews loaded below.' : 'Be the first to share an experience here.')}</p><button disabled={!ai || summarizing || !placeReviews.some(row => row.text && (row.status === 'approved' || row.demo))} onClick={async () => {
        setSummarizing(true); try { const response = await fetch('/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'summary', reviews: placeReviews.filter(row => row.status === 'approved' || row.demo && !row.status).map(row => row.text).filter(Boolean).slice(0, 30) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Summary unavailable.'); setTextSummary(result.summary); } catch (failure) { onNotice((failure as Error).message); } finally { setSummarizing(false); }
      }}>{summarizing ? 'Summarising…' : ai ? 'Summarise with Claude' : 'Claude connection needed'}</button></div></div>
      <div className="section-heading"><h3>The student perspective</h3><button className="button coral small" onClick={onReview}><Plus size={14} />Write or update review</button></div>
      <div className="review-filters"><label>Year<select value={year} onChange={event => setYear(event.target.value)}><option value="all">All years</option>{years.map(value => <option key={value!}>{value}</option>)}</select></label><label>Sort loaded reviews<select value={order} onChange={event => setOrder(event.target.value)}><option value="recent">Most recent</option><option value="helpful">Most helpful</option></select></label></div>
      {!demo && more && <p className="fineprint">Showing {loaded.length} of {total} reviews. Filters apply to loaded reviews; the scores above include every published review.</p>}
      {!loading && !error && !shown.length && <p className="empty-copy">{year === 'all' ? 'No reviews yet. Your firsthand experience can help the next student.' : 'No loaded reviews from this year.'}</p>}
      {shown.map(row => <article className="review" key={row.id}><div className="review-top"><span className="review-avatar"><GraduationCap size={17} /></span><div><b>{row.demo ? 'Demo student' : 'UCL account'}</b><small>{row.term}{row.year ? ` · ${row.year}` : ''}{row.status && row.status !== 'approved' ? ` · ${row.status}` : ''}</small></div><span className="review-score"><Star size={12} fill="currentColor" />{Number(row.rating).toFixed(1)}</span></div><p>{row.text}</p>{row.own && row.moderationReason && <p className="setup-note">{row.moderationReason}</p>}<div className="review-tags">{row.tags?.map((tag: string) => <span key={tag}>{tag}</span>)}</div><div className="review-actions"><button disabled={row.status && row.status !== 'approved'} className={votes[row.id] === 'helpful' ? 'voted' : ''} onClick={() => onAction('vote', { targetId: row.id, kind: 'helpful' }).catch(failure => onNotice(failure.message))}><ThumbsUp size={13} />Helpful {Number(row.helpful || 0) + (demo && votes[row.id] === 'helpful' ? 1 : 0)}</button><button disabled={row.status && row.status !== 'approved'} aria-label="Not helpful" aria-pressed={votes[row.id] === 'unhelpful'} onClick={() => onAction('vote', { targetId: row.id, kind: 'unhelpful' }).catch(failure => onNotice(failure.message))}><ThumbsDown size={13} /></button><button onClick={() => onReport(row.id)}><Flag size={12} />Report</button></div></article>)}
    </> : <>
      <div className="section-heading"><h3>Ask your campus</h3><button className="button coral small" onClick={onThread}><Plus size={14} />Start a conversation</button></div>
      {!loading && !error && !placeThreads.length && <p className="empty-copy">No conversations yet. Ask a question about this place.</p>}
      {placeThreads.map(thread => <article className="forum-thread" key={thread.id}><small>{thread.demo ? 'SAMPLE CONVERSATION' : 'UCL COMMUNITY'}{thread.status && thread.status !== 'approved' ? ` · ${thread.status} · visible only to you` : ''}</small><h3>{thread.title}</h3><p>{thread.text}</p>{thread.own && thread.moderationReason && <p className="setup-note">{thread.moderationReason}</p>}<div className="button-row"><button disabled={!!thread.status && thread.status !== 'approved'} onClick={() => setActive(active === thread.id ? null : thread.id)}><MessageCircle size={14} />{thread.replies || 0} replies · Join the conversation <ChevronDown size={13} /></button><button onClick={() => onReport(thread.id)} aria-label="Report discussion"><Flag size={13} /></button></div>{active === thread.id && (thread.status === 'approved' || thread.demo && !thread.status) && <Replies key={thread.id} placeId={place.id} threadId={thread.id} demo={demo} rows={replies.filter(row => row.threadId === thread.id)} refreshKey={refreshKey} onAction={onAction} onReport={onReport} onNotice={onNotice} />}</article>)}
    </>}
    {loading && <p role="status"><LoaderCircle className="spin" size={16} /> Loading…</p>}
    {error && <p role="alert" className="form-error">{error}<button className="text-link" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
    {more && <button disabled={loading} className="button light full" onClick={() => setOffset(loaded.length)}>Load more {tab === 'reviews' ? 'reviews' : 'conversations'}</button>}
  </>;
}

function Replies({ placeId, threadId, demo, rows, refreshKey, onAction, onReport, onNotice }: { placeId: string; threadId: string; demo: boolean; rows: Row[]; refreshKey?: unknown; onAction: Props['onAction']; onReport: Props['onReport']; onNotice: Props['onNotice'] }) {
  const [loaded, setLoaded] = useState<Row[]>([]), [offset, setOffset] = useState(0), [total, setTotal] = useState(0), [revision, setRevision] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const source = useRef({ placeId, threadId, demo, refreshKey });
  useEffect(() => {
    if (demo) return;
    const changed = source.current.placeId !== placeId || source.current.threadId !== threadId || source.current.demo !== demo || source.current.refreshKey !== refreshKey;
    source.current = { placeId, threadId, demo, refreshKey };
    if (changed) { setLoaded([]); setTotal(0); if (offset !== 0) { setOffset(0); return; } }
    let cancelled = false; setError(''); fetch(`/api/community/place?${new URLSearchParams({ placeId, threadId, kind: 'replies', offset: String(offset) })}`).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Replies unavailable'); return result; }).then(result => { if (!cancelled) { setLoaded(previous => offset ? mergeRows(previous, result.rows || []) : result.rows || []); setTotal(result.total || 0); } }).catch(failure => { if (!cancelled) setError(failure.message); }); return () => { cancelled = true; };
  }, [demo, placeId, threadId, offset, revision, refreshKey]);
  return <div className="replies">{(demo ? rows : loaded).map(row => <p key={row.id}><b>{row.demo ? 'Demo student' : 'UCL account'}{row.status && row.status !== 'approved' ? ` · ${row.status} · visible only to you` : ''}</b>{row.text}<button onClick={() => onReport(row.id)} aria-label="Report reply"><Flag size={12} /></button></p>)}{error && <p role="alert">{error}</p>}{!demo && loaded.length < total && <button onClick={() => setOffset(loaded.length)}>Load older replies</button>}<form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; setBusy(true); try { await onAction('reply', { threadId, text: new FormData(form).get('text') }); form.reset(); setOffset(0); setRevision(value => value + 1); } catch (failure) { onNotice((failure as Error).message); } finally { setBusy(false); } }}><input name="text" aria-label="Your reply" required maxLength={1500} placeholder="Share a little local knowledge…" /><button disabled={busy} className="button coral small">Reply</button></form></div>;
}
