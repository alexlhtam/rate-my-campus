'use client';
/* eslint-disable @next/next/no-img-element -- QR images are generated data URLs on-device. */

import {useState} from 'react';
import {campusShareUrl,type ShareTarget} from '../lib/campus-links';
import './share-campus-link.css';

function LinkActions({url,label}:{url:string;label:string}) {
  const [message,setMessage]=useState(''),[qr,setQr]=useState(''),[busy,setBusy]=useState(false);
  async function copy() {
    try {await navigator.clipboard.writeText(url);setMessage('Link copied.')}
    catch {setMessage('Select and copy the address below.')}
  }
  async function share() {
    try {if(navigator.share)await navigator.share({title:label,url});else await copy()}
    catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setMessage('Use Copy link or the address below.')}
  }
  async function generateQr() {
    if(url.length>2200){setMessage('This link is too long for a useful QR code. Copy the address below.');return}
    setBusy(true);
    try {const qrcode=await import('qrcode');setQr(await qrcode.toDataURL(url,{width:320,margin:2,errorCorrectionLevel:'M',color:{dark:'#102924',light:'#ffffff'}}))}
    catch {setMessage('QR generation failed. The link below still works.')}
    finally {setBusy(false)}
  }
  return <div className="share-link-actions">
    <div className="share-row"><button type="button" onClick={copy}>Copy link</button><button type="button" onClick={share}>Share</button><button type="button" onClick={generateQr} disabled={busy}>{busy?'Making QR…':'Show QR'}</button></div>
    <label className="share-url">Share address<input aria-label={`Share address for ${label}`} value={url} readOnly onFocus={event=>event.currentTarget.select()}/></label>
    {qr&&<div className="share-qr"><img src={qr} alt={`QR code for ${label}`} width="240" height="240"/><a href={qr} download="rate-my-campus-qr.png">Download QR image</a></div>}
    {message&&<p role="status" className="share-note">{message}</p>}
  </div>;
}

export function ShareCampusLink({target,label}:{target:ShareTarget;label:string}) {
  const [base,setBase]=useState(''),[show,setShow]=useState(false);
  let url='';try {if(base)url=campusShareUrl(base,target)}catch {/* Invalid targets have no share address. */}
  return <div className="campus-share"><button type="button" onClick={()=>{setBase(window.location.href);setShow(value=>!value)}} aria-expanded={show}>Share {target.kind==='place'?'place':'alert'}</button>
    {show&&<div className="share-body"><p>{target.mode==='demo'?'Demo link: the recipient must open sample mode. Personal sandbox alerts only exist on this device and may be unavailable elsewhere.':'Community link: alerts may have expired or been removed when someone opens it.'}</p>{url&&<LinkActions key={url} url={url} label={label}/>}</div>}
  </div>;
}
