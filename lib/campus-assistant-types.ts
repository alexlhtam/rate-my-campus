/** Public, request-local research results. This module imports no server code. */
export type AssistantSource = {id:string;url:string;title:string};
export type AssistantSuggestion = {
  id:string;
  name:string;
  description:string;
  address:string;
  placeId?:string;
  lat?:number;
  lng?:number;
  locationProvider:'campus'|'google';
  sourceIds:string[];
  mapUrl?:string;
};
export type AssistantFilters = {
  query:string;
  category:'study'|'lecture'|'halls'|'rental'|'building'|null;
  near?:string|null;
  radiusKm?:number|null;
  dietary:('vegan'|'vegetarian'|'halal'|'gluten-free')[];
  openNow:boolean;
  tags:string[];
  layer:'rated'|'freebie'|'event'|'food'|'deal'|null;
  clarification?:string|null;
};
export type CampusAssistantResult = {
  answer:string;
  sources:AssistantSource[];
  suggestions:AssistantSuggestion[];
  filters?:AssistantFilters|null;
};
