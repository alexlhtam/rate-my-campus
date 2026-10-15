'use client';
import {ExternalLink, MapPin, Sparkles, X} from 'lucide-react';
import type {CampusAssistantResult, AssistantSuggestion} from '@/lib/campus-assistant-types';
import {assistantHasLocation} from '@/lib/campus-assistant-view';
import './campus-assistant.css';

export function AssistantAnswer({answer, sources}: Pick<CampusAssistantResult, 'answer' | 'sources'>) {
  // Text remains text. Only server-validated citation IDs become links.
  return <>{answer.split(/(\[[a-zA-Z0-9_-]+\])/g).map((part, index) => {
    const source = sources.find(item => `[${item.id}]` === part);
    return source ? <a key={index} className="assistant-citation" href={source.url} target="_blank" rel="noreferrer" title={source.title}>[{sources.indexOf(source) + 1}]</a> : part;
  })}</>;
}

export function AssistantSuggestionCard({item, sources, onFocus, onOpenPlace, googleAvailable, compact = false}: {
  item: AssistantSuggestion; sources: CampusAssistantResult['sources']; onFocus: (id: string) => void;
  onOpenPlace: (id: string) => void; googleAvailable: boolean; compact?: boolean;
}) {
  const located = assistantHasLocation(item);
  const canMap = located && (item.locationProvider !== 'google' || googleAvailable);
  return <article className="assistant-suggestion">
    <h3>{item.name}</h3><p className="assistant-address">{item.address}</p>
    <p><AssistantAnswer answer={item.description} sources={sources}/></p>
    {!located && <small>A precise map location hasn’t been confirmed.</small>}
    {located && item.locationProvider === 'campus' && <small>Pin marks the building, not a room or entrance.</small>}
    {located && item.locationProvider === 'google' && !googleAvailable && <small>Open the Google Maps link while the campus map is unavailable.</small>}
    <div className="assistant-actions">
      {!compact && canMap && <button type="button" onClick={() => onFocus(item.id)}><MapPin size={13}/>Show on map</button>}
      {item.placeId && <button type="button" onClick={() => onOpenPlace(item.placeId!)}>Place details</button>}
      {item.mapUrl && <a className="assistant-google-attribution" href={item.mapUrl} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={12}/></a>}
    </div>
    <div className="assistant-place-sources">{item.sourceIds.map(id => sources.find(source => source.id === id)).filter(source => !!source).map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={10}/></a>)}</div>
  </article>;
}

export default function CampusAssistantResults({result, onFocus, onOpenPlace, googleAvailable, previous = false}: {
  result: CampusAssistantResult; onFocus: (id: string) => void; onOpenPlace: (id: string) => void; googleAvailable: boolean; previous?: boolean;
}) {
  return <section className="assistant-results" aria-label="Researched campus suggestions">
    {result.suggestions.length > 0 && <><div className="assistant-results-heading"><Sparkles size={13}/><b>{previous ? 'Previous suggestions' : 'Places for your question'}</b></div>
    {result.suggestions.map(item => <AssistantSuggestionCard key={item.id} item={item} sources={result.sources} onFocus={onFocus} onOpenPlace={onOpenPlace} googleAvailable={googleAvailable}/>)}</>}
    {result.sources.length > 0 && <details className="assistant-all-sources"><summary>Sources · {result.sources.length}</summary>{result.sources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{index + 1}. {source.title}<ExternalLink size={11}/></a>)}</details>}
  </section>;
}

export function AssistantMapCard({item, sources, onClose, onOpenPlace}: {
  item: AssistantSuggestion; sources: CampusAssistantResult['sources']; onClose: () => void; onOpenPlace: (id: string) => void;
}) {
  return <section className="assistant-map-card" aria-label={`${item.name} search pin`}>
    <button type="button" className="assistant-map-close" onClick={onClose} aria-label="Close search pin"><X size={16}/></button>
    <div className="assistant-results-heading"><Sparkles size={13}/><b>From your search</b></div>
    <AssistantSuggestionCard item={item} sources={sources} onFocus={() => {}} onOpenPlace={onOpenPlace} googleAvailable compact/>
  </section>;
}
