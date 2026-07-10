#!/usr/bin/env npx tsx
import fs from 'node:fs';
import path from 'node:path';

interface Baseline {
  instrumentId: string;
  status: string;
  current: {
    mappings: number;
    roots: number;
    maxRoundRobins: number;
    payloadBytes: number;
    worstShiftSemitones: number;
    velocityRootCompleteness: number;
  };
  preliminaryBlockers?: string[];
  candidate: {
    mappings: number;
    roots: number;
    maxRoundRobins: number;
    orphanFiles: number;
    worstShiftSemitones: number;
    velocityRootCompleteness: number;
    deliveryFiles: number;
    payloadBytes: number;
    decodedPcmBytes: number;
    hardErrors: number;
    reviewFlags: number;
    reviewCodes: Record<string, number>;
    runtimeEventsChecked: number;
    runtimeSilentEvents: number;
    chromiumDecoded: number;
    webkitDecoded: number;
  };
}

function htmlEscapeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function buildReviewIndex(baselines: Baseline[]): string {
  for (const baseline of baselines) {
    const candidate = baseline.candidate;
    if (baseline.status === 'decision-ready') {
      if ((baseline.preliminaryBlockers?.length ?? 0) !== 0
          || candidate.hardErrors !== 0
          || candidate.orphanFiles !== 0
          || candidate.worstShiftSemitones > baseline.current.worstShiftSemitones
          || candidate.velocityRootCompleteness < baseline.current.velocityRootCompleteness
          || candidate.runtimeSilentEvents !== 0
          || candidate.runtimeEventsChecked <= 0
          || candidate.chromiumDecoded !== candidate.deliveryFiles
          || candidate.webkitDecoded !== candidate.deliveryFiles
          || candidate.decodedPcmBytes <= 0
          || candidate.decodedPcmBytes > 96 * 1024 * 1024) {
        throw new Error(`${baseline.instrumentId}: decision-ready baseline does not satisfy mechanical review gates`);
      }
    } else if (baseline.status !== 'blocked' || (baseline.preliminaryBlockers?.length ?? 0) === 0) {
      throw new Error(`${baseline.instrumentId}: unsupported or unexplained baseline status ${baseline.status}`);
    }
  }
  const candidates = baselines.map(baseline => ({
    ...baseline,
    blindUrl: `/__sample-pipeline/${baseline.instrumentId}/sample-lab.html`,
    runtimeUrl: `/__sample-pipeline/${baseline.instrumentId}/runtime-listening.html`,
    templateUrl: `/__sample-pipeline/${baseline.instrumentId}/listening-decision.template.json`,
    objectiveUrl: `/__sample-pipeline/${baseline.instrumentId}/reports/objective-audit.json`,
  }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keyboardia upgrade review</title><style>
:root{color-scheme:dark;font:14px/1.45 system-ui;background:#0d1015;color:#edf1f7}body{max-width:1300px;margin:auto;padding:24px}h1,h2{margin:.2em 0}.muted{color:#9da7b8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;margin-top:20px}.card{background:#161b24;border:1px solid #303846;border-radius:12px;padding:18px}.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:14px 0}.metric{background:#202734;border-radius:8px;padding:8px}.ok{color:#8eefad}.warn{color:#ffd37e}a,button{color:#fff;background:#2867d8;border:0;border-radius:7px;padding:8px 11px;text-decoration:none;font:inherit;font-weight:650;cursor:pointer}a.secondary,button.secondary{background:#303949}.links{display:flex;gap:8px;flex-wrap:wrap}label{display:block;margin:8px 0}input,select,textarea{width:100%;background:#202734;color:#fff;border:1px solid #414c5f;border-radius:7px;padding:8px}textarea{min-height:55px}.checks label{display:flex;gap:8px;align-items:flex-start}.checks input{width:auto;margin-top:4px}button:disabled{opacity:.4;cursor:not-allowed}.codes{font-size:12px}.pill{display:inline-block;padding:2px 8px;border-radius:99px;background:#243a2d;color:#9af0b2}.instructions{border-left:4px solid #69a1ff;padding-left:14px}.status{min-height:1.4em}</style></head><body>
<h1>Keyboardia existing-instrument upgrade review</h1><p class="instructions">These are exact Pipeline v2 candidates, not production files. Review the blinded low/mid/high anchors first, then the actual-runtime page. Numerical gates reject defects but do not choose timbre. Exporting a decision never modifies production.</p>
<p><span class="pill">${candidates.filter(candidate => candidate.status === 'decision-ready').length} decision-ready candidates</span> · ${candidates.filter(candidate => candidate.status === 'blocked').length} mechanically verified but blocked · ready candidates have zero hard defects, Chromium/WebKit decode, zero silent runtime events, and ≤96 MiB decoded PCM.</p><div class="grid" id="grid"></div>
<script>const candidates=${htmlEscapeJson(candidates)};
const protocols=['Blinded low/mid/high anchors reviewed','Dynamics and velocity transitions reviewed','Repeated notes and round robins reviewed','Held notes, releases, loops, and tail curation reviewed','Stereo image and mono compatibility reviewed','Actual-runtime musical phrase and full-set review completed'];
const mb=n=>(n/1048576).toFixed(1)+' MiB';
function render(){const grid=document.querySelector('#grid');for(const c of candidates){const card=document.createElement('section');card.className='card';if(c.status==='blocked'){card.innerHTML='<h2>'+c.instrumentId+'</h2><p class="warn"><b>Blocked before listening handoff</b></p><p>'+c.preliminaryBlockers.join('<br>')+'</p><p class="muted">Mechanical reports are retained for diagnosis, but this candidate cannot export an acceptance decision.</p>';grid.append(card);continue}const codeInputs=Object.entries(c.candidate.reviewCodes).map(([code,count])=>'<label class="codes">'+code+' ('+count+')<textarea data-code="'+code+'" placeholder="Required exact-finding disposition rationale"></textarea></label>').join('');card.innerHTML='<h2>'+c.instrumentId+'</h2><div class="metrics"><div class="metric">Mappings <b>'+c.current.mappings+' → '+c.candidate.mappings+'</b></div><div class="metric">Roots <b>'+c.current.roots+' → '+c.candidate.roots+'</b></div><div class="metric">Max RR <b>'+c.current.maxRoundRobins+' → '+c.candidate.maxRoundRobins+'</b></div><div class="metric">Payload <b>'+mb(c.current.payloadBytes)+' → '+mb(c.candidate.payloadBytes)+'</b></div><div class="metric">Decoded PCM <b>'+mb(c.candidate.decodedPcmBytes)+'</b></div><div class="metric">Review flags <b class="'+(c.candidate.reviewFlags?'warn':'ok')+'">'+c.candidate.reviewFlags+'</b></div></div><p class="ok">✓ '+c.candidate.chromiumDecoded+'/'+c.candidate.deliveryFiles+' Chromium and '+c.candidate.webkitDecoded+'/'+c.candidate.deliveryFiles+' WebKit decodes · '+c.candidate.runtimeEventsChecked+' runtime events · '+c.candidate.runtimeSilentEvents+' silent</p><div class="links"><a target="_blank" href="'+c.blindUrl+'">1. Blind A/B</a><a class="secondary" target="_blank" href="'+c.runtimeUrl+'">2. Runtime review</a><a class="secondary" target="_blank" href="'+c.templateUrl+'">Exact template</a><a class="secondary" target="_blank" href="'+c.objectiveUrl+'">Exact findings JSON</a></div><div class="checks">'+protocols.map((p,i)=>'<label><input type="checkbox" data-check="'+i+'">'+p+'</label>').join('')+'</div><label>Decision<select data-decision><option value="">Choose only after review</option><option value="accepted">Accept candidate</option><option value="rejected">Reject and retain current</option></select></label><label>Reviewer<input data-reviewer autocomplete="name"></label><label>Review notes<textarea data-notes placeholder="Identity, timbre, dynamics, tails, stereo, phrase, and any rejection reason"></textarea></label>'+codeInputs+'<button data-export disabled>Download exact decision JSON</button><p class="status muted"></p>';grid.append(card);
const controls=[...card.querySelectorAll('input,select,textarea')],button=card.querySelector('[data-export]'),status=card.querySelector('.status');const valid=()=>{const checks=[...card.querySelectorAll('[data-check]')].every(x=>x.checked),text=card.querySelector('[data-reviewer]').value.trim()&&card.querySelector('[data-notes]').value.trim(),decision=card.querySelector('[data-decision]').value,dispositions=[...card.querySelectorAll('[data-code]')].every(x=>x.value.trim());button.disabled=!(checks&&text&&decision&&dispositions)};controls.forEach(x=>x.addEventListener('input',valid));button.addEventListener('click',async()=>{try{const decision=await fetch(c.templateUrl).then(r=>{if(!r.ok)throw new Error('template HTTP '+r.status);return r.json()});decision.decision=card.querySelector('[data-decision]').value;decision.reviewer=card.querySelector('[data-reviewer]').value.trim();decision.reviewedAt=new Date().toISOString();decision.notes=card.querySelector('[data-notes]').value.trim();const rationale=Object.fromEntries([...card.querySelectorAll('[data-code]')].map(x=>[x.dataset.code,x.value.trim()]));for(const key of Object.keys(decision.reviewDispositions)){const code=key.slice(key.lastIndexOf(': ')+2);decision.reviewDispositions[key]=rationale[code]||''}const blob=new Blob([JSON.stringify(decision,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=c.instrumentId+'-decision.'+decision.decision+'.json';a.click();URL.revokeObjectURL(a.href);status.textContent='Downloaded exact '+decision.decision+' decision. Production is still unchanged.'}catch(error){status.textContent=String(error)}})}}render();</script></body></html>`;
}

function main(): void {
  const root = path.resolve('sample-pipeline/baselines');
  const baselines = fs.readdirSync(root).filter(filename => filename.endsWith('.json')).sort()
    .map(filename => JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8')) as Baseline);
  const output = path.resolve('public/__sample-pipeline/index.html');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buildReviewIndex(baselines));
  console.log(`Wrote ${output} (${baselines.filter(baseline => baseline.status === 'decision-ready').length} ready, ${baselines.filter(baseline => baseline.status === 'blocked').length} blocked)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
