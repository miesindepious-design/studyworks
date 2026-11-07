import { sm2 } from './sm2.bundle.mjs';
const now = new Date();
let pq = ['Q0','Q1','Q2'].map(id=>({ id, question:id, answer:'a', type:'open', createdAt:now }));

// EXACT copy of FlashcardsView.tsx:95-106
const due = () => pq
  .filter(q => !q.nextReview || new Date(q.nextReview) <= now)
  .sort((a,b)=>{ if(!a.nextReview&&!b.nextReview) return 0; if(!a.nextReview) return -1; if(!b.nextReview) return 1;
                 return new Date(a.nextReview).getTime()-new Date(b.nextReview).getTime(); });

let idx = 0;
const cur = () => due()[idx % Math.max(due().length,1)];
for (let step=0; step<6; step++) {
  const q = cur();
  console.log(`step ${step}: idx=${idx} due=[${due().map(x=>x.id).join(',')}] -> showing ${q?.id}`);
  if (!q) break;
  pq = pq.map(x => x.id===q.id ? {...x, ...sm2(q,3), lastAnsweredCorrect:true} : x);
  const len = due().length;
  if (idx + 1 >= len) { console.log(`  after rating ${q.id}: due=[${due().map(x=>x.id).join(',')}] len=${len} -> idx+1(${idx+1})>=len(${len}) => SESSION COMPLETE`); break; }
  idx++;
}
